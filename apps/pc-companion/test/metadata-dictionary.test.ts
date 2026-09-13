import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { AssetRepository, DatabaseManager, MetadataDictionaryRepository } from '@nikkisync/database'
import { MetadataDictionaryService } from '../src/metadata/MetadataDictionaryService.js'
import { loadMetadataDictionaryFile } from '../src/metadata/MetadataDictionaryConfigFile.js'

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
