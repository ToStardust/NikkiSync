import type { GameVersionCalendarManifest } from './GameVersionCalendar.js'

export interface GameVersionCalendarFetchState {
  etag?: string
  lastModified?: string
}

export type GameVersionCalendarFetchResult =
  | { status: 'not-modified'; etag?: string; lastModified?: string }
  | { status: 'updated'; manifest: GameVersionCalendarManifest; etag?: string; lastModified?: string }

export interface GameVersionCalendarProvider {
  readonly id: string
  fetch(state?: GameVersionCalendarFetchState): Promise<GameVersionCalendarFetchResult>
}
