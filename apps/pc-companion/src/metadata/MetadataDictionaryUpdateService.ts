import { AppSettingsRepository, type DatabaseManager } from '@nikkisync/database'
import { MetadataDictionaryService } from './MetadataDictionaryService.js'
import type { MetadataDictionaryFetchState, MetadataDictionaryProvider } from './MetadataDictionaryProvider.js'

export interface MetadataDictionaryUpdateServiceConfig {
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

  constructor(
    database: DatabaseManager,
    private readonly dictionary: MetadataDictionaryService,
    private readonly provider: MetadataDictionaryProvider,
    config: MetadataDictionaryUpdateServiceConfig = {}
  ) {
    this.settings = new AppSettingsRepository(database)
    this.enabled = config.enabled ?? true
    this.intervalMs = config.intervalMs ?? 6 * 60 * 60_000
  }

  private stateKey(): string {
    return `metadata_dictionary_remote_state:${this.provider.id}`
  }

  start(): void {
    if (!this.enabled || this.timer) return
    void this.runOnce()
    this.timer = setInterval(() => { void this.runOnce() }, this.intervalMs)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  async runOnce(): Promise<MetadataDictionaryUpdateResult> {
    if (!this.enabled || this.running) return { status: 'not-modified', enrichedAssets: 0 }
    this.running = true
    const previous = this.settings.get<PersistedFetchState>(this.stateKey()) ?? {}
    const checkedAt = new Date().toISOString()
    try {
      const result = await this.provider.fetch(previous)
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
      const previousManifest = this.dictionary.replaceManifest({ ...result.manifest, fetchedAt: checkedAt })
      const enrichedAssets = this.dictionary.reenrichResolvedAssets(previousManifest)
      this.settings.set(this.stateKey(), {
        ...(result.etag ? { etag: result.etag } : {}),
        ...(result.lastModified ? { lastModified: result.lastModified } : {}),
        lastCheckedAt: checkedAt,
        lastSuccessAt: checkedAt
      })
      return { status: 'updated', enrichedAssets }
    } catch (error) {
      this.settings.set(this.stateKey(), { ...previous, lastCheckedAt: checkedAt })
      return {
        status: 'failed',
        enrichedAssets: 0,
        error: error instanceof Error ? error.message : String(error)
      }
    } finally {
      this.running = false
    }
  }
}
