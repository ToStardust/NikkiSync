import assert from 'node:assert/strict'
import { test } from 'node:test'
import path from 'node:path'
import { toPathKey, type MetadataDictionaryManifest } from '@nikkisync/core'
import {
  AssetRepository,
  ChangeJournalRepository,
  DatabaseManager,
  MetadataDictionaryRepository,
  PairingRepository,
  ResolverCandidateRepository,
  ResourceRepository
} from '../src/index.js'

function setup() {
  const database = new DatabaseManager()
  database.initialize()
  return {
    database,
    assets: new AssetRepository(database),
    resources: new ResourceRepository(database),
    journal: new ChangeJournalRepository(database),
    candidates: new ResolverCandidateRepository(database),
    dictionary: new MetadataDictionaryRepository(database)
  }
}

function createAsset(assets: AssetRepository, assetId = 'asset-1'): void {
  assets.create({
    assetId,
    assetType: 'photo',
    discoveredAt: '2026-01-01T00:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z'
  })
}

function createResource(
  resources: ResourceRepository,
  resourceId: string,
  pathKey: string,
  role: 'source_high_quality' | 'source_motion' = 'source_high_quality'
): void {
  resources.create({
    resourceId,
    assetId: 'asset-1',
    role,
    fileName: `${resourceId}.${role === 'source_motion' ? 'mp4' : 'jpg'}`,
    sourcePath: `C:\\Photos\\${resourceId}`,
    pathKey,
    mimeType: role === 'source_motion' ? 'video/mp4' : 'image/jpeg',
    fileExt: role === 'source_motion' ? '.mp4' : '.jpg',
    sizeBytes: 4,
    sha256: 'a'.repeat(64),
    createdAt: '2026-01-01T00:00:00.000Z'
  })
}

test('schema initializes and passes quick/foreign-key checks', () => {
  const { database } = setup()
  assert.equal(database.connection.prepare('PRAGMA quick_check').get()?.quick_check, 'ok')
  assert.deepEqual(database.connection.prepare('PRAGMA foreign_key_check').all(), [])
  database.close()
})

test('obsolete LIVE ownership recovery refuses active owners, uncertain scope and changed identities',()=>{
  for(const condition of ['active-owner','no-completed-scope','other-uid','changed-bytes','ordinary-photo','different-source-path']){
    const {database,assets,journal}=setup(),root=path.resolve('synthetic-motion-scope'),source=path.join(root,'Good.mp4')
    const resource={resourceId:'old-video',assetId:'old',role:'source_motion' as const,fileName:'Good.mp4',sourcePath:source,pathKey:toPathKey(source),mimeType:'video/mp4',fileExt:'.mp4',sizeBytes:10,sha256:'a'.repeat(64)}
    try{
      assets.reconcile({assetId:'old',assetType:'motion_photo',uid:'10001',discoveredAt:'2026-01-01T00:00:00Z',resources:[resource]})
      const revision=journal.currentRevision()
      const target={assetId:'new',assetType:condition==='ordinary-photo'?'photo' as const:'motion_photo' as const,uid:condition==='other-uid'?'20002':'10001',discoveredAt:'2026-01-01T00:00:00Z',resources:[{...resource,assetId:'new',resourceId:'new-video',...(condition==='changed-bytes'?{sha256:'b'.repeat(64)}:{}),...(condition==='different-source-path'?{sourcePath:path.join(root,'Other.mp4')}:{})}]}
      assert.throws(()=>assets.reconcile(target,{activeAssetIds:new Set(condition==='active-owner'?['old','new']:['new']),completedRoots:condition==='no-completed-scope'?[]:[root]}),/UNIQUE/)
      assert.equal(journal.currentRevision(),revision)
      assert.equal(assets.getById('old')?.asset_state,'ready')
      assert.equal(database.connection.prepare('SELECT asset_id FROM resources WHERE path_key=?').get(resource.pathKey)?.asset_id,'old')
      assert.equal(assets.getById('new'),undefined)
    }finally{database.close()}
  }
})

test('obsolete LIVE reassociation rolls back old ownership and journal if the replacement cannot be indexed',()=>{
  const {database,assets,journal}=setup(),root=path.resolve('synthetic-motion-rollback'),source=path.join(root,'Good.mp4')
  const resource={resourceId:'old-video',assetId:'old',role:'source_motion' as const,fileName:'Good.mp4',sourcePath:source,pathKey:toPathKey(source),mimeType:'video/mp4',fileExt:'.mp4',sizeBytes:10,sha256:'a'.repeat(64)}
  try{
    assets.reconcile({assetId:'old',assetType:'motion_photo',uid:'10001',discoveredAt:'2026-01-01T00:00:00Z',resources:[resource]})
    const revision=journal.currentRevision()
    assert.throws(()=>assets.reconcile({assetId:'new',assetType:'motion_photo',uid:'10001',discoveredAt:'2026-01-01T00:00:00Z',resources:[{...resource,assetId:'new',resourceId:'new-video'},{...resource,role:'source_primary',assetId:'new',resourceId:'bad-cover',pathKey:toPathKey(path.join(root,'cover.jpeg')),sourcePath:path.join(root,'cover.jpeg'),sizeBytes:-1}]},{activeAssetIds:new Set(['new']),completedRoots:[root]}),/CHECK/)
    assert.equal(journal.currentRevision(),revision)
    assert.equal(assets.getById('old')?.asset_state,'ready')
    assert.equal(database.connection.prepare('SELECT resource_id FROM resources WHERE path_key=?').get(resource.pathKey)?.resource_id,'old-video')
    assert.equal(assets.getById('new'),undefined)
  }finally{database.close()}
})

test('foreign keys reject orphan resources', () => {
  const { database, resources } = setup()
  assert.throws(() => createResource(resources, 'orphan', 'c:/orphan.jpg'), /FOREIGN KEY/)
  database.close()
})

test('asset and resources persist and physical asset deletion cascades', () => {
  const { database, assets, resources } = setup()
  createAsset(assets)
  createResource(resources, 'still', 'c:/photos/still.jpg')
  assert.equal(resources.listByAsset('asset-1').length, 1)
  assets.hardDelete('asset-1')
  assert.equal(resources.listByAsset('asset-1').length, 0)
  database.close()
})

test('asset changes allocate monotonic revisions and journal entries atomically', () => {
  const { database, assets, journal } = setup()
  createAsset(assets)
  const revision = assets.updateState('asset-1', 'ready')
  assert.equal(revision, 2)
  assert.equal(journal.currentRevision(), 2)
  assert.deepEqual(
    journal.listAfter(0).map((row) => row.event_type),
    ['asset.created', 'asset.updated']
  )
  assert.equal(assets.getById('asset-1')?.revision, 2)
  database.close()
})

test('scanner reconcile backfills capturedAt for an existing asset without resource changes', () => {
  const { database, assets } = setup()
  const base = {
    assetId: 'asset-capture-backfill',
    assetType: 'photo' as const,
    discoveredAt: '2026-09-10T00:00:00.000Z',
    resources: []
  }
  assert.equal(assets.reconcile(base).kind, 'created')
  assert.equal(assets.getById(base.assetId)?.captured_at, null)

  const capturedAt = '2026-08-30T12:34:56.000Z'
  assert.equal(assets.reconcile({ ...base, capturedAt }).kind, 'updated')
  assert.equal(assets.getById(base.assetId)?.captured_at, capturedAt)
  database.close()
})

test('scanner metadata merges preserve user edits while refreshing native fields', () => {
  const { database, assets } = setup()
  assets.create({
    assetId: 'asset-meta', assetType: 'photo', discoveredAt: '2026-01-01T00:00:00.000Z',
    metadataSchemaVersion: 1,
    metadata: { schemaVersion: 1, identity: { uid: '10001' }, capture: {}, camera: { exposure: 0.5 }, raw: { nativeParamToken: 'old' } }
  })
  assets.updateMetadata('asset-meta', { camera: { brightness: 0.25 } })
  assets.reconcile({
    assetId: 'asset-meta', assetType: 'photo', uid: '10001', discoveredAt: '2026-01-02T00:00:00.000Z',
    metadataSchemaVersion: 1,
    metadata: { schemaVersion: 1, identity: { uid: '10001' }, capture: {}, camera: {}, raw: { nativeParamToken: 'new' } },
    resources: []
  })
  const metadata = JSON.parse(String(assets.getById('asset-meta')?.metadata_json))
  assert.equal(metadata.camera.exposure, 0.5)
  assert.equal(metadata.camera.brightness, 0.25)
  assert.equal(metadata.raw.nativeParamToken, 'new')
  database.close()
})

test('resolver candidates store scores, confidence and reasons', () => {
  const { database, assets, resources, candidates } = setup()
  createAsset(assets)
  createResource(resources, 'still', 'c:/photos/still.jpg')
  createResource(resources, 'motion', 'c:/video/motion.mp4', 'source_motion')
  candidates.upsert({
    stillResourceId: 'still',
    motionResourceId: 'motion',
    score: 140,
    confidence: 0.8,
    reasons: ['basename_exact:+90', 'time<=1s:+50']
  })
  const rows = candidates.listForStill('still')
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.score, 140)
  assert.deepEqual(JSON.parse(String(rows[0]?.reasons_json)), ['basename_exact:+90', 'time<=1s:+50'])
  database.close()
})

test('canonical duplicate path_key is rejected', () => {
  const { database, assets, resources } = setup()
  createAsset(assets)
  const first = toPathKey('C:\\ABC\\File.JPG', 'win32')
  const second = toPathKey('c:\\abc\\file.jpg', 'win32')
  createResource(resources, 'resource-1', first)
  assert.equal(first, second)
  assert.throws(() => createResource(resources, 'resource-2', second), /UNIQUE/)
  database.close()
})

test('metadata dictionary snapshot replacement is atomic and queryable', () => {
  const { database, dictionary } = setup()
  const first: MetadataDictionaryManifest = {
    schemaVersion: 1,
    provider: 'fixture',
    providerVersion: '1',
    generatedAt: '2026-09-03T00:00:00.000Z',
    entries: [
      { kind: 'filter', id: '7', name: '旧滤镜' },
      { kind: 'clothing', id: '101', name: '旧衣服', category: 'hair', rarity: 4 }
    ]
  }
  dictionary.replaceSnapshot(first, '2026-09-03T00:00:01.000Z')
  assert.equal(dictionary.lookup('filter', '7')?.name, '旧滤镜')
  assert.equal(dictionary.getActiveManifest()?.providerVersion, '1')

  const second: MetadataDictionaryManifest = {
    schemaVersion: 1,
    provider: 'fixture',
    providerVersion: '2',
    gameVersion: '2.0',
    entries: [{ kind: 'filter', id: '8', name: '新滤镜' }]
  }
  dictionary.replaceSnapshot(second, '2026-09-03T00:00:02.000Z')
  assert.equal(dictionary.lookup('filter', '7'), undefined)
  assert.equal(dictionary.lookup('filter', '8')?.name, '新滤镜')
  assert.equal(dictionary.getActiveManifest()?.gameVersion, '2.0')
  database.close()
})

test('paired-device count excludes revoked devices', () => {
  const { database } = setup()
  const pairing = new PairingRepository(database)
  pairing.pairDevice({ deviceId: 'active', deviceName: 'A', platform: 'android', publicKey: 'key-a', credentialHash: 'hash-a' })
  pairing.pairDevice({ deviceId: 'revoked', deviceName: 'B', platform: 'android', publicKey: 'key-b', credentialHash: 'hash-b' })
  pairing.revoke('revoked')
  assert.equal(pairing.countActiveDevices(), 1)
  database.close()
})

test('dictionary thumbnail fallbacks round-trip with canonical entries and legacy raw data', () => {
  const { database, dictionary } = setup()
  dictionary.replaceSnapshot({ schemaVersion: 1, provider: 'fixture', providerVersion: '1', entries: [
    { kind: 'clothing', id: '101', thumbnailFallbacks: ['https://example.test/hair.webp'] },
    { kind: 'clothing', id: '102', raw: { thumbnailFallbacks: ['https://example.test/tops.webp', 123] } }
  ] })
  assert.deepEqual(dictionary.lookup('clothing', '101')?.thumbnailFallbacks, ['https://example.test/hair.webp'])
  assert.deepEqual(dictionary.lookup('clothing', '102')?.thumbnailFallbacks, ['https://example.test/tops.webp'])
  assert.deepEqual(dictionary.getActiveManifest()?.entries[0]?.thumbnailFallbacks, ['https://example.test/hair.webp'])
  database.close()
})
