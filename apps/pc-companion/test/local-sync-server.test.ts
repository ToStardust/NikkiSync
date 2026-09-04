import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { AssetRepository, DatabaseManager } from '@nikkisync/database'
import { PairingService } from '../src/server/PairingService.js'
import { LocalSyncServer } from '../src/server/LocalSyncServer.js'
import { LocalTlsIdentityService } from '../src/server/LocalTlsIdentityService.js'

function sha256(data: Buffer): string { return createHash('sha256').update(data).digest('hex') }

function signedHeaders(privateKey: string, deviceId: string, method: string, requestPath: string, body = Buffer.alloc(0)): Record<string, string> {
  const timestamp = String(Date.now())
  const nonce = randomBytes(16).toString('base64url')
  const canonical = [method, requestPath, timestamp, nonce, sha256(body)].join('\n')
  return {
    'X-NikkiSync-Device-Id': deviceId,
    'X-NikkiSync-Timestamp': timestamp,
    'X-NikkiSync-Nonce': nonce,
    'X-NikkiSync-Signature': sign(null, Buffer.from(canonical), privateKey).toString('base64url')
  }
}

async function readWsText(socket: net.Socket, timeoutMs = 3000): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('websocket frame timeout')), timeoutMs)
    const onData = (chunk: Buffer) => {
      const marker = chunk.indexOf(Buffer.from('\r\n\r\n'))
      let frame = marker >= 0 ? chunk.subarray(marker + 4) : chunk
      if (!frame.length) return
      let offset = 2
      let length = frame[1]! & 0x7f
      if (length === 126) { length = frame.readUInt16BE(2); offset = 4 }
      if (length === 127) { clearTimeout(timeout); socket.off('data', onData); reject(new Error('large frame unsupported in test')); return }
      if (frame.length < offset + length) return
      clearTimeout(timeout); socket.off('data', onData)
      resolve(frame.subarray(offset, offset + length).toString('utf8'))
    }
    socket.on('data', onData)
  })
}

test('LocalSyncServer pairs, authenticates, pages, streams ranges, reports changes and emits websocket events', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'nikkisync-server-'))
  const mediaPath = path.join(temp, 'photo.jpeg')
  const media = Buffer.from('0123456789abcdef')
  await writeFile(mediaPath, media)
  const db = new DatabaseManager(':memory:')
  db.initialize()
  const assets = new AssetRepository(db)
  assets.reconcile({
    assetId: 'asset_test', assetType: 'photo', assetState: 'ready', uid: '10001', discoveredAt: '2026-09-02T00:00:00.000Z',
    metadataSchemaVersion: 1,
    metadata: { schemaVersion: 1, raw: { nativeParamToken: 'token-visible', nativeParamPayload: 'pc-only-secret-payload', nativeParamNuan5Md5: '0123456789abcdef0123456789abcdef' } },
    resources: [{
      resourceId: 'resource_test', assetId: 'asset_test', role: 'source_high_quality', fileName: 'photo.jpeg',
      sourcePath: mediaPath, pathKey: mediaPath.replaceAll('\\', '/').toLowerCase(), mimeType: 'image/jpeg', fileExt: '.jpeg',
      sizeBytes: media.length, sha256: sha256(media), width: 16, height: 9, stableState: 'stable', isDerived: false
    }]
  })

  const server = new LocalSyncServer(db, { host: '127.0.0.1', port: 0, mdns: false, journalPollMs: 20 })
  const address = await server.start()
  const base = `http://127.0.0.1:${address.port}`
  try {
    const info = await fetch(`${base}/v1/server`)
    assert.equal(info.status, 200)
    assert.equal((await info.json() as { libraryRevision: number }).libraryRevision, 1)

    const deviceKeys = generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    })
    const pairing = new PairingService(db)
    const qr = pairing.createQrPayload({ host: '127.0.0.1', port: address.port, tlsFingerprintSha256: '0'.repeat(64) })
    const pairResponse = await fetch(`${base}/v1/pair`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        pairingToken: qr.pairingToken,
        device: { deviceId: 'phone_test', deviceName: 'Test Phone', platform: 'android', publicKey: deviceKeys.publicKey, appVersion: '0.0.1' }
      })
    })
    assert.equal(pairResponse.status, 200)
    assert.equal((await pairResponse.json() as { serverId: string }).serverId, server.serverId)

    const replay = await fetch(`${base}/v1/pair`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        pairingToken: qr.pairingToken,
        device: { deviceId: 'phone_test_2', deviceName: 'Other', platform: 'android', publicKey: deviceKeys.publicKey, appVersion: '0.0.1' }
      })
    })
    assert.equal(replay.status, 401)

    assert.equal((await fetch(`${base}/v1/assets`)).status, 401)
    const assetsPath = '/v1/assets?limit=10'
    const assetList = await fetch(`${base}${assetsPath}`, { headers: signedHeaders(deviceKeys.privateKey, 'phone_test', 'GET', assetsPath) })
    assert.equal(assetList.status, 200)
    const listJson = await assetList.json() as { items: Array<{ assetId: string; hasMotion: boolean; previewResourceId?: string }>; libraryRevision: number }
    assert.equal(listJson.items.length, 1); assert.equal(listJson.items[0]?.assetId, 'asset_test'); assert.equal(listJson.items[0]?.hasMotion, false)
    assert.equal(listJson.items[0]?.previewResourceId, 'resource_test')

    const detailPath = '/v1/assets/asset_test'
    const detail = await fetch(`${base}${detailPath}`, { headers: signedHeaders(deviceKeys.privateKey, 'phone_test', 'GET', detailPath) })
    assert.equal(detail.status, 200)
    const detailJson = await detail.json() as { asset: { resources: unknown[]; metadata?: { raw?: Record<string, unknown> } } }
    assert.equal(detailJson.asset.resources.length, 1)
    assert.equal(detailJson.asset.metadata?.raw?.nativeParamToken, 'token-visible')
    assert.equal('nativeParamPayload' in (detailJson.asset.metadata?.raw ?? {}), false)
    assert.equal('nativeParamNuan5Md5' in (detailJson.asset.metadata?.raw ?? {}), false)

    const metadataPath = '/v1/assets/asset_test/metadata'
    const metadataBody = Buffer.from(JSON.stringify({ camera: { exposure: 0.75, contrast: 0.2 } }))
    const metadataUpdate = await fetch(`${base}${metadataPath}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...signedHeaders(deviceKeys.privateKey, 'phone_test', 'PATCH', metadataPath, metadataBody) },
      body: metadataBody
    })
    assert.equal(metadataUpdate.status, 200)
    const metadataJson = await metadataUpdate.json() as { asset: { metadata?: { camera?: { exposure?: number; contrast?: number } } }; revision: number }
    assert.equal(metadataJson.asset.metadata?.camera?.exposure, 0.75)
    assert.equal(metadataJson.asset.metadata?.camera?.contrast, 0.2)
    assert.equal(metadataJson.revision, 2)
    // Let the journal broadcaster advance past the metadata update before opening the WS
    // used below to assert the next asset-created event; otherwise this test races the poller.
    await new Promise((resolve) => setTimeout(resolve, 50))

    const resourcePath = '/v1/assets/asset_test/resources/resource_test'
    const ranged = await fetch(`${base}${resourcePath}`, {
      headers: { ...signedHeaders(deviceKeys.privateKey, 'phone_test', 'GET', resourcePath), Range: 'bytes=2-5' }
    })
    assert.equal(ranged.status, 206); assert.equal(await ranged.text(), '2345')
    assert.equal(ranged.headers.get('x-nikkisync-sha256'), sha256(media))

    const changesPath = '/v1/changes?after=0'
    const changes = await fetch(`${base}${changesPath}`, { headers: signedHeaders(deviceKeys.privateKey, 'phone_test', 'GET', changesPath) })
    assert.equal(changes.status, 200)
    assert.equal((await changes.json() as { changes: unknown[] }).changes.length, 2)

    const wsPath = '/ws/v1'
    const wsHeaders = signedHeaders(deviceKeys.privateKey, 'phone_test', 'GET', wsPath)
    const socket = net.createConnection({ host: '127.0.0.1', port: address.port })
    await new Promise<void>((resolve) => socket.once('connect', () => resolve()))
    socket.write([
      `GET ${wsPath} HTTP/1.1`, `Host: 127.0.0.1:${address.port}`, 'Upgrade: websocket', 'Connection: Upgrade',
      `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`, 'Sec-WebSocket-Version: 13',
      ...Object.entries(wsHeaders).map(([key, value]) => `${key}: ${value}`), '', ''
    ].join('\r\n'))
    const hello = JSON.parse(await readWsText(socket)) as { event: string; libraryRevision: number }
    assert.equal(hello.event, 'server.hello'); assert.equal(hello.libraryRevision, 2)

    const nextMediaPath = path.join(temp, 'photo2.jpeg')
    await writeFile(nextMediaPath, Buffer.from('next'))
    const nextEvent = readWsText(socket)
    assets.reconcile({
      assetId: 'asset_next', assetType: 'photo', assetState: 'ready', discoveredAt: '2026-09-02T00:01:00.000Z',
      resources: [{ resourceId: 'resource_next', assetId: 'asset_next', role: 'source_high_quality', fileName: 'photo2.jpeg', sourcePath: nextMediaPath,
        pathKey: nextMediaPath.replaceAll('\\', '/').toLowerCase(), mimeType: 'image/jpeg', fileExt: '.jpeg', sizeBytes: 4, sha256: sha256(Buffer.from('next')), stableState: 'stable', isDerived: false }]
    })
    assert.equal((JSON.parse(await nextEvent) as { event: string }).event, 'asset.created')
    socket.destroy()
  } finally {
    await server.stop(); db.close(); await rm(temp, { recursive: true, force: true })
  }
})

test('local TLS identity is generated once and persists with a stable fingerprint', () => {
  const db = new DatabaseManager(':memory:')
  db.initialize()
  try {
    const service = new LocalTlsIdentityService(db)
    const first = service.getOrCreate()
    const second = service.getOrCreate()
    assert.equal(first.fingerprintSha256.length, 64)
    assert.equal(first.fingerprintSha256, second.fingerprintSha256)
    assert.equal(first.keyPem, second.keyPem)
    assert.match(first.certPem, /BEGIN CERTIFICATE/)
  } finally { db.close() }
})
