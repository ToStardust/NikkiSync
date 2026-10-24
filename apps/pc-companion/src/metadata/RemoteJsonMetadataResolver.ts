import type { InfinityPhotoMetadata } from '@nikkisync/core'
import type { MetadataCapability, PhotoMetadataResolveRequest, PhotoMetadataResolver, PhotoMetadataResolveResult } from './types.js'

export interface RemoteJsonMetadataResolverConfig {
  id?: string
  version?: string
  endpoint: string
  timeoutMs?: number
  headers?: Record<string, string>
  capabilities?: MetadataCapability[]
}

/**
 * Generic opt-in remote resolver transport.
 * Only UID + embedded parameter payload/token are sent; source media bytes never leave the PC.
 */
export class RemoteJsonMetadataResolver implements PhotoMetadataResolver {
  readonly id: string
  readonly version: string | undefined
  readonly capabilities: MetadataCapability[]

  constructor(private readonly config: RemoteJsonMetadataResolverConfig) {
    this.id = config.id ?? 'remote-json'
    this.version = config.version
    this.capabilities = config.capabilities ?? [
      'clothing',
      'pose',
      'camera',
      'filter',
      'lighting',
      'location',
      'thumbnail'
    ]
  }

  async resolve(request: PhotoMetadataResolveRequest): Promise<PhotoMetadataResolveResult> {
    request.signal?.throwIfAborted()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 12_000)
    try {
      const response = await fetch(this.config.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(this.config.headers ?? {})
        },
        body: JSON.stringify({
          uid: request.uid,
          params: request.nativeParamPayload ?? request.nativeParamToken,
          token: request.nativeParamToken,
          ...(request.nativeParamPayloadMd5 ? { md5: request.nativeParamPayloadMd5 } : {}),
          ...(request.nativeParamPayloadFormat ? { payloadFormat: request.nativeParamPayloadFormat } : {}),
          ...(request.nativeParamPayloadDecodedBytes === undefined
            ? {}
            : { payloadDecodedBytes: request.nativeParamPayloadDecodedBytes })
        }),
        signal: request.signal?AbortSignal.any([controller.signal,request.signal]):controller.signal
      })
      const text = await response.text()
      if (!response.ok) throw new Error(`metadata resolver HTTP ${response.status}: ${text.slice(0, 240)}`)
      return this.normalize(JSON.parse(text) as unknown)
    } finally {
      clearTimeout(timer)
    }
  }

  private normalize(value: unknown): PhotoMetadataResolveResult {
    if (!value || typeof value !== 'object') throw new Error('metadata resolver returned a non-object payload')
    const object = value as Record<string, unknown>
    const payload = object.metadata && typeof object.metadata === 'object'
      ? object.metadata as Partial<InfinityPhotoMetadata>
      : object as Partial<InfinityPhotoMetadata>
    return {
      metadata: payload,
      provider: this.id,
      ...(typeof object.version === 'string' ? { providerVersion: object.version } : {}),
      capabilities: this.capabilities,
      rawResponse: value
    }
  }
}
