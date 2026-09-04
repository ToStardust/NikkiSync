import assert from 'node:assert/strict'
import test from 'node:test'
import { AppSettingsRepository, DatabaseManager } from '@nikkisync/database'
import { BUILTIN_GAME_VERSION_CALENDAR } from '../src/game-version/BuiltinGameVersionCalendar.js'
import { GameVersionCalendar } from '../src/game-version/GameVersionCalendar.js'
import { GameVersionCalendarStore } from '../src/game-version/GameVersionCalendarStore.js'
import { mapAssetSummary } from '../src/server/row-mappers.js'

test('game version calendar resolves the latest UTC availability boundary and leaves earlier timestamps unknown', () => {
  const calendar = new GameVersionCalendar({
    schemaVersion: 1,
    provider: 'fixture-calendar',
    providerVersion: '1',
    sourceUrls: ['https://example.test/versions'],
    entries: [
      { version: '2.9', availableAt: '2026-08-28T03:00:00.000Z' },
      { version: '2.8', availableAt: '2026-07-17T03:00:00.000Z' }
    ]
  })

  assert.equal(calendar.resolve('2026-08-28T02:59:59.999Z'), '2.8')
  assert.equal(calendar.resolve('2026-08-28T03:00:00.000Z'), '2.9')
  assert.equal(calendar.resolve('2026-09-05T00:00:00.000Z'), '2.9')
  assert.equal(calendar.resolve('2026-07-17T02:59:59.999Z'), undefined)
})

test('built-in calendar conservatively covers only verified versions 2.8 and 2.9', () => {
  const calendar = new GameVersionCalendar(BUILTIN_GAME_VERSION_CALENDAR)
  assert.deepEqual(BUILTIN_GAME_VERSION_CALENDAR.entries.map((entry) => entry.version), ['2.8', '2.9'])
  assert.equal(calendar.resolve('2026-07-17T02:59:59.999Z'), undefined)
  assert.equal(calendar.resolve('2026-07-17T03:00:00.000Z'), '2.8')
  assert.equal(calendar.resolve('2026-08-28T02:59:59.999Z'), '2.8')
  assert.equal(calendar.resolve('2026-08-28T03:00:00.000Z'), '2.9')
  assert.deepEqual(BUILTIN_GAME_VERSION_CALENDAR.sourceUrls, [
    'https://infinitynikki.infoldgames.com/en/news/559',
    'https://infinitynikki.infoldgames.com/en/news/583'
  ])
})

test('game version calendar rejects invalid timestamps instead of forcing a version', () => {
  const calendar = new GameVersionCalendar({
    schemaVersion: 1,
    provider: 'fixture-calendar',
    providerVersion: '1',
    sourceUrls: ['https://example.test/versions'],
    entries: [{ version: '2.9', availableAt: '2026-08-28T03:00:00.000Z' }]
  })

  assert.equal(calendar.resolve('not-a-date'), undefined)
  assert.equal(calendar.resolve(''), undefined)
})

test('asset summary keeps explicit game version authoritative over calendar inference', () => {
  const seen: string[] = []
  const summary = mapAssetSummary(assetRow({
    metadata: metadata({ gameVersion: '2.9', capturedAt: '2026-07-20T10:00:00.000Z' })
  }), [resourceRow({ birthTime: '2026-07-20T09:00:00.000Z', modifiedAt: '2026-07-20T11:00:00.000Z' })], (timestamp) => {
    seen.push(timestamp ?? '')
    return '2.8'
  })

  assert.equal(summary.gameVersion, '2.9')
  assert.equal(summary.gameVersionSource, 'explicit')
  assert.deepEqual(seen, [])
})

test('asset summary inference prefers canonical capture time then source birth time then source modified time', () => {
  const inferredFromCapture = mapAssetSummary(assetRow({
    metadata: metadata({ capturedAt: '2026-08-30T12:00:00.000Z' })
  }), [resourceRow({ birthTime: '2026-08-29T12:00:00.000Z', modifiedAt: '2026-08-28T12:00:00.000Z' })],
  (timestamp) => timestamp === '2026-08-30T12:00:00.000Z' ? '2.9' : undefined)
  assert.equal(inferredFromCapture.gameVersion, '2.9')
  assert.equal(inferredFromCapture.gameVersionSource, 'inferred')

  const inferredFromBirth = mapAssetSummary(assetRow({ metadata: metadata({}) }), [
    resourceRow({ birthTime: '2026-08-29T12:00:00.000Z', modifiedAt: '2026-08-28T12:00:00.000Z' })
  ], (timestamp) => timestamp === '2026-08-29T12:00:00.000Z' ? '2.9' : undefined)
  assert.equal(inferredFromBirth.gameVersion, '2.9')
  assert.equal(inferredFromBirth.gameVersionSource, 'inferred')

  const inferredFromModified = mapAssetSummary(assetRow({ metadata: metadata({}) }), [
    resourceRow({ modifiedAt: '2026-08-28T12:00:00.000Z' })
  ], (timestamp) => timestamp === '2026-08-28T12:00:00.000Z' ? '2.9' : undefined)
  assert.equal(inferredFromModified.gameVersion, '2.9')
  assert.equal(inferredFromModified.gameVersionSource, 'inferred')
})

test('asset summary inference ignores derived-resource timestamps and leaves unmatched photos unknown', () => {
  const summary = mapAssetSummary(assetRow({ metadata: metadata({}) }), [
    resourceRow({ role: 'derived_preview', birthTime: '2026-09-01T12:00:00.000Z', modifiedAt: '2026-09-01T12:00:00.000Z' })
  ], () => '2.9')

  assert.equal(summary.gameVersion, undefined)
  assert.equal(summary.gameVersionSource, 'unknown')
})

test('calendar store persists the last valid snapshot and resolves after reconstruction', () => {
  const db = new DatabaseManager(':memory:')
  db.initialize()
  try {
    const settings = new AppSettingsRepository(db)
    const first = new GameVersionCalendarStore(settings)
    first.replace({
      schemaVersion: 1,
      provider: 'fixture-calendar',
      providerVersion: '2026-09-04',
      sourceUrls: ['https://example.test/versions'],
      fetchedAt: '2026-09-04T17:00:00.000Z',
      entries: [
        { version: '2.8', availableAt: '2026-07-17T03:00:00.000Z' },
        { version: '2.9', availableAt: '2026-08-28T03:00:00.000Z' }
      ]
    })

    const reconstructed = new GameVersionCalendarStore(new AppSettingsRepository(db))
    assert.equal(reconstructed.resolve('2026-09-01T00:00:00.000Z'), '2.9')
    assert.equal(reconstructed.manifest()?.providerVersion, '2026-09-04')
    assert.equal(reconstructed.manifest()?.fetchedAt, '2026-09-04T17:00:00.000Z')
  } finally { db.close() }
})

test('calendar store starts empty and replacing a snapshot updates future inference without touching assets', () => {
  const db = new DatabaseManager(':memory:')
  db.initialize()
  try {
    const store = new GameVersionCalendarStore(new AppSettingsRepository(db))
    assert.equal(store.resolve('2026-09-01T00:00:00.000Z'), undefined)

    store.replace({
      schemaVersion: 1,
      provider: 'fixture-calendar',
      providerVersion: '1',
      sourceUrls: ['https://example.test/versions'],
      entries: [{ version: '2.9', availableAt: '2026-08-28T03:00:00.000Z' }]
    })
    assert.equal(store.resolve('2026-09-01T00:00:00.000Z'), '2.9')

    store.replace({
      schemaVersion: 1,
      provider: 'fixture-calendar',
      providerVersion: '2',
      sourceUrls: ['https://example.test/versions'],
      entries: [
        { version: '2.9', availableAt: '2026-08-28T03:00:00.000Z' },
        { version: '2.10', availableAt: '2026-09-01T03:00:00.000Z' }
      ]
    })
    assert.equal(store.resolve('2026-09-02T00:00:00.000Z'), '2.10')
  } finally { db.close() }
})

function metadata(input: { gameVersion?: string; capturedAt?: string }): Record<string, unknown> {
  return {
    schemaVersion: 1,
    identity: input.gameVersion ? { gameVersion: input.gameVersion } : {},
    capture: input.capturedAt ? { capturedAt: input.capturedAt } : {},
    camera: {}
  }
}

function assetRow(input: { metadata?: Record<string, unknown> } = {}): Record<string, unknown> {
  return {
    asset_id: 'asset_version_test',
    asset_type: 'photo',
    asset_state: 'ready',
    discovered_at: '2026-09-01T00:00:00.000Z',
    revision: 1,
    metadata_json: input.metadata ? JSON.stringify(input.metadata) : null
  }
}

function resourceRow(input: {
  role?: string
  birthTime?: string
  modifiedAt?: string
} = {}): Record<string, unknown> {
  return {
    resource_id: `resource_${input.role ?? 'source_high_quality'}`,
    role: input.role ?? 'source_high_quality',
    file_name: 'photo.jpg',
    mime_type: 'image/jpeg',
    file_ext: '.jpg',
    size_bytes: 100,
    sha256: 'a'.repeat(64),
    birth_time: input.birthTime ?? null,
    modified_at: input.modifiedAt ?? null
  }
}