import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { AssetRepository, DatabaseManager } from '@nikkisync/database'
import { GameVersionCalendar } from '../src/game-version/GameVersionCalendar.js'
import { LocalSyncServer } from '../src/server/LocalSyncServer.js'
import { PairingService } from '../src/server/PairingService.js'

function sha256(data: Buffer): string { return createHash('sha256').update(data).digest('hex') }

function signedHeaders(privateKey: string, deviceId: string, requestPath: string): Record<string, string> {
  const timestamp = String(Date.now())
  const nonce = randomBytes(16).toString('base64url')
  const canonical = ['GET', requestPath, timestamp, nonce, sha256(Buffer.alloc(0))].join('\n')
  return {
    'X-NikkiSync-Device-Id': deviceId,
    'X-NikkiSync-Timestamp': timestamp,
    'X-NikkiSync-Nonce': nonce,
    'X-NikkiSync-Signature': sign(null, Buffer.from(canonical), privateKey).toString('base64url')
  }
}

test('LocalSyncServer exposes inferred calendar versions while preserving explicit metadata versions', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nikkisync-game-version-server-'))
  const mediaPath = path.join(directory, 'photo.jpg')
  const media = Buffer.from('calendar-photo')
  await writeFile(mediaPath, media)
  const db = new DatabaseManager(':memory:')
  db.initialize()
  const assets = new AssetRepository(db)
  const commonResource = (assetId: string, resourceId: string, birthTime: string) => ({
    resourceId, assetId, role: 'source_high_quality' as const, fileName: 'photo.jpg', sourcePath: mediaPath,
    pathKey: `${mediaPath.replaceAll('\\', '/').toLowerCase()}-${resourceId}`, mimeType: 'image/jpeg', fileExt: '.jpg',
    sizeBytes: media.length, sha256: sha256(media), birthTime, stableState: 'stable' as const, isDerived: false
  })
  assets.reconcile({
    assetId: 'asset_inferred', assetType: 'photo', assetState: 'ready', discoveredAt: '2026-09-02T00:00:00.000Z',
    resources: [commonResource('asset_inferred', 'resource_inferred', '2026-09-02T00:00:00.000Z')]
  })
  assets.reconcile({
    assetId: 'asset_explicit', assetType: 'photo', assetState: 'ready', discoveredAt: '2026-09-02T00:01:00.000Z',
    metadataSchemaVersion: 1,
    metadata: { schemaVersion: 1, identity: { gameVersion: '2.8' } },
    resources: [commonResource('asset_explicit', 'resource_explicit', '2026-09-02T00:01:00.000Z')]
  })

  const calendar = new GameVersionCalendar({
    schemaVersion: 1,
    provider: 'fixture-calendar',
    providerVersion: '1',
    sourceUrls: ['https://example.test/calendar'],
    entries: [
      { version: '2.8', availableAt: '2026-07-17T03:00:00.000Z' },
      { version: '2.9', availableAt: '2026-08-28T03:00:00.000Z' }
    ]
  })
  const server = new LocalSyncServer(db, {
    host: '127.0.0.1', port: 0, mdns: false,
    gameVersionResolver: (timestamp) => calendar.resolve(timestamp)
  })
  const address = await server.start()
  try {
    const keys = generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    })
    const pairing = new PairingService(db)
    const qr = pairing.createQrPayload({ host: '127.0.0.1', port: address.port, tlsFingerprintSha256: '0'.repeat(64) })
    const base = `http://127.0.0.1:${address.port}`
    const paired = await fetch(`${base}/v1/pair`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        pairingToken: qr.pairingToken,
        device: { deviceId: 'phone_calendar', deviceName: 'Calendar Test', platform: 'android', publicKey: keys.publicKey, appVersion: '0.0.1' }
      })
    })
    assert.equal(paired.status, 200)

    const requestPath = '/v1/assets?limit=10'
    const response = await fetch(`${base}${requestPath}`, { headers: signedHeaders(keys.privateKey, 'phone_calendar', requestPath) })
    assert.equal(response.status, 200)
    const body = await response.json() as {
      items: Array<{ assetId: string; gameVersion?: string; gameVersionSource: 'explicit' | 'inferred' | 'unknown' }>
    }
    const inferred = body.items.find((item) => item.assetId === 'asset_inferred')
    const explicit = body.items.find((item) => item.assetId === 'asset_explicit')
    assert.deepEqual(inferred && { version: inferred.gameVersion, source: inferred.gameVersionSource }, { version: '2.9', source: 'inferred' })
    assert.deepEqual(explicit && { version: explicit.gameVersion, source: explicit.gameVersionSource }, { version: '2.8', source: 'explicit' })
  } finally {
    await server.stop()
    db.close()
    await rm(directory, { recursive: true, force: true })
  }
})
