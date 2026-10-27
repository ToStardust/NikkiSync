import assert from 'node:assert/strict'
import test from 'node:test'
import {AssetRepository,DatabaseManager,SyncReadRepository,ResourceRepository} from '@nikkisync/database'
import {AccountSyncSettings,isSpinningMomoDirectory} from '../src/server/AccountSyncSettings.js'
import {LocalSyncServer} from '../src/server/LocalSyncServer.js'
import {PairingService} from '../src/server/PairingService.js'
import {createDesktopControlServer} from '../src/desktop/DesktopControlServer.js'
import {createHash,generateKeyPairSync,randomBytes,sign} from 'node:crypto'
import type {AddressInfo} from 'node:net'
import {toPathKey} from '@nikkisync/core'
import path from 'node:path'

test('spinning-momo sources are a separate sharing choice, not an unknown UID or neighbouring folder',async()=>{
  const db=new DatabaseManager(':memory:');db.initialize();const assets=new AssetRepository(db),resources=new ResourceRepository(db)
  const root=path.resolve('out/test-only-custom-momo-output'),other=path.resolve('out/test-only-ordinary-captures')
  let roots=[{id:'dir_momo',path:root,mode:'images',source:'spinning_momo'},{id:'dir_other',path:other,mode:'images'}]
  const server=new LocalSyncServer(db,{host:'127.0.0.1',port:0,mdns:false,accountSourceDirectories:()=>roots} as import('../src/server/LocalSyncServer.js').LocalSyncServerConfig)
  try{
    for(const [id,uid,folder] of [['game','1001',other],['momo',undefined,root],['momo_uid','1001',root],['near',undefined,root+'-other']] as const){
      assets.create({assetId:id,assetType:'photo',...(uid?{uid}:{}),discoveredAt:'2026-10-27T00:00:00Z'})
      const file=path.join(folder,id+'.jpeg');resources.create({resourceId:'r_'+id,assetId:id,role:'source_high_quality',sourcePath:file,pathKey:toPathKey(file),fileName:id+'.jpeg',mimeType:'image/jpeg',fileExt:'.jpeg',sizeBytes:1,sha256:'a'.repeat(64)})
    }
    const state=server.accounts.state();const momo=state.accounts.find(row=>row.uid==='source:spinning_momo')
    assert.ok(momo,'explicitly added spinning-momo directories must have their own card');assert.equal(momo.count,2)
    const address=await server.start(),keys=generateKeyPairSync('ed25519',{publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}})
    const pairing=new PairingService(db),qr=pairing.createQrPayload({host:'127.0.0.1',port:address.port,tlsFingerprintSha256:'00'.repeat(32)})
    pairing.pair({pairingToken:qr.pairingToken,device:{deviceId:'momo_phone',deviceName:'Test',platform:'android',publicKey:keys.publicKey,appVersion:'test'}},'PC')
    const get=async(url:string)=>{const timestamp=String(Date.now()),nonce=randomBytes(16).toString('base64url');return fetch(`http://127.0.0.1:${address.port}`+url,{headers:{'X-NikkiSync-Device-Id':'momo_phone','X-NikkiSync-Timestamp':timestamp,'X-NikkiSync-Nonce':nonce,'X-NikkiSync-Signature':sign(null,Buffer.from(['GET',url,timestamp,nonce,createHash('sha256').update('').digest('hex')].join('\n')),keys.privateKey).toString('base64url')}})}
    const ids=async()=>((await(await get('/v1/assets?limit=500')).json()) as {items:{assetId:string}[]}).items.map(row=>row.assetId).sort()
    server.accounts.setSelection(['1001']);assert.deepEqual(await ids(),['game'])
    server.accounts.setSelection(['']);assert.deepEqual(await ids(),['near'])
    server.accounts.setSelection(['source:spinning_momo']);assert.deepEqual(await ids(),['momo','momo_uid'])
    const stable=server.accounts.revision();server.accounts.state();new AccountSyncSettings(db,()=>roots as import('../src/scanner/types.js').ExtraScanRoot[]).state();assert.equal(server.accounts.revision(),stable,'unchanged sources must not invalidate every reconnect')
    assert.equal((await get('/v1/assets/near')).status,404);assert.equal((await get('/v1/assets/near/resources/r_near')).status,404)
    roots=[];assert.equal(server.accounts.state().accounts.some(row=>row.uid==='source:spinning_momo'),false)
    assert.ok(server.accounts.revision()>stable,'changing source scope forces the cached phone library to reconcile')
    assert.deepEqual(await ids(),[])
  }finally{await server.stop();db.close()}
})

test('only identified or explicitly marked spinning-momo directories get the source card',()=>{
  const root={id:'test',mode:'images' as const,path:path.resolve('out/SpinningMomo')}
  assert.equal(isSpinningMomoDirectory(root),true)
  assert.equal(isSpinningMomoDirectory({...root,path:path.resolve('out/ordinary')}),false)
  assert.equal(isSpinningMomoDirectory({...root,path:path.resolve('out/custom'),source:'spinning_momo'}),true)
  assert.equal(isSpinningMomoDirectory({...root,source:'other'}),false)
  assert.equal(isSpinningMomoDirectory({...root,mode:'native',source:'spinning_momo'}),false)
})

test('authenticated mobile and loopback desktop enforce saved scope and full resync',async()=>{
  const db=new DatabaseManager(':memory:');db.initialize();const assets=new AssetRepository(db)
  for(const [id,uid] of [['visible','1001'],['hidden','2002']])assets.create({assetId:id!,uid:uid!,assetType:'photo',discoveredAt:'2026-10-27T00:00:00Z'})
  const server=new LocalSyncServer(db,{host:'127.0.0.1',port:0,mdns:false})
  const desktop=createDesktopControlServer({accounts:server.accounts,getStatus:()=>({service:'ready',host:'127.0.0.1',port:28080,assets:2,pairedDevices:1,firstRun:false}),createPairingUri:()=>'',qrSvg:async()=>''})
  try{
    const address=await server.start();await new Promise<void>(resolve=>desktop.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${(desktop.address() as AddressInfo).port}`
    assert.equal((await fetch(base+'/api/sync-accounts')).status,403)
    const html=await(await fetch(base)).text(),token=/<meta name="nikkisync-desktop-token" content="([^"]+)"/.exec(html)?.[1];assert.ok(token)
    const save=await fetch(base+'/api/sync-accounts',{method:'POST',headers:{'x-nikkisync-desktop-token':token,'content-type':'application/json'},body:JSON.stringify({uids:['1001']})});assert.equal(save.status,200)
    const keys=generateKeyPairSync('ed25519',{publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}})
    const pairing=new PairingService(db),qr=pairing.createQrPayload({host:'127.0.0.1',port:address.port,tlsFingerprintSha256:'00'.repeat(32)})
    pairing.pair({pairingToken:qr.pairingToken,device:{deviceId:'account_phone',deviceName:'Test',platform:'android',publicKey:keys.publicKey,appVersion:'test'}},'PC')
    const get=async(path:string)=>{const timestamp=String(Date.now()),nonce=randomBytes(16).toString('base64url');return fetch(`http://127.0.0.1:${address.port}`+path,{headers:{'X-NikkiSync-Device-Id':'account_phone','X-NikkiSync-Timestamp':timestamp,'X-NikkiSync-Nonce':nonce,'X-NikkiSync-Signature':sign(null,Buffer.from(['GET',path,timestamp,nonce,createHash('sha256').update('').digest('hex')].join('\n')),keys.privateKey).toString('base64url')}})}
    const list=await(await get('/v1/assets?limit=500')).json() as {items:{assetId:string}[]};assert.deepEqual(list.items.map(item=>item.assetId),['visible'])
    assert.equal((await get('/v1/assets/hidden')).status,404)
    const changes=await(await get('/v1/changes?after=0')).json() as {fullResyncRequired:boolean};assert.equal(changes.fullResyncRequired,true)
    assert.ok(html.includes('同步账号设置'));assert.ok(html.includes('aria-expanded="false"'))
  }finally{await server.stop();await new Promise<void>(resolve=>desktop.close(()=>resolve()));db.close()}
})

test('account selection persists, scopes pagination/details/search/resources and can sync none or all',()=>{
  const db=new DatabaseManager(':memory:');db.initialize()
  try{
    const assets=new AssetRepository(db)
    for(const [id,uid] of [['a','1001'],['b','2002'],['c',undefined]] as const)
      assets.create({assetId:id,assetType:'photo',discoveredAt:'2026-10-27T00:00:00Z',...(uid?{uid}:{}),metadata:{identity:{uid},camera:{brightness:1}}})
    const settings=new AccountSyncSettings(db),reads=new SyncReadRepository(db,()=>settings.selection())
    assert.equal(reads.listAssets({limit:500}).length,3)
    assert.deepEqual(settings.state().accounts.map(a=>a.uid),['1001','2002',''])
    const before=reads.currentRevision();settings.setSelection(['1001'])
    assert.ok(reads.currentRevision()>before)
    assert.deepEqual(reads.listAssets({limit:500}).map(a=>a.asset_id),['a'])
    assert.equal(reads.getAsset('b')??undefined,undefined) // SQLite engines represent an absent row as null or undefined.
    assert.deepEqual(reads.listSuitSearchAssets().map(a=>a.asset_id),['a'])
    assert.deepEqual(new AccountSyncSettings(db).selection(),['1001'])
    const stable=reads.currentRevision();settings.setSelection(['1001']);assert.equal(reads.currentRevision(),stable)
    settings.setSelection([]);assert.equal(reads.listAssets({limit:500}).length,0)
    settings.setSelection(['']);assert.deepEqual(reads.listAssets({limit:500}).map(a=>a.asset_id),['c'])
    settings.setSelection(null);assert.equal(reads.listAssets({limit:500}).length,3)
    assert.throws(()=>settings.setSelection(['malformed uid']))
    assert.equal(assets.list().length,3,'selection never deletes source rows or photos')
  }finally{db.close()}
})
