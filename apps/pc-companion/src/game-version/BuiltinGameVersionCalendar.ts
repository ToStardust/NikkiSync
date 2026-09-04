import type { GameVersionCalendarManifest } from './GameVersionCalendar.js'

/**
 * Conservative offline seed derived only from verified official update notices.
 * Earlier versions intentionally remain unknown until a verified calendar update supplies them.
 */
export const BUILTIN_GAME_VERSION_CALENDAR: GameVersionCalendarManifest = {
  schemaVersion: 1,
  provider: 'nikkisync-builtin-official',
  providerVersion: '2026-08-27',
  sourceUrls: [
    'https://infinitynikki.infoldgames.com/en/news/559',
    'https://infinitynikki.infoldgames.com/en/news/583'
  ],
  entries: [
    { version: '2.8', availableAt: '2026-07-17T03:00:00.000Z' },
    { version: '2.9', availableAt: '2026-08-28T03:00:00.000Z' }
  ]
}
