import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { AssetRepository, DatabaseManager } from '@nikkisync/database'
import { MetadataResolverService } from '../src/metadata/MetadataResolverService.js'
import type { PhotoMetadataResolver } from '../src/metadata/types.js'
import { loadMetadataResolverConfigFile } from '../src/metadata/MetadataResolverConfigFile.js'
import { Nuan5CompatibleResolver } from '../src/metadata/Nuan5CompatibleResolver.js'
import { MetadataDictionaryService } from '../src/metadata/MetadataDictionaryService.js'
import { metadataResolutionDiagnostics } from '../src/metadata/MetadataResolutionDiagnostics.js'

function seedFirstRun(assets: AssetRepository, count: number): void {
  for (let index = 0; index < count; index++) assets.create({
    assetId: `first-run-${String(index).padStart(3, '0')}`, assetType: 'photo', uid: '10001',
    discoveredAt: '2026-09-03T00:00:00.000Z',
    metadata: { camera: {}, raw: { nativeParamToken: `fixture-${index}` } }
  })
}

test('metadata diagnostic report contains only aggregate counts and allowlisted failure categories', () => {
  const db = new DatabaseManager(':memory:'); db.initialize()
  const assets = new AssetRepository(db); seedFirstRun(assets, 3)
  assets.updateMetadata('first-run-000', { camera: { focalLength: 50 }, dressing: { clothes: [{ id: '101', name: 'private outfit name' }] },
    raw: { nativeParamPayload: 'private-payload', nativeParamNuan5Md5: 'private-digest', resolver: { status: 'resolved' } } })
  assets.updateMetadata('first-run-001', { raw: { resolver: { status: 'failed', error: 'fetch failed https://private.example/?secret=credential' } } })
  assets.create({ assetId: 'private-live-id', assetType: 'motion_photo', uid: '987654321', discoveredAt: '2026-09-03', metadata: {} })
  try {
    const report = metadataResolutionDiagnostics(db, true)
    assert.equal(report.ordinaryPhotos, 3)
    assert.equal(report.withNativeToken, 3)
    assert.equal(report.withCompleteEnvelope, 1)
    assert.equal(report.resolved, 1)
    assert.equal(report.failed, 1)
    assert.equal(report.pending, 1)
    assert.equal(report.withOutfit, 1)
    assert.equal(report.withCamera, 1)
    assert.equal(report.motionPhotos, 1)
    assert.deepEqual(report.failureCategories, { networkOrTimeout: 1 })
    const text = JSON.stringify(report)
    for (const secret of ['first-run-', '10001', '987654321', 'private', 'credential', 'fixture-', 'https://']) assert.equal(text.includes(secret), false)
    assert.equal(metadataResolutionDiagnostics(db, false).resolverEnabled, false)
  } finally { db.close() }
})

test('clean first run resolves photos beyond the first batch and stops querying when complete', async () => {
  const db = new DatabaseManager(':memory:'); db.initialize()
  const assets = new AssetRepository(db); seedFirstRun(assets, 25)
  const calls: string[] = []
  const resolver: PhotoMetadataResolver = { id: 'first-run', resolve: async request => {
    calls.push(request.assetId)
    return { provider: 'first-run', metadata: { camera: { focalLength: 50 }, dressing: { clothes: [101] } } }
  } }
  const service = new MetadataResolverService(db, resolver)
  let queries = 0
  const repository = service['assets'], original = repository.listMetadataResolutionCandidates.bind(repository)
  repository.listMetadataResolutionCandidates = (...args) => { queries++; return original(...args) }
  try {
    assert.equal(await service.runOnce(), 12)
    assert.equal(await service.runOnce(), 12, 'resolved first batch must not hide the next batch')
    assert.equal(await service.runOnce(), 1)
    assert.equal(new Set(calls).size, 25)
    for (let index = 0; index < 25; index++) {
      const metadata = JSON.parse(String(assets.getById(`first-run-${String(index).padStart(3, '0')}`)?.metadata_json))
      assert.equal(metadata.camera.focalLength, 50)
      assert.deepEqual(metadata.dressing.clothes, [101])
    }
    await service.runOnce(); const completedQueries = queries
    await service.runOnce(); await service.runOnce()
    assert.equal(queries, completedQueries, 'idle polling must not reload large native payloads')
    assert.equal(calls.length, 25, 'completed photos must not trigger duplicate remote calls')
  } finally { service.stop(); db.close() }
})

test('a large already-resolved library is walked in bounded pages and becomes idle without remote calls', async () => {
  const db = new DatabaseManager(':memory:'); db.initialize()
  const assets = new AssetRepository(db); seedFirstRun(assets, 300)
  let calls = 0
  const resolver: PhotoMetadataResolver = { id: 'bounded-sweep', resolve: async () => {
    calls++; return { provider: 'bounded-sweep', metadata: { camera: { focalLength: 50 } } }
  } }
  const initial = new MetadataResolverService(db, resolver, { batchSize: 400 })
  const restarted = new MetadataResolverService(db, resolver)
  const repository = restarted['assets'], original = repository.listMetadataResolutionCandidates.bind(repository)
  let rowsRead = 0
  repository.listMetadataResolutionCandidates = (...args) => {
    const rows = original(...args); assert.ok(rows.length <= 12); rowsRead += rows.length; return rows
  }
  try {
    assert.equal(await initial.runOnce(), 300)
    for (let turn = 0; turn < 3; turn++) {
      const before = rowsRead; await restarted.runOnce()
      assert.ok(rowsRead - before <= 128, 'cached native envelopes must not all be read in one idle tick')
    }
    assert.equal(rowsRead, 300)
    await restarted.runOnce(); assert.equal(rowsRead, 300)
    assert.equal(calls, 300, 'restart must not submit already resolved photos again')
  } finally { initial.stop(); restarted.stop(); db.close() }
})

test('a failed first batch in retry cooldown does not starve later first-run photos', async context => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-11T00:00:00Z') })
  const db = new DatabaseManager(':memory:'); db.initialize()
  const assets = new AssetRepository(db); seedFirstRun(assets, 25)
  const calls: string[] = []
  const resolver: PhotoMetadataResolver = { id: 'partial-failure', resolve: async request => {
    calls.push(request.assetId)
    if (Number(request.assetId.slice(-3)) < 12) throw new Error('Temporary provider outage fixture')
    return { provider: 'partial-failure', metadata: { dressing: { clothes: [101] } } }
  } }
  const service = new MetadataResolverService(db, resolver, { retryAfterMs: 60_000 })
  try {
    assert.equal(await service.runOnce(), 0)
    assert.equal(await service.runOnce(), 12, 'failed photos must not block eligible later photos')
    assert.equal(await service.runOnce(), 1)
    assert.equal(calls.length, 25)
    await service.runOnce(); assert.equal(calls.length, 25)
    context.mock.timers.tick(60_001)
    await service.runOnce()
    assert.equal(calls.length, 37, 'retry deadline must revisit the failed batch without repeating successes')
  } finally { service.stop(); db.close() }
})

test('first-run continuation does not miss earlier input changes during a remote resolve', async () => {
  const db = new DatabaseManager(':memory:'); db.initialize()
  const assets = new AssetRepository(db); seedFirstRun(assets, 3)
  const calls: string[] = []
  const resolver: PhotoMetadataResolver = { id: 'changed-input', resolve: async request => {
    calls.push(`${request.assetId}:${request.nativeParamToken}`)
    if (request.assetId === 'first-run-001') assets.updateMetadata('first-run-000', { raw: { nativeParamToken: 'changed' } })
    return { provider: 'changed-input', metadata: { camera: { focalLength: 50 } } }
  } }
  const service = new MetadataResolverService(db, resolver, { batchSize: 1 })
  try {
    await service.runOnce(); await service.runOnce(); await service.runOnce()
    assert.ok(calls.includes('first-run-000:changed'), 'external writes during a batch must restart the sweep')
    await service.runOnce(); await service.runOnce()
    assert.ok(calls.some(call => call.startsWith('first-run-002:')))
  } finally { service.stop(); db.close() }
})

test('unchanged resolver input does not keep loading parameter payloads and failed work still retries', async (context) => {
  context.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-05T00:00:00.000Z') })
  const db = new DatabaseManager(':memory:'); db.initialize()
  const assets = new AssetRepository(db)
  assets.create({assetId:'idle-resolver',assetType:'photo',uid:'10001',discoveredAt:'2026-09-03T00:00:00.000Z',metadata:{raw:{nativeParamToken:'abc123=='}}})
  let calls = 0, queries = 0
  const resolver: PhotoMetadataResolver = {id:'idle-test', resolve:async()=>{calls++;throw new Error('Retry fixture')}}
  const service = new MetadataResolverService(db,resolver,{retryAfterMs:30})
  const repository=service['assets'],original=repository.listMetadataResolutionCandidates.bind(repository)
  repository.listMetadataResolutionCandidates=(...args)=>{queries++;return original(...args)}
  try {
    await service.runOnce(); await service.runOnce(); await service.runOnce()
    assert.equal(calls,1)
    assert.equal(queries,1,'completed sweep accounts for its own revisions without reloading the same large parameters')
    context.mock.timers.tick(40)
    await service.runOnce(); assert.equal(calls,2,'the retry deadline still wakes failed work')
  } finally { service.stop(); db.close() }
})

test('NUAN5 resolver sends the verified decode-photo2 tuple without source media bytes', async () => {
  let received: { headers: http.IncomingHttpHeaders, body: Record<string, unknown> } | undefined
  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    received = { headers: request.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> }
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify([['10001', [{
      focal: 50, apeture: 2.8, brightness: 0.1, exposure: 0.2, contrast: 0.3,
      saturation: 0.4, vibrance: 0.5, highlights: 0.6, shadow: 0.7,
      filter: { f: 7, s: 0.8 }, light: { l: 9, s: 0.6 }, pose: 12,
      raw: { time: { h: 15, m: 30 }, pos: { x: 1, y: 2, z: 3 } }, clothes: [101, 102]
    }]]]))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address() as { port: number }
    const payload = Buffer.from('payload-segment').toString('base64')
    const token = Buffer.from('hash-segment').toString('base64')
    const resolver = new Nuan5CompatibleResolver({ endpoint: `http://127.0.0.1:${address.port}/api/decode-photo2` })
    const result = await resolver.resolve({
      assetId: 'asset_one', uid: '10001', nativeParamPayload: payload, nativeParamToken: token,
      nativeParamNuan5Md5: '0123456789abcdef0123456789abcdef'
    })
    const encoded = Buffer.concat([Buffer.from(token, 'base64'), Buffer.from(payload, 'base64')]).toString('base64')
    assert.deepEqual(received?.body, { photos: { '10001': [['0123456789abcdef0123456789abcdef', encoded]] }, raw_data: true, raw_id: true })
    assert.equal(received?.headers['content-type'], 'application/json')
    assert.equal(received?.headers['x-client'], 'SpinningMomo')
    assert.equal('token' in (received?.body ?? {}), false)
    assert.equal('jpeg' in (received?.body ?? {}), false)
    assert.equal(result.metadata.camera?.focalLength, 50)
    assert.equal(result.metadata.camera?.apertureSection, 2.8)
    assert.equal(result.metadata.filter?.id, '7')
    assert.equal(result.metadata.lighting?.id, '9')
    assert.deepEqual(result.metadata.dressing?.clothes, [101, 102])
    assert.deepEqual(result.metadata.location?.coordinates, { x: 1, y: 2, z: 3 })
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('NUAN5 resolver spaces sequential requests to respect the endpoint rate limit', async () => {
  const requestTimes: number[] = []
  const server = http.createServer(async (request, response) => {
    requestTimes.push(Date.now())
    for await (const _chunk of request) { /* drain request */ }
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify([['10001', [{}]]]))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address() as { port: number }
    const resolver = new Nuan5CompatibleResolver({ endpoint: `http://127.0.0.1:${address.port}/api/decode-photo2`, minIntervalMs: 20 })
    const request = {
      assetId: 'asset_rate', uid: '10001', nativeParamPayload: Buffer.from('payload').toString('base64'),
      nativeParamToken: Buffer.from('token').toString('base64'), nativeParamNuan5Md5: '0123456789abcdef0123456789abcdef'
    }
    await resolver.resolve(request); await resolver.resolve(request)
    assert.equal(requestTimes.length, 2)
    assert.ok(requestTimes[1]! - requestTimes[0]! >= 15)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

test('metadata resolver enriches decoded IDs with the local dictionary without additional resolver calls', async () => {
  const db = new DatabaseManager(':memory:')
  db.initialize()
  const assets = new AssetRepository(db)
  assets.create({
    assetId: 'asset_dictionary_resolver', assetType: 'photo', uid: '10001', discoveredAt: '2026-09-03T00:00:00.000Z',
    metadataSchemaVersion: 1,
    metadata: { schemaVersion: 1, identity: { uid: '10001' }, capture: {}, camera: {}, raw: { nativeParamToken: 'abc123==' } }
  })
  const dictionary = new MetadataDictionaryService(db)
  dictionary.replaceManifest({
    schemaVersion: 1, provider: 'fixture-dictionary', providerVersion: '1', entries: [
      { kind: 'filter', id: '7', name: '晨雾' },
      { kind: 'clothing', id: '101', name: '星夜长发' }
    ]
  })
  let calls = 0
  const resolver: PhotoMetadataResolver = {
    id: 'fixture-resolver',
    async resolve() {
      calls++
      return { provider: 'fixture-resolver', metadata: { filter: { id: '7' }, dressing: { clothes: [101, 999] } } }
    }
  }
  const service = new MetadataResolverService(db, resolver, {}, dictionary)
  assert.equal(await service.runOnce(), 1)
  assert.equal(calls, 1)
  const metadata = JSON.parse(String(assets.getById('asset_dictionary_resolver')?.metadata_json))
  assert.equal(metadata.filter.name, '晨雾')
  assert.deepEqual(metadata.dressing.clothes, [{ id: '101', name: '星夜长发' }, { id: '999' }])
  assert.equal(metadata.raw.dictionary.provider, 'fixture-dictionary')
  db.close()
})

test('metadata resolver enriches UID+token assets and caches resolved state', async () => {
  const db = new DatabaseManager(':memory:')
  db.initialize()
  const assets = new AssetRepository(db)
  assets.create({
    assetId: 'asset_meta', assetType: 'photo', uid: '10001', discoveredAt: '2026-09-02T00:00:00.000Z',
    metadataSchemaVersion: 1,
    metadata: { schemaVersion: 1, camera: {}, raw: { nativeParamToken: 'abc123==' } }
  })
  let calls = 0
  const resolver: PhotoMetadataResolver = {
    id: 'test-provider',
    version: '1',
    async resolve(request) {
      calls++
      assert.equal(request.uid, '10001')
      assert.equal(request.nativeParamToken, 'abc123==')
      return {
        provider: 'test-provider', providerVersion: '1',
        metadata: { camera: { focalLength: 55, exposure: 0.25 }, filter: { id: 'filter_7', name: 'Test Filter' } }
      }
    }
  }
  const service = new MetadataResolverService(db, resolver, { enabled: true, batchSize: 5 })
  assert.equal(await service.runOnce(), 1)
  assert.equal(await service.runOnce(), 0)
  assert.equal(calls, 1)
  const row = assets.getById('asset_meta')!
  const metadata = JSON.parse(String(row.metadata_json))
  assert.equal(metadata.camera.focalLength, 55)
  assert.equal(metadata.filter.name, 'Test Filter')
  assert.equal(metadata.raw.nativeParamToken, 'abc123==')
  assert.equal(metadata.raw.resolver.status, 'resolved')
  assert.equal(metadata.raw.resolver.provider, 'test-provider')
  assert.equal(metadata.raw.resolver.providerVersion, '1')
  assert.equal(typeof metadata.raw.resolver.inputFingerprint, 'string')
  db.close()
})

test('metadata resolver re-enriches when provider version changes', async () => {
  const db = new DatabaseManager(':memory:')
  db.initialize()
  const assets = new AssetRepository(db)
  assets.create({
    assetId: 'asset_versioned', assetType: 'photo', uid: '10001', discoveredAt: '2026-09-02T00:00:00.000Z',
    metadataSchemaVersion: 1,
    metadata: { schemaVersion: 1, raw: { nativeParamToken: 'same-token==' } }
  })
  let calls = 0
  const provider = (version: string, focalLength: number): PhotoMetadataResolver => ({
    id: 'versioned-provider', version,
    async resolve() {
      calls++
      return { provider: 'versioned-provider', providerVersion: version, metadata: { camera: { focalLength } } }
    }
  })
  assert.equal(await new MetadataResolverService(db, provider('1', 35)).runOnce(), 1)
  assert.equal(await new MetadataResolverService(db, provider('1', 35)).runOnce(), 0)
  assert.equal(await new MetadataResolverService(db, provider('2', 50)).runOnce(), 1)
  assert.equal(calls, 2)
  const metadata = JSON.parse(String(assets.getById('asset_versioned')!.metadata_json))
  assert.equal(metadata.camera.focalLength, 50)
  assert.equal(metadata.raw.resolver.providerVersion, '2')
  db.close()
})

test('metadata resolver re-enriches when native input changes', async () => {
  const db = new DatabaseManager(':memory:')
  db.initialize()
  const assets = new AssetRepository(db)
  assets.create({
    assetId: 'asset_input', assetType: 'photo', uid: '10001', discoveredAt: '2026-09-02T00:00:00.000Z',
    metadataSchemaVersion: 1,
    metadata: { schemaVersion: 1, raw: { nativeParamToken: 'first-token==' } }
  })
  let calls = 0
  const resolver: PhotoMetadataResolver = {
    id: 'input-provider', version: '1',
    async resolve(request) { calls++; return { provider: 'input-provider', providerVersion: '1', metadata: { raw: { echoedToken: request.nativeParamToken } } } }
  }
  const service = new MetadataResolverService(db, resolver)
  assert.equal(await service.runOnce(), 1)
  assert.equal(await service.runOnce(), 0)
  assets.updateMetadata('asset_input', { raw: { nativeParamToken: 'second-token==' } })
  assert.equal(await service.runOnce(), 1)
  assert.equal(calls, 2)
  const metadata = JSON.parse(String(assets.getById('asset_input')!.metadata_json))
  assert.equal(metadata.raw.echoedToken, 'second-token==')
  db.close()
})

test('metadata resolver passes a large Base64 envelope losslessly and computes its MD5', async () => {
  const db = new DatabaseManager(':memory:')
  db.initialize()
  const assets = new AssetRepository(db)
  const payload = Buffer.alloc(36_000, 0x41).toString('base64')
  assets.create({
    assetId: 'asset_payload', assetType: 'photo', uid: '10001', discoveredAt: '2026-09-02T00:00:00.000Z',
    metadataSchemaVersion: 1,
    metadata: { schemaVersion: 1, raw: { nativeParamToken: 'token-value=', nativeParamPayload: payload, nativeParamNuan5Md5: '0123456789abcdef0123456789abcdef' } }
  })
  const resolver: PhotoMetadataResolver = {
    id: 'payload-provider',
    async resolve(request) {
      assert.equal(request.nativeParamPayload, payload)
      assert.equal(request.nativeParamPayloadFormat, 'base64-envelope')
      assert.equal(request.nativeParamPayloadDecodedBytes, 36_000)
      assert.equal(request.nativeParamPayloadMd5, createHash('md5').update(payload, 'ascii').digest('hex'))
      assert.equal(request.nativeParamNuan5Md5, '0123456789abcdef0123456789abcdef')
      return { provider: 'payload-provider', metadata: { camera: { focalLength: 50 } } }
    }
  }
  assert.equal(await new MetadataResolverService(db, resolver).runOnce(), 1)
  db.close()
})

test('metadata resolver preserves small block-aligned Base64 envelopes instead of guessing a legacy format', async () => {
  const db = new DatabaseManager(':memory:')
  db.initialize()
  const assets = new AssetRepository(db)
  const decoded = Buffer.alloc(16, 0x5a)
  const payload = decoded.toString('base64')
  assets.create({
    assetId: 'asset_legacy_payload', assetType: 'photo', uid: '10001', discoveredAt: '2026-09-02T00:00:00.000Z',
    metadataSchemaVersion: 1,
    metadata: { schemaVersion: 1, raw: { nativeParamToken: 'token-value=', nativeParamPayload: payload } }
  })
  const resolver: PhotoMetadataResolver = {
    id: 'small-envelope-provider',
    async resolve(request) {
      assert.equal(request.nativeParamPayload, payload)
      assert.equal(request.nativeParamPayloadFormat, 'base64-envelope')
      assert.equal(request.nativeParamPayloadDecodedBytes, 16)
      assert.equal(request.nativeParamPayloadMd5, createHash('md5').update(payload, 'ascii').digest('hex'))
      return { provider: 'small-envelope-provider', metadata: {} }
    }
  }
  assert.equal(await new MetadataResolverService(db, resolver).runOnce(), 1)
  db.close()
})

test('metadata resolver endpoint/provider can be hot-updated from local config file', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nikkisync-resolver-config-'))
  const file = path.join(directory, 'metadata-resolver.json')
  try {
    await writeFile(file, JSON.stringify({
      enabled: true,
      provider: { type: 'remote-json', id: 'compatible-provider', version: '2026.09', endpoint: 'https://metadata.example.test/v1/resolve' }
    }))
    const config = loadMetadataResolverConfigFile(file)
    assert.equal(config?.enabled, true)
    assert.equal(config?.provider?.id, 'compatible-provider')
    assert.equal(config?.provider?.version, '2026.09')
    assert.equal(config?.provider?.endpoint, 'https://metadata.example.test/v1/resolve')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('metadata resolver config accepts an explicit NUAN5-compatible opt-in provider', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nikkisync-nuan5-config-'))
  const file = path.join(directory, 'metadata-resolver.json')
  try {
    await writeFile(file, JSON.stringify({ enabled: true, provider: { type: 'nuan5-compatible', version: '2026.09', endpoint: 'https://nuan5.pro/api/decode-photo2' } }))
    const config = loadMetadataResolverConfigFile(file)
    assert.equal(config?.provider?.type, 'nuan5-compatible')
    assert.equal(config?.provider?.endpoint, 'https://nuan5.pro/api/decode-photo2')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
