import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { AssetRepository, DatabaseManager, MetadataDictionaryRepository } from '@nikkisync/database'
import { MetadataDictionaryService } from '../src/metadata/MetadataDictionaryService.js'
import { MetadataDictionaryUpdateService } from '../src/metadata/MetadataDictionaryUpdateService.js'
import { RemoteJsonMetadataDictionaryProvider } from '../src/metadata/RemoteJsonMetadataDictionaryProvider.js'
import { loadMetadataDictionaryRemoteConfigFile } from '../src/metadata/MetadataDictionaryRemoteConfigFile.js'

test('remote dictionary update uses conditional GET and re-enriches locally without photo identifiers', async () => {
  const db = new DatabaseManager(':memory:')
  db.initialize()
  const assets = new AssetRepository(db)
  const dictionary = new MetadataDictionaryRepository(db)
  assets.create({
    assetId: 'asset_dictionary_remote', assetType: 'photo', uid: '10001', discoveredAt: '2026-09-03T00:00:00.000Z',
    metadataSchemaVersion: 1,
    metadata: {
      schemaVersion: 1, identity: { uid: '10001' }, capture: {}, camera: {}, filter: { id: '7' },
      raw: { resolver: { status: 'resolved', provider: 'fixture-photo-resolver' } }
    }
  })
  dictionary.replaceSnapshot({
    schemaVersion: 1, provider: 'fixture-dictionary', providerVersion: '1',
    entries: [{ kind: 'filter', id: '7', name: '旧滤镜' }]
  })

  const requests: Array<{ headers: http.IncomingHttpHeaders, body: string }> = []
  const modified = 'Thu, 03 Sep 2026 08:00:00 GMT'
  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const body = Buffer.concat(chunks).toString('utf8')
    requests.push({ headers: request.headers, body })
    if (request.headers['if-none-match'] === '"dict-v2"') {
      response.writeHead(304); response.end(); return
    }
    response.setHeader('content-type', 'application/json')
    response.setHeader('etag', '"dict-v2"')
    response.setHeader('last-modified', modified)
    response.end(JSON.stringify({
      schemaVersion: 1,
      provider: 'fixture-dictionary',
      providerVersion: '2',
      generatedAt: '2026-09-03T08:00:00.000Z',
      entries: [{ kind: 'filter', id: '7', name: '新滤镜' }]
    }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address() as { port: number }
    const provider = new RemoteJsonMetadataDictionaryProvider({
      id: 'fixture-dictionary',
      endpoint: `http://127.0.0.1:${address.port}/dictionary`,
      locale: 'zh-CN'
    })
    const service = new MetadataDictionaryService(db)
    const updater = new MetadataDictionaryUpdateService(db, service, provider)

    const first = await updater.runOnce()
    assert.equal(first.status, 'updated')
    assert.equal(first.enrichedAssets, 1)
    assert.equal(requests[0]?.body, '')
    assert.equal(requests[0]?.headers['accept-language'], 'zh-CN')
    assert.equal(JSON.stringify(requests[0]).includes('10001'), false)
    const metadata = JSON.parse(String(assets.getById('asset_dictionary_remote')?.metadata_json))
    assert.equal(metadata.filter.name, '新滤镜')
    const revisionAfterUpdate = assets.getById('asset_dictionary_remote')?.revision

    const second = await updater.runOnce()
    assert.equal(second.status, 'not-modified')
    assert.equal(requests[1]?.headers['if-none-match'], '"dict-v2"')
    assert.equal(requests[1]?.headers['if-modified-since'], modified)
    assert.equal(assets.getById('asset_dictionary_remote')?.revision, revisionAfterUpdate)
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    db.close()
  }
})

test('failed remote dictionary update preserves the previous valid snapshot', async () => {
  const db = new DatabaseManager(':memory:')
  db.initialize()
  const dictionary = new MetadataDictionaryRepository(db)
  dictionary.replaceSnapshot({
    schemaVersion: 1, provider: 'fixture-dictionary', providerVersion: '1',
    entries: [{ kind: 'filter', id: '7', name: '旧滤镜' }]
  })
  const server = http.createServer((_request, response) => {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ schemaVersion: 1, provider: 'wrong-provider', providerVersion: '2', entries: [] }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address() as { port: number }
    const updater = new MetadataDictionaryUpdateService(
      db,
      new MetadataDictionaryService(db),
      new RemoteJsonMetadataDictionaryProvider({
        id: 'fixture-dictionary', endpoint: `http://127.0.0.1:${address.port}/dictionary`
      })
    )
    const result = await updater.runOnce()
    assert.equal(result.status, 'failed')
    assert.match(result.error ?? '', /provider/i)
    assert.equal(dictionary.getActiveManifest()?.providerVersion, '1')
    assert.equal(dictionary.lookup('filter', '7')?.name, '旧滤镜')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    db.close()
  }
})

test('remote dictionary update refreshes generated names without replacing user overrides', async () => {
  const db = new DatabaseManager(':memory:')
  db.initialize()
  const assets = new AssetRepository(db)
  const dictionary = new MetadataDictionaryRepository(db)
  const initialManifest = {
    schemaVersion: 1 as const, provider: 'fixture-dictionary', providerVersion: '1',
    entries: [{ kind: 'filter' as const, id: '7', name: '旧滤镜' }]
  }
  dictionary.replaceSnapshot(initialManifest)
  for (const [assetId, name] of [['asset_generated_name', '旧滤镜'], ['asset_user_override', '我自己的滤镜名']] as const) {
    assets.create({
      assetId, assetType: 'photo', uid: '10001', discoveredAt: '2026-09-03T00:00:00.000Z', metadataSchemaVersion: 1,
      metadata: {
        schemaVersion: 1, identity: { uid: '10001' }, capture: {}, camera: {}, filter: { id: '7', name },
        raw: { resolver: { status: 'resolved', provider: 'fixture-photo-resolver' } }
      }
    })
  }
  const server = http.createServer((_request, response) => {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({
      schemaVersion: 1, provider: 'fixture-dictionary', providerVersion: '2',
      entries: [{ kind: 'filter', id: '7', name: '新滤镜' }]
    }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address() as { port: number }
    const updater = new MetadataDictionaryUpdateService(
      db,
      new MetadataDictionaryService(db),
      new RemoteJsonMetadataDictionaryProvider({ id: 'fixture-dictionary', endpoint: `http://127.0.0.1:${address.port}/dictionary` })
    )
    const result = await updater.runOnce()
    assert.deepEqual(result, { status: 'updated', enrichedAssets: 2 })
    assert.equal(JSON.parse(String(assets.getById('asset_generated_name')?.metadata_json)).filter.name, '新滤镜')
    assert.equal(JSON.parse(String(assets.getById('asset_user_override')?.metadata_json)).filter.name, '我自己的滤镜名')
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    db.close()
  }
})

test('remote dictionary config requires an explicit HTTPS opt-in', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nikkisync-dictionary-remote-config-'))
  const file = path.join(directory, 'metadata-dictionary-remote.json')
  try {
    await writeFile(file, JSON.stringify({
      enabled: true,
      provider: {
        type: 'remote-json', id: 'fixture-dictionary', endpoint: 'https://dictionary.example.test/v1/zh-CN',
        locale: 'zh-CN', intervalMs: 3_600_000, timeoutMs: 5_000
      }
    }))
    const config = loadMetadataDictionaryRemoteConfigFile(file)
    assert.equal(config?.enabled, true)
    assert.equal(config?.provider?.id, 'fixture-dictionary')
    assert.equal(config?.provider?.endpoint, 'https://dictionary.example.test/v1/zh-CN')
    assert.equal(config?.provider?.intervalMs, 3_600_000)

    await writeFile(file, JSON.stringify({ enabled: true, provider: { type: 'remote-json', id: 'fixture-dictionary', endpoint: 'http://127.0.0.1/dictionary' } }))
    assert.equal(loadMetadataDictionaryRemoteConfigFile(file), undefined)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
