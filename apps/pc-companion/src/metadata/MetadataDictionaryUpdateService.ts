import { AppSettingsRepository, type DatabaseManager } from '@nikkisync/database'
import { MetadataDictionaryService, parseMetadataDictionaryManifest } from './MetadataDictionaryService.js'
import type { MetadataDictionaryFetchState, MetadataDictionaryProvider } from './MetadataDictionaryProvider.js'

export interface MetadataDictionaryUpdateServiceConfig {
  mode?: 'replace' | 'supplement'
  onWorkSettled?: () => void
  enabled?: boolean
  intervalMs?: number
}

export type MetadataDictionaryUpdateResult =
  | { status: 'updated', enrichedAssets: number }
  | { status: 'not-modified', enrichedAssets: 0 }
  | { status: 'failed', enrichedAssets: 0, error: string }

type PersistedFetchState = MetadataDictionaryFetchState & {
  lastCheckedAt?: string
  lastSuccessAt?: string
}

export class MetadataDictionaryUpdateService {
  private readonly settings: AppSettingsRepository
  private readonly enabled: boolean
  private readonly intervalMs: number
  private timer: NodeJS.Timeout | undefined
  private running = false
  private stopped = false
  private readonly supplementMode: boolean
  private supplementCacheVersion: string | undefined
  private readonly onWorkSettled: (() => void) | undefined

  constructor(
    database: DatabaseManager,
    private readonly dictionary: MetadataDictionaryService,
    private readonly provider: MetadataDictionaryProvider,
    config: MetadataDictionaryUpdateServiceConfig = {}
  ) {
    this.settings = new AppSettingsRepository(database)
    this.onWorkSettled = config.onWorkSettled
    this.enabled = config.enabled ?? true
    this.intervalMs = config.intervalMs ?? 6 * 60 * 60_000
    this.supplementMode = config.mode === 'supplement'
    if (this.enabled && this.supplementMode) {
      try {
        const cached = this.settings.get<unknown>(this.cacheKey())
        if (cached) {
          const manifest = parseMetadataDictionaryManifest(cached)
          if (manifest.provider !== this.provider.id) throw new Error('Supplement cache provider mismatch')
          this.dictionary.setSupplement(manifest)
          this.supplementCacheVersion = manifest.providerVersion
        }
      } catch { /* Ignore an invalid cache and fetch a fresh validated snapshot. */ }
    }
  }

  private cacheKey(): string { return `metadata_dictionary_supplement_cache:${this.provider.id}` }

  private stateKey(): string {
    return `metadata_dictionary_remote_state:${this.provider.id}`
  }

  start(): void {
    if (!this.enabled || this.timer) return
    this.stopped = false
    void this.runOnce()
    this.timer = setInterval(() => { void this.runOnce() }, this.intervalMs)
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  async runOnce(): Promise<MetadataDictionaryUpdateResult> {
    if (!this.enabled || this.running || this.stopped) return { status: 'not-modified', enrichedAssets: 0 }
    this.running = true
    const previous = this.settings.get<PersistedFetchState>(this.stateKey()) ?? {}
    const checkedAt = new Date().toISOString()
    try {
      const fetchState = { ...previous }
      if (this.supplementMode && (!this.supplementCacheVersion || this.supplementCacheVersion !== previous.contentVersion)) {
        delete fetchState.contentVersion; delete fetchState.etag; delete fetchState.lastModified
      }
      const result = await this.provider.fetch(fetchState)
      if (this.stopped) return { status: 'not-modified', enrichedAssets: 0 }
      if (result.status === 'not-modified') {
        this.settings.set(this.stateKey(), {
          ...previous,
          ...(result.etag ? { etag: result.etag } : {}),
          ...(result.lastModified ? { lastModified: result.lastModified } : {}),
          lastCheckedAt: checkedAt,
          lastSuccessAt: checkedAt
        })
        return { status: 'not-modified', enrichedAssets: 0 }
      }
      const manifest = parseMetadataDictionaryManifest({ ...result.manifest, fetchedAt: checkedAt })
      if (manifest.provider !== this.provider.id) throw new Error('Dictionary provider mismatch')
      const previousManifest = this.supplementMode
        ? this.dictionary.setSupplement(manifest)
        : this.dictionary.replaceManifest(manifest)
      const enrichedAssets = this.dictionary.reenrichResolvedAssets(previousManifest)
      if (this.supplementMode) {
        this.settings.set(this.cacheKey(), manifest)
        this.supplementCacheVersion = manifest.providerVersion
      }
      this.settings.set(this.stateKey(), {
        ...(result.etag ? { etag: result.etag } : {}),
        ...(result.lastModified ? { lastModified: result.lastModified } : {}),
        contentVersion: manifest.providerVersion,
        lastCheckedAt: checkedAt,
        lastSuccessAt: checkedAt
      })
      return { status: 'updated', enrichedAssets }
    } catch (error) {
      if (this.stopped) return { status: 'not-modified', enrichedAssets: 0 }
      this.settings.set(this.stateKey(), { ...previous, lastCheckedAt: checkedAt })
      return {
        status: 'failed',
        enrichedAssets: 0,
        error: error instanceof Error ? error.message : String(error)
      }
    } finally {
      this.running = false
      this.onWorkSettled?.()
    }
  }
}
