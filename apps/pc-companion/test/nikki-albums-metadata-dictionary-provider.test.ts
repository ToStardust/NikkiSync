import assert from 'node:assert/strict'
import { createCipheriv, hkdfSync } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  createMetadataDictionaryProviderFromConfig,
  loadMetadataDictionaryRemoteConfigFile
} from '../src/metadata/MetadataDictionaryRemoteConfigFile.js'
import { NikkiAlbumsMetadataDictionaryProvider } from '../src/metadata/NikkiAlbumsMetadataDictionaryProvider.js'
import { composeMetadataDictionaryProvider } from '../src/metadata/MetadataStartupComposition.js'

const PACKAGE_KEY = Buffer.from('9C46C6BF431F5AFFF97A2002AEDFA8B7', 'ascii')

function varint(value: number): Buffer {
  let current = BigInt(value)
  const bytes: number[] = []
  do {
    let byte = Number(current & 0x7fn)
    current >>= 7n
    if (current !== 0n) byte |= 0x80
    bytes.push(byte)
  } while (current !== 0n)
  return Buffer.from(bytes)
}

function protoVarintField(number: number, value: number): Buffer {
  return Buffer.concat([varint(number * 8), varint(value)])
}

function protoBytesField(number: number, value: Buffer): Buffer {
  return Buffer.concat([varint(number * 8 + 2), varint(value.length), value])
}

function msgpackString(value: string): Buffer {
  const data = Buffer.from(value, 'utf8')
  if (data.length <= 31) return Buffer.concat([Buffer.from([0xa0 | data.length]), data])
  if (data.length <= 255) return Buffer.concat([Buffer.from([0xd9, data.length]), data])
  throw new Error('fixture string is too long')
}

function msgpackMap(entries: Array<[string, Buffer]>): Buffer {
  if (entries.length > 15) throw new Error('fixture map is too large')
  return Buffer.concat([
    Buffer.from([0x80 | entries.length]),
    ...entries.flatMap(([key, value]) => [msgpackString(key), value])
  ])
}

function encryptPackage(plain: Buffer): Buffer {
  const salt = Buffer.alloc(16, 0x11)
  const nonce = Buffer.alloc(12, 0x22)
  const key = Buffer.from(hkdfSync('sha256', PACKAGE_KEY, salt, Buffer.from('aes-gcm-filebox'), 32))
  const cipher = createCipheriv('aes-256-gcm', key, nonce)
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()])
  return Buffer.concat([salt, nonce, encrypted, cipher.getAuthTag()])
}

function responseBytes(value: Buffer): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(value.byteLength)
  copy.set(value)
  return copy
}

function languageFixture(id: number, name: string): Buffer {
  return msgpackMap([
    ['infinity_nikki', msgpackMap([
      ['cloth', msgpackMap([[String(id), msgpackString(name)]])]
    ])]
  ])
}

function databaseFixture(id: number, clothType: number): Buffer {
  const imageItem = Buffer.concat([
    protoBytesField(1, Buffer.from('https://icons.example.test/{id}.png')),
    protoBytesField(2, Buffer.from('{id}'))
  ])
  const networkImage = protoBytesField(4, imageItem)
  const cloth = protoVarintField(1, clothType)
  const mapEntry = Buffer.concat([
    protoVarintField(1, id),
    protoBytesField(2, cloth)
  ])
  return Buffer.concat([
    protoBytesField(20001, networkImage),
    protoBytesField(11, mapEntry)
  ])
}

test('Nikki Albums adapter converts public hot-update packages into canonical clothing entries without sending photo data', async () => {
  const clothingId = 1020810145
  const manifestUrl = 'https://fixture.test/hot_update.json'
  const langUrl = 'https://fixture.test/zh-CN.bin'
  const dbUrl = 'https://fixture.test/v1.db'
  const requests: Array<{ url: string, method?: string, body?: BodyInit | null }> = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    requests.push({ url, ...(init?.method ? { method: init.method } : {}), ...(init?.body === undefined ? {} : { body: init.body }) })
    if (url === manifestUrl) {
      return new Response(JSON.stringify([
        {
          id: 'infinity_nikki', versionId: 'lang-v1',
          files: [{ path: 'zh-CN.bin', downloadLink: langUrl }]
        },
        {
          id: 'nuan5_database', versionId: 'db-v1',
          files: [{ path: 'v1.db', downloadLink: dbUrl }]
        }
      ]), { status: 200, headers: { 'content-type': 'application/json', etag: '"fixture-v1"' } })
    }
    if (url === langUrl) return new Response(responseBytes(encryptPackage(languageFixture(clothingId, '测试底妆'))), { status: 200 })
    if (url === dbUrl) return new Response(responseBytes(encryptPackage(databaseFixture(clothingId, 81))), { status: 200 })
    return new Response('not found', { status: 404 })
  }) as typeof fetch

  try {
    const result = await new NikkiAlbumsMetadataDictionaryProvider({ manifestEndpoint: manifestUrl, locale: 'zh-CN' }).fetch()
    assert.equal(result.status, 'updated')
    if (result.status !== 'updated') return
    assert.equal(result.etag, '"fixture-v1"')
    assert.equal(result.manifest.provider, 'nikki-albums-public')
    assert.equal(result.manifest.providerVersion, 'lang-v1:db-v1')
    assert.deepEqual(result.manifest.entries, [{
      kind: 'clothing',
      id: String(clothingId),
      name: '测试底妆',
      category: 'baseMakeup',
      thumbnail: `https://icons.example.test/${clothingId}.png`,
      raw: { clothType: 81, source: 'nikki-albums-public' }
    }])
    assert.deepEqual(requests.map((request) => request.url), [manifestUrl, langUrl, dbUrl])
    assert.equal(requests.every((request) => request.method === 'GET' && request.body === undefined), true)
    assert.equal(JSON.stringify(requests).includes(String(clothingId)), false)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('Nikki Albums dictionary source remains explicit opt-in and rejects insecure configured manifests', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nikkisync-nikki-albums-config-'))
  const file = path.join(directory, 'metadata-dictionary-remote.json')
  try {
    await writeFile(file, JSON.stringify({
      enabled: true,
      provider: {
        type: 'nikki-albums-public', locale: 'zh-CN', intervalMs: 21_600_000,
        manifestEndpoint: 'https://nikki.example.test/app_api/hot_update.json'
      }
    }))
    const config = loadMetadataDictionaryRemoteConfigFile(file)
    assert.equal(config?.provider?.type, 'nikki-albums-public')
    assert.equal(config?.provider?.manifestEndpoint, 'https://nikki.example.test/app_api/hot_update.json')
    assert.equal(config?.provider?.intervalMs, 21_600_000)
    assert.ok(createMetadataDictionaryProviderFromConfig(config) instanceof NikkiAlbumsMetadataDictionaryProvider)

    await writeFile(file, JSON.stringify({
      enabled: true,
      provider: { type: 'nikki-albums-public', manifestEndpoint: 'http://nikki.example.test/hot_update.json' }
    }))
    assert.equal(loadMetadataDictionaryRemoteConfigFile(file), undefined)

    await writeFile(file, JSON.stringify({ enabled: false, provider: { type: 'nikki-albums-public' } }))
    assert.equal(createMetadataDictionaryProviderFromConfig(loadMetadataDictionaryRemoteConfigFile(file)), undefined)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('clean-install dictionary composition defaults to the public Nikki Albums provider', () => {
  const provider = composeMetadataDictionaryProvider(undefined)
  assert.ok(provider instanceof NikkiAlbumsMetadataDictionaryProvider)
  assert.equal(provider.id, 'nikki-albums-public')
})

test('explicit dictionary disable remains authoritative over the clean-install default', () => {
  assert.equal(composeMetadataDictionaryProvider({ enabled: false }), undefined)
})
