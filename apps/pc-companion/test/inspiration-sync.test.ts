import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash,generateKeyPairSync,randomBytes,sign } from 'node:crypto'
import { DatabaseManager } from '@nikkisync/database'
import { InspirationRepository } from '../src/inspiration/InspirationRepository.js'
import { LocalSyncServer } from '../src/server/LocalSyncServer.js'
import { PairingService } from '../src/server/PairingService.js'
import { createDesktopControlServer } from '../src/desktop/DesktopControlServer.js'
import { renderDesktopPage } from '../src/desktop/DesktopPage.js'
import type { AddressInfo } from 'node:net'
import {readFileSync} from 'node:fs'
import path from 'node:path'

const id='11111111-1111-4111-8111-111111111111'
const imageId='22222222-2222-4222-8222-222222222222'
const bytes=Buffer.from([137,80,78,71,13,10,26,10,1,2,3])
const hash=createHash('sha256').update(bytes).digest('hex')
const database=()=>{const db=new DatabaseManager(':memory:');db.initialize(readFileSync(path.resolve('packages/database/migrations/0001_initial.sql'),'utf8'));return db}
const entry=()=>({id,title:'',notes:'旧备注',tags:['原标签'],categories:['日常'],status:'self',createdAt:1,deletedAt:0,
  code:{id:'33333333-3333-4333-8333-333333333333',rawCode:'1wPXwKyiXS4#',type:'dye',sourceText:'原文',sourceUrl:null,parsedState:'pending',snapshotJson:null,resolverVersion:null,dictionaryVersion:null,resolvedAt:0},
  images:[{id:imageId,sha256:hash,mimeType:'image/png',bytes:bytes.length,addedAt:2}]})

test('desktop has a visible inspiration section with code and reference image editing',()=>{
  const page=renderDesktopPage({service:'ready',host:'127.0.0.1',port:1,assets:0,pairedDevices:0,firstRun:true},{desktopToken:'token'})
  assert.match(page,/data-view="inspiration"/);assert.match(page,/data-page="inspiration"/)
  assert.match(page,/id="inspiration-code"/);assert.match(page,/id="inspiration-images"/)
  assert.match(page,/图片|参考图/);assert.match(page,/离线/)
})

test('reference bytes and user fields survive independently; stale revisions never overwrite newer edits',()=>{
  const db=database();const store=new InspirationRepository(db)
  try{
    assert.throws(()=>store.save(entry(),0),/missing_image/)
    assert.throws(()=>store.putImage('0'.repeat(64),'image/png',bytes),/image_hash/)
    store.putImage(hash,'image/png',bytes);const saved=store.save(entry(),0)
    assert.equal(saved.revision,1);assert.deepEqual(store.image(hash)?.bytes,bytes)
    const edit={...entry(),notes:'电脑端新备注'};const newer=store.save(edit,saved.revision)
    assert.equal(newer.revision,2);assert.throws(()=>store.save({...entry(),notes:'手机旧版本'},1),/conflict/)
    assert.equal(store.list('',10).items[0]?.entry.notes,'电脑端新备注')
    assert.equal(store.save(edit,2).revision,2,'idempotent retry does not manufacture a new version')
    const deleted=store.save({...edit,deletedAt:3},2);assert.equal(deleted.entry.deletedAt,3)
    assert.equal(store.list('',10).items[0]?.entry.deletedAt,3,'tombstone survives for offline devices')
  }finally{db.close()}
})

test('invalid input and missing or unsupported images are rejected without changing stored data',()=>{
  const db=database();const store=new InspirationRepository(db)
  try{
    assert.throws(()=>store.putImage(hash,'image/svg+xml',bytes))
    assert.throws(()=>store.save({...entry(),id:'../../outside'},0))
    assert.equal(store.list('',10).items.length,0)
  }finally{db.close()}
})

test('only paired signatures or token-protected desktop requests can access inspiration and image bytes',async()=>{
  const db=database()
  const server=new LocalSyncServer(db,{host:'127.0.0.1',port:0,mdns:false})
  const desktop=createDesktopControlServer({inspirations:server.inspirations,getStatus:()=>({service:'ready',host:'127.0.0.1',port:1,assets:0,pairedDevices:1,firstRun:false}),createPairingUri:()=>'',qrSvg:async()=>''})
  try{
    const address=await server.start();await new Promise<void>(r=>desktop.listen(0,'127.0.0.1',r))
    const info=await(await fetch(`http://127.0.0.1:${address.port}/v1/server`)).json() as {capabilities:{inspirationV1?:boolean}}
    assert.equal(info.capabilities.inspirationV1,true)
    const desktopBase=`http://127.0.0.1:${(desktop.address() as AddressInfo).port}`
    const page=await(await fetch(desktopBase)).text();const token=/name="nikkisync-desktop-token" content="([^"]+)"/.exec(page)?.[1];assert.ok(token)
    assert.equal((await fetch(desktopBase+'/api/inspiration')).status,403)
    const keys=generateKeyPairSync('ed25519',{publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}})
    const pairing=new PairingService(db),qr=pairing.createQrPayload({host:'127.0.0.1',port:address.port,tlsFingerprintSha256:'00'.repeat(32)})
    pairing.pair({pairingToken:qr.pairingToken,device:{deviceId:'inspiration_phone',deviceName:'test',platform:'android',publicKey:keys.publicKey,appVersion:'test'}},'PC')
    const send=async(method:string,path:string,body:Buffer=Buffer.alloc(0),type='application/json')=>{
      const timestamp=String(Date.now()),nonce=randomBytes(16).toString('base64url')
      const canonical=[method,path,timestamp,nonce,createHash('sha256').update(body).digest('hex')].join('\n')
      return fetch(`http://127.0.0.1:${address.port}`+path,{method,headers:{'content-type':type,'X-NikkiSync-Device-Id':'inspiration_phone','X-NikkiSync-Timestamp':timestamp,'X-NikkiSync-Nonce':nonce,'X-NikkiSync-Signature':sign(null,Buffer.from(canonical),keys.privateKey).toString('base64url')},...(body.length?{body:new Uint8Array(body)}:{})})
    }
    assert.equal((await fetch(`http://127.0.0.1:${address.port}/v1/inspiration`)).status,401)
    assert.equal((await send('PUT','/v1/inspiration/images/'+hash,bytes,'image/png')).status,200)
    const head=await send('HEAD','/v1/inspiration/images/'+hash);assert.equal(head.status,200);assert.equal(head.headers.get('content-length'),String(bytes.length))
    assert.equal((await send('POST','/v1/inspiration',Buffer.from(JSON.stringify({baseRevision:0,entry:entry()})))).status,200)
    assert.deepEqual(Buffer.from(await(await send('GET','/v1/inspiration/images/'+hash)).arrayBuffer()),bytes)
    const response=await fetch(desktopBase+'/api/inspiration',{headers:{'x-nikkisync-desktop-token':token}})
    assert.equal(response.status,200);assert.equal(((await response.json()) as {items:unknown[]}).items.length,1)
    assert.equal((await send('POST','/v1/inspiration',Buffer.from(JSON.stringify({baseRevision:0,entry:{...entry(),notes:'stale'}})))).status,409)
  }finally{await server.stop();await new Promise<void>(r=>desktop.close(()=>r()));db.close()}
})
