import { createHash } from 'node:crypto'
import type { InfinityPhotoMetadata } from '@nikkisync/core'
import { AssetRepository, SyncReadRepository, type DatabaseManager } from '@nikkisync/database'
import type { MetadataResolverServiceConfig, PhotoMetadataResolver } from './types.js'

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

function inputFingerprint(uid: string, token: string, payload?: string, nuan5Md5?: string): string {
  return createHash('sha256').update(`${uid}\n${token}\n${payload ?? ''}\n${nuan5Md5 ?? ''}`, 'utf8').digest('hex')
}

function classifyPayload(payload: string | undefined): 'base64-envelope' | undefined {
  if (!payload || !/^[A-Za-z0-9+/=]+$/.test(payload) || payload.length % 4 !== 0) return undefined
  return 'base64-envelope'
}

export class MetadataResolverService {
  private readonly assets: AssetRepository
  private timer: NodeJS.Timeout | undefined
  private running = false
  private readonly reads: SyncReadRepository
  private checked: { revision: number; provider: string; version: string | undefined; retryAt: number } | undefined
  private sweep: {
    revision: number; provider: string; version: string | undefined; retryAt: number
    after: { discoveredAt: string; assetId: string }
  } | undefined
  private readonly config: Required<MetadataResolverServiceConfig>

  constructor(
    database: DatabaseManager,
    private readonly resolver: PhotoMetadataResolver,
    config: MetadataResolverServiceConfig = {},
    private readonly dictionaryEnricher?: PhotoMetadataDictionaryEnricher
  ) {
    this.assets = new AssetRepository(database)
    this.reads = new SyncReadRepository(database)
    this.config = {
      enabled: config.enabled ?? true,
      intervalMs: config.intervalMs ?? 15_000,
      batchSize: config.batchSize ?? 12,
      retryAfterMs: config.retryAfterMs ?? 10 * 60_000,
      onWorkSettled: config.onWorkSettled ?? (() => {})
    }
  }

  start(): void {
    if (!this.config.enabled || this.timer) return
    void this.runOnce()
    this.timer = setInterval(() => { void this.runOnce() }, this.config.intervalMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  async runOnce(): Promise<number> {
    if (this.running || !this.config.enabled) return 0
    const revision = this.reads.currentRevision(), provider = this.resolver.id, version = this.resolver.version
    if (this.checked?.revision === revision && this.checked.provider === provider && this.checked.version === version && Date.now() < this.checked.retryAt) return 0
    this.running = true
    let resolved = 0, attempts = 0, retryAt = Infinity
    let expectedRevision = revision, externallyChanged = false, exhausted = false, visited = 0
    const continuation = this.sweep?.revision === revision && this.sweep.provider === provider
      && this.sweep.version === version && Date.now() < this.sweep.retryAt ? this.sweep : undefined
    let after = continuation?.after
    retryAt = continuation?.retryAt ?? Infinity
    const batchSize = Math.max(1, Math.floor(this.config.batchSize))
    const visitBudget = Math.max(128, batchSize)
    const recordMutation = (nextRevision: number) => {
      // Dictionary/scanner edits during an awaited request may affect rows before the cursor.
      if (nextRevision !== expectedRevision + 1) externallyChanged = true
      expectedRevision = nextRevision
    }
    try {
      while (attempts < batchSize && visited < visitBudget) {
        const pageSize = Math.min(batchSize, visitBudget - visited)
        const candidates = this.assets.listMetadataResolutionCandidates(pageSize, after)
        if (candidates.length === 0) { exhausted = true; break }
        for (const row of candidates) {
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
          const payloadMd5 = payload ? createHash('md5').update(payload, 'ascii').digest('hex') : undefined
          const payloadFormat = classifyPayload(payload)
          const payloadDecodedBytes = payloadFormat ? Buffer.from(payload!, 'base64').length : undefined
          const currentProviderVersion = this.resolver.version
          const providerVersionMatches = currentProviderVersion === undefined
            || String(state?.providerVersion ?? '') === currentProviderVersion
          if (state?.status === 'resolved'
            && state?.provider === this.resolver.id
            && providerVersionMatches
            && state?.inputFingerprint === fingerprint) continue
          if (state?.status === 'failed'
            && state?.provider === this.resolver.id
            && providerVersionMatches
            && state?.inputFingerprint === fingerprint
            && state?.lastAttemptAt) {
            const elapsed = Date.now() - Date.parse(String(state.lastAttemptAt))
            if (Number.isFinite(elapsed) && elapsed < this.config.retryAfterMs) {
              retryAt = Math.min(retryAt, Date.parse(String(state.lastAttemptAt)) + this.config.retryAfterMs)
              continue
            }
          }
          const attemptedAt = new Date().toISOString()
          attempts++
          try {
            const result = await this.resolver.resolve({
              assetId, uid, nativeParamToken: token,
              ...(payload ? { nativeParamPayload: payload } : {}),
              ...(payloadMd5 ? { nativeParamPayloadMd5: payloadMd5 } : {}),
              ...(payloadFormat ? { nativeParamPayloadFormat: payloadFormat } : {}),
              ...(payloadDecodedBytes === undefined ? {} : { nativeParamPayloadDecodedBytes: payloadDecodedBytes }),
              ...(nuan5Md5 ? { nativeParamNuan5Md5: nuan5Md5 } : {})
            })
            const enrichedMetadata = this.dictionaryEnricher?.enrichMetadata(result.metadata) ?? result.metadata
            const providerRaw = enrichedMetadata.raw && typeof enrichedMetadata.raw === 'object'
              ? enrichedMetadata.raw as Record<string, unknown>
              : {}
            recordMutation(this.assets.updateMetadata(assetId, {
              ...enrichedMetadata,
              raw: {
                ...providerRaw,
                resolver: {
                  status: 'resolved',
                  provider: result.provider,
                  ...(result.providerVersion ?? currentProviderVersion
                    ? { providerVersion: result.providerVersion ?? currentProviderVersion }
                    : {}),
                  inputFingerprint: fingerprint,
                  resolvedAt: new Date().toISOString()
                },
                ...(result.rawResponse === undefined ? {} : { resolverResponse: result.rawResponse })
              }
            }))
            resolved++
          } catch (error) {
            retryAt = Math.min(retryAt, Date.parse(attemptedAt) + this.config.retryAfterMs)
            recordMutation(this.assets.updateMetadata(assetId, {
              raw: {
                resolver: {
                  status: 'failed',
                  provider: this.resolver.id,
                  ...(currentProviderVersion ? { providerVersion: currentProviderVersion } : {}),
                  inputFingerprint: fingerprint,
                  lastAttemptAt: attemptedAt,
                  error: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500)
                }
              }
            }))
          }
        }
        if (candidates.length < pageSize && attempts < batchSize) { exhausted = true; break }
      }
      if (this.reads.currentRevision() !== expectedRevision) externallyChanged = true
      this.checked = !externallyChanged && exhausted ? { revision: expectedRevision, provider, version, retryAt } : undefined
      this.sweep = !externallyChanged && !exhausted && after
        ? { revision: expectedRevision, provider, version, retryAt, after } : undefined
      return resolved
    } finally {
      this.running = false
      if (attempts) this.config.onWorkSettled()
    }
  }
}
