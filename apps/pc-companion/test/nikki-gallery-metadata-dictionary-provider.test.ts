import assert from 'node:assert/strict'
import test from 'node:test'
import { AssetRepository, AppSettingsRepository, DatabaseManager, MetadataDictionaryRepository } from '@nikkisync/database'
import { MetadataDictionaryService } from '../src/metadata/MetadataDictionaryService.js'
import { MetadataDictionaryUpdateService } from '../src/metadata/MetadataDictionaryUpdateService.js'
import { composeMetadataDictionaryProvider } from '../src/metadata/MetadataStartupComposition.js'
import { composeMetadataDictionarySupplementProvider } from '../src/metadata/MetadataStartupComposition.js'
import { NikkiGalleryMetadataDictionaryProvider } from '../src/metadata/NikkiGalleryMetadataDictionaryProvider.js'
import { PcCompanionRuntime } from '../src/runtime.js'
import { loadMetadataDictionaryRemoteConfigFile } from '../src/metadata/MetadataDictionaryRemoteConfigFile.js'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const endpoint = 'https://www.nikkigallery.vip/api/v1/clothes/all'
const fixture = {
  clothes: [
    { gid: 1020300419, name: '甜心跳', filename: 'S0419T.png', part: 'tops', level: 0 },
    { gid: 1020720419, name: '兔耳糖', filename: 'S0419AHC.png', part: 'accessory.hat', level: 0 },
    { gid: 10419, name: '蹦跳计划', filename: 'S0419T.png', part: 'set', level: 0 }
  ],
  clothes_set: [{ clothes_gid: 10419, item_gids: [1020300419, 1020720419] }],
  pose: [], colors: {}
}

test('NikkiGallery supplementary dictionary includes exact public action names without replacing clothes', async () => {
  const api = await provider(async () => Response.json({ ...fixture,
    pose: [{ gid: 1090010002, posename: '侧身低头', filename: 'T_Icon_Static_002.png' }] }))
  const result = await api.fetch()
  assert.equal(result.status, 'updated')
  if (result.status !== 'updated') throw new Error('Expected dictionary')
  assert.equal(result.manifest.entries.filter(entry => entry.kind === 'clothing').length, 2)
  assert.equal(result.manifest.entries.find(entry => entry.kind === 'pose' && entry.id === '1090010002')?.name, '侧身低头')
  const db = new DatabaseManager(':memory:'); db.initialize()
  try {
    const service = new MetadataDictionaryService(db)
    service.setSupplement(result.manifest)
    assert.equal(service.enrichMetadata({ pose: { id: '1090010002' } }).pose?.name, '侧身低头')
    assert.equal(service.enrichMetadata({ pose: { id: '1090010002', name: '个人备注' } }).pose?.name, '个人备注')
  } finally { db.close() }
})

async function provider(fetcher: typeof fetch) {
  return new NikkiGalleryMetadataDictionaryProvider({}, fetcher)
}

test('NikkiGallery maps exact IDs, names, safe images and explicit suit membership without guessing rarity', async () => {
  const requests: Array<{ url: string, options?: RequestInit }> = []
  const api = await provider(async (input, options) => {
    requests.push({ url: String(input), ...(options ? { options } : {}) })
    return Response.json(fixture)
  })
  const result = await api.fetch()
  assert.equal(result.status, 'updated')
  if (result.status !== 'updated') throw new Error('Expected fixture dictionary')
  const top = result.manifest.entries.find((entry: any) => entry.id === '1020300419')
  assert.equal(top?.name, '甜心跳')
  assert.equal(top?.category, 'tops')
  assert.equal(top?.suitId, '10419')
  assert.equal(top?.suitName, '蹦跳计划')
  assert.equal(top?.thumbnail, 'https://nikkigallery.vip/static/img/clothes/S0419T.png')
  assert.equal(top?.rarity, undefined)
  assert.equal(result.manifest.entries.length, 2, 'suit rows are membership data, not clothing')
  assert.equal(result.manifest.entries.find((entry: any) => entry.id === '1020720419')?.category, 'headwear')
  assert.equal(top?.raw?.sourceEndpoint, endpoint)
  assert.equal(requests.length, 1)
  assert.equal(requests[0]?.url, endpoint)
  assert.equal(requests[0]?.options?.method, 'GET')
  assert.equal(requests[0]?.options?.body, undefined)
  assert.equal(new Headers(requests[0]?.options?.headers).get('authorization'), null)
  const unchanged = await api.fetch({ contentVersion: result.manifest.providerVersion })
  assert.equal(unchanged.status, 'not-modified', 'content hash avoids rewriting unchanged HTTP 200 data')
})

test('NikkiGallery supports conditional requests and rejects invalid snapshots and unsafe filenames', async () => {
  const conditional = await provider(async (_url, options) => {
    assert.equal(new Headers(options?.headers).get('if-none-match'), 'fixture-etag')
    return new Response(null, { status: 304 })
  })
  assert.equal((await conditional.fetch({ etag: 'fixture-etag' })).status, 'not-modified')
  for (const payload of [{ clothes: [] }, { ...fixture, clothes: [...fixture.clothes, fixture.clothes[0]] },
    { ...fixture, clothes_set: [{ clothes_gid: 10419, item_gids: ['not-an-id'] }] }]) {
    await assert.rejects((await provider(async () => Response.json(payload))).fetch())
  }
  const unsafe = await provider(async () => Response.json({ ...fixture, clothes: [
    { ...fixture.clothes[0], filename: '../../secret.png' }, fixture.clothes[1], fixture.clothes[2]
  ] }))
  const result = await unsafe.fetch()
  assert.equal(result.status, 'updated')
  if (result.status === 'updated') assert.equal(result.manifest.entries.find((entry: any) => entry.id === '1020300419')?.thumbnail, undefined)
  const oversized = await provider(async () => new Response('x'.repeat(8 * 1024 * 1024 + 1)))
  await assert.rejects(oversized.fetch(), /size|large|limit/i)
  const failed = await provider(async () => new Response('unavailable', { status: 503 }))
  await assert.rejects(failed.fetch(), /503/)
})

test('supplement updater caches separately, preserves primary icons, survives offline restart and primary refresh', async () => {
  const db = new DatabaseManager(':memory:'); db.initialize()
  const dictionary = new MetadataDictionaryRepository(db), assets = new AssetRepository(db), settings = new AppSettingsRepository(db)
  const primary = { schemaVersion: 1 as const, provider: 'primary', providerVersion: '1', entries: [
    { kind: 'clothing' as const, id: '1020300419', thumbnail: 'https://example.test/original.png', category: 'tops',
      thumbnailFallbacks: ['https://example.test/type.webp'], suitId: '10419' },
    { kind: 'filter' as const, id: '7', name: '原滤镜' }
  ] }
  const service = new MetadataDictionaryService(db); service.replaceManifest(primary)
  for (const [id, name] of [['missing', undefined], ['custom', '我的备注']] as const) {
    assets.create({ assetId: id, assetType: 'photo', discoveredAt: '2026-10-09T00:00:00.000Z', metadataSchemaVersion: 1,
      metadata: { schemaVersion: 1, identity: {}, capture: {}, camera: {}, dressing: { clothes: [{ id: '1020300419', ...(name ? { name } : {}) }] },
        raw: { resolver: { status: 'resolved' } } }
    })
  }
  let offline = false, data = fixture
  const api = await provider(async () => { if (offline) throw new Error('offline'); return Response.json(data) })
  let settled = 0
  const updater = new MetadataDictionaryUpdateService(db, service, api, { mode: 'supplement', onWorkSettled: () => { settled++ } })
  assert.equal((await updater.runOnce()).status, 'updated')
  assert.equal(settled, 1, 'bulk dictionary work must notify the quiet-time memory collector')
  assert.equal(dictionary.getActiveManifest()?.provider, 'primary', 'secondary feed must not replace the primary dictionary')
  assert.equal(dictionary.lookup('filter', '7')?.name, '原滤镜')
  assert.equal(dictionary.lookup('clothing', '1020300419')?.name, '甜心跳')
  assert.equal(dictionary.lookup('clothing', '1020300419')?.thumbnail, 'https://example.test/original.png')
  assert.deepEqual(dictionary.lookup('clothing', '1020300419')?.thumbnailFallbacks, ['https://example.test/type.webp'])
  assert.equal(JSON.parse(String(assets.getById('custom')?.metadata_json)).dressing.clothes[0].name, '我的备注')
  assert.ok(settings.get('metadata_dictionary_supplement_cache:nikki-gallery-public'))
  assert.equal((await updater.runOnce()).status, 'not-modified')
  data = { ...fixture, clothes: fixture.clothes.map(row => row.gid === 1020300419 ? { ...row, name: '甜心跳·更新' } : row) }
  assert.equal((await updater.runOnce()).status, 'updated')
  assert.equal(JSON.parse(String(assets.getById('missing')?.metadata_json)).dressing.clothes[0].name, '甜心跳·更新')
  assert.equal(JSON.parse(String(assets.getById('custom')?.metadata_json)).dressing.clothes[0].name, '我的备注')
  const restarted = new MetadataDictionaryService(db)
  const restored = new MetadataDictionaryUpdateService(db, restarted, api, { mode: 'supplement' })
  assert.equal(restarted.reenrichResolvedAssets(), 0, 'restoring an unchanged cache must not rewrite photos')
  offline = true
  assert.equal((await restored.runOnce()).status, 'failed')
  const old = restarted.replaceManifest({ ...primary, providerVersion: '2' })
  restarted.reenrichResolvedAssets(old)
  assert.equal(dictionary.lookup('clothing', '1020300419')?.name, '甜心跳·更新')
  const upgraded = restarted.replaceManifest({ ...primary, providerVersion: '3', entries: [
    { ...primary.entries[0]!, name: '主字典正式名称' }, primary.entries[1]!
  ] })
  restarted.reenrichResolvedAssets(upgraded)
  assert.equal(JSON.parse(String(assets.getById('missing')?.metadata_json)).dressing.clothes[0].name, '主字典正式名称')
  assert.equal(JSON.parse(String(assets.getById('custom')?.metadata_json)).dressing.clothes[0].name, '我的备注')
  db.close()
})

test('public dictionary startup keeps the original primary source', () => {
  assert.equal(composeMetadataDictionaryProvider(undefined)?.id, 'nikki-albums-public')
  assert.equal(composeMetadataDictionarySupplementProvider(undefined)?.id, 'nikki-gallery-public')
  assert.equal(composeMetadataDictionarySupplementProvider({ enabled: false }), undefined)
  assert.equal(composeMetadataDictionarySupplementProvider({ gallery: { enabled: false } }), undefined)
})

test('ambiguous memberships do not assign a guessed suit', async () => {
  const api = await provider(async () => Response.json({ ...fixture,
    clothes: [...fixture.clothes, { gid: 10420, name: '另一套', filename: 'S0420T.png', part: 'set', level: 0 }],
    clothes_set: [...fixture.clothes_set, { clothes_gid: 10420, item_gids: [1020300419] }]
  }))
  const result = await api.fetch()
  assert.equal(result.status, 'updated')
  if (result.status === 'updated') {
    const top = result.manifest.entries.find(entry => entry.id === '1020300419')
    assert.equal(top?.suitId, undefined); assert.equal(top?.suitName, undefined)
    assert.deepEqual(top?.raw?.gallerySuitIds, ['10419', '10420'])
  }
})

test('missing or malformed supplement cache forces a full refresh despite an old content hash', async () => {
  const db = new DatabaseManager(':memory:'); db.initialize()
  const settings = new AppSettingsRepository(db), dictionary = new MetadataDictionaryService(db)
  settings.set('metadata_dictionary_supplement_cache:nikki-gallery-public', { broken: true })
  settings.set('metadata_dictionary_remote_state:nikki-gallery-public', { contentVersion: 'old', etag: 'old' })
  const api = { id: 'nikki-gallery-public', fetch: async (state: any) => {
    assert.equal(state.contentVersion, undefined); assert.equal(state.etag, undefined)
    return { status: 'updated' as const, manifest: { schemaVersion: 1 as const, provider: 'nikki-gallery-public', providerVersion: 'fresh',
      entries: [{ kind: 'clothing' as const, id: '101', name: '新名称' }] } }
  } }
  const updater = new MetadataDictionaryUpdateService(db, dictionary, api, { mode: 'supplement' })
  assert.equal((await updater.runOnce()).status, 'updated')
  assert.equal(new MetadataDictionaryRepository(db).lookup('clothing', '101')?.name, '新名称')
  db.close()
})

test('runtime owns the supplement updater and late responses cannot write after stop', async () => {
  let finish: ((value: any) => void) | undefined
  const api = { id: 'nikki-gallery-public', fetch: () => new Promise<any>(resolve => { finish = resolve }) }
  const runtime = new PcCompanionRuntime({ metadataDictionarySupplementRemote: { provider: api } })
  assert.ok(runtime.metadataDictionarySupplementUpdater)
  const pending = runtime.metadataDictionarySupplementUpdater.runOnce()
  await runtime.stop()
  finish!({ status: 'updated', manifest: { schemaVersion: 1, provider: api.id, providerVersion: 'late', entries: [] } })
  assert.equal((await pending).status, 'not-modified')
})

test('local remote config persists the separate Gallery interval and opt-out', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nikki-gallery-config-')), file = path.join(dir, 'remote.json')
  try {
    await writeFile(file, JSON.stringify({ enabled: true, provider: { type: 'nikki-albums-public' },
      gallery: { enabled: false, intervalMs: 21_600_000 } }))
    const config = loadMetadataDictionaryRemoteConfigFile(file)
    assert.deepEqual(config?.gallery, { enabled: false, intervalMs: 21_600_000 })
    assert.equal(composeMetadataDictionaryProvider(config)?.id, 'nikki-albums-public')
    assert.equal(composeMetadataDictionarySupplementProvider(config), undefined)
    await writeFile(file, JSON.stringify({ enabled: true, provider: { type: 'nikki-albums-public' }, gallery: { intervalMs: -1 } }))
    assert.equal(loadMetadataDictionaryRemoteConfigFile(file), undefined)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
