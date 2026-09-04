import { parseMetadataDictionaryManifest } from './MetadataDictionaryService.js'
import type {
  MetadataDictionaryFetchResult,
  MetadataDictionaryFetchState,
  MetadataDictionaryProvider
} from './MetadataDictionaryProvider.js'

export interface RemoteJsonMetadataDictionaryProviderConfig {
  id: string
  endpoint: string
  locale?: string
  timeoutMs?: number
  headers?: Record<string, string>
}

/**
 * Provider-neutral transport for a canonical NikkiSync dictionary manifest.
 * It performs a bodyless GET; no photo UID, metadata envelope or media bytes are supplied.
 */
export class RemoteJsonMetadataDictionaryProvider implements MetadataDictionaryProvider {
  readonly id: string

  constructor(private readonly config: RemoteJsonMetadataDictionaryProviderConfig) {
    this.id = config.id
  }

  async fetch(state: MetadataDictionaryFetchState = {}): Promise<MetadataDictionaryFetchResult> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 12_000)
    try {
      const response = await fetch(this.config.endpoint, {
        method: 'GET',
        headers: {
          accept: 'application/json',
          ...(this.config.locale ? { 'accept-language': this.config.locale } : {}),
          ...(state.etag ? { 'if-none-match': state.etag } : {}),
          ...(state.lastModified ? { 'if-modified-since': state.lastModified } : {}),
          ...(this.config.headers ?? {})
        },
        signal: controller.signal
      })
      const etag = response.headers.get('etag') ?? state.etag
      const lastModified = response.headers.get('last-modified') ?? state.lastModified
      if (response.status === 304) {
        return {
          status: 'not-modified',
          ...(etag ? { etag } : {}),
          ...(lastModified ? { lastModified } : {})
        }
      }
      const text = await response.text()
      if (!response.ok) throw new Error(`metadata dictionary HTTP ${response.status}: ${text.slice(0, 240)}`)
      const manifest = parseMetadataDictionaryManifest(JSON.parse(text) as unknown)
      if (manifest.provider !== this.id) {
        throw new Error(`metadata dictionary provider mismatch: expected ${this.id}, received ${manifest.provider}`)
      }
      return {
        status: 'updated',
        manifest,
        ...(etag ? { etag } : {}),
        ...(lastModified ? { lastModified } : {})
      }
    } finally {
      clearTimeout(timer)
    }
  }
}
