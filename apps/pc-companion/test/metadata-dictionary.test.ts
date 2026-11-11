import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { AssetRepository, DatabaseManager, MetadataDictionaryRepository } from '@nikkisync/database'
import { MetadataDictionaryService, parseMetadataDictionaryManifest } from '../src/metadata/MetadataDictionaryService.js'
import { loadMetadataDictionaryFile } from '../src/metadata/MetadataDictionaryConfigFile.js'
import { clothingNameSupplement } from '../src/metadata/VerifiedClothingNames.js'
import { parseLocalPhotoMetadata } from '../src/metadata/LocalPhotoMetadataResolver.js'
import { mapAssetRow } from '../src/server/row-mappers.js'

function setup() {
  const db = new DatabaseManager(':memory:')
  db.initialize()
  return {
    db,
    assets: new AssetRepository(db),
    dictionary: new MetadataDictionaryRepository(db),
    service: new MetadataDictionaryService(db)
  }
}

test('previously decoded photos gain verified local effect names offline without changing custom names', () => {
  const { db, assets, service } = setup()
  try {
    service.replaceManifest({ schemaVersion: 1, provider: 'old-dictionary', providerVersion: 'old', entries: [] })
    for (const [id, name] of [['old-photo', undefined], ['custom-photo', '自定义光照']] as const) {
      assets.create({ assetId: id, assetType: 'photo', uid: '10001', discoveredAt: '2026-11-08T00:00:00.000Z',
        metadataSchemaVersion: 1, metadata: { schemaVersion: 1, identity: { uid: '10001' }, capture: {}, camera: {},
          filter: { id: 'Vibe_013', strength: 0.28 }, lighting: { id: 'DirectionLight_R', strength: 0.46, ...(name ? { name } : {}) },
          raw: { resolver: { status: 'resolved', provider: 'local-photo' }, dictionary: { provider: 'old-dictionary', providerVersion: 'old' } } } })
    }
    const fixed = new MetadataDictionaryService(db, clothingNameSupplement())
    assert.equal(fixed.reenrichResolvedAssets(), 2)
    const result = JSON.parse(String(assets.getById('old-photo')?.metadata_json))
    assert.deepEqual(result.filter, { id: 'Vibe_013', strength: 0.28, name: '溯影' })
    assert.deepEqual(result.lighting, { id: 'DirectionLight_R', strength: 0.46, name: '方向补光-侧光-右' })
    assert.equal(JSON.parse(String(assets.getById('custom-photo')?.metadata_json)).lighting.name, '自定义光照')
    assert.equal(new MetadataDictionaryService(db, clothingNameSupplement()).reenrichResolvedAssets(), 0)
  } finally { db.close() }
})

test('installing, updating and removing the icon pack invalidates old photo detail caches without changing names', () => {
  const { db, assets, service } = setup()
  const id = '1020100111'
  const manifest = {
    schemaVersion: 1 as const, provider: 'fixture', providerVersion: 'dict-v1',
    entries: [{ kind: 'clothing' as const, id, name: '字典名称' }]
  }
  try {
    service.replaceManifest(manifest)
    assets.create({ assetId: 'legacy-clothing', assetType: 'photo', discoveredAt: '2026-11-09T00:00:00Z',
      metadataSchemaVersion: 1, metadata: { schemaVersion: 1, identity: {}, capture: {}, camera: {},
        dressing: { clothes: [{ id, name: '我的自定义名称' }] }
      } })
    let revision = Number(assets.getById('legacy-clothing')?.revision)
    for (const digest of ['a'.repeat(64), 'b'.repeat(64), undefined]) {
      const dictionary = new MetadataDictionaryService(db, undefined, digest)
      assert.equal(dictionary.reenrichResolvedAssets(), 1)
      const row = assets.getById('legacy-clothing')!
      assert.ok(Number(row.revision) > revision)
      revision = Number(row.revision)
      const { dressing, raw } = JSON.parse(String(row.metadata_json))
      assert.equal(dressing.clothes[0].name, '我的自定义名称')
      assert.equal(raw.dictionary.providerVersion, digest ? 'dict-v1:local-icons-' + digest : 'dict-v1')
      assert.equal(dictionary.reenrichResolvedAssets(), 0)
    }
  } finally { db.close() }
})

test('local camera IDs are translated before the photo detail is sent to mobile', () => {
  const { db } = setup()
  try {
    const values: unknown[] = Array(31).fill(0)
    values[14] = 50
    values[17] = 'DirectionLight_R'; values[18] = 0.46
    values[29] = 'Vibe_013'; values[30] = 0.28
    const decoded = parseLocalPhotoMetadata(JSON.stringify(values), '{"nikkiClothes":[]}')
    const fixed = new MetadataDictionaryService(db, clothingNameSupplement())
    const metadata = fixed.enrichMetadata(decoded)
    const detail = mapAssetRow({ asset_id: 'photo', asset_type: 'photo', asset_state: 'ready',
      discovered_at: '2026-11-08T00:00:00Z', revision: 1, metadata_json: JSON.stringify(metadata) }, [])
    assert.deepEqual(detail.metadata?.filter, { id: 'Vibe_013', name: '溯影', strength: 28 })
    assert.deepEqual(detail.metadata?.lighting, { id: 'DirectionLight_R', name: '方向补光-侧光-右', strength: 46 })
  } finally { db.close() }
})

test('dictionary service loads a local manifest and re-enriches resolved photos without a photo resolver', async () => {
  const { db, assets, service } = setup()
  assets.create({
    assetId: 'asset_dictionary', assetType: 'photo', uid: '10001', discoveredAt: '2026-09-03T00:00:00.000Z',
    metadataSchemaVersion: 1,
    metadata: {
      schemaVersion: 1, identity: { uid: '10001' }, capture: {}, camera: {},
      filter: { id: '7' }, dressing: { clothes: [101, 999] },
      raw: { resolver: { status: 'resolved', provider: 'fixture' } }
    }
  })
  service.replaceManifest({
    schemaVersion: 1, provider: 'fixture-dictionary', providerVersion: '1', entries: [
      { kind: 'filter', id: '7', name: '晨雾' },
      { kind: 'clothing', id: '101', name: '星夜长发', category: 'hair', rarity: 5, suitId: 'suit-7', suitName: '星夜回响' }
    ]
  })
  assert.equal(service.reenrichResolvedAssets(), 1)
  const metadata = JSON.parse(String(assets.getById('asset_dictionary')?.metadata_json))
  assert.equal(metadata.filter.name, '晨雾')
  assert.deepEqual(metadata.dressing.clothes, [
    { id: '101', name: '星夜长发', category: 'hair', rarity: 5, suitId: 'suit-7', suitName: '星夜回响' },
    { id: '999' }
  ])
  assert.equal(metadata.raw.dictionary.provider, 'fixture-dictionary')
  db.close()
})

test('invalid local dictionary does not replace the previous valid snapshot', async () => {
  const { db, dictionary, service } = setup()
  service.replaceManifest({
    schemaVersion: 1, provider: 'fixture', providerVersion: '1',
    entries: [{ kind: 'filter', id: '7', name: '旧值' }]
  })
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nikkisync-dictionary-'))
  const file = path.join(directory, 'metadata-dictionary.json')
  try {
    await writeFile(file, JSON.stringify({ schemaVersion: 1, provider: 'broken', providerVersion: '2', entries: [{ kind: 'unknown', id: 'x' }] }))
    assert.throws(() => service.loadLocalManifest(file), /dictionary/i)
    assert.equal(dictionary.lookup('filter', '7')?.name, '旧值')
    assert.equal(dictionary.getActiveManifest()?.providerVersion, '1')
  } finally {
    await rm(directory, { recursive: true, force: true })
    db.close()
  }
})

test('optional dictionary startup file returns undefined when missing or invalid', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nikkisync-dictionary-config-'))
  const missing = path.join(directory, 'missing.json')
  const invalid = path.join(directory, 'invalid.json')
  const valid = path.join(directory, 'valid.json')
  try {
    assert.equal(loadMetadataDictionaryFile(missing), undefined)
    await writeFile(invalid, '{"schemaVersion":1,"provider":"broken"}')
    assert.equal(loadMetadataDictionaryFile(invalid), undefined)
    await writeFile(valid, JSON.stringify({
      schemaVersion: 1, provider: 'fixture', providerVersion: '1',
      entries: [{ kind: 'filter', id: '7', name: '晨雾' }]
    }))
    assert.equal(loadMetadataDictionaryFile(valid)?.entries[0]?.name, '晨雾')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('verified name supplements survive restart and remote replacement without losing icons or custom names', () => {
  const { db, assets, dictionary, service } = setup()
  const upstream = {
    schemaVersion: 1 as const, provider: 'fixture', providerVersion: 'remote-1', entries: [
      { kind: 'clothing' as const, id: '101', category: 'tops', thumbnail: 'https://example.test/101.png', suitId: 's1', raw: { upstream: true, thumbnailFallbacks: ['https://example.test/tops.webp'] } },
      { kind: 'clothing' as const, id: '102', name: '已有名字', thumbnail: 'https://example.test/102.png' },
      { kind: 'filter' as const, id: '7', name: '晨雾' }
    ]
  }
  service.replaceManifest(upstream)
  for (const [id, clothes] of [
    ['missing-name', [{ id: '101', suitId: 's1' }]],
    ['custom-name', [{ id: '101', name: '我的备注', suitId: 's1' }]]
  ] as const) {
    assets.create({
      assetId: id, assetType: 'photo', uid: '10001', discoveredAt: '2026-09-03T00:00:00.000Z', metadataSchemaVersion: 1,
      metadata: { schemaVersion: 1, identity: { uid: '10001' }, capture: {}, camera: {}, dressing: { clothes: [...clothes] },
        raw: { resolver: { status: 'resolved' }, dictionary: { provider: 'fixture', providerVersion: 'remote-1' } } }
    })
  }
  const supplement = {
    schemaVersion: 1, provider: 'verified-local', providerVersion: '1', entries: [
      { kind: 'clothing', id: '101', name: '核验名称', suitId: 's1', suitName: '核验套装', raw: { sources: ['https://example.test/wiki'] } },
      { kind: 'clothing', id: '102', name: '不覆盖上游' },
      { kind: 'clothing', id: '103', name: '上游尚未收录', suitId: 's1', suitName: '核验套装' }
    ]
  }
  const supplemented: MetadataDictionaryService = Reflect.construct(MetadataDictionaryService, [db, supplement])
  assert.equal(dictionary.lookup('clothing', '101')?.name, '核验名称')
  assert.equal(dictionary.lookup('clothing', '101')?.thumbnail, 'https://example.test/101.png')
  assert.equal(dictionary.lookup('clothing', '101')?.category, 'tops')
  assert.equal(dictionary.lookup('clothing', '101')?.raw?.upstream, true)
  assert.deepEqual(dictionary.lookup('clothing', '101')?.thumbnailFallbacks, ['https://example.test/tops.webp'])
  assert.equal(dictionary.lookup('clothing', '102')?.name, '已有名字')
  assert.equal(dictionary.lookup('clothing', '103')?.name, '上游尚未收录')
  assert.equal(dictionary.lookup('filter', '7')?.name, '晨雾')
  assert.equal(supplemented.reenrichResolvedAssets(), 2)
  const photo = JSON.parse(String(assets.getById('missing-name')?.metadata_json))
  assert.equal(photo.dressing.clothes[0].name, '核验名称')
  assert.equal(photo.dressing.clothes[0].suitName, '核验套装')
  assert.deepEqual(photo.dressing.clothes[0].thumbnailFallbacks, ['https://example.test/tops.webp'])
  assert.equal(JSON.parse(String(assets.getById('custom-name')?.metadata_json)).dressing.clothes[0].name, '我的备注')
  const version = dictionary.getActiveManifest()?.providerVersion
  const restarted: MetadataDictionaryService = Reflect.construct(MetadataDictionaryService, [db, supplement])
  assert.equal(dictionary.getActiveManifest()?.providerVersion, version)
  assert.equal(restarted.reenrichResolvedAssets(), 0)
  restarted.replaceManifest({ ...upstream, providerVersion: 'remote-2' })
  assert.equal(dictionary.lookup('clothing', '101')?.name, '核验名称')
  const previous = restarted.replaceManifest({ ...upstream, providerVersion: 'remote-3', entries: [
    { ...upstream.entries[0]!, name: '上游正式名字', suitName: '上游正式套装' }, ...upstream.entries.slice(1)
  ] })
  restarted.reenrichResolvedAssets(previous)
  assert.equal(JSON.parse(String(assets.getById('missing-name')?.metadata_json)).dressing.clothes[0].name, '上游正式名字')
  assert.equal(JSON.parse(String(assets.getById('custom-name')?.metadata_json)).dressing.clothes[0].name, '我的备注')
  db.close()
})

test('supplement does not apply a name when the upstream suit ID conflicts', () => {
  const { db, service, dictionary } = setup()
  service.replaceManifest({ schemaVersion: 1, provider: 'fixture', providerVersion: '1', entries: [
    { kind: 'clothing', id: '101', suitId: 'different-suit' }
  ] })
  Reflect.construct(MetadataDictionaryService, [db, {
    schemaVersion: 1, provider: 'local', providerVersion: '1', entries: [
      { kind: 'clothing', id: '101', name: '不匹配', suitId: 's1', suitName: '不匹配套装' }
    ]
  }])
  assert.equal(dictionary.lookup('clothing', '101')?.name, undefined)
  assert.equal(dictionary.getActiveManifest()?.providerVersion, '1')
  db.close()
})

test('startup repairs photo fallbacks from legacy stored dictionary data exactly once', () => {
  const { db, assets, dictionary } = setup()
  dictionary.replaceSnapshot({ schemaVersion: 1, provider: 'fixture', providerVersion: 'legacy', entries: [
    { kind: 'clothing', id: '101', name: '核验名称', raw: { thumbnailFallbacks: ['https://example.test/tops.webp'] } }
  ] })
  assets.create({ assetId: 'legacy-photo', assetType: 'photo', discoveredAt: '2026-09-03T00:00:00.000Z', metadataSchemaVersion: 1,
    metadata: { schemaVersion: 1, identity: {}, capture: {}, camera: {}, dressing: { clothes: [{ id: '101', name: '核验名称' }] },
      raw: { resolver: { status: 'resolved' }, dictionary: { provider: 'fixture', providerVersion: 'legacy' } } }
  })
  const service = new MetadataDictionaryService(db)
  assert.equal(service.reenrichResolvedAssets(), 1)
  assert.deepEqual(JSON.parse(String(assets.getById('legacy-photo')?.metadata_json)).dressing.clothes[0].thumbnailFallbacks,
    ['https://example.test/tops.webp'])
  assert.equal(new MetadataDictionaryService(db).reenrichResolvedAssets(), 0)
  db.close()
})

test('dictionary parsing preserves canonical fallbacks and rejects malformed lists', () => {
  const manifest = { schemaVersion: 1, provider: 'fixture', providerVersion: '1', entries: [
    { kind: 'clothing', id: '101', thumbnailFallbacks: ['https://example.test/tops.webp'] }
  ] }
  assert.deepEqual(parseMetadataDictionaryManifest(manifest).entries[0]?.thumbnailFallbacks, manifest.entries[0]?.thumbnailFallbacks)
  assert.throws(() => parseMetadataDictionaryManifest({ ...manifest, entries: [
    { ...manifest.entries[0], thumbnailFallbacks: [123] }
  ] }), /thumbnailFallbacks/)
})

test('bulk enrichment reads one dictionary snapshot for the entire photo batch', () => {
  const { db, service, assets } = setup()
  service.replaceManifest({ schemaVersion: 1, provider: 'fixture', providerVersion: '1', entries: [
    { kind: 'clothing', id: '101', name: '核验名称' }
  ] })
  for (let index = 0; index < 3; index++) assets.create({
    assetId: `batch-${index}`, assetType: 'photo', discoveredAt: '2026-10-09T00:00:00.000Z', metadataSchemaVersion: 1,
    metadata: { schemaVersion: 1, identity: {}, capture: {}, camera: {}, dressing: { clothes: [101] },
      raw: { resolver: { status: 'resolved' } } }
  })
  const dictionary = service['dictionary'], read = dictionary.getActiveManifest.bind(dictionary)
  let snapshotsRead = 0
  dictionary.getActiveManifest = () => { snapshotsRead++; return read() }
  assert.equal(service.reenrichResolvedAssets(), 3)
  assert.equal(snapshotsRead, 1, 'bulk work must not reload thousands of dictionary rows for every photo')
  assert.equal(JSON.parse(String(assets.getById('batch-2')?.metadata_json)).dressing.clothes[0].name, '核验名称')
  snapshotsRead = 0
  assert.equal(service.reenrichResolvedAssets(), 0)
  assert.equal(snapshotsRead, 1)
  db.close()
})
