import assert from 'node:assert/strict'
import test from 'node:test'
import { GameVersionCalendar } from '../src/game-version/GameVersionCalendar.js'
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
