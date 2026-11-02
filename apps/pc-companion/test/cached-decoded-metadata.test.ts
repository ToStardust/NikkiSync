import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { AssetRepository, DatabaseManager, MetadataDictionaryRepository, SyncReadRepository } from '@nikkisync/database'
import { CachedDecodedMetadataService } from '../src/metadata/CachedDecodedMetadataService.js'
import { MetadataDictionaryService } from '../src/metadata/MetadataDictionaryService.js'

test('cached decoded metadata is completed offline once with revisions and existing edits preserved', () => {
  const db = new DatabaseManager(':memory:')
  db.initialize(readFileSync('packages/database/migrations/0001_initial.sql', 'utf8'))
  try {
    const assets = new AssetRepository(db), reads = new SyncReadRepository(db)
    new MetadataDictionaryRepository(db).replaceSnapshot({ schemaVersion: 1, provider: 'fixture', providerVersion: '1',
      entries: [{ kind: 'pose', id: '1090010002', name: '侧身低头' }] })
    assets.create({ assetId: 'one', assetType: 'photo', discoveredAt: '2026-10-13T00:00:00Z', metadata: {
      camera: { brightness: 0 }, dressing: { clothes: [{ id: '10', name: '个人备注' }] },
      raw: { nuan5: { brightness: 80, rotation: 90, pose: 1090010002, clothes: [10] },
        resolver: { status: 'resolved' }, dictionary: { provider: 'fixture', providerVersion: '1' } } } })
    assets.create({ assetId: 'live', assetType: 'motion_photo', discoveredAt: '2026-10-13T00:00:00Z', metadata: { camera: {}, raw: {} } })
    const before = reads.currentRevision()
    const service = new CachedDecodedMetadataService(db, new MetadataDictionaryService(db))
    assert.equal(service.runOnce(), 1)
    const completed = JSON.parse(String(assets.getById('one')?.metadata_json))
    assert.deepEqual(completed.pose, { id: '1090010002', name: '侧身低头' })
    assert.equal(completed.camera.brightness, 0)
    assert.equal(completed.camera.rotation, 90)
    assert.equal(completed.dressing.clothes[0].name, '个人备注')
    assert.equal(reads.currentRevision(), before + 1)
    assert.equal(service.runOnce(), 0)
    assert.equal(reads.currentRevision(), before + 1)
    assert.deepEqual(JSON.parse(String(assets.getById('live')?.metadata_json)), { camera: {}, raw: {} })
  } finally { db.close() }
})

test('optional corrupt cached metadata does not prevent startup or create fake parameters', () => {
  const db = new DatabaseManager(':memory:')
  db.initialize(readFileSync('packages/database/migrations/0001_initial.sql', 'utf8'))
  try {
    const assets = new AssetRepository(db)
    assets.create({ assetId: 'null', assetType: 'photo', discoveredAt: '2026-10-13T00:00:00Z', metadata: null })
    assets.create({ assetId: 'failed', assetType: 'photo', discoveredAt: '2026-10-13T00:00:00Z',
      metadata: { raw: { nikkiGalleryDecoded: { hasParams: false } } } })
    assert.equal(new CachedDecodedMetadataService(db).runOnce(), 0)
  } finally { db.close() }
})
