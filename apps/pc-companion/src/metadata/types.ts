import type { InfinityPhotoMetadata } from '@nikkisync/core'
import type { DatabaseManager } from '@nikkisync/database'

export type MetadataCapability =
  | 'clothing'
  | 'pose'
  | 'camera'
  | 'filter'
  | 'lighting'
  | 'location'
  | 'thumbnail'

export interface MetadataProviderDescriptor {
  id: string
  version?: string
  capabilities: MetadataCapability[]
}

export interface PhotoMetadataResolveRequest {
  /** Local cancellation, never serialized in the third-party request body. */
  signal?: AbortSignal
  /** Recheck the scanned asset after waiting for the online queue. */
  isCurrent?: () => boolean
  /** A refresh of a previously decoded local result must stay on this machine. */
  localOnly?: boolean
  assetId: string
  uid: string
  sourcePhotoPath?: string
  sourcePhotoSha256?: string
  nativeParamToken: string
  /** Full opaque Base64 parameter payload between the two trailing JPEG EOI markers. */
  nativeParamPayload?: string
  /** MD5 of the ASCII payload, exposed because existing compatible resolvers derive a photo tuple hash. */
  nativeParamPayloadMd5?: string
  /** MD5 of the legacy JPEG prefix or the final [V2]N bytes before the metadata delimiter EOI. */
  nativeParamNuan5Md5?: string
  /** Scanner-verified opaque Base64 envelope. Length is diagnostic only; small envelopes are valid too. */
  nativeParamPayloadFormat?: 'base64-envelope'
  nativeParamPayloadDecodedBytes?: number
}

export interface PhotoMetadataResolveResult {
  metadata: Partial<InfinityPhotoMetadata>
  provider: string
  providerVersion?: string
  capabilities?: MetadataCapability[]
  rawResponse?: unknown
  /** Values emitted by the older file decoder, for comparing against its cached result. */
  previousLocalValues?: Partial<Pick<InfinityPhotoMetadata, 'camera' | 'filter' | 'lighting'>>
}

export interface PhotoMetadataResolver {
  readonly id: string
  readonly usesPhotoFile?: boolean
  /** Bump when provider parsing/dictionary semantics change so cached photos can be re-enriched. */
  readonly version?: string | undefined
  readonly capabilities?: MetadataCapability[]
  resolve(request: PhotoMetadataResolveRequest, database?: DatabaseManager): Promise<PhotoMetadataResolveResult>
  resolveBatch?(requests: readonly PhotoMetadataResolveRequest[], database: DatabaseManager): Promise<MetadataResolutionOutcome[]>
  readonly batchSize?: number
}

export type MetadataResolutionOutcome = PromiseSettledResult<PhotoMetadataResolveResult>

export class MetadataResolutionFailure extends Error {
  constructor(readonly category: string, readonly nextAttemptAt: number | null) {
    super(category)
  }
}

export interface MetadataResolverServiceConfig {
  canResolve?(): boolean
  enabled?: boolean
  intervalMs?: number
  batchSize?: number
  retryAfterMs?: number
  onWorkSettled?(): void
}
