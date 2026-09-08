import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { AssetRepository, DatabaseManager } from '@nikkisync/database'
import { MetadataThumbnailCache } from '../src/metadata/MetadataThumbnailCache.js'
import { LocalSyncServer } from '../src/server/LocalSyncServer.js'
import { PairingService } from '../src/server/PairingService.js'

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

function signedHeaders(privateKey: string, deviceId: string, method: string, requestPath: string): Record<string, string> {
  const timestamp = String(Date.now())
  const nonce = randomBytes(16).toString('base64url')
  const canonical = [method, requestPath, timestamp, nonce, sha256(Buffer.alloc(0))].join('\n')
  return {
    'X-NikkiSync-Device-Id': deviceId,
    'X-NikkiSync-Timestamp': timestamp,
    'X-NikkiSync-Nonce': nonce,
    'X-NikkiSync-Signature': sign(null, Buffer.from(canonical), privateKey).toString('base64url')
  }
}

test('clothing thumbnail route proxies only a thumbnail URL already present in the asset metadata', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'nikkisync-thumb-proxy-'))
  const db = new DatabaseManager(':memory:')
  db.initialize()
  const assets = new AssetRepository(db)
  assets.create({
    assetId: 'asset_clothing', assetType: 'photo', uid: '10001', discoveredAt: '2026-09-08T00:00:00.000Z',
    metadataSchemaVersion: 1,
    metadata: {
      schemaVersion: 1,
      identity: { uid: '10001' }, capture: {}, camera: {},
      dressing: {
        clothes: [{
          id: '1020810145', name: '测试底妆', category: 'baseMakeup',
          thumbnail: 'https://images.example.test/cloth/1020810145.png'
        }]
      },
      raw: { dictionary: { provider: 'fixture', providerVersion: 'dict-v1' } }
    }
  })

  const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 8, 7, 6])
  let requests = 0
  const cache = new MetadataThumbnailCache({
    cacheDir: temp,
    fetchImpl: (async () => {
      requests++
      return new Response(image, { status: 200, headers: { 'content-type': 'image/png' } })
    }) as typeof fetch
  })
  const server = new LocalSyncServer(db, {
    host: '127.0.0.1', port: 0, mdns: false, metadataThumbnailCache: cache
  })
  const address = await server.start()
  const base = `http://127.0.0.1:${address.port}`

  try {
    const deviceKeys = generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    })
    const pairing = new PairingService(db)
    const qr = pairing.createQrPayload({ host: '127.0.0.1', port: address.port, tlsFingerprintSha256: '0'.repeat(64) })
    const pair = await fetch(`${base}/v1/pair`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        pairingToken: qr.pairingToken,
        device: { deviceId: 'phone_clothing', deviceName: 'Test Phone', platform: 'android', publicKey: deviceKeys.publicKey, appVersion: '0.2.0' }
      })
    })
    assert.equal(pair.status, 200)

    const route = '/v1/assets/asset_clothing/clothing/1020810145/thumbnail'
    assert.equal((await fetch(`${base}${route}`)).status, 401)

    const proxied = await fetch(`${base}${route}`, {
      headers: signedHeaders(deviceKeys.privateKey, 'phone_clothing', 'GET', route)
    })
    assert.equal(proxied.status, 200)
    assert.equal(proxied.headers.get('content-type'), 'image/png')
    assert.equal(proxied.headers.get('x-nikkisync-sha256'), sha256(image))
    assert.deepEqual(Buffer.from(await proxied.arrayBuffer()), image)

    const again = await fetch(`${base}${route}`, {
      headers: signedHeaders(deviceKeys.privateKey, 'phone_clothing', 'GET', route)
    })
    assert.equal(again.status, 200)
    assert.equal(requests, 1)

    const unknownRoute = '/v1/assets/asset_clothing/clothing/1020000000/thumbnail'
    const unknown = await fetch(`${base}${unknownRoute}`, {
      headers: signedHeaders(deviceKeys.privateKey, 'phone_clothing', 'GET', unknownRoute)
    })
    assert.equal(unknown.status, 404)
    assert.equal(requests, 1)
  } finally {
    await server.stop()
    db.close()
    await rm(temp, { recursive: true, force: true })
  }
})
