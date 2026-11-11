import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { AssetRepository, DatabaseManager } from '@nikkisync/database'
import { loadLocalClothingIconPack } from '../src/metadata/LocalClothingIconPack.js'
import { MetadataThumbnailCache } from '../src/metadata/MetadataThumbnailCache.js'
import { LocalSyncServer } from '../src/server/LocalSyncServer.js'
import { PairingService } from '../src/server/PairingService.js'

function sha256(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

function signedHeaders(privateKey: string, deviceId: string, method: string, requestPath: string): Record<string, string> {
  const timestamp = String(Date.now())
  const nonce = randomBytes(16).toString('base64url')
  const canonical = [method, requestPath, timestamp, nonce, sha256(Buffer.alloc(0))].join('\n')
  return {
    'X-NikkiSync-Device-Id': deviceId,
    'X-NikkiSync-Timestamp': timestamp,
    'X-NikkiSync-Nonce': nonce,
    'X-NikkiSync-Signature': sign(null, Buffer.from(canonical), privateKey).toString('base64url')
  }
}

async function pairTestPhone(db: DatabaseManager, base: string, port: number, deviceId: string) {
  const deviceKeys = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  })
  const pairing = new PairingService(db)
  const qr = pairing.createQrPayload({ host: '127.0.0.1', port, tlsFingerprintSha256: '0'.repeat(64) })
  const pair = await fetch(`${base}/v1/pair`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      pairingToken: qr.pairingToken,
      device: { deviceId, deviceName: 'Test Phone', platform: 'android', publicKey: deviceKeys.publicKey, appVersion: '0.2.0' }
    })
  })
  assert.equal(pair.status, 200)
  return deviceKeys
}

test('clothing thumbnail route proxies only a thumbnail URL already present in the asset metadata', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'nikkisync-thumb-proxy-'))
  const db = new DatabaseManager(':memory:')
  db.initialize()
  const assets = new AssetRepository(db)
  assets.create({
    assetId: 'asset_clothing', assetType: 'photo', uid: '10001', discoveredAt: '2026-09-08T00:00:00.000Z',
    metadataSchemaVersion: 1,
    metadata: {
      schemaVersion: 1,
      identity: { uid: '10001' }, capture: {}, camera: {},
      dressing: {
        clothes: [{
          id: '1020810145', name: '测试底妆', category: 'baseMakeup',
          thumbnail: 'https://images.example.test/cloth/1020810145.png'
        }]
      },
      raw: { dictionary: { provider: 'fixture', providerVersion: 'dict-v1' } }
    }
  })

  const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 9, 8, 7, 6])
  let requests = 0
  const cache = new MetadataThumbnailCache({
    cacheDir: temp,
    fetchImpl: (async () => {
      requests++
      return new Response(image, { status: 200, headers: { 'content-type': 'image/png' } })
    }) as typeof fetch
  })
  const server = new LocalSyncServer(db, {
    host: '127.0.0.1', port: 0, mdns: false, metadataThumbnailCache: cache
  })
  const address = await server.start()
  const base = `http://127.0.0.1:${address.port}`

  try {
    const deviceKeys = await pairTestPhone(db, base, address.port, 'phone_clothing')
    const route = '/v1/assets/asset_clothing/clothing/1020810145/thumbnail'
    assert.equal((await fetch(`${base}${route}`)).status, 401)

    const proxied = await fetch(`${base}${route}`, {
      headers: signedHeaders(deviceKeys.privateKey, 'phone_clothing', 'GET', route)
    })
    assert.equal(proxied.status, 200)
    assert.equal(proxied.headers.get('content-type'), 'image/png')
    assert.equal(proxied.headers.get('x-nikkisync-sha256'), sha256(image))
    assert.deepEqual(Buffer.from(await proxied.arrayBuffer()), image)

    const again = await fetch(`${base}${route}`, {
      headers: signedHeaders(deviceKeys.privateKey, 'phone_clothing', 'GET', route)
    })
    assert.equal(again.status, 200)
    assert.equal(requests, 1)

    const unknownRoute = '/v1/assets/asset_clothing/clothing/1020000000/thumbnail'
    const unknown = await fetch(`${base}${unknownRoute}`, {
      headers: signedHeaders(deviceKeys.privateKey, 'phone_clothing', 'GET', unknownRoute)
    })
    assert.equal(unknown.status, 404)
    assert.equal(requests, 1)
  } finally {
    await server.stop()
    db.close()
    await rm(temp, { recursive: true, force: true })
  }
})

test('clothing thumbnail route falls back to the dictionary clothing-type image when the exact item image is missing', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'nikkisync-thumb-fallback-'))
  const db = new DatabaseManager(':memory:')
  db.initialize()
  const assets = new AssetRepository(db)
  assets.create({
    assetId: 'asset_skin_tone', assetType: 'photo', uid: '10001', discoveredAt: '2026-09-09T00:00:00.000Z',
    metadataSchemaVersion: 1,
    metadata: {
      schemaVersion: 1,
      identity: { uid: '10001' }, capture: {}, camera: {},
      dressing: {
        clothes: [{
          id: '1023860042', name: '雪上月华', category: 'skinTones',
          thumbnail: 'https://images.example.test/cloth/1023860042.png',
          thumbnailFallbacks: ['https://images.example.test/type/86.png']
        }]
      },
      raw: { dictionary: { provider: 'fixture', providerVersion: 'dict-v2' } }
    }
  })

  const fallbackImage = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])
  const requestedUrls: string[] = []
  const cache = new MetadataThumbnailCache({
    cacheDir: temp,
    fetchImpl: (async (input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      requestedUrls.push(url)
      if (url.includes('/cloth/1023860042.png')) return new Response('missing', { status: 404 })
      if (url.includes('/type/86.png')) return new Response(fallbackImage, { status: 200, headers: { 'content-type': 'image/png' } })
      return new Response('missing', { status: 404 })
    }) as typeof fetch
  })
  const server = new LocalSyncServer(db, {
    host: '127.0.0.1', port: 0, mdns: false, metadataThumbnailCache: cache
  })
  const address = await server.start()
  const base = `http://127.0.0.1:${address.port}`

  try {
    const deviceKeys = await pairTestPhone(db, base, address.port, 'phone_skin_tone')
    const route = '/v1/assets/asset_skin_tone/clothing/1023860042/thumbnail'
    const proxied = await fetch(`${base}${route}`, {
      headers: signedHeaders(deviceKeys.privateKey, 'phone_skin_tone', 'GET', route)
    })
    assert.equal(proxied.status, 200)
    assert.equal(proxied.headers.get('x-nikkisync-thumbnail-source'), 'fallback')
    assert.equal(proxied.headers.get('x-nikkisync-sha256'), sha256(fallbackImage))
    assert.deepEqual(Buffer.from(await proxied.arrayBuffer()), fallbackImage)
    assert.deepEqual(requestedUrls, [
      'https://images.example.test/cloth/1023860042.png',
      'https://images.example.test/type/86.png'
    ])
  } finally {
    await server.stop()
    db.close()
    await rm(temp, { recursive: true, force: true })
  }
})

test('paired thumbnail requests in local mode use only exact pack IDs and never request legacy URLs', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nikkisync-local-icons-'))
  const db = new DatabaseManager()
  let server: LocalSyncServer | undefined
  try {
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGN4WTQFAAQ3AfCGNPMoAAAAAElFTkSuQmCC', 'base64')
    const digest = sha256(image)
    const exact = '1020100111', missing = '1020600111', unrelated = '1020900111'
    const imagePath = path.join(directory, digest + '.png')
    await writeFile(imagePath, image)
    await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({
      schemaVersion: 1, version: 'test', source: 'synthetic',
      entries: [{ id: exact, sha256: digest }, { id: unrelated, sha256: digest }]
    }))
    const pack = await loadLocalClothingIconPack(directory)
    assert.ok(pack)
    db.initialize()
    new AssetRepository(db).create({
      assetId: 'asset_local_clothing', assetType: 'photo', uid: '10001', discoveredAt: '2026-11-09T00:00:00.000Z',
      metadataSchemaVersion: 1,
      metadata: {
        schemaVersion: 1, identity: { uid: '10001' }, capture: {}, camera: {},
        dressing: { clothes: [Number(exact), {
          id: missing, name: '保留已有名称', thumbnail: 'https://images.example.test/item.png',
          thumbnailFallbacks: ['https://images.example.test/category.png']
        }] }
      }
    })
    let requests = 0
    const config = {
      host: '127.0.0.1', port: 0, mdns: false, localClothingIcons: pack,
      metadataThumbnailCache: new MetadataThumbnailCache({ cacheDir: directory,
        fetchImpl: async () => { requests++; throw Error('Unexpected external request') } })
    }
    server = new LocalSyncServer(db, config)
    const address = await server.start()
    const base = 'http://127.0.0.1:' + address.port
    const deviceId = 'phone_local_clothing'
    const keys = await pairTestPhone(db, base, address.port, deviceId)
    const get = (route: string, method = 'GET') => fetch(base + route, {
      method, headers: signedHeaders(keys.privateKey, deviceId, method, route)
    })
    const detailRoute = '/v1/assets/asset_local_clothing'
    const route = (id: string) => `${detailRoute}/clothing/${id}/thumbnail`
    assert.equal((await fetch(base + route(exact))).status, 401)
    const detail = await (await get(detailRoute)).json()
    assert.deepEqual(detail.asset.metadata.dressing.clothes, [Number(exact), { id: missing, name: '保留已有名称' }])
    const served = await get(route(exact))
    assert.equal(served.status, 200)
    assert.equal(served.headers.get('x-nikkisync-sha256'), digest)
    assert.equal(served.headers.get('content-type'), 'image/png')
    assert.deepEqual(Buffer.from(await served.arrayBuffer()), image)
    const head = await get(route(exact), 'HEAD')
    assert.equal(head.headers.get('content-length'), String(image.length))
    assert.equal((await head.arrayBuffer()).byteLength, 0)
    assert.equal((await get(route(missing))).status, 404)
    assert.equal((await get(route(unrelated))).status, 404)
    const corrupt = Buffer.from(image)
    corrupt[50] = corrupt[50]! ^ 1
    await writeFile(imagePath, corrupt)
    assert.equal((await get(route(exact))).status, 404)
    assert.equal(requests, 0)
  } finally {
    await server?.stop()
    db.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('the local icon pack rejects ambiguous IDs and filename traversal and is optional when absent', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nikkisync-invalid-local-icons-'))
  try {
    const id = '1020100111'
    const digest = 'a'.repeat(64)
    const manifest = path.join(directory, 'manifest.json')
    assert.equal(await loadLocalClothingIconPack(path.join(directory, 'absent')), undefined)
    for (const entries of [
      [{ id, sha256: digest }, { id, sha256: 'b'.repeat(64) }],
      [{ id, sha256: '../' + digest }],
      [{ id: 'S0205', sha256: digest }]
    ]) {
      await writeFile(manifest, JSON.stringify({ schemaVersion: 1, version: 'test', source: 'synthetic', entries }))
      const pack = await loadLocalClothingIconPack(directory)
      assert.ok(pack, 'invalid installed packs must still select local-only mode')
      assert.equal(pack.sha256For(id), undefined)
      assert.equal(await pack.read(id), undefined)
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('the WebP pack prioritizes item art and exposes category fallback from the offline manifest', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nikkisync-webp-icons-'))
  try {
    const { mkdir } = await import('node:fs/promises')
    await mkdir(path.join(directory, 'icons'))
    await mkdir(path.join(directory, 'fallbacks'))
    const image = Buffer.from('UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAQAcJaQAA3AA/v4G0AA=', 'base64')
    const digest = sha256(image)
    const exact = '1020100111', fallback = '1020600111'
    const item = { id: exact, sha256: digest, file: `icons/${exact}.webp`, sizeBytes: image.length, width: 1, height: 1 }
    const category = { ...item, id: fallback, file: `fallbacks/${digest}.webp` }
    await writeFile(path.join(directory, item.file), image)
    await writeFile(path.join(directory, category.file), image)
    const manifest = { schemaVersion: 2, version: 'r2', source: 'test', imageFormat: 'webp',
      entries: [item], fallbackEntries: [{ ...category, id: exact }, category] }
    const manifestPath = path.join(directory, 'manifest.json')
    await writeFile(manifestPath, JSON.stringify(manifest))
    const pack = await loadLocalClothingIconPack(directory)
    assert.equal(pack?.valid, true)
    assert.deepEqual(await pack?.read(exact), { image, sha256: digest, mime: 'image/webp', source: 'item' })
    assert.deepEqual(await pack?.read(fallback), { image, sha256: digest, mime: 'image/webp', source: 'category' })
    assert.equal(await pack?.read('1020900111'), undefined)
    await writeFile(path.join(directory, item.file), Buffer.alloc(image.length))
    assert.equal((await pack?.read(exact))?.source, 'category')
    await writeFile(manifestPath, JSON.stringify({ ...manifest, entries: [{ ...item, file: '../icon.webp' }] }))
    assert.equal((await loadLocalClothingIconPack(directory))?.valid, false)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('signed effect icons use the exact pose and lighting attached to the photo', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nikkisync-effect-icons-'))
  const db = new DatabaseManager()
  let server: LocalSyncServer | undefined
  try {
    const { mkdir } = await import('node:fs/promises')
    await mkdir(path.join(directory, 'effects'))
    const image = Buffer.from('UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAQAcJaQAA3AA/v4G0AA=', 'base64')
    const digest = sha256(image), pose = '1090012102', light = '1090030001', alias = 'HueEdgeLight_001_R'
    const effectEntries = [
      { kind: 'pose', id: pose, file: `effects/pose-${pose}.webp` },
      { kind: 'lighting', id: light, file: `effects/lighting-${light}.webp`, aliases: [alias] }
    ].map(entry => ({ ...entry, sha256: digest, sizeBytes: image.length, width: 1, height: 1 }))
    for (const entry of effectEntries) await writeFile(path.join(directory, entry.file), image)
    await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({
      schemaVersion: 2, version: 'r3', source: 'fixture', imageFormat: 'webp', entries: [], effectEntries
    }))
    const pack = await loadLocalClothingIconPack(directory)
    assert.ok(pack?.valid)
    db.initialize()
    new AssetRepository(db).create({
      assetId: 'asset_effects', assetType: 'photo', uid: '10001', discoveredAt: '2026-11-10T00:00:00.000Z',
      metadata: { pose: { id: pose }, lighting: { id: alias } }
    })
    server = new LocalSyncServer(db, { host: '127.0.0.1', port: 0, mdns: false, localClothingIcons: pack })
    const address = await server.start(), base = 'http://127.0.0.1:' + address.port, device = 'phone_effects'
    const keys = await pairTestPhone(db, base, address.port, device)
    const route = (kind: string, id: string) => `/v1/assets/asset_effects/effects/${kind}/${id}/thumbnail`
    const get = (pathname: string) => fetch(base + pathname, { headers: signedHeaders(keys.privateKey, device, 'GET', pathname) })
    assert.equal((await fetch(base + route('pose', pose))).status, 401)
    for (const [kind, id] of [['pose', pose], ['lighting', alias]]) {
      const response = await get(route(kind!, id!))
      assert.equal(response.status, 200)
      assert.equal(response.headers.get('content-type'), 'image/webp')
      assert.equal(response.headers.get('x-nikkisync-sha256'), digest)
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), image)
    }
    assert.equal((await get(route('lighting', light))).status, 404)
    assert.equal((await get(route('lighting', pose))).status, 404)
    assert.equal((await get('/v1/assets/asset_effects/clothing/' + pose + '/thumbnail')).status, 404)
  } finally {
    await server?.stop()
    db.close()
    await rm(directory, { recursive: true, force: true })
  }
})
