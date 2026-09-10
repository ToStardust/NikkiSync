import assert from 'node:assert/strict'
import test from 'node:test'
import { mapAssetSummary } from '../src/server/row-mappers.js'

test('asset summary exposes explicit Infinity Nikki game version without requiring detail fetch', () => {
  const summary = mapAssetSummary({
    asset_id: 'asset_29',
    asset_type: 'photo',
    asset_state: 'ready',
    discovered_at: '2026-09-10T00:00:00.000Z',
    captured_at: '2026-09-09T12:00:00.000Z',
    revision: 9,
    metadata_json: JSON.stringify({
      schemaVersion: 1,
      identity: { gameVersion: ' 2.9 ' },
      capture: {},
      camera: {}
    })
  }, [])

  assert.equal(summary.gameVersion, '2.9')
  assert.equal(summary.gameVersionSource, 'explicit')
})

test('asset summary keeps malformed or missing game version in the unknown bucket', () => {
  const malformed = mapAssetSummary({
    asset_id: 'asset_bad_metadata',
    asset_type: 'photo',
    asset_state: 'ready',
    discovered_at: '2026-09-10T00:00:00.000Z',
    revision: 10,
    metadata_json: '{not-json'
  }, [])
  const missing = mapAssetSummary({
    asset_id: 'asset_unknown',
    asset_type: 'photo',
    asset_state: 'ready',
    discovered_at: '2026-09-10T00:00:00.000Z',
    revision: 11,
    metadata_json: JSON.stringify({ schemaVersion: 1, identity: {}, capture: {}, camera: {} })
  }, [])

  assert.equal(malformed.gameVersion, undefined)
  assert.equal(malformed.gameVersionSource, 'unknown')
  assert.equal(missing.gameVersion, undefined)
  assert.equal(missing.gameVersionSource, 'unknown')
})
