import type { InfinityPhotoMetadata } from '@nikkisync/core'

export interface PhotoMetadataResolveRequest {
  assetId: string
  uid: string
  nativeParamToken: string
  /** Full opaque Base64 parameter payload between the two trailing JPEG EOI markers. */
  nativeParamPayload?: string
  /** MD5 of the ASCII payload, exposed because existing compatible resolvers derive a photo tuple hash. */
  nativeParamPayloadMd5?: string
  /** MD5 of local JPEG bytes before the final metadata delimiter EOI, required by NUAN5 decode-photo2. */
  nativeParamNuan5Md5?: string
  /** Scanner-verified opaque Base64 envelope. Length is diagnostic only; small envelopes are valid too. */
  nativeParamPayloadFormat?: 'base64-envelope'
  nativeParamPayloadDecodedBytes?: number
}

export interface PhotoMetadataResolveResult {
  metadata: Partial<InfinityPhotoMetadata>
  provider: string
  providerVersion?: string
  rawResponse?: unknown
}

export interface PhotoMetadataResolver {
  readonly id: string
  /** Bump when provider parsing/dictionary semantics change so cached photos can be re-enriched. */
  readonly version?: string | undefined
  resolve(request: PhotoMetadataResolveRequest): Promise<PhotoMetadataResolveResult>
}

export interface MetadataResolverServiceConfig {
  enabled?: boolean
  intervalMs?: number
  batchSize?: number
  retryAfterMs?: number
}
