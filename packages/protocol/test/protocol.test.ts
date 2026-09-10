import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  API_ROUTES,
  PROTOCOL_VERSION,
  buildAssetsRoute,
  buildChangesRoute,
  buildPairingUri,
  isProtocolVersionSupported,
  type AssetSummary
} from '../src/index.js'

test('protocol version is frozen at v1', () => {
  assert.equal(PROTOCOL_VERSION, 1)
  assert.equal(isProtocolVersionSupported(1), true)
  assert.equal(isProtocolVersionSupported(2), false)
})

test('asset summary game-version fields remain additive within protocol v1', () => {
  const summary: AssetSummary = {
    assetId: 'asset_29',
    type: 'photo',
    state: 'ready',
    revision: 1,
    hasMotion: false,
    hasMetadata: true,
    gameVersion: '2.9',
    gameVersionSource: 'explicit'
  }
  assert.equal(summary.gameVersion, '2.9')
  assert.equal(summary.gameVersionSource, 'explicit')
})

test('route builders encode identifiers and query values', () => {
  assert.equal(API_ROUTES.asset('asset/a'), '/v1/assets/asset%2Fa')
  assert.equal(
    API_ROUTES.resource('asset/a', 'resource b'),
    '/v1/assets/asset%2Fa/resources/resource%20b'
  )
  assert.equal(
    API_ROUTES.clothingThumbnail('asset/a', '1020810145'),
    '/v1/assets/asset%2Fa/clothing/1020810145/thumbnail'
  )
  assert.equal(buildChangesRoute(42), '/v1/changes?after=42')
  assert.equal(
    buildAssetsRoute({ cursor: 'a/b', limit: 25, type: 'motion_photo', includeDeleted: true }),
    '/v1/assets?cursor=a%2Fb&limit=25&type=motion_photo&includeDeleted=true'
  )
})

test('pairing QR payload is compact, stable and self-contained', () => {
  const uri = buildPairingUri({
    scheme: 'nikki-sync',
    action: 'pair',
    serverId: 'server_1',
    host: '192.168.1.5',
    port: 4242,
    pairingToken: 'abc-_123',
    protocolVersion: 1,
    expiresAt: '2026-09-02T14:30:00.000Z',
    tlsFingerprintSha256: '00'.repeat(32)
  })
  assert.equal(uri.startsWith('NS1|server_1|192.168.1.5|4242|abc-_123|'), true)
  assert.equal(uri.endsWith(`|${'00'.repeat(32)}`), true)
  assert.equal(uri.split('|').length, 7)
})
