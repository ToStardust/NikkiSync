import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { normalizeNuan5Photo } from '@nikkisync/core'
import type { DatabaseManager } from '@nikkisync/database'
import { inputFingerprint } from './MetadataInputFingerprint.js'
import { MetadataResolutionFailure, type MetadataResolutionOutcome, type PhotoMetadataResolveRequest,
  type PhotoMetadataResolveResult, type PhotoMetadataResolver } from './types.js'

export interface Nuan5CompatibleResolverConfig {
  endpoint?: string
  id?: string
  version?: string
  timeoutMs?: number
  /** May increase the provider's minimum 500 ms spacing. */
  minIntervalMs?: number
}

type DecodedPhoto = Record<string, unknown>
type PhotoTuple = [string, string]
type PhotoGroups = Record<string, PhotoTuple[]>
type Input = { uid: string; tuple: PhotoTuple; key: string; legacyKey: string; indexes: number[] }
type Job = { attempt_count: number; next_attempt_at: number; outcome: string; response_json: string | null }
type EndpointState = { next_attempt_at: number; pause_reason: string | null }
type BatchReply = { photos: Map<string, DecodedPhoto | null> }
  | { category: string; nextAttemptAt: number | null; pause: boolean }

const BATCH_SIZE = 50
const MAX_ATTEMPTS = 3
const MIN_SPACING = 500
const UNCERTAIN_RETRY_MS = 60_000
const pausedDatabases = new WeakSet<DatabaseManager>()
const gates = new Map<string, { tail: Promise<void>; nextAt: number; pause?: EndpointState }>()

export function pauseNuan5AfterDatabaseError(database: DatabaseManager): void {
  pausedDatabases.add(database)
}

export function nuan5QueueStatus(database: DatabaseManager, endpoints: readonly string[]): string | undefined {
  if (pausedDatabases.has(database)) return '本地数据库写入失败，在线解析已暂停。请检查磁盘空间及权限，再重启电脑端。'
  const read = database.connection.prepare('SELECT * FROM nuan5_endpoint_state WHERE endpoint = ?')
  const states = endpoints.map(endpoint => read.get(endpointKey(endpoint)) as EndpointState | undefined)
  if (states.some(state => state?.pause_reason && state.pause_reason !== 'rateLimited')) {
    return '在线服务访问被拒绝或返回异常，已暂停请求。请核对解析服务配置与接入权限。'
  }
  const cooling = states.some(state => state?.pause_reason === 'rateLimited' && state.next_attempt_at > Date.now())
  return cooling ? '在线服务正在限流，候补请求将在等待期结束后恢复。' : undefined
}

function endpointKey(value: string): string {
  const endpoint = new URL(value)
  endpoint.hash = ''
  return endpoint.toString()
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function decodeSegment(value: string | undefined): Buffer | undefined {
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return undefined
  const bytes = Buffer.from(value, 'base64')
  const canonical = bytes.toString('base64')
  return bytes.length && (value === canonical || value === canonical.replace(/=+$/, '')) ? bytes : undefined
}

function prepareInput(request: PhotoMetadataResolveRequest): Omit<Input, 'indexes'> | undefined {
  const hash = request.nativeParamNuan5Md5?.toLowerCase()
  if (!/^\d{1,32}$/.test(request.uid) || !hash || !/^[a-f0-9]{32}$/.test(hash)) return undefined
  const token = decodeSegment(request.nativeParamToken)
  const payload = decodeSegment(request.nativeParamPayload)
  if (!token || !payload) return undefined
  const tuple: PhotoTuple = [hash, Buffer.concat([token, payload]).toString('base64')]
  const key = createHash('sha256').update(JSON.stringify([request.uid, ...tuple])).digest('hex')
  const legacyKey = inputFingerprint(request.uid, request.nativeParamToken, request.nativeParamPayload, request.nativeParamNuan5Md5)
  return { uid: request.uid, tuple, key, legacyKey }
}

function retryAfter(value: string | null): number {
  const now = Date.now()
  if (value && /^\d+$/.test(value)) {
    const at = now + Number(value) * 1000
    if (Number.isSafeInteger(at)) return at
  } else if (value && /^[A-Za-z]{3},/.test(value)) {
    const at = Date.parse(value)
    if (Number.isFinite(at)) return Math.max(now, at)
  }
  return now + UNCERTAIN_RETRY_MS
}

function failed(category: string, nextAttemptAt: number | null = null): MetadataResolutionOutcome {
  return { status: 'rejected', reason: new MetadataResolutionFailure(category, nextAttemptAt) }
}

function parseResponse(value: unknown, groups: Map<string, Input[]>): Map<string, DecodedPhoto | null> {
  if (!Array.isArray(value) || value.length !== groups.size) throw new Error('unexpected response groups')
  const seen = new Set<string>()
  const photos = new Map<string, DecodedPhoto | null>()
  for (const pair of value) {
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || seen.has(pair[0])) throw new Error('invalid response group')
    const group = groups.get(pair[0])
    const rows: unknown = pair[1]
    if (!group || !Array.isArray(rows) || rows.length !== group.length) throw new Error('unexpected response length')
    seen.add(pair[0])
    for (let i = 0; i < group.length; i++) {
      const row: unknown = rows[i]
      const photo = recordOf(row)
      if (!photo && typeof row !== 'string') throw new Error('invalid decoded photo')
      photos.set(group[i]!.key, photo ?? null)
    }
  }
  return photos
}

export class Nuan5CompatibleResolver implements PhotoMetadataResolver {
  readonly batchSize = BATCH_SIZE
  readonly id: string
  readonly version: string | undefined
  private readonly endpoint: string
  private readonly spacing: number

  constructor(private readonly config: Nuan5CompatibleResolverConfig = {}) {
    this.id = config.id ?? 'nuan5-compatible'
    this.version = config.version
    this.endpoint = endpointKey(config.endpoint ?? 'https://nuan5.pro/api/decode-photo2')
    this.spacing = Math.max(MIN_SPACING, config.minIntervalMs ?? MIN_SPACING)
  }

  async resolve(request: PhotoMetadataResolveRequest, database?: DatabaseManager): Promise<PhotoMetadataResolveResult> {
    if (!database) throw new Error('NUAN5 requires the durable metadata queue')
    const [result] = await this.resolveBatch([request], database)
    if (result?.status === 'fulfilled') return result.value
    throw result?.reason
  }

  async resolveBatch(requests: readonly PhotoMetadataResolveRequest[], database: DatabaseManager): Promise<MetadataResolutionOutcome[]> {
    const outcomes: MetadataResolutionOutcome[] = []
    const inputs = new Map<string, Input>()
    for (const [index, request] of requests.entries()) {
      const input = prepareInput(request)
      if (!input) { outcomes[index] = failed('invalidInput'); continue }
      const duplicate = inputs.get(input.key)
      if (duplicate) duplicate.indexes.push(index)
      else inputs.set(input.key, { ...input, indexes: [index] })
    }
    const list = [...inputs.values()]
    for (let i = 0; i < list.length; i += BATCH_SIZE) {
      await this.process(list.slice(i, i + BATCH_SIZE), requests, database, outcomes)
    }
    return outcomes
  }

  private async process(inputs: Input[], requests: readonly PhotoMetadataResolveRequest[], database: DatabaseManager, outcomes: MetadataResolutionOutcome[]) {
    const gate = gates.get(this.endpoint) ?? { tail: Promise.resolve(), nextAt: 0 }
    gates.set(this.endpoint, gate)
    const previous = gate.tail
    let release!: () => void
    gate.tail = new Promise<void>(resolve => { release = resolve })
    await previous
    const setOutcome = (input: Input, outcome: MetadataResolutionOutcome) => {
      for (const index of input.indexes) outcomes[index] = outcome
    }
    try {
      if (pausedDatabases.has(database)) {
        for (const input of inputs) setOutcome(input, failed('databasePaused'))
        return
      }
      while (gate.nextAt > Date.now()) await delay(gate.nextAt - Date.now())
      const eligible = (index: number) => !requests[index]!.signal?.aborted && requests[index]!.isCurrent?.() !== false
      const active = inputs.filter(input => {
        if (input.indexes.some(eligible)) return true
        setOutcome(input, failed('cancelled', Date.now()))
        return false
      })
      if (!active.length) return
      const sql = database.connection
      const getJob = sql.prepare('SELECT * FROM nuan5_resolution WHERE endpoint = ? AND input_hash = ?')
      const getLegacy = sql.prepare(`SELECT json_extract(metadata_json, '$.raw.resolverResponse') AS response
        FROM assets WHERE json_valid(metadata_json)
          AND json_extract(metadata_json, '$.raw.resolver.inputFingerprint') = ?
          AND json_extract(metadata_json, '$.raw.resolver.status') = 'resolved'
          AND json_extract(metadata_json, '$.raw.resolver.provider') = ?
          AND json_type(metadata_json, '$.raw.resolverResponse') = 'object'
        LIMIT 1`)
      const getEndpoint = sql.prepare('SELECT * FROM nuan5_endpoint_state WHERE endpoint = ?')
      const setEndpoint = sql.prepare(`INSERT INTO nuan5_endpoint_state VALUES (?, ?, ?)
        ON CONFLICT(endpoint) DO UPDATE SET next_attempt_at = excluded.next_attempt_at, pause_reason = excluded.pause_reason`)
      const reserve = sql.prepare(`INSERT INTO nuan5_resolution VALUES (?, ?, 1, ?, 'interrupted', NULL)
        ON CONFLICT(endpoint, input_hash) DO UPDATE SET attempt_count = attempt_count + 1,
          next_attempt_at = excluded.next_attempt_at, outcome = 'interrupted'`)
      const finish = sql.prepare(`UPDATE nuan5_resolution SET next_attempt_at = ?, outcome = ?, response_json = ?
        WHERE endpoint = ? AND input_hash = ?`)
      const cacheLegacy = sql.prepare(`INSERT INTO nuan5_resolution VALUES (?, ?, 0, 0, 'success', ?)
        ON CONFLICT(endpoint, input_hash) DO UPDATE SET outcome = 'success', response_json = excluded.response_json`)
      const timeoutMs = this.config.timeoutMs ?? 12_000
      const now = Date.now()
      const batch = database.transaction(() => {
        const saved = getEndpoint.get(this.endpoint) as EndpointState | undefined
        const paused = [saved, gate.pause].find(state => state && (
          (state.pause_reason && state.pause_reason !== 'rateLimited') || state.next_attempt_at > now))
        const pending: Array<{ input: Input; attempt: number }> = []
        for (const input of active) {
          const job = getJob.get(this.endpoint, input.key) as Job | undefined
          const legacy = job?.response_json ? undefined : getLegacy.get(input.legacyKey, this.id)?.response as string | undefined
          if (job?.outcome === 'success' && job.response_json) {
            setOutcome(input, this.success(JSON.parse(job.response_json) as DecodedPhoto))
          } else if (legacy) {
            cacheLegacy.run(this.endpoint, input.key, legacy)
            setOutcome(input, this.success(JSON.parse(legacy) as DecodedPhoto))
          } else if (job?.outcome === 'rejectedPhoto' || (job && job.attempt_count >= MAX_ATTEMPTS)) {
            setOutcome(input, failed(job.outcome === 'rejectedPhoto' ? job.outcome : 'attemptLimit'))
          } else if (paused) {
            setOutcome(input, failed(paused.pause_reason ?? 'endpointWaiting',
              paused.pause_reason && paused.pause_reason !== 'rateLimited' ? null : paused.next_attempt_at))
          } else if (job && job.next_attempt_at > now) {
            setOutcome(input, failed(job.outcome, job.next_attempt_at))
          } else {
            reserve.run(this.endpoint, input.key, now + Math.max(timeoutMs, UNCERTAIN_RETRY_MS))
            pending.push({ input, attempt: (job?.attempt_count ?? 0) + 1 })
          }
        }
        if (pending.length) setEndpoint.run(this.endpoint, now + timeoutMs + this.spacing + 1000, null)
        return pending
      })
      if (!batch.length) return
      const signal = batch.flatMap(({ input }) => input.indexes.filter(eligible).map(index => requests[index]!.signal)).find(Boolean)
      const result = await this.send(batch.map(item => item.input), timeoutMs, signal)
      gate.nextAt = Date.now() + this.spacing
      if ('pause' in result && result.pause) {
        gate.pause = { pause_reason: result.category, next_attempt_at: result.nextAttemptAt ?? 0 }
      }
      database.transaction(() => {
        const pause = 'pause' in result && result.pause
        setEndpoint.run(this.endpoint, pause ? Math.max(gate.nextAt, result.nextAttemptAt ?? 0) : gate.nextAt,
          pause ? result.category : null)
        for (const { input, attempt } of batch) {
          if ('photos' in result) {
            const photo = result.photos.get(input.key)
            finish.run(0, photo ? 'success' : 'rejectedPhoto', photo ? JSON.stringify(photo) : null, this.endpoint, input.key)
            setOutcome(input, photo ? this.success(photo) : failed('rejectedPhoto'))
            continue
          }
          const nextAt = result.pause ? result.nextAttemptAt : Date.now() + UNCERTAIN_RETRY_MS * 2 ** (attempt - 1)
          finish.run(nextAt ?? 0, result.category, null, this.endpoint, input.key)
          setOutcome(input, failed(result.category, attempt < MAX_ATTEMPTS ? nextAt : null))
        }
      })
    } catch {
      pauseNuan5AfterDatabaseError(database)
      for (const input of inputs) setOutcome(input, failed('databasePaused'))
    } finally {
      release()
    }
  }

  private success(photo: DecodedPhoto): MetadataResolutionOutcome {
    return { status: 'fulfilled', value: { metadata: normalizeNuan5Photo(photo), provider: this.id,
      ...(this.version ? { providerVersion: this.version } : {}), rawResponse: photo } }
  }

  private async send(inputs: Input[], timeoutMs: number, signal?: AbortSignal): Promise<BatchReply> {
    const groups = new Map<string, Input[]>()
    for (const input of inputs) {
      const group = groups.get(input.uid)
      if (group) group.push(input)
      else groups.set(input.uid, [input])
    }
    const photos: PhotoGroups = Object.fromEntries([...groups].map(([uid, entries]) => [uid, entries.map(entry => entry.tuple)]))
    const timeout = AbortSignal.timeout(timeoutMs)
    const version = process.env.NIKKISYNC_DESKTOP_VERSION ?? ''
    const appVersion = /^[A-Za-z0-9._-]+$/.test(version) ? version : 'development'
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST', redirect: 'manual',
        headers: { 'content-type': 'application/json', accept: 'application/json', 'x-client': 'NikkiSync',
          'user-agent': `NikkiSync/${appVersion} (+https://github.com/ToStardust/NikkiSync)` },
        body: JSON.stringify({ photos, raw_data: true, raw_id: true }),
        signal: signal ? AbortSignal.any([timeout, signal]) : timeout
      })
      if (!response.ok) {
        void response.body?.cancel().catch(() => {})
        if (response.status === 429) return { category: 'rateLimited', nextAttemptAt: retryAfter(response.headers.get('Retry-After')), pause: true }
        if ([408, 500, 502, 503, 504].includes(response.status)) return { category: 'transientHttp', nextAttemptAt: null, pause: false }
        return { category: 'accessOrConfiguration', nextAttemptAt: null, pause: true }
      }
      const body = await response.text()
      try { return { photos: parseResponse(JSON.parse(body), groups) } }
      catch { return { category: 'invalidResponse', nextAttemptAt: null, pause: true } }
    } catch {
      return { category: signal?.aborted ? 'cancelled' : 'networkOrTimeout', nextAttemptAt: null, pause: false }
    }
  }
}
