import { createHash } from 'node:crypto'
import { mergePhotoMetadataGaps, type InfinityPhotoMetadata } from '@nikkisync/core'
import { AssetRepository, SyncReadRepository, type DatabaseManager } from '@nikkisync/database'
import { MetadataResolutionFailure, type MetadataResolutionOutcome, type MetadataResolverServiceConfig,
  type PhotoMetadataResolveRequest, type PhotoMetadataResolveResult, type PhotoMetadataResolver } from './types.js'
import { pauseNuan5AfterDatabaseError } from './Nuan5CompatibleResolver.js'
import { inputFingerprint } from './MetadataInputFingerprint.js'

export interface PhotoMetadataDictionaryEnricher {
  enrichMetadata(metadata: Partial<InfinityPhotoMetadata>): Partial<InfinityPhotoMetadata>
}

function metadataOf(row: Record<string, unknown>): Record<string, any> {
  try {
    return row.metadata_json ? JSON.parse(String(row.metadata_json)) as Record<string, any> : {}
  } catch {
    return {}
  }
}

function classifyPayload(payload: string | undefined): 'base64-envelope' | undefined {
  if (!payload || !/^[A-Za-z0-9+/=]+$/.test(payload) || payload.length % 4 !== 0) return undefined
  return 'base64-envelope'
}

function discardOldLocalValues(current: Partial<InfinityPhotoMetadata>, result: PhotoMetadataResolveResult) {
  const previous = result.previousLocalValues
  if (!previous) return current
  const base = { ...current }
  // Only replace values still equal to the old decoder output for this same original.
  if (current.camera && previous.camera) {
    const camera = { ...current.camera }
    for (const key of Object.keys(previous.camera) as (keyof typeof camera)[]) {
      if (camera[key] === previous.camera[key] && result.metadata.camera?.[key] !== undefined) delete camera[key]
    }
    base.camera = camera
  }
  for (const key of ['filter', 'lighting'] as const) {
    const old = previous[key], effect = current[key], updated = result.metadata[key]
    if (effect && old && effect.id === old.id && effect.strength === old.strength && updated?.id === effect.id
      && updated?.strength !== undefined) {
      const { strength, ...remaining } = effect
      base[key] = remaining
    }
  }
  return base
}

interface ResolutionWork {
  request: PhotoMetadataResolveRequest
  fingerprint: string
  attemptedAt: string
  inputIsCurrent: () => boolean
}

export class MetadataResolverService {
  private readonly assets: AssetRepository
  private timer: NodeJS.Timeout | undefined
  private running = false
  private stopped = false
  private activeRun: AbortController | undefined
  private readonly reads: SyncReadRepository
  private checked: { revision: number; provider: string; version: string | undefined; retryAt: number } | undefined
  private sweep: {
    revision: number; provider: string; version: string | undefined; retryAt: number
    after: { discoveredAt: string; assetId: string }
  } | undefined
  private readonly config: Required<MetadataResolverServiceConfig>

  constructor(
    private readonly database: DatabaseManager,
    private readonly resolver: PhotoMetadataResolver,
    config: MetadataResolverServiceConfig = {},
    private readonly dictionaryEnricher?: PhotoMetadataDictionaryEnricher
  ) {
    this.assets = new AssetRepository(database)
    this.reads = new SyncReadRepository(database)
    this.config = {
      enabled: config.enabled ?? true,
      canResolve: config.canResolve ?? (()=>true),
      intervalMs: config.intervalMs ?? 15_000,
      batchSize: config.batchSize ?? 0,
      retryAfterMs: config.retryAfterMs ?? 10 * 60_000,
      onWorkSettled: config.onWorkSettled ?? (() => {})
    }
  }

  start(): void {
    this.stopped=false
    if (!this.config.enabled || this.timer) return
    const tick = () => { void this.runOnce().catch(() => {}) }
    tick()
    this.timer = setInterval(tick, this.config.intervalMs)
  }

  stop(): void {
    this.stopped=true
    this.activeRun?.abort()
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  reconsider(): void {
    this.checked = undefined
    this.sweep = undefined
  }

  async runOnce(): Promise<number> {
    if (this.running || this.stopped || !this.config.enabled || !this.config.canResolve()) return 0
    const revision = this.reads.currentRevision(), provider = this.resolver.id, version = this.resolver.version
    if (this.checked?.revision === revision && this.checked.provider === provider && this.checked.version === version && Date.now() < this.checked.retryAt) return 0
    this.running = true
    const controller = this.activeRun = new AbortController()
    let resolved = 0, attempts = 0, retryAt = Infinity
    let expectedRevision = revision, externallyChanged = false, exhausted = false, visited = 0
    const continuation = this.sweep?.revision === revision && this.sweep.provider === provider
      && this.sweep.version === version && Date.now() < this.sweep.retryAt ? this.sweep : undefined
    let after = continuation?.after
    retryAt = continuation?.retryAt ?? Infinity
    const batchSize = Math.max(1, Math.floor(this.config.batchSize || this.resolver.batchSize || 12))
    const visitBudget = Math.max(128, batchSize)
    const recordMutation = (nextRevision: number) => {
      // Dictionary/scanner edits during an awaited request may affect rows before the cursor.
      if (nextRevision !== expectedRevision + 1) externallyChanged = true
      expectedRevision = nextRevision
    }
    const pending: ResolutionWork[] = []
    const applyResult = (work: ResolutionWork, outcome: MetadataResolutionOutcome) => {
      if (controller.signal.aborted || !this.config.canResolve() || !work.inputIsCurrent()) return
      const { request: { assetId }, fingerprint, attemptedAt } = work
      if (outcome.status === 'rejected') {
        if (work.request.localOnly) {
          retryAt = Math.min(retryAt, Date.parse(attemptedAt) + this.config.retryAfterMs)
          return
        }
        const error: unknown = outcome.reason
        const nextAttemptAt = error instanceof MetadataResolutionFailure
          ? error.nextAttemptAt : Date.parse(attemptedAt) + this.config.retryAfterMs
        if (nextAttemptAt !== null) retryAt = Math.min(retryAt, nextAttemptAt)
        const message = error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500)
        const terminal = error instanceof MetadataResolutionFailure
          && ['invalidInput', 'rejectedPhoto', 'attemptLimit'].includes(error.category)
        const prior = metadataOf(this.assets.getById(assetId)!).raw?.resolver
        if (prior?.status === 'failed' && prior.provider === provider && prior.providerVersion === version
          && prior.inputFingerprint === fingerprint && prior.error === message
          && prior.nextAttemptAt === (nextAttemptAt ?? 0) && prior.terminal === terminal) return
        recordMutation(this.assets.updateMetadata(assetId, { raw: { resolver: {
          status: 'failed', provider,
          ...(version ? { providerVersion: version } : {}),
          inputFingerprint: fingerprint, lastAttemptAt: attemptedAt, nextAttemptAt: nextAttemptAt ?? 0,
          terminal, error: message
        } } }))
        return
      }
      const result = outcome.value
      const enriched = this.dictionaryEnricher?.enrichMetadata(result.metadata) ?? result.metadata
      let enrichedMetadata = enriched
      if (this.resolver.usesPhotoFile) {
        const current = metadataOf(this.assets.getById(assetId)!)
        const base = work.request.localOnly && current.raw?.resolver?.provider === result.provider
          ? discardOldLocalValues(current, result) : current
        enrichedMetadata = mergePhotoMetadataGaps(base, enriched)
      }
      const providerRaw = enrichedMetadata.raw && typeof enrichedMetadata.raw === 'object'
        ? enrichedMetadata.raw as Record<string, unknown> : {}
      const providerVersion = result.providerVersion ?? version
      recordMutation(this.assets.updateMetadata(assetId, {
        ...enrichedMetadata,
        raw: {
          ...providerRaw,
          resolver: { status: 'resolved', provider: result.provider, ...(providerVersion ? { providerVersion } : {}),
            inputFingerprint: fingerprint, resolvedAt: new Date().toISOString() },
          ...(result.rawResponse === undefined ? {} : { resolverResponse: result.rawResponse })
        }
      }))
      resolved++
    }
    try {
      while (attempts < batchSize && visited < visitBudget && !this.stopped && this.config.canResolve()) {
        const pageSize = Math.min(batchSize, visitBudget - visited)
        const candidates = this.assets.listMetadataResolutionCandidates(pageSize, after)
        if (candidates.length === 0) { exhausted = true; break }
        for (const row of candidates) {
          if(controller.signal.aborted || !this.config.canResolve()) return resolved
          if (attempts >= batchSize) break
          visited++
          after = { discoveredAt: String(row.discovered_at), assetId: String(row.asset_id) }
          const metadata = metadataOf(row)
          const state = metadata.raw?.resolver
          const assetId = String(row.asset_id)
          const uid = String(row.uid ?? '')
          const token = String(metadata.raw?.nativeParamToken ?? '')
          const payload = typeof metadata.raw?.nativeParamPayload === 'string'
            ? String(metadata.raw.nativeParamPayload)
            : undefined
          const nuan5Md5 = typeof metadata.raw?.nativeParamNuan5Md5 === 'string'
            ? String(metadata.raw.nativeParamNuan5Md5)
            : undefined
          if (!uid || !token) continue
          const fingerprint = inputFingerprint(uid, token, payload, nuan5Md5)
          const inputIsCurrent = () => {
            const current = this.assets.getById(assetId)
            const raw = current ? metadataOf(current).raw : undefined
            const matches = !!current && current.asset_state !== 'deleted'
              && inputFingerprint(String(current.uid ?? ''), String(raw?.nativeParamToken ?? ''),
                typeof raw?.nativeParamPayload === 'string' ? raw.nativeParamPayload : undefined,
                typeof raw?.nativeParamNuan5Md5 === 'string' ? raw.nativeParamNuan5Md5 : undefined) === fingerprint
            if (!matches) externallyChanged = true
            return matches
          }
          const payloadMd5 = payload ? createHash('md5').update(payload, 'ascii').digest('hex') : undefined
          const payloadFormat = classifyPayload(payload)
          const payloadDecodedBytes = payloadFormat ? Buffer.from(payload!, 'base64').length : undefined
          const providerVersionMatches = version === undefined || String(state?.providerVersion ?? '') === version
          const resolvedSameInput = state?.status === 'resolved' && state.inputFingerprint === fingerprint
          const refreshLocal = resolvedSameInput && this.resolver.usesPhotoFile && state.provider === provider
            && typeof state.providerVersion === 'string' && typeof version === 'string'
            && state.providerVersion.split('+', 1)[0] !== version.split('+', 1)[0]
          if (resolvedSameInput && !refreshLocal
            && (this.resolver.usesPhotoFile || (state?.provider === this.resolver.id && providerVersionMatches))
          ) continue
          if (state?.status === 'failed'
            && state?.provider === this.resolver.id
            && providerVersionMatches
            && state?.inputFingerprint === fingerprint) {
            if (state.terminal === true) continue
            const nextAt = typeof state.nextAttemptAt === 'number' ? state.nextAttemptAt
              : Date.parse(String(state.lastAttemptAt)) + this.config.retryAfterMs
            if (nextAt > Date.now()) {
              retryAt = Math.min(retryAt, nextAt)
              continue
            }
          }
          attempts++
          const original = this.resolver.usesPhotoFile && row.asset_type === 'photo'
            ? this.reads.listResources(assetId).find(resource => resource.role === 'source_high_quality')
            : undefined
          const request: PhotoMetadataResolveRequest = {
            assetId, uid, nativeParamToken: token, signal: controller.signal, isCurrent: inputIsCurrent,
            ...(refreshLocal ? { localOnly: true } : {}),
            ...(typeof original?.source_path === 'string' && typeof original.sha256 === 'string'
              ? { sourcePhotoPath: original.source_path, sourcePhotoSha256: original.sha256 } : {}),
            ...(payload ? { nativeParamPayload: payload } : {}),
            ...(payloadMd5 ? { nativeParamPayloadMd5: payloadMd5 } : {}),
            ...(payloadFormat ? { nativeParamPayloadFormat: payloadFormat } : {}),
            ...(payloadDecodedBytes === undefined ? {} : { nativeParamPayloadDecodedBytes: payloadDecodedBytes }),
            ...(nuan5Md5 ? { nativeParamNuan5Md5: nuan5Md5 } : {})
          }
          const work = { request, fingerprint, attemptedAt: new Date().toISOString(), inputIsCurrent }
          if (this.resolver.resolveBatch) { pending.push(work); continue }
          let outcome: MetadataResolutionOutcome
          try {
            outcome = { status: 'fulfilled', value: await this.resolver.resolve(request, this.database) }
          } catch (reason) { outcome = { status: 'rejected', reason } }
          applyResult(work, outcome)
        }
        if (candidates.length < pageSize && attempts < batchSize) { exhausted = true; break }
      }
      if (pending.length && this.resolver.resolveBatch) {
        const outcomes = await this.resolver.resolveBatch(pending.map(work => work.request), this.database)
        pending.forEach((work, index) => applyResult(work, outcomes[index]!))
      }
      if (controller.signal.aborted || !this.config.canResolve()) return resolved
      if (this.reads.currentRevision() !== expectedRevision) externallyChanged = true
      this.checked = !externallyChanged && exhausted ? { revision: expectedRevision, provider, version, retryAt } : undefined
      this.sweep = !externallyChanged && !exhausted && after
        ? { revision: expectedRevision, provider, version, retryAt, after } : undefined
      return resolved
    } catch (error) {
      pauseNuan5AfterDatabaseError(this.database)
      throw error
    } finally {
      this.activeRun = undefined
      this.running = false
      if (attempts) this.config.onWorkSettled()
    }
  }
}
