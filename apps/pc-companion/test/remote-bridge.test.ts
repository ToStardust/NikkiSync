import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { AssetRepository, DatabaseManager } from '@nikkisync/database'
import { RemoteBridgeService } from '../src/remote/RemoteBridgeService.js'
import { RemoteRoutes } from '../src/remote/RemoteRoutes.js'
import { LocalSyncServer } from '../src/server/LocalSyncServer.js'

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
    assert.throws(() => bridge.createSession([]), /select/i)
    assert.throws(() => bridge.createSession(['unknown']), /resource/i)
    const session = bridge.createSession(['still-1'])
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

    const expiring = bridge.createSession(['still-1'])
    now += 600_000
    assert.equal(bridge.listResources(expiring.sessionId, expiring.token).status, 'expired')
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
  const session = bridge.createSession(['still-1'])
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

