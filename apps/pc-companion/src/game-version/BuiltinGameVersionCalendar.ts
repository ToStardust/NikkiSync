import type { GameVersionCalendarManifest } from './GameVersionCalendar.js'

/**
 * Conservative offline seed derived only from verified official release/update notices.
 * Boundaries are the UTC moments when the new version became available after maintenance.
 */
export const BUILTIN_GAME_VERSION_CALENDAR: GameVersionCalendarManifest = {
  schemaVersion: 1,
  provider: 'nikkisync-builtin-official',
  providerVersion: '2026-09-05-full-history',
  sourceUrls: [
    'https://infinitynikki.infoldgames.com/en/news/16',
    'https://infinitynikki.infoldgames.com/en/news/59',
    'https://infinitynikki.infoldgames.com/en/news/90',
    'https://infinitynikki.infoldgames.com/en/news/120',
    'https://infinitynikki.infoldgames.com/en/news/145',
    'https://infinitynikki.infoldgames.com/en/news/164',
    'https://infinitynikki.infoldgames.com/en/news/211',
    'https://infinitynikki.infoldgames.com/en/news/239',
    'https://infinitynikki.infoldgames.com/en/news/270',
    'https://infinitynikki.infoldgames.com/en/news/307',
    'https://infinitynikki.infoldgames.com/en/news/330',
    'https://infinitynikki.infoldgames.com/en/news/345',
    'https://infinitynikki.infoldgames.com/en/news/395',
    'https://infinitynikki.infoldgames.com/en/news/411',
    'https://infinitynikki.infoldgames.com/en/news/433',
    'https://infinitynikki.infoldgames.com/en/news/447',
    'https://infinitynikki.infoldgames.com/en/news/474',
    'https://infinitynikki.infoldgames.com/en/news/499',
    'https://infinitynikki.infoldgames.com/en/news/515',
    'https://infinitynikki.infoldgames.com/en/news/533',
    'https://infinitynikki.infoldgames.com/en/news/560',
    'https://infinitynikki.infoldgames.com/en/news/583'
  ],
  entries: [
    { version: '1.0', availableAt: '2024-12-05T02:00:00.000Z' },
    { version: '1.1', availableAt: '2024-12-30T03:00:00.000Z' },
    { version: '1.2', availableAt: '2025-01-24T03:00:00.000Z' },
    { version: '1.3', availableAt: '2025-02-26T03:00:00.000Z' },
    { version: '1.4', availableAt: '2025-03-26T03:00:00.000Z' },
    { version: '1.5', availableAt: '2025-04-29T03:00:00.000Z' },
    { version: '1.6', availableAt: '2025-06-13T03:00:00.000Z' },
    { version: '1.7', availableAt: '2025-07-08T03:00:00.000Z' },
    { version: '1.8', availableAt: '2025-07-30T03:00:00.000Z' },
    { version: '1.9', availableAt: '2025-09-02T03:00:00.000Z' },
    { version: '1.10', availableAt: '2025-09-29T03:00:00.000Z' },
    { version: '1.11', availableAt: '2025-10-28T03:00:00.000Z' },
    { version: '2.0', availableAt: '2025-11-26T03:00:00.000Z' },
    { version: '2.1', availableAt: '2026-01-07T03:00:00.000Z' },
    { version: '2.2', availableAt: '2026-01-30T03:00:00.000Z' },
    { version: '2.3', availableAt: '2026-03-03T03:00:00.000Z' },
    { version: '2.4', availableAt: '2026-03-27T03:00:00.000Z' },
    { version: '2.5', availableAt: '2026-04-24T03:00:00.000Z' },
    { version: '2.6', availableAt: '2026-05-29T03:00:00.000Z' },
    { version: '2.7', availableAt: '2026-06-24T03:00:00.000Z' },
    { version: '2.8', availableAt: '2026-07-17T03:00:00.000Z' },
    { version: '2.9', availableAt: '2026-08-28T03:00:00.000Z' }
  ]
}
