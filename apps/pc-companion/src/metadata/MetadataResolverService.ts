import { createHash } from 'node:crypto'
import type { InfinityPhotoMetadata } from '@nikkisync/core'
import { AssetRepository, type DatabaseManager } from '@nikkisync/database'
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
  private readonly config: Required<MetadataResolverServiceConfig>

  constructor(
    database: DatabaseManager,
    private readonly resolver: PhotoMetadataResolver,
    config: MetadataResolverServiceConfig = {},
    private readonly dictionaryEnricher?: PhotoMetadataDictionaryEnricher
  ) {
    this.assets = new AssetRepository(database)
    this.config = {
      enabled: config.enabled ?? true,
      intervalMs: config.intervalMs ?? 15_000,
      batchSize: config.batchSize ?? 12,
      retryAfterMs: config.retryAfterMs ?? 10 * 60_000
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
    this.running = true
    let resolved = 0
    let attempted = 0
    let offset = 0
    try {
      while (attempted < this.config.batchSize) {
        const candidates = this.assets.listMetadataResolutionCandidates(this.config.batchSize, offset)
        if (candidates.length === 0) break
        offset += candidates.length

        for (const row of candidates) {
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
            if (Number.isFinite(elapsed) && elapsed < this.config.retryAfterMs) continue
          }

          attempted++
          const attemptedAt = new Date().toISOString()
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
            this.assets.updateMetadata(assetId, {
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
            })
            resolved++
          } catch (error) {
            this.assets.updateMetadata(assetId, {
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
            })
          }

          if (attempted >= this.config.batchSize) break
        }

        if (candidates.length < this.config.batchSize) break
      }
      return resolved
    } finally {
      this.running = false
    }
  }
}
