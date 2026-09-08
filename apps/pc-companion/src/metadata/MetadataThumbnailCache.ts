import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 10_000
const ALLOWED_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp'])

export interface MetadataThumbnailCacheConfig {
  cacheDir: string
  maxBytes?: number
  timeoutMs?: number
  fetchImpl?: typeof fetch
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

export class MetadataThumbnailCache {
  private readonly maxBytes: number
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch
  private readonly inflight = new Map<string, Promise<CachedMetadataThumbnail>>()

  constructor(private readonly config: MetadataThumbnailCacheConfig) {
    if (!config.cacheDir) throw new Error('metadata thumbnail cacheDir is required')
    this.maxBytes = config.maxBytes ?? DEFAULT_MAX_BYTES
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
    this.fetchImpl = config.fetchImpl ?? fetch
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes < 1) throw new Error('metadata thumbnail maxBytes must be positive')
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1) throw new Error('metadata thumbnail timeoutMs must be positive')
  }

  async get(sourceUrl: string, versionKey = ''): Promise<CachedMetadataThumbnail> {
    if (!/^https:\/\//i.test(sourceUrl)) throw new Error('metadata thumbnail source must use HTTPS')
    const key = cacheKey(sourceUrl, versionKey)
    const cached = await this.readCached(key, sourceUrl, versionKey)
    if (cached) return cached
    const running = this.inflight.get(key)
    if (running) return await running
    const request = this.download(key, sourceUrl, versionKey)
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
      const record = JSON.parse(await readFile(this.recordPath(key), 'utf8')) as Partial<CacheRecord>
      if (record.sourceUrl !== sourceUrl || record.versionKey !== versionKey) return undefined
      if (typeof record.mimeType !== 'string' || !ALLOWED_CONTENT_TYPES.has(record.mimeType)) return undefined
      if (!positiveInteger(record.sizeBytes) || typeof record.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(record.sha256)) return undefined
      const dataPath = this.dataPath(key)
      const info = await stat(dataPath)
      if (!info.isFile() || info.size !== record.sizeBytes || info.size > this.maxBytes) return undefined
      return { path: dataPath, mimeType: record.mimeType, sizeBytes: record.sizeBytes, sha256: record.sha256 }
    } catch {
      return undefined
    }
  }

  private async download(key: string, sourceUrl: string, versionKey: string): Promise<CachedMetadataThumbnail> {
    await mkdir(this.config.cacheDir, { recursive: true })
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    let response: Response
    try {
      response = await this.fetchImpl(sourceUrl, {
        method: 'GET',
        redirect: 'follow',
        headers: { accept: 'image/png,image/jpeg,image/webp;q=0.9' },
        signal: controller.signal
      })
    } finally {
      clearTimeout(timer)
    }
    if (!response.ok) throw new Error(`metadata thumbnail HTTP ${response.status}`)
    if (response.url && !/^https:\/\//i.test(response.url)) throw new Error('metadata thumbnail redirect must remain HTTPS')
    const mimeType = normalizedContentType(response.headers.get('content-type'))
    if (!ALLOWED_CONTENT_TYPES.has(mimeType)) throw new Error(`metadata thumbnail content type is not allowed: ${mimeType || 'missing'}`)
    const advertisedLength = Number(response.headers.get('content-length'))
    if (Number.isFinite(advertisedLength) && advertisedLength > this.maxBytes) throw new Error('metadata thumbnail is too large')

    const body = await this.readLimitedBody(response)
    if (body.length === 0) throw new Error('metadata thumbnail is empty')
    const sha256 = createHash('sha256').update(body).digest('hex')
    const dataPath = this.dataPath(key)
    const recordPath = this.recordPath(key)
    const suffix = `.part-${process.pid}-${Date.now()}`
    const dataTemp = `${dataPath}${suffix}`
    const recordTemp = `${recordPath}${suffix}`
    const record: CacheRecord = { sourceUrl, versionKey, mimeType, sizeBytes: body.length, sha256 }
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
    return { path: dataPath, mimeType, sizeBytes: body.length, sha256 }
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
