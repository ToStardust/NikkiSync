import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile, readdir,lstat,utimes } from 'node:fs/promises'
import { isIP } from 'node:net'
import path from 'node:path'

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 10_000
const ALLOWED_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

export interface MetadataThumbnailCacheConfig {
  cacheDir: string
  maxBytes?: number
  timeoutMs?: number
  fetchImpl?: typeof fetch
  maxCacheBytes?: number
  maxEntries?: number
  graceMs?: number
}

export interface CachedMetadataThumbnail {
  path: string
  mimeType: string
  sizeBytes: number
  sha256: string
}

type CacheRecord = {
  sourceUrl: string
  versionKey: string
  mimeType: string
  sizeBytes: number
  sha256: string
}

function cacheKey(sourceUrl: string, versionKey: string): string {
  return createHash('sha256').update(`${versionKey}\n${sourceUrl}`, 'utf8').digest('hex')
}

function normalizedContentType(value: string | null): string {
  return (value ?? '').split(';', 1)[0]!.trim().toLowerCase()
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isPrivateIpv4(host: string): boolean {
  const parts = host.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const [a, b] = parts
  return a === 0 || a === 10 || a === 127 || a! >= 224
    || (a === 100 && b! >= 64 && b! <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b! >= 16 && b! <= 31)
    || (a === 192 && b === 168)
}

function assertSafeHttpsUrl(raw: string): URL {
  let url: URL
  try { url = new URL(raw) }
  catch { throw new Error('metadata thumbnail source URL is invalid') }
  if (url.protocol !== 'https:') throw new Error('metadata thumbnail source must use HTTPS')
  if (url.username || url.password) throw new Error('metadata thumbnail source must not contain credentials')
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new Error('metadata thumbnail source must not target a local host')
  }
  const ipVersion = isIP(host)
  if (ipVersion === 4 && isPrivateIpv4(host)) throw new Error('metadata thumbnail source must not target a private address')
  if (ipVersion === 6) {
    const normalized = host.toLowerCase()
    if (normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) {
      throw new Error('metadata thumbnail source must not target a private address')
    }
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(normalized)
    if (mapped?.[1] && isPrivateIpv4(mapped[1])) throw new Error('metadata thumbnail source must not target a private address')
  }
  return url
}

export class MetadataThumbnailCache {
  private readonly maxBytes: number
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch
  private readonly inflight = new Map<string, Promise<CachedMetadataThumbnail>>()
  private budgetQueue: Promise<unknown> = Promise.resolve()
  private readonly maxCacheBytes: number
  private readonly maxEntries: number
  private readonly graceMs: number

  constructor(private readonly config: MetadataThumbnailCacheConfig) {
    if (!config.cacheDir) throw new Error('metadata thumbnail cacheDir is required')
    this.maxBytes = config.maxBytes ?? DEFAULT_MAX_BYTES
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.fetchImpl = config.fetchImpl ?? fetch
    this.maxCacheBytes=config.maxCacheBytes??128*1024*1024
    this.maxEntries=config.maxEntries??2048
    this.graceMs=config.graceMs??60000
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes < 1) throw new Error('metadata thumbnail maxBytes must be positive')
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1) throw new Error('metadata thumbnail timeoutMs must be positive')
    if(!Number.isSafeInteger(this.maxCacheBytes)||this.maxCacheBytes<this.maxBytes||!Number.isSafeInteger(this.maxEntries)||this.maxEntries<1||!Number.isSafeInteger(this.graceMs)||this.graceMs<0)throw new Error('metadata thumbnail cache budget is invalid')
  }

  async get(sourceUrl: string, versionKey = ''): Promise<CachedMetadataThumbnail> {
    const normalizedUrl = assertSafeHttpsUrl(sourceUrl).toString()
    const key = cacheKey(normalizedUrl, versionKey)
    const cached = await this.readCached(key, normalizedUrl, versionKey)
    if (cached) return cached
    const running = this.inflight.get(key)
    if (running) return await running
    const request = this.download(key, normalizedUrl, versionKey)
    this.inflight.set(key, request)
    try {
      return await request
    } finally {
      this.inflight.delete(key)
    }
  }

  private dataPath(key: string): string { return path.join(this.config.cacheDir, `${key}.img`) }
  private recordPath(key: string): string { return path.join(this.config.cacheDir, `${key}.json`) }

  private async readCached(key: string, sourceUrl: string, versionKey: string): Promise<CachedMetadataThumbnail | undefined> {
    try {
      if(!(await lstat(this.recordPath(key))).isFile())return undefined
      const record = JSON.parse(await readFile(this.recordPath(key), 'utf8')) as Partial<CacheRecord>
      if (record.sourceUrl !== sourceUrl || record.versionKey !== versionKey) return undefined
      if (typeof record.mimeType !== 'string' || !ALLOWED_CONTENT_TYPES.has(record.mimeType)) return undefined
      if (!positiveInteger(record.sizeBytes) || typeof record.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(record.sha256)) return undefined
      const dataPath = this.dataPath(key)
      const info = await lstat(dataPath)
      if (!info.isFile() || info.size !== record.sizeBytes || info.size > this.maxBytes) return undefined
      if(createHash('sha256').update(await readFile(dataPath)).digest('hex')!==record.sha256)return undefined
      const accessed=new Date();await utimes(dataPath,accessed,accessed)
      return { path: dataPath, mimeType: record.mimeType, sizeBytes: record.sizeBytes, sha256: record.sha256 }
    } catch {
      return undefined
    }
  }

  private async download(key: string, sourceUrl: string, versionKey: string): Promise<CachedMetadataThumbnail> {
    await mkdir(this.config.cacheDir, { recursive: true })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    let body: Buffer
    let mimeType: string
    try {
      const response = await this.fetchImpl(sourceUrl, {
        method: 'GET',
        redirect: 'follow',
        headers: { accept: 'image/png,image/jpeg,image/webp;q=0.9' },
        signal: controller.signal
      })
    if (!response.ok) throw new Error(`metadata thumbnail HTTP ${response.status}`)
    if (response.url) assertSafeHttpsUrl(response.url)
    mimeType = normalizedContentType(response.headers.get('content-type'))
    if (!ALLOWED_CONTENT_TYPES.has(mimeType)) throw new Error(`metadata thumbnail content type is not allowed: ${mimeType || 'missing'}`)
    const advertisedLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(advertisedLength) && advertisedLength > this.maxBytes) throw new Error('metadata thumbnail is too large')

    body = await this.readLimitedBody(response)
    if (body.length === 0) throw new Error('metadata thumbnail is empty')
    } finally {
      clearTimeout(timer)
    }
    const sha256 = createHash('sha256').update(body).digest('hex')
    const dataPath = this.dataPath(key)
    const recordPath = this.recordPath(key)
    const suffix = `.part-${process.pid}-${Date.now()}`
    const dataTemp = `${dataPath}${suffix}`
    const recordTemp = `${recordPath}${suffix}`
    const record: CacheRecord = { sourceUrl, versionKey, mimeType, sizeBytes: body.length, sha256 }
    const persist=async()=>{
     await this.pruneToFit(key,body.length)
     try {
      await writeFile(dataTemp, body, { flag: 'wx' })
      await writeFile(recordTemp, JSON.stringify(record), { encoding: 'utf8', flag: 'wx' })
      await rename(dataTemp, dataPath)
      await rename(recordTemp, recordPath)
    } catch (error) {
      await Promise.all([
        rm(dataTemp, { force: true }).catch(() => undefined),
        rm(recordTemp, { force: true }).catch(() => undefined)
      ])
      throw error
     }
    }
    const committed=this.budgetQueue.catch(()=>undefined).then(persist);this.budgetQueue=committed
    await committed
    return { path: dataPath, mimeType, sizeBytes: body.length, sha256 }
  }

  private async pruneToFit(currentKey:string,incoming:number):Promise<void>{
    const owned: {key:string;size:number;mtime:number}[]=[]
    for(const entry of await readdir(this.config.cacheDir,{withFileTypes:true})){
      if(!entry.isFile()||!/^[a-f0-9]{64}\.img$/.test(entry.name))continue
      const key=entry.name.slice(0,-4);if(key===currentKey)continue
      try{const info=await lstat(this.dataPath(key));if(info.isFile())owned.push({key,size:info.size,mtime:info.mtimeMs})}catch{}
    }
    let bytes=owned.reduce((total,x)=>total+x.size,0),count=owned.length
    for(const item of owned.sort((a,b)=>a.mtime-b.mtime||a.key.localeCompare(b.key))){
      if(bytes+incoming<=this.maxCacheBytes&&count+1<=this.maxEntries)break
      // Recent readers and in-flight fills are protected; refuse new fills rather than grow unbounded.
      if(this.inflight.has(item.key)||Date.now()-item.mtime<this.graceMs)continue
      await rm(this.dataPath(item.key),{force:true});await rm(this.recordPath(item.key),{force:true});bytes-=item.size;count--
    }
    if(bytes+incoming>this.maxCacheBytes||count+1>this.maxEntries)throw new Error('metadata thumbnail cache budget is busy')
  }

  private async readLimitedBody(response: Response): Promise<Buffer> {
    if (!response.body) return Buffer.alloc(0)
    const reader = response.body.getReader()
    const chunks: Buffer[] = []
    let total = 0
    while (true) {
      const part = await reader.read()
      if (part.done) break
      const chunk = Buffer.from(part.value)
      total += chunk.length
      if (total > this.maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new Error('metadata thumbnail is too large')
      }
      chunks.push(chunk)
    }
    return Buffer.concat(chunks, total)
  }
}
