import type { AppSettingsRepository } from '@nikkisync/database'
import { GameVersionCalendar, type GameVersionCalendarManifest } from './GameVersionCalendar.js'

const SNAPSHOT_KEY = 'game_version_calendar_snapshot'

export class GameVersionCalendarStore {
  constructor(private readonly settings: AppSettingsRepository) {}

  replace(manifest: GameVersionCalendarManifest): void {
    this.settings.set(SNAPSHOT_KEY, manifest)
  }

  manifest(): GameVersionCalendarManifest | undefined {
    return this.settings.get<GameVersionCalendarManifest>(SNAPSHOT_KEY)
  }

  calendar(): GameVersionCalendar | undefined {
    const manifest = this.manifest()
    return manifest ? new GameVersionCalendar(manifest) : undefined
  }

  resolve(timestamp: string | undefined): string | undefined {
    return this.calendar()?.resolve(timestamp)
  }
}
