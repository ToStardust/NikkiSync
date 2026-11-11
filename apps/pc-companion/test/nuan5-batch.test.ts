import assert from 'node:assert/strict'
import { createServer, type ServerResponse } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { AssetRepository, DatabaseManager } from '@nikkisync/database'
import { Nuan5CompatibleResolver, nuan5QueueStatus } from '../src/metadata/Nuan5CompatibleResolver.js'
import { MetadataResolverService } from '../src/metadata/MetadataResolverService.js'
import { MetadataOnlineConsent } from '../src/metadata/MetadataOnlineConsent.js'
import { withLocalPhotoFallback } from '../src/metadata/LocalPhotoMetadataResolver.js'
import type { PhotoMetadataResolveRequest } from '../src/metadata/types.js'

type Photos = Record<string, [string, string][]>
const request = (i: number): PhotoMetadataResolveRequest => ({
  uid: String(100 + i % 3), assetId: 'asset-' + i,
  nativeParamToken: 'aGFzaA==', nativeParamPayload: Buffer.from('data-' + i).toString('base64'),
  nativeParamNuan5Md5: i.toString(16).padStart(32, '0')
})
const reply = (response: ServerResponse, photos: Photos, item = (_hash: string): unknown => ({ focal: 50 })) => {
  response.end(JSON.stringify(Object.entries(photos).reverse().map(([uid, rows]) =>
    [uid, rows.map(([hash]) => item(hash))])))
}

async function mock(handle: (response: ServerResponse, photos: Photos) => void | Promise<void>) {
  const batches: Photos[] = []
  const server = createServer(async (incoming, response) => {
    assert.equal(incoming.headers['x-client'], 'NikkiSync')
    assert.match(incoming.headers['user-agent'] ?? '', /^NikkiSync\//)
    const chunks: Buffer[] = []
    for await (const chunk of incoming) chunks.push(Buffer.from(chunk))
    const { photos } = JSON.parse(Buffer.concat(chunks).toString()) as { photos: Photos }
    batches.push(photos)
    await handle(response, photos)
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const endpoint = 'http://127.0.0.1:' + (server.address() as {port: number}).port
  return { endpoint, batches, close: () => new Promise<void>(resolve => server.close(() => resolve())) }
}

test('scanner resolves 1,000 photos in 20 HTTP requests and restart or duplicate input reuses SQLite', async () => {
  const host = await mock((response, photos) => reply(response, photos))
  const folder = await mkdtemp(path.join(os.tmpdir(), 'nikkisync-nuan5-'))
  const file = path.join(folder, 'library.db')
  let db = new DatabaseManager(file)
  const resolver = () => new Nuan5CompatibleResolver({ endpoint: host.endpoint })
  function add(i: number, assetId = request(i).assetId) {
    const r = request(i)
    new AssetRepository(db).create({ assetId, assetType: 'photo', uid: r.uid,
      discoveredAt: '2026-11-08T00:00:00.000Z', metadataSchemaVersion: 1,
      metadata: { schemaVersion: 1, identity: { uid: r.uid }, capture: {}, camera: {},
        raw: { nativeParamToken: r.nativeParamToken, nativeParamPayload: r.nativeParamPayload,
          nativeParamNuan5Md5: r.nativeParamNuan5Md5 } } })
  }
  try {
    db.initialize()
    for (let i = 0; i < 1000; i++) add(i)
    const service = new MetadataResolverService(db, resolver())
    for (let batch = 0; batch < 20; batch++) assert.equal(await service.runOnce(), 50)
    assert.equal(host.batches.length, 20)
    for (const photos of host.batches) {
      assert.equal(Object.keys(photos).length, 3)
      assert.equal(Object.values(photos).flat().length, 50)
    }
    db.close()
    db = new DatabaseManager(file)
    db.initialize()
    const restarted = new MetadataResolverService(db, resolver())
    add(99, 'duplicate')
    for (let i = 0; i < 10; i++) await restarted.runOnce()
    assert.equal(host.batches.length, 20)
    const row = new AssetRepository(db).getById('duplicate')!
    assert.equal(JSON.parse(String(row.metadata_json)).camera.focalLength, 50)
  } finally {
    db.close()
    await host.close()
    await rm(folder, { recursive: true, force: true })
  }
})

test('429 pauses other inputs across restart, then partial success is cached and permanent failures stop', async context => {
  context.mock.timers.enable({ apis: ['Date'], now: Date.now() })
  const first = request(0), rejected = request(1), newcomer = request(2)
  let sends = 0
  const host = await mock((response, photos) => {
    if (++sends === 1) {
      response.writeHead(429, { 'Retry-After': '120' }).end()
      return
    }
    reply(response, photos, hash => hash === rejected.nativeParamNuan5Md5 ? 'invalid encrypted data' : { focal: 45 })
  })
  const folder = await mkdtemp(path.join(os.tmpdir(), 'nikkisync-nuan5-'))
  const file = path.join(folder, 'library.db')
  let db = new DatabaseManager(file)
  const resolve = (...photos: PhotoMetadataResolveRequest[]) =>
    new Nuan5CompatibleResolver({ endpoint: host.endpoint }).resolveBatch(photos, db)
  try {
    db.initialize()
    const firstAttempt = await resolve(first, rejected)
    assert.deepEqual(firstAttempt.map(result => result.status === 'rejected' && result.reason.category), ['rateLimited', 'rateLimited'])
    db.close()
    db = new DatabaseManager(file)
    db.initialize()
    context.mock.timers.tick(119_000)
    assert.match(nuan5QueueStatus(db, [host.endpoint])!, /限流/)
    await resolve(newcomer)
    assert.equal(sends, 1)
    context.mock.timers.tick(1000)
    const retried = await resolve(rejected, first, first)
    assert.deepEqual(retried.map(result => result.status), ['rejected', 'fulfilled', 'fulfilled'])
    assert.equal(Object.values(host.batches[1]!).flat().length, 2)
    context.mock.timers.tick(60_000)
    const reused = await resolve(first, rejected, newcomer)
    assert.deepEqual(reused.map(result => result.status), ['fulfilled', 'rejected', 'fulfilled'])
    assert.deepEqual(Object.values(host.batches[2]!).flat().map(([hash]) => hash), [newcomer.nativeParamNuan5Md5])
  } finally {
    db.close()
    await host.close()
    await rm(folder, { recursive: true, force: true })
  }
})

test('temporary HTTP failures spend a durable attempt before sending and stop after three', async context => {
  context.mock.timers.enable({ apis: ['Date'], now: Date.now() })
  const folder = await mkdtemp(path.join(os.tmpdir(), 'nikkisync-nuan5-'))
  const file = path.join(folder, 'library.db')
  let db = new DatabaseManager(file)
  const attemptsAtServer: number[] = []
  const host = await mock(response => {
    const row = db.connection.prepare('SELECT attempt_count, outcome FROM nuan5_resolution').get()
    assert.equal(row.outcome, 'interrupted')
    attemptsAtServer.push(row.attempt_count)
    response.writeHead(503).end()
  })
  try {
    db.initialize()
    for (let i = 0; i < 4; i++) {
      const resolver = new Nuan5CompatibleResolver({ endpoint: host.endpoint, version: 'revision-' + i })
      await resolver.resolveBatch([request(3)], db)
      assert.equal(host.batches.length, Math.min(i + 1, 3))
      db.close()
      db = new DatabaseManager(file)
      db.initialize()
      context.mock.timers.tick(240_001)
    }
    assert.deepEqual(attemptsAtServer, [1, 2, 3])
  } finally {
    db.close()
    await host.close()
    await rm(folder, { recursive: true, force: true })
  }
})

test('shared queue serializes resolver instances, spaces starts and deduplicates in-flight inputs', async () => {
  const times: number[] = []
  let active = 0
  const host = await mock(async (response, photos) => {
    assert.equal(++active, 1)
    times.push(Date.now())
    await new Promise(resolve => setTimeout(resolve, 40))
    active--
    reply(response, photos)
  })
  const db = new DatabaseManager()
  try {
    db.initialize()
    const first = new Nuan5CompatibleResolver({ endpoint: host.endpoint })
    const other = new Nuan5CompatibleResolver({ endpoint: host.endpoint })
    const result = await Promise.all([
      first.resolveBatch([request(10)], db),
      other.resolveBatch([request(10), request(11)], db),
      first.resolveBatch([request(11)], db)
    ])
    assert.equal(result.flat().filter(item => item.status === 'fulfilled').length, 4)
    assert.equal(host.batches.length, 2)
    assert.equal(Object.values(host.batches[1]!).flat().length, 1)
    assert.ok(times[1]! - times[0]! >= 500)
  } finally { db.close(); await host.close() }
})

test('local successes, invalid tuples and missing originals never reach the opted-in fallback', async () => {
  const host = await mock((response, photos) => reply(response, photos))
  const folder = await mkdtemp(path.join(os.tmpdir(), 'nikkisync-nuan5-'))
  const db = new DatabaseManager()
  try {
    db.initialize()
    const consent = new MetadataOnlineConsent(path.join(folder, 'consent.json'), [])
    const online = consent.guard(new Nuan5CompatibleResolver({ endpoint: host.endpoint }))
    const localCalls: string[] = []
    const resolver = withLocalPhotoFallback({
      id: 'local-photo', usesPhotoFile: true,
      async resolve(input) {
        localCalls.push(input.assetId)
        if (input.assetId === 'asset-0') return { provider: 'local-photo', metadata: { camera: { focalLength: 35 } } }
        throw new Error('local decode failure')
      }
    }, online, () => consent.enabled())
    const original = { sourcePhotoPath: 'synthetic.jpg', sourcePhotoSha256: 'a'.repeat(64) }
    const inputs = [{ ...request(0), ...original }, { ...request(1), ...original },
      { ...request(2), ...original, nativeParamPayload: 'broken!' }, request(3)]
    await resolver.resolveBatch!(inputs, db)
    assert.equal(host.batches.length, 0)
    consent.setEnabled(true, MetadataOnlineConsent.POLICY_VERSION)
    const results = await resolver.resolveBatch!(inputs, db)
    assert.deepEqual(localCalls.slice(-4), inputs.map(input => input.assetId))
    assert.deepEqual(results.map(result => result.status === 'fulfilled' && result.value.provider), ['local-photo', 'nuan5-compatible', false, false])
    assert.deepEqual(Object.values(host.batches[0]!).flat().map(([hash]) => hash), [request(1).nativeParamNuan5Md5])
    assert.equal((await resolver.resolveBatch!([{ ...request(4), ...original, localOnly: true }], db))[0]?.status, 'rejected')
    assert.equal(host.batches.length, 1, 'redecoding an older local cache never uses the online fallback')
    consent.setEnabled(false)
    await resolver.resolveBatch!([{ ...request(6), ...original }], db)
    assert.equal(host.batches.length, 1)
  } finally {
    db.close()
    await host.close()
    await rm(folder, { recursive: true, force: true })
  }
})

test('protocol and database failures pause the entire endpoint instead of advancing through the library', async () => {
  const malformed = await mock(response => { response.end(JSON.stringify([['wrong-uid', [{}]]])) })
  const valid = await mock((response, photos) => reply(response, photos))
  const db = new DatabaseManager()
  try {
    db.initialize()
    const resolver = new Nuan5CompatibleResolver({ endpoint: malformed.endpoint })
    await resolver.resolveBatch([request(0)], db)
    await resolver.resolveBatch([request(1)], db)
    assert.equal(malformed.batches.length, 1)
    assert.match(nuan5QueueStatus(db, [malformed.endpoint])!, /已暂停/)
    db.connection.exec(`CREATE TRIGGER fail_nuan5_save BEFORE UPDATE ON nuan5_resolution
      WHEN NEW.outcome = 'success' BEGIN SELECT RAISE(ABORT, 'simulated DB write failure'); END`)
    const backup = new Nuan5CompatibleResolver({ endpoint: valid.endpoint })
    await backup.resolveBatch([request(0)], db)
    await backup.resolveBatch([request(2)], db)
    assert.equal(valid.batches.length, 1)
    assert.match(nuan5QueueStatus(db, [valid.endpoint])!, /数据库写入失败/)
  } finally { db.close(); await malformed.close(); await valid.close() }
})
