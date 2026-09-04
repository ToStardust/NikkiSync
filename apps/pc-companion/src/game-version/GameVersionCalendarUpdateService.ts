import { AppSettingsRepository, type DatabaseManager } from '@nikkisync/database'
import type { GameVersionCalendarFetchState, GameVersionCalendarProvider } from './GameVersionCalendarProvider.js'
import { GameVersionCalendarStore } from './GameVersionCalendarStore.js'

export interface GameVersionCalendarUpdateServiceConfig {
  enabled?: boolean
  intervalMs?: number
}

export type GameVersionCalendarUpdateResult =
  | { status: 'updated' }
  | { status: 'not-modified' }
  | { status: 'failed'; error: string }

type PersistedFetchState = GameVersionCalendarFetchState & {
  lastCheckedAt?: string
  lastSuccessAt?: string
}

export class GameVersionCalendarUpdateService {
  private readonly settings: AppSettingsRepository
  private readonly enabled: boolean
  private readonly intervalMs: number
  private timer: NodeJS.Timeout | undefined
  private running = false

  constructor(
    database: DatabaseManager,
    private readonly store: GameVersionCalendarStore,
    private readonly provider: GameVersionCalendarProvider,
    config: GameVersionCalendarUpdateServiceConfig = {}
  ) {
    this.settings = new AppSettingsRepository(database)
    this.enabled = config.enabled ?? true
    this.intervalMs = config.intervalMs ?? 6 * 60 * 60_000
  }

  private stateKey(): string {
    return `game_version_calendar_remote_state:${this.provider.id}`
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

  async runOnce(): Promise<GameVersionCalendarUpdateResult> {
    if (!this.enabled || this.running) return { status: 'not-modified' }
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
        return { status: 'not-modified' }
      }
      this.store.replace({ ...result.manifest, fetchedAt: checkedAt })
      this.settings.set(this.stateKey(), {
        ...(result.etag ? { etag: result.etag } : {}),
        ...(result.lastModified ? { lastModified: result.lastModified } : {}),
        lastCheckedAt: checkedAt,
        lastSuccessAt: checkedAt
      })
      return { status: 'updated' }
    } catch (error) {
      this.settings.set(this.stateKey(), { ...previous, lastCheckedAt: checkedAt })
      return { status: 'failed', error: error instanceof Error ? error.message : String(error) }
    } finally {
      this.running = false
    }
  }
}
