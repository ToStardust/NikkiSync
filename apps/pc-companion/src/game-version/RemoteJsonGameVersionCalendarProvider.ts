import { parseGameVersionCalendarManifest } from './GameVersionCalendar.js'
import type {
  GameVersionCalendarFetchResult,
  GameVersionCalendarFetchState,
  GameVersionCalendarProvider
} from './GameVersionCalendarProvider.js'

export interface RemoteJsonGameVersionCalendarProviderConfig {
  id: string
  endpoint: string
  timeoutMs?: number
  headers?: Record<string, string>
}

/** Fetches only public version-calendar JSON. No photo, UID, asset or media data is sent. */
export class RemoteJsonGameVersionCalendarProvider implements GameVersionCalendarProvider {
  readonly id: string

  constructor(private readonly config: RemoteJsonGameVersionCalendarProviderConfig) {
    this.id = config.id
  }

  async fetch(state: GameVersionCalendarFetchState = {}): Promise<GameVersionCalendarFetchResult> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 12_000)
    try {
      const response = await fetch(this.config.endpoint, {
        method: 'GET',
        headers: {
          accept: 'application/json',
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
      if (!response.ok) throw new Error(`game version calendar HTTP ${response.status}: ${text.slice(0, 240)}`)
      const manifest = parseGameVersionCalendarManifest(JSON.parse(text) as unknown)
      if (manifest.provider !== this.id) {
        throw new Error(`game version calendar provider mismatch: expected ${this.id}, received ${manifest.provider}`)
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
