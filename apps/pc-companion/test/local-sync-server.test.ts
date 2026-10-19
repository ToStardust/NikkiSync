import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto'
import { mkdtemp, rm, writeFile,readFile } from 'node:fs/promises'
import net from 'node:net'
import tls from 'node:tls'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { AssetRepository, DatabaseManager } from '@nikkisync/database'
import { PairingService } from '../src/server/PairingService.js'
import { searchClothingLibrary } from '../src/server/ClothingSearchIndex.js'
import { LocalSyncServer } from '../src/server/LocalSyncServer.js'
import { searchSuitLibrary } from '../src/server/SuitSearchIndex.js'
import { LocalTlsIdentityService } from '../src/server/LocalTlsIdentityService.js'

function sha256(data: Buffer): string { return createHash('sha256').update(data).digest('hex') }

test('paired realtime handshake and hello work over the production TLS transport',async()=>{
  const db=new DatabaseManager(':memory:');db.initialize(await readFile(path.resolve('packages/database/migrations/0001_initial.sql'),'utf8'));
  const identity=new LocalTlsIdentityService(db).getOrCreate();
  const server=new LocalSyncServer(db,{host:'127.0.0.1',port:0,mdns:false,tls:{key:identity.keyPem,cert:identity.certPem}});
  let socket:tls.TLSSocket|undefined;
  try{
    const address=await server.start();
    const keys=generateKeyPairSync('ed25519',{publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
    const pairing=new PairingService(db),qr=pairing.createQrPayload({host:'127.0.0.1',port:address.port,tlsFingerprintSha256:identity.fingerprintSha256});
    pairing.pair({pairingToken:qr.pairingToken,device:{deviceId:'tls_phone',deviceName:'Test',platform:'android',publicKey:keys.publicKey,appVersion:'test'}},'PC');
    socket=tls.connect({host:'127.0.0.1',port:address.port,rejectUnauthorized:false});
    await new Promise<void>((resolve,reject)=>{socket!.once('secureConnect',resolve);socket!.once('error',reject)});
    let wire=Buffer.alloc(0);socket.on('data',chunk=>{wire=Buffer.concat([wire,chunk])});
    const hello=readWsText(socket,1500).catch(error=>{throw new Error(`${error.message}; subscribers=${server['sockets'].size}; bytes=${wire.length}; status=${wire.subarray(0,32).toString()}`)});
    socket.write(['GET /ws/v1 HTTP/1.1',`Host: 127.0.0.1:${address.port}`,'Upgrade: websocket','Connection: Upgrade',
      `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`,'Sec-WebSocket-Version: 13',
      ...Object.entries(signedHeaders(keys.privateKey,'tls_phone','GET','/ws/v1')).map(([k,v])=>`${k}: ${v}`),'',''].join('\r\n'));
    assert.equal((JSON.parse(await hello) as {event:string}).event,'server.hello');
  }finally{socket?.destroy();await server.stop();db.close()}
})

test('idle server does not query the change journal when no phone subscribes', async () => {
  const db = new DatabaseManager(':memory:'); db.initialize()
  const server = new LocalSyncServer(db, { host: '127.0.0.1', port: 0, mdns: false, journalPollMs: 5 })
  let queries = 0
  const reads = server['reads'], original = reads.listChangesAfter.bind(reads)
  reads.listChangesAfter = (...args) => { queries++; return original(...args) }
  try {
    await server.start()
    await new Promise(resolve => setTimeout(resolve, 60))
    assert.equal(queries, 0, 'without subscribers there is no journal broadcast work')
  } finally { await server.stop(); db.close() }
})

test('ordinary JPEG export is authenticated, source-verified, non-destructive and rejects malformed options or changed bytes',async()=>{
  const temp=await mkdtemp(path.join(os.tmpdir(),'nikki-exif-route-')),mediaPath=path.join(temp,'photo.jpg');
  const media=Buffer.from('ffd8ffe200084943435f5f5fffc0000b080040003001011100ffda0008010100003f000908ff0007ffd9','hex');await writeFile(mediaPath,media);
  const db=new DatabaseManager(':memory:');db.initialize();const assets=new AssetRepository(db);
  assets.reconcile({assetId:'exif_asset',assetType:'photo',assetState:'ready',discoveredAt:'2026-09-05T00:00:00.000Z',capturedAt:'2026-09-05T00:00:00.000Z',metadataSchemaVersion:1,
    metadata:{schemaVersion:1,identity:{uid:'PRIVATE'},capture:{},camera:{focalLength:35,apertureSection:1.2},raw:{secret:'PRIVATE'}},
    resources:[{resourceId:'exif_resource',assetId:'exif_asset',role:'source_primary',fileName:'photo.jpg',sourcePath:mediaPath,pathKey:mediaPath.toLowerCase(),mimeType:'image/jpeg',fileExt:'.jpg',sizeBytes:media.length,sha256:sha256(media),stableState:'stable',isDerived:false}]});
  const server=new LocalSyncServer(db,{host:'127.0.0.1',port:0,mdns:false}),address=await server.start(),base=`http://127.0.0.1:${address.port}`;
  const keys=generateKeyPairSync('ed25519',{publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
  const pair=new PairingService(db),qr=pair.createQrPayload({host:'127.0.0.1',port:address.port,tlsFingerprintSha256:'0'.repeat(64)});
  pair.pair({pairingToken:qr.pairingToken,device:{deviceId:'exif_phone',deviceName:'Test',platform:'android',publicKey:keys.publicKey,appVersion:'test'}},'PC');
  const route='/v1/assets/exif_asset/resources/exif_resource/export?exif=true&rotation=90';
  const get=(p:string)=>fetch(base+p,{headers:signedHeaders(keys.privateKey,'exif_phone','GET',p)});
  try{
    assert.equal((await fetch(base+route)).status,401);
    const result=await get(route);assert.equal(result.status,200);const output=Buffer.from(await result.arrayBuffer());
    assert.equal(result.headers.get('X-NikkiSync-SHA256'),sha256(output));assert.notEqual(sha256(output),sha256(media));assert.equal(result.headers.get('X-NikkiSync-Rotation'),'90');assert.equal(result.headers.get('X-NikkiSync-Exif'),'1');
    assert.ok(output.includes(Buffer.from('MomoCamera,Infinity Nikki')));assert.ok(output.includes(Buffer.from('Bloom Beneath Bright Skies')));assert.equal(output.includes(Buffer.from('PRIVATE')),false);assert.deepEqual(await readFile(mediaPath),media);
    const personalized=await get(route+'&cameraName='+encodeURIComponent('晚星的大喵相机'));
    assert.equal(personalized.status,200);assert.ok(!Buffer.from(await personalized.arrayBuffer()).includes(Buffer.from('晚星的大喵相机','utf8')));
    for(const suffix of ['&cameraName=','&cameraName=x&cameraName=y','&cameraName=x%00y','&cameraName='+encodeURIComponent('暖'.repeat(100))])assert.equal((await get(route+suffix)).status,400);
    assert.equal((await get(route.replace('exif=true','exif=false')+'&cameraName=x')).status,400);
    for(const p of [route.replace('90','91'),route+'&path=PRIVATE',route+'&exif=false'])assert.equal((await get(p)).status,400);
    await writeFile(mediaPath,Buffer.alloc(media.length));assert.equal((await get(route)).status,409);
  }finally{await server.stop();db.close();await rm(temp,{recursive:true,force:true});}
})

function signedHeaders(privateKey: string, deviceId: string, method: string, requestPath: string, body = Buffer.alloc(0)): Record<string, string> {
  const timestamp = String(Date.now())
  const nonce = randomBytes(16).toString('base64url')
  const canonical = [method, requestPath, timestamp, nonce, sha256(body)].join('\n')
  return {
    'X-NikkiSync-Device-Id': deviceId,
    'X-NikkiSync-Timestamp': timestamp,
    'X-NikkiSync-Nonce': nonce,
    'X-NikkiSync-Signature': sign(null, Buffer.from(canonical), privateKey).toString('base64url')
  }
}

async function readWsText(socket: net.Socket, timeoutMs = 3000): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('websocket frame timeout')), timeoutMs)
    const onData = (chunk: Buffer) => {
      const marker = chunk.indexOf(Buffer.from('\r\n\r\n'))
      let frame = marker >= 0 ? chunk.subarray(marker + 4) : chunk
      if (!frame.length) return
      let offset = 2
      let length = frame[1]! & 0x7f
      if (length === 126) { length = frame.readUInt16BE(2); offset = 4 }
      if (length === 127) { clearTimeout(timeout); socket.off('data', onData); reject(new Error('large frame unsupported in test')); return }
      if (frame.length < offset + length) return
      clearTimeout(timeout); socket.off('data', onData)
      resolve(frame.subarray(offset, offset + length).toString('utf8'))
    }
    socket.on('data', onData)
  })
}

test('LocalSyncServer pairs, authenticates, pages, streams ranges, reports changes and emits websocket events', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'nikkisync-server-'))
  const mediaPath = path.join(temp, 'photo.jpeg')
  const media = Buffer.from('0123456789abcdef')
  await writeFile(mediaPath, media)
  const db = new DatabaseManager(':memory:')
  db.initialize()
  const assets = new AssetRepository(db)
  assets.reconcile({
    assetId: 'asset_test', assetType: 'photo', assetState: 'ready', uid: '10001', discoveredAt: '2026-09-02T00:00:00.000Z',
    metadataSchemaVersion: 1,
    metadata: {
      schemaVersion: 1,
      dressing: { clothes: [{ id: 'cloth_swan_dress', name: '天鹅之梦', category: 'dresses', suitId: 'suit_swan', suitName: '天鹅童话' }] },
      raw: { nativeParamToken: 'token-visible', nativeParamPayload: 'pc-only-secret-payload', nativeParamNuan5Md5: '0123456789abcdef0123456789abcdef' }
    },
    resources: [{
      resourceId: 'resource_test', assetId: 'asset_test', role: 'source_high_quality', fileName: 'photo.jpeg',
      sourcePath: mediaPath, pathKey: mediaPath.replaceAll('\\', '/').toLowerCase(), mimeType: 'image/jpeg', fileExt: '.jpeg',
      sizeBytes: media.length, sha256: sha256(media), width: 16, height: 9, stableState: 'stable', isDerived: false
    }]
  })

  const server = new LocalSyncServer(db, { host: '127.0.0.1', port: 0, mdns: false, journalPollMs: 20 })
  const address = await server.start()
  const base = `http://127.0.0.1:${address.port}`
  try {
    const info = await fetch(`${base}/v1/server`)
    assert.equal(info.status, 200)
    const infoJson = await info.json() as { libraryRevision: number; capabilities: { profileStats?: boolean } }
    assert.equal(infoJson.libraryRevision, 1)
    assert.equal(infoJson.capabilities.profileStats, true)

    const deviceKeys = generateKeyPairSync('ed25519', {
      publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    })
    const pairing = new PairingService(db)
    const qr = pairing.createQrPayload({ host: '127.0.0.1', port: address.port, tlsFingerprintSha256: '0'.repeat(64) })
    const pairResponse = await fetch(`${base}/v1/pair`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        pairingToken: qr.pairingToken,
        device: { deviceId: 'phone_test', deviceName: 'Test Phone', platform: 'android', publicKey: deviceKeys.publicKey, appVersion: '0.0.1' }
      })
    })
    assert.equal(pairResponse.status, 200)
    assert.equal((await pairResponse.json() as { serverId: string }).serverId, server.serverId)

    const replay = await fetch(`${base}/v1/pair`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        pairingToken: qr.pairingToken,
        device: { deviceId: 'phone_test_2', deviceName: 'Other', platform: 'android', publicKey: deviceKeys.publicKey, appVersion: '0.0.1' }
      })
    })
    assert.equal(replay.status, 401)

    assert.equal((await fetch(`${base}/v1/assets`)).status, 401)
    const assetsPath = '/v1/assets?limit=10'
    const assetList = await fetch(`${base}${assetsPath}`, { headers: signedHeaders(deviceKeys.privateKey, 'phone_test', 'GET', assetsPath) })
    assert.equal(assetList.status, 200)
    const listJson = await assetList.json() as { items: Array<{ assetId: string; hasMotion: boolean; previewResourceId?: string }>; libraryRevision: number }
    assert.equal(listJson.items.length, 1); assert.equal(listJson.items[0]?.assetId, 'asset_test'); assert.equal(listJson.items[0]?.hasMotion, false)
    assert.equal(listJson.items[0]?.previewResourceId, 'resource_test')

    const suitSearchPath = '/v1/search/suits?q=' + encodeURIComponent('天鹅童话')
    const suitSearch = await fetch(`${base}${suitSearchPath}`, {
      headers: signedHeaders(deviceKeys.privateKey, 'phone_test', 'GET', suitSearchPath)
    })
    assert.equal(suitSearch.status, 200)
    const suitSearchJson = await suitSearch.json() as {
      items: Array<{ suitName: string; photoCount: number; observedPartCount: number; photos: Array<{ asset: { assetId: string }; matchedParts: Array<{ category?: string }> }> }>
    }
    assert.equal(suitSearchJson.items.length, 1)
    assert.equal(suitSearchJson.items[0]?.suitName, '天鹅童话')
    assert.equal(suitSearchJson.items[0]?.photoCount, 1)
    assert.equal(suitSearchJson.items[0]?.observedPartCount, 1)
    assert.equal(suitSearchJson.items[0]?.photos[0]?.asset.assetId, 'asset_test')
    assert.equal(suitSearchJson.items[0]?.photos[0]?.matchedParts[0]?.category, 'dresses')

    const clothingSearchPath = '/v1/search/clothing?q=' + encodeURIComponent('天鹅之梦')
    const clothingSearch = await fetch(`${base}${clothingSearchPath}`, {
      headers: signedHeaders(deviceKeys.privateKey, 'phone_test', 'GET', clothingSearchPath)
    })
    assert.equal(clothingSearch.status, 200)
    const clothingSearchJson = await clothingSearch.json() as {
      items: Array<{ clothingId: string; name?: string; category?: string; photoCount: number; photos: Array<{ asset: { assetId: string } }> }>
    }
    assert.equal(clothingSearchJson.items.length, 1)
    assert.equal(clothingSearchJson.items[0]?.clothingId, 'cloth_swan_dress')
    assert.equal(clothingSearchJson.items[0]?.name, '天鹅之梦')
    assert.equal(clothingSearchJson.items[0]?.category, 'dresses')
    assert.equal(clothingSearchJson.items[0]?.photoCount, 1)
    assert.equal(clothingSearchJson.items[0]?.photos[0]?.asset.assetId, 'asset_test')

    const profileStatsPath = '/v1/profile/stats'
    const profileStats = await fetch(`${base}${profileStatsPath}`, {
      headers: signedHeaders(deviceKeys.privateKey, 'phone_test', 'GET', profileStatsPath)
    })
    assert.equal(profileStats.status, 200)
    const profileStatsJson = await profileStats.json() as {
      libraryRevision: number
      topSuits: Array<{ suitName: string; photoCount: number }>
      topClothing: Array<{ clothingId: string; name?: string; category?: string; photoCount: number }>
    }
    assert.equal(profileStatsJson.libraryRevision, 1)
    assert.equal(profileStatsJson.topSuits[0]?.suitName, '天鹅童话')
    assert.equal(profileStatsJson.topSuits[0]?.photoCount, 1)
    assert.equal(profileStatsJson.topClothing[0]?.clothingId, 'cloth_swan_dress')
    assert.equal(profileStatsJson.topClothing[0]?.name, '天鹅之梦')
    assert.equal(profileStatsJson.topClothing[0]?.category, 'dresses')
    assert.equal(profileStatsJson.topClothing[0]?.photoCount, 1)

    const detailPath = '/v1/assets/asset_test'
    const detail = await fetch(`${base}${detailPath}`, { headers: signedHeaders(deviceKeys.privateKey, 'phone_test', 'GET', detailPath) })
    assert.equal(detail.status, 200)
    const detailJson = await detail.json() as { asset: { resources: unknown[]; metadata?: { raw?: Record<string, unknown> } } }
    assert.equal(detailJson.asset.resources.length, 1)
    assert.equal(detailJson.asset.metadata?.raw?.nativeParamToken, 'token-visible')
    assert.equal('nativeParamPayload' in (detailJson.asset.metadata?.raw ?? {}), false)
    assert.equal('nativeParamNuan5Md5' in (detailJson.asset.metadata?.raw ?? {}), false)

    const metadataPath = '/v1/assets/asset_test/metadata'
    const metadataBody = Buffer.from(JSON.stringify({
      camera: { exposure: 0.75, contrast: 0.2 },
      dressing: { clothes: [{ id: 'cloth_star_hair', name: '星夜长发', category: 'hair', suitId: 'suit_star', suitName: '星夜回响' }] }
    }))
    const metadataUpdate = await fetch(`${base}${metadataPath}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...signedHeaders(deviceKeys.privateKey, 'phone_test', 'PATCH', metadataPath, metadataBody) },
      body: metadataBody
    })
    assert.equal(metadataUpdate.status, 200)
    const metadataJson = await metadataUpdate.json() as { asset: { metadata?: { camera?: { exposure?: number; contrast?: number } } }; revision: number }
    assert.equal(metadataJson.asset.metadata?.camera?.exposure, 0.75)
    assert.equal(metadataJson.asset.metadata?.camera?.contrast, 0.2)
    assert.equal(metadataJson.revision, 2)

    const oldSuitAfterUpdate = await fetch(`${base}${suitSearchPath}`, {
      headers: signedHeaders(deviceKeys.privateKey, 'phone_test', 'GET', suitSearchPath)
    })
    assert.equal(oldSuitAfterUpdate.status, 200)
    assert.equal((await oldSuitAfterUpdate.json() as { items: unknown[] }).items.length, 0)

    const updatedSuitPath = '/v1/search/suits?q=' + encodeURIComponent('星夜回响')
    const updatedSuit = await fetch(`${base}${updatedSuitPath}`, {
      headers: signedHeaders(deviceKeys.privateKey, 'phone_test', 'GET', updatedSuitPath)
    })
    assert.equal(updatedSuit.status, 200)
    const updatedSuitJson = await updatedSuit.json() as { items: Array<{ suitName: string; photos: Array<{ asset: { assetId: string } }> }> }
    assert.equal(updatedSuitJson.items[0]?.suitName, '星夜回响')
    assert.equal(updatedSuitJson.items[0]?.photos[0]?.asset.assetId, 'asset_test')
    // Let the journal broadcaster advance past the metadata update before opening the WS
    // used below to assert the next asset-created event; otherwise this test races the poller.
    await new Promise((resolve) => setTimeout(resolve, 50))

    const resourcePath = '/v1/assets/asset_test/resources/resource_test'
    const ranged = await fetch(`${base}${resourcePath}`, {
      headers: { ...signedHeaders(deviceKeys.privateKey, 'phone_test', 'GET', resourcePath), Range: 'bytes=2-5' }
    })
    assert.equal(ranged.status, 206); assert.equal(await ranged.text(), '2345')
    assert.equal(ranged.headers.get('x-nikkisync-sha256'), sha256(media))

    const changesPath = '/v1/changes?after=0'
    const changes = await fetch(`${base}${changesPath}`, { headers: signedHeaders(deviceKeys.privateKey, 'phone_test', 'GET', changesPath) })
    assert.equal(changes.status, 200)
    assert.equal((await changes.json() as { changes: unknown[] }).changes.length, 2)

    const wsPath = '/ws/v1'
    const wsHeaders = signedHeaders(deviceKeys.privateKey, 'phone_test', 'GET', wsPath)
    const socket = net.createConnection({ host: '127.0.0.1', port: address.port })
    await new Promise<void>((resolve) => socket.once('connect', () => resolve()))
    socket.write([
      `GET ${wsPath} HTTP/1.1`, `Host: 127.0.0.1:${address.port}`, 'Upgrade: websocket', 'Connection: Upgrade',
      `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`, 'Sec-WebSocket-Version: 13',
      ...Object.entries(wsHeaders).map(([key, value]) => `${key}: ${value}`), '', ''
    ].join('\r\n'))
    const hello = JSON.parse(await readWsText(socket)) as { event: string; libraryRevision: number }
    assert.equal(hello.event, 'server.hello'); assert.equal(hello.libraryRevision, 2)

    const nextMediaPath = path.join(temp, 'photo2.jpeg')
    await writeFile(nextMediaPath, Buffer.from('next'))
    const nextEvent = readWsText(socket)
    assets.reconcile({
      assetId: 'asset_next', assetType: 'photo', assetState: 'ready', discoveredAt: '2026-09-02T00:01:00.000Z',
      resources: [{ resourceId: 'resource_next', assetId: 'asset_next', role: 'source_high_quality', fileName: 'photo2.jpeg', sourcePath: nextMediaPath,
        pathKey: nextMediaPath.replaceAll('\\', '/').toLowerCase(), mimeType: 'image/jpeg', fileExt: '.jpeg', sizeBytes: 4, sha256: sha256(Buffer.from('next')), stableState: 'stable', isDerived: false }]
    })
    assert.equal((JSON.parse(await nextEvent) as { event: string }).event, 'asset.created')
    socket.destroy()
  } finally {
    await server.stop(); db.close(); await rm(temp, { recursive: true, force: true })
  }
})

test('local TLS identity is generated once and persists with a stable fingerprint', () => {
  const db = new DatabaseManager(':memory:')
  db.initialize()
  try {
    const service = new LocalTlsIdentityService(db)
    const first = service.getOrCreate()
    const second = service.getOrCreate()
    assert.equal(first.fingerprintSha256.length, 64)
    assert.equal(first.fingerprintSha256, second.fingerprintSha256)
    assert.equal(first.keyPem, second.keyPem)
    assert.match(first.certPem, /BEGIN CERTIFICATE/)
  } finally { db.close() }
})


test('suit search ranks exact names before broader matches and keeps photo-count ordering within a relevance tier', () => {
  const summary = (assetId: string) => ({
    assetId,
    type: 'photo' as const,
    state: 'ready' as const,
    revision: 1,
    hasMotion: false,
    hasMetadata: true,
    gameVersionSource: 'unknown' as const
  })

  const assets = [
    {
      asset: summary('exact'),
      metadataJson: JSON.stringify({
        dressing: { clothes: [{ id: 'cloth_exact', category: 'dresses', suitId: '1', suitName: '天鹅童话' }] }
      })
    },
    {
      asset: summary('prefix-1'),
      metadataJson: JSON.stringify({
        dressing: { clothes: [{ id: 'cloth_prefix_1', category: 'hair', suitId: '2', suitName: '天鹅童话·晨曦' }] }
      })
    },
    {
      asset: summary('prefix-2'),
      metadataJson: JSON.stringify({
        dressing: { clothes: [{ id: 'cloth_prefix_2', category: 'shoes', suitId: '2', suitName: '天鹅童话·晨曦' }] }
      })
    },
    {
      asset: summary('contains-1'),
      metadataJson: JSON.stringify({
        dressing: { clothes: [{ id: 'cloth_contains_1', category: 'gloves', suitId: '3', suitName: '梦境·天鹅童话·回声' }] }
      })
    },
    {
      asset: summary('contains-2'),
      metadataJson: JSON.stringify({
        dressing: { clothes: [{ id: 'cloth_contains_2', category: 'earrings', suitId: '3', suitName: '梦境·天鹅童话·回声' }] }
      })
    },
    {
      asset: summary('contains-3'),
      metadataJson: JSON.stringify({
        dressing: { clothes: [{ id: 'cloth_contains_3', category: 'hairAccessories', suitId: '3', suitName: '梦境·天鹅童话·回声' }] }
      })
    }
  ]

  const result = searchSuitLibrary(assets, undefined, '天鹅童话')
  assert.deepEqual(result.items.map((item) => item.suitName), [
    '天鹅童话',
    '天鹅童话·晨曦',
    '梦境·天鹅童话·回声'
  ])
  assert.equal(result.items[0]?.photoCount, 1)
  assert.equal(result.items[1]?.photoCount, 2)
  assert.equal(result.items[2]?.photoCount, 3)
})


test('clothing search ranks exact names before prefix and contains matches', () => {
  const summary = (assetId: string) => ({
    assetId,
    type: 'photo' as const,
    state: 'ready' as const,
    revision: 1,
    hasMotion: false,
    hasMetadata: true,
    gameVersionSource: 'unknown' as const
  })

  const assets = [
    { asset: summary('exact'), metadataJson: JSON.stringify({ dressing: { clothes: [{ id: '1', name: '星夜长发', category: 'hair' }] } }) },
    { asset: summary('prefix'), metadataJson: JSON.stringify({ dressing: { clothes: [{ id: '2', name: '星夜长发·晨曦', category: 'hair' }] } }) },
    { asset: summary('contains'), metadataJson: JSON.stringify({ dressing: { clothes: [{ id: '3', name: '梦境·星夜长发·回声', category: 'hair' }] } }) }
  ]

  const result = searchClothingLibrary(assets, undefined, '星夜长发')
  assert.deepEqual(result.items.map((item) => item.name), [
    '星夜长发',
    '星夜长发·晨曦',
    '梦境·星夜长发·回声'
  ])
})

