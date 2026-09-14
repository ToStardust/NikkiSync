import assert from 'node:assert/strict'
import test from 'node:test'
import { mapAssetSummary } from '../src/server/row-mappers.js'

test('asset summary exposes explicit Infinity Nikki game version without requiring detail fetch', () => {
  const summary = mapAssetSummary({
    asset_id: 'asset_29',
    asset_type: 'photo',
    asset_state: 'ready',
    discovered_at: '2026-09-10T00:00:00.000Z',
    captured_at: '2026-07-20T12:00:00.000Z',
    revision: 9,
    metadata_json: JSON.stringify({
      schemaVersion: 1,
      identity: { gameVersion: ' 2.9 ' },
      capture: {},
      camera: {}
    })
  }, [])

  // Explicit decoded metadata always wins over calendar inference.
  assert.equal(summary.gameVersion, '2.9')
  assert.equal(summary.gameVersionSource, 'explicit')
})

test('asset summary infers version from source capture time when metadata has no version', () => {
  const v29 = mapAssetSummary({
    asset_id: 'asset_inferred_29',
    asset_type: 'photo',
    asset_state: 'ready',
    captured_at: '2026-08-30T12:00:00.000Z',
    discovered_at: '2026-09-10T00:00:00.000Z',
    revision: 10,
    metadata_json: JSON.stringify({ schemaVersion: 1, identity: {}, capture: {}, camera: {} })
  }, [])
  const v28 = mapAssetSummary({
    asset_id: 'asset_inferred_28',
    asset_type: 'photo',
    asset_state: 'ready',
    captured_at: '2026-07-20T12:00:00.000Z',
    discovered_at: '2026-09-10T00:00:00.000Z',
    revision: 11,
    metadata_json: '{not-json'
  }, [])

  assert.equal(v29.gameVersion, '2.9')
  assert.equal(v29.gameVersionSource, 'inferred')
  assert.equal(v28.gameVersion, '2.8')
  assert.equal(v28.gameVersionSource, 'inferred')
})

test('asset summary never infers a version from discovery time alone', () => {
  const summary = mapAssetSummary({
    asset_id: 'asset_unknown',
    asset_type: 'photo',
    asset_state: 'ready',
    discovered_at: '2026-09-10T00:00:00.000Z',
    revision: 12,
    metadata_json: JSON.stringify({ schemaVersion: 1, identity: {}, capture: {}, camera: {} })
  }, [])

  assert.equal(summary.gameVersion, undefined)
  assert.equal(summary.gameVersionSource, 'unknown')
})
