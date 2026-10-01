import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import http from 'node:http'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { AssetRepository, DatabaseManager } from '@nikkisync/database'
import { RemoteBridgeService } from '../src/remote/RemoteBridgeService.js'
import { RemoteRoutes } from '../src/remote/RemoteRoutes.js'
import { LocalSyncServer } from '../src/server/LocalSyncServer.js'
import { LocalTlsIdentityService } from '../src/server/LocalTlsIdentityService.js'
import { PcCompanionRuntime } from '../src/runtime.js'

const connection = { endpoint: 'https://192.168.1.8:28080', tlsFingerprintSha256: 'a'.repeat(64) }

test('photo selection paginates without duplicates, prefers HQ, excludes Live and hides local fields', () => {
  const db = new DatabaseManager(':memory:'); db.initialize()
  const assets = new AssetRepository(db)
  for (let index = 0; index < 62; index++) {
    const assetId = `photo-${String(index).padStart(3, '0')}`
    const primary = { resourceId: `primary-${index}`, assetId, role: 'source_primary' as const, fileName: `${assetId}.jpg`, sourcePath: `C:/private/${assetId}.jpg`, pathKey: `c:/private/${assetId}.jpg`, mimeType: 'image/jpeg', fileExt: '.jpg', sizeBytes: 16, sha256: 'a'.repeat(64), stableState: 'stable' as const, isDerived: false }
    assets.reconcile({ assetId, assetType: 'photo', assetState: 'ready', discoveredAt: '2026-10-01T00:00:00.000Z',
      resources: [primary, ...(index === 61 ? [{ ...primary, resourceId: 'hq-61', role: 'source_high_quality' as const, sourcePath: 'C:/private/hq.jpg', pathKey: 'c:/private/hq.jpg' }] : [])] })
  }
  assets.reconcile({ assetId: 'live', assetType: 'motion_photo', assetState: 'ready', discoveredAt: '2026-10-02T00:00:00.000Z', resources: [] })
  const bridge = new RemoteBridgeService(db)
  try {
    const first = bridge.listSelectablePhotos()
    assert.equal(first.items.length, 60); assert.ok(first.nextCursor)
    const second = bridge.listSelectablePhotos(first.nextCursor)
    assert.equal(second.items.length, 2); assert.equal(second.nextCursor, undefined)
    const photos = [...first.items, ...second.items]
    assert.equal(new Set(photos.map((item) => item.assetId)).size, 62)
    assert.equal(photos.find((item) => item.assetId === 'photo-061')?.resourceId, 'hq-61')
    assert.equal(JSON.stringify(photos).includes('C:/private'), false)
    assert.equal(JSON.stringify(photos).includes('sha256'), false)
    assert.throws(() => bridge.listSelectablePhotos('invalid-cursor'), /cursor/i)
    const session = bridge.createSession([first.items[0]!.resourceId, second.items[0]!.resourceId], connection)
    const list = bridge.listResources(session.sessionId, session.token)
    assert.equal(list.status, 'ok')
    if (list.status === 'ok') assert.equal(list.resources.length, 2)
  } finally { db.close() }
})

test('closing or expiring a session interrupts an already backpressured download', { timeout: 8000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nikkisync-remote-active-'))
  const imagePath = path.join(directory, 'photo.jpg')
  const image = Buffer.alloc(16 * 1024 * 1024, 7)
  await writeFile(imagePath, image)
  const db = new DatabaseManager(':memory:'); db.initialize()
  new AssetRepository(db).reconcile({ assetId: 'photo', assetType: 'photo', assetState: 'ready', discoveredAt: '2026-10-01T00:00:00.000Z', resources: [{ resourceId: 'still', assetId: 'photo', role: 'source_primary', fileName: 'photo.jpg', sourcePath: imagePath, pathKey: imagePath.toLowerCase(), mimeType: 'image/jpeg', fileExt: '.jpg', sizeBytes: image.length, sha256: createHash('sha256').update(image).digest('hex'), stableState: 'stable', isDerived: false }] })
  let now = Date.now()
  const bridge = new RemoteBridgeService(db, { now: () => now })
  const routes = new RemoteRoutes(bridge)
  let interrupted: ((finished: boolean) => void) | undefined
  const server = http.createServer((req, res) => {
    res.once('close', () => interrupted?.(res.writableFinished))
    void routes.handle(req, res)
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as { port: number }).port
  try {
    for (const action of ['close', 'expire']) {
      const session = bridge.createSession(['still'], connection)
      const closed = new Promise<boolean>((resolve) => { interrupted = resolve })
      let client: http.ClientRequest | undefined
      const incoming = await new Promise<http.IncomingMessage>((resolve, reject) => {
        client = http.get({ hostname: '127.0.0.1', port, path: `/remote/session/${session.sessionId}/resource/still`, headers: { 'X-NikkiSync-Remote-Token': session.token } }, resolve)
        client.on('error', reject)
      })
      incoming.pause(); incoming.on('error', () => {})
      try {
        assert.equal(incoming.statusCode, 200)
        if (action === 'close') bridge.closeSession(session.sessionId)
        else now += 600_001
        let timeout: ReturnType<typeof setTimeout> | undefined
        const finished = await Promise.race([closed, new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Download was not interrupted')), 2000) })]).finally(() => clearTimeout(timeout))
        assert.equal(finished, false, `${action} must abort before all bytes are delivered`)
      } finally { incoming.destroy(); client?.destroy() }
    }
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    db.close(); await rm(directory, { recursive: true, force: true })
  }
})

test('runtime composes the PC bridge only when enabled and generates a reachable TLS payload', async () => {
  const runtime = new PcCompanionRuntime({ remoteBridge: true, server: { host: '127.0.0.1', mdns: false } })
  new AssetRepository(runtime.database).reconcile({
    assetId: 'photo-1', assetType: 'photo', assetState: 'ready', discoveredAt: '2026-10-01T00:00:00.000Z',
    resources: [{ resourceId: 'still-1', assetId: 'photo-1', role: 'source_primary', fileName: 'photo.jpg', sourcePath: 'C:/fixture/photo.jpg', pathKey: 'c:/fixture/photo.jpg', mimeType: 'image/jpeg', fileExt: '.jpg', sizeBytes: 12, sha256: 'a'.repeat(64), stableState: 'stable', isDerived: false }]
  })
  const address = await runtime.server.start()
  try {
    assert.ok(runtime.remoteBridge)
    const session = runtime.server.createRemoteSession('192.168.1.8', ['still-1'])
    const payload = JSON.parse(session.qrPayload) as { endpoint: string; tlsFingerprintSha256: string }
    const tls = new LocalTlsIdentityService(runtime.database).getOrCreate()
    assert.equal(payload.endpoint, `https://192.168.1.8:${address.port}`)
    assert.equal(payload.tlsFingerprintSha256, tls.fingerprintSha256)
    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const request = https.get({ hostname: '127.0.0.1', port: address.port, servername: 'nikkisync.local', ca: tls.certPem, path: `/remote/session/${session.sessionId}/assets`, headers: { 'X-NikkiSync-Remote-Token': session.token } }, (res) => {
        let body = ''; res.on('data', (chunk) => { body += chunk }); res.on('end', () => resolve({ status: res.statusCode!, body }))
      }); request.on('error', reject)
    })
    assert.equal(response.status, 200)
    assert.equal(JSON.parse(response.body).resources[0].resourceId, 'still-1')
    await runtime.server.stop()
    assert.equal(runtime.remoteBridge.getSessionStatus(session.sessionId)?.state, 'closed')
  } finally { await runtime.stop() }
})

test('remote sessions expose only explicitly selected stable photo resources and expire', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nikkisync-remote-'))
  const imagePath = path.join(directory, 'photo.jpg')
  const image = Buffer.from('test-photo')
  await writeFile(imagePath, image)
  const db = new DatabaseManager(':memory:')
  db.initialize()
  const assets = new AssetRepository(db)
  assets.reconcile({
    assetId: 'photo-1', assetType: 'photo', assetState: 'ready', discoveredAt: '2026-09-29T00:00:00.000Z',
    resources: [{
      resourceId: 'still-1', assetId: 'photo-1', role: 'source_primary', fileName: 'photo.jpg',
      sourcePath: imagePath, pathKey: imagePath.toLowerCase(), mimeType: 'image/jpeg', fileExt: '.jpg',
      sizeBytes: image.length, sha256: createHash('sha256').update(image).digest('hex'),
      stableState: 'stable', isDerived: false
    }]
  })
  let now = Date.parse('2026-09-29T00:00:00.000Z')
  const bridge = new RemoteBridgeService(db, { now: () => now })
  try {
    assert.throws(() => bridge.createSession([], connection), /select/i)
    assert.throws(() => bridge.createSession(['unknown'], connection), /resource/i)
    assert.throws(() => bridge.createSession(['still-1'], { ...connection, endpoint: 'https://example.com' }), /local/i)
    const session = bridge.createSession(['still-1'], connection)
    const qr = JSON.parse(session.qrPayload) as Record<string, unknown>
    assert.equal(qr.endpoint, connection.endpoint)
    assert.equal(qr.tlsFingerprintSha256, connection.tlsFingerprintSha256)
    assert.deepEqual(bridge.listSelectablePhotos().items.map((item) => item.resourceId), ['still-1'])
    assert.equal(session.expiresAt, '2026-09-29T00:10:00.000Z')
    assert.equal(session.state, 'created')
    assert.ok(session.token.length >= 32)
    assert.equal(bridge.listResources(session.sessionId, 'wrong').status, 'invalid_token')
    assert.equal(bridge.listResources(session.sessionId, session.token).status, 'ok')
    const listed = bridge.listResources(session.sessionId, session.token)
    assert.equal(listed.status, 'ok')
    if (listed.status === 'ok') {
      assert.deepEqual(listed.resources.map((item) => item.resourceId), ['still-1'])
      assert.equal(JSON.stringify(listed.resources).includes(imagePath), false)
    }
    assert.equal(bridge.getResource(session.sessionId, session.token, 'not-selected').status, 'not_found')
    const selected = bridge.getResource(session.sessionId, session.token, 'still-1')
    assert.equal(selected.status, 'ok')
    if (selected.status === 'ok') assert.equal(selected.sourcePath, imagePath)
    bridge.closeSession(session.sessionId)
    assert.equal(bridge.listResources(session.sessionId, session.token).status, 'closed')

    const expiring = bridge.createSession(['still-1'], connection)
    now += 600_000
    assert.equal(bridge.listResources(expiring.sessionId, expiring.token).status, 'expired')
    assert.equal(bridge.getSessionStatus(expiring.sessionId)?.state, 'expired')
  } finally {
    db.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('remote routes cannot be mounted on the local server without TLS', async () => {
  const db = new DatabaseManager(':memory:')
  db.initialize()
  const bridge = new RemoteBridgeService(db)
  try {
    const server = new LocalSyncServer(db, { host: '127.0.0.1', mdns: false, remoteBridge: bridge })
    await assert.rejects(server.start(), /TLS/i)
  } finally { db.close() }
})

test('remote routes require the session token and stream only selected bytes with Range', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nikkisync-remote-http-'))
  const imagePath = path.join(directory, 'photo.jpg')
  const image = Buffer.from('0123456789abcdef')
  await writeFile(imagePath, image)
  const db = new DatabaseManager(':memory:')
  db.initialize()
  new AssetRepository(db).reconcile({
    assetId: 'photo-1', assetType: 'photo', assetState: 'ready', discoveredAt: '2026-09-29T00:00:00.000Z',
    resources: [{
      resourceId: 'still-1', assetId: 'photo-1', role: 'source_primary', fileName: 'photo.jpg',
      sourcePath: imagePath, pathKey: imagePath.toLowerCase(), mimeType: 'image/jpeg', fileExt: '.jpg',
      sizeBytes: image.length, sha256: createHash('sha256').update(image).digest('hex'),
      stableState: 'stable', isDerived: false
    }]
  })
  const bridge = new RemoteBridgeService(db)
  const routes = new RemoteRoutes(bridge)
  const server = http.createServer((req, res) => { void routes.handle(req, res) })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const base = `http://127.0.0.1:${address.port}`
  const session = bridge.createSession(['still-1'], connection)
  const listUrl = `${base}/remote/session/${session.sessionId}/assets`
  const fileUrl = `${base}/remote/session/${session.sessionId}/resource/still-1`
  const headers = { 'X-NikkiSync-Remote-Token': session.token }
  try {
    assert.equal((await fetch(listUrl)).status, 401)
    assert.equal((await fetch(listUrl, { headers: { 'X-NikkiSync-Remote-Token': 'bad' } })).status, 401)
    assert.equal((await fetch(`${base}/remote/session/tampered/assets`, { headers })).status, 404)
    const listed = await fetch(listUrl, { headers })
    assert.equal(listed.status, 200)
    const listBody = await listed.json() as { resources: Array<{ resourceId: string }> }
    assert.deepEqual(listBody.resources.map((item) => item.resourceId), ['still-1'])
    assert.equal(JSON.stringify(listBody).includes(imagePath), false)
    assert.equal((await fetch(`${base}/remote/session/${session.sessionId}/resource/other`, { headers })).status, 404)
    const partial = await fetch(fileUrl, { headers: { ...headers, Range: 'bytes=2-5' } })
    assert.equal(partial.status, 206)
    assert.equal(partial.headers.get('content-range'), 'bytes 2-5/16')
    assert.equal(await partial.text(), '2345')
    const full = await fetch(fileUrl, { headers })
    assert.equal(full.status, 200)
    assert.equal(await full.text(), image.toString())
    const head = await fetch(fileUrl, { method: 'HEAD', headers })
    assert.equal(head.status, 200)
    assert.equal(head.headers.get('content-length'), String(image.length))
    assert.equal((await fetch(fileUrl, { headers: { ...headers, Range: 'bytes=20-30' } })).status, 416)
    await writeFile(imagePath, Buffer.from('f'.repeat(image.length)))
    assert.equal((await fetch(fileUrl, { headers })).status, 404, 'a same-size replacement must not be exported under the selected resource')
    await unlink(imagePath)
    assert.equal((await fetch(fileUrl, { headers })).status, 404)
    bridge.closeSession(session.sessionId)
    assert.equal((await fetch(fileUrl, { headers })).status, 410)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    db.close()
    await rm(directory, { recursive: true, force: true })
  }
})

