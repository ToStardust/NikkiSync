import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rename,rm,realpath} from 'node:fs/promises'
import {randomUUID,generateKeyPairSync,createHash,sign} from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import {DatabaseManager} from '@nikkisync/database'
import {ScannerService} from '../src/scanner/ScannerService.js'
import {DeletionQueue,type DeleteIntent} from '../src/organizer/DeletionQueue.js'
import {createDesktopControlServer} from '../src/desktop/DesktopControlServer.js'
import {DesktopStatusService} from '../src/desktop/DesktopStatusService.js'
import {LocalSyncServer} from '../src/server/LocalSyncServer.js'
import {PairingService} from '../src/server/PairingService.js'

async function sync(queue:DeletionQueue,device:string,intents:DeleteIntent[]){await queue.sync(device,intents);await queue.idle();return queue.list(device)}
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>resolve=done);return {promise,resolve}}
async function twoPhotos(f:Awaited<ReturnType<typeof fixture>>){
 const file=path.join(f.hq,'second.jpeg');await writeFile(file,Buffer.from([255,216,255,218,0,2,4,5,6,255,217]));await f.scanner.fullScan()
 const asset=f.db.connection.prepare('SELECT a.asset_id,a.revision FROM assets a JOIN resources r ON a.asset_id=r.asset_id WHERE r.source_path=?').get(file)
 const first=f.db.connection.prepare('SELECT revision FROM assets WHERE asset_id=?').get(f.intent.assetId)
 return [{...f.intent,revision:Number(first.revision)},{id:randomUUID(),assetId:String(asset.asset_id),revision:Number(asset.revision)}]
}

async function fixture(){
 const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'momo-organizer-'))),game=path.join(root,'InfinityNikki'),hq=path.join(game,'X6Game/Saved/GamePlayPhotos/12345/NikkiPhotos_HighQuality'),screen=path.join(game,'X6Game/ScreenShot')
 await mkdir(hq,{recursive:true});await mkdir(screen,{recursive:true});await writeFile(path.join(game,'InfinityNikki.exe'),'')
 const jpeg=Buffer.from([255,216,255,218,0,2,1,2,3,255,217]),source=path.join(hq,'photo.jpeg'),copy=path.join(screen,'photo.jpeg')
 await writeFile(source,Buffer.concat([jpeg,Buffer.from('native parameters')]));await writeFile(copy,jpeg);await writeFile(path.join(screen,'other.jpeg'),'different image');await writeFile(path.join(hq,'photo.bin'),'unrecognized companion retained')
 const db=new DatabaseManager();db.initialize();const scanner=new ScannerService(db,{startingPaths:[game],runningExecutablePaths:[],watcher:false,stability:{pollIntervalMs:0,stableChecks:1,maxWaitMs:1000}});await scanner.start()
 const asset=db.connection.prepare("SELECT a.* FROM assets a JOIN resources r ON a.asset_id=r.asset_id WHERE r.source_path=?").get(source)
 let now=100000;const moved:string[]=[];const recycle=async(file:{path:string})=>{moved.push(file.path);await rename(file.path,file.path+'.recycled')}
 const queue=new DeletionQueue(db,()=>scanner.getScanRoots(),()=>scanner.fullScan(),recycle,()=>now)
 const intent={id:randomUUID(),assetId:String(asset.asset_id),revision:Number(asset.revision)}
 return {root,source,copy,hq,screen,db,scanner,queue,intent,moved,advance:()=>now+=90000,close:async()=>{await queue.stop();await scanner.stop();db.close();await rm(root,{recursive:true,force:true})}}
}
test('deletion is intent-only until desktop approval AND fresh phone challenge; exports recycled, unknown companions kept',async()=>{
 const f=await fixture();try{
  const first=await sync(f.queue,'phone',[f.intent]);assert.equal(first[0]?.state,'pending');assert.equal(first[0]?.count,2);assert.equal(f.moved.length,0)
  await f.queue.decide(f.intent.id,true);assert.equal(f.moved.length,0)
  const ack=await sync(f.queue,'phone',[f.intent]);assert.equal(ack[0]?.state,'confirming');assert.equal(f.moved.length,0)
  const done=await sync(f.queue,'phone',[{...f.intent,approval:ack[0]!.approval!}]);assert.equal(done[0]?.state,'recycled');assert.equal(f.moved.length,2)
  await sync(f.queue,'phone',[f.intent]);assert.equal(f.moved.length,2)
  assert.equal(await readFile(path.join(f.hq,'photo.bin'),'utf8'),'unrecognized companion retained');assert.equal(await readFile(path.join(f.screen,'other.jpeg'),'utf8'),'different image')
  await rename(f.source+'.recycled',f.source);await rename(f.copy+'.recycled',f.copy);await f.scanner.fullScan();
  const restored=f.db.connection.prepare('SELECT asset_state,revision FROM assets WHERE asset_id=?').get(f.intent.assetId);assert.equal(restored.asset_state,'ready');assert.ok(Number(restored.revision)>f.intent.revision)
 }finally{await f.close()}
})
test('offline cancellation wins over an acknowledged desktop approval and replay cannot reopen it',async()=>{
 const f=await fixture();try{await sync(f.queue,'phone',[f.intent]);await f.queue.decide(f.intent.id,true);const ack=await sync(f.queue,'phone',[f.intent]);
  await sync(f.queue,'phone',[{...f.intent,cancel:true,approval:ack[0]!.approval!}]);await sync(f.queue,'phone',[f.intent]);assert.equal(f.queue.list()[0]?.state,'cancelled');assert.equal(f.moved.length,0)
  await assert.rejects(f.queue.decide(f.intent.id,true));await assert.rejects(sync(f.queue,'other',[f.intent]))
 }finally{await f.close()}
})

test('bulk approval uses an explicit online pending snapshot and preserves mobile cancellation and fresh challenges',async()=>{
 const f=await fixture();try{
  const second=path.join(f.hq,'second.jpeg');await writeFile(second,Buffer.from([255,216,255,218,0,2,4,5,6,255,217]));await f.scanner.fullScan()
  const asset=f.db.connection.prepare('SELECT a.asset_id,a.revision FROM assets a JOIN resources r ON a.asset_id=r.asset_id WHERE r.source_path=?').get(second)
  const current=f.db.connection.prepare('SELECT revision FROM assets WHERE asset_id=?').get(f.intent.assetId)
  const first={...f.intent,revision:Number(current.revision)},next={id:randomUUID(),assetId:String(asset.asset_id),revision:Number(asset.revision)}
  const offline={...first,id:randomUUID()},cancelled={...first,id:randomUUID()},unselected={...first,id:randomUUID()}
  await sync(f.queue,'offline-phone',[offline]);f.advance();await sync(f.queue,'phone',[first,next,cancelled,unselected]);await sync(f.queue,'phone',[{...cancelled,cancel:true}])
  const result=await f.queue.approveMany([first.id,next.id,offline.id,cancelled.id,randomUUID()]);assert.equal(result.approved,2);assert.equal(result.skipped,3);assert.equal(f.moved.length,0)
  assert.equal(f.queue.list().find(item=>item.id===unselected.id)?.state,'pending')
  assert.equal(f.queue.list().find(item=>item.id===offline.id)?.state,'pending')
  const ack=await sync(f.queue,'phone',[first,next]);const challenges=ack.filter(item=>item.state==='confirming').map(item=>item.approval)
  const repeated=await f.queue.approveMany([first.id,next.id]);assert.equal(repeated.approved,0);assert.equal(repeated.skipped,2)
  assert.deepEqual(f.queue.list('phone').filter(item=>item.state==='confirming').map(item=>item.approval),challenges);assert.equal(f.moved.length,0)
  await sync(f.queue,'phone',[{...next,approval:'wrong-challenge'}]);assert.equal(f.moved.length,0)
  const firstAck=ack.find(item=>item.id===first.id)!,nextAck=ack.find(item=>item.id===next.id)!
  await sync(f.queue,'phone',[{...first,cancel:true,approval:firstAck.approval!},{...next,approval:nextAck.approval!}])
  assert.equal(f.queue.list().find(item=>item.id===first.id)?.state,'cancelled');assert.equal(f.queue.list().find(item=>item.id===next.id)?.state,'recycled')
  assert.deepEqual(f.moved,[second]);assert.ok(await readFile(f.source));assert.ok(await readFile(f.copy))
  assert.equal((await f.queue.approveMany([next.id])).approved,0)
 }finally{await f.close()}
})

test('invalid bulk requests cannot partially approve records',async()=>{
 const f=await fixture();try{
  await sync(f.queue,'phone',[f.intent])
  for(const ids of [[],[f.intent.id,f.intent.id],[f.intent.id,'invalid'],Array(501).fill(f.intent.id),null,[f.intent.id,1]]){
   await assert.rejects(f.queue.approveMany(ids as string[]),/invalid_ids/);assert.equal(f.queue.list()[0]?.state,'pending')
  }
  assert.equal(f.moved.length,0)
 }finally{await f.close()}
})

test('one desktop approval completes the whole batch while slow work and heartbeats never block each other',async()=>{
 const f=await fixture(),started=deferred(),hold=deferred();let now=100000,blocked=false;const moved:string[]=[]
 const queue=new DeletionQueue(f.db,()=>f.scanner.getScanRoots(),()=>f.scanner.fullScan(),async file=>{if(!blocked){blocked=true;started.resolve();await hold.promise}await rename(file.path,file.path+'.recycled');moved.push(file.path)},()=>now)
 try{
  const intents=await twoPhotos(f);const submitted=await queue.sync('phone',intents)
  assert.ok(submitted.every(row=>row.state==='preparing'));assert.equal(queue.activity().prepared,0);assert.equal(moved.length,0)
  await queue.idle();assert.equal((await queue.approveMany(intents.map(item=>item.id))).approved,2)
  const ack=await queue.sync('phone',intents),requests=intents.map(item=>({...item,approval:ack.find(row=>row.id===item.id)!.approval!}))
  assert.ok((await queue.sync('phone',requests)).every(row=>row.state==='queued'))
  await started.promise
  // Keep the first native operation paused longer than the old whole-batch expiry window.
  for(let i=0;i<4;i++){now+=30000;const status=await queue.sync('phone',requests);assert.ok(status.every(row=>row.online));assert.ok(status.every(row=>['executing','queued'].includes(row.state)))}
  hold.resolve();await queue.idle();assert.ok(queue.list().every(row=>row.state==='recycled'));assert.equal(moved.length,3)
  assert.equal(queue.activity().catalogPasses,2);assert.equal(queue.activity().catalogImages,2)
 }finally{hold.resolve();await queue.stop();await f.close()}
})

test('mobile cancellation of queued work stays responsive during a slow native recycle',async()=>{
 const f=await fixture(),started=deferred(),hold=deferred();let blocked=false;const moved:string[]=[]
 const queue=new DeletionQueue(f.db,()=>f.scanner.getScanRoots(),()=>f.scanner.fullScan(),async file=>{if(!blocked){blocked=true;started.resolve();await hold.promise}await rename(file.path,file.path+'.recycled');moved.push(file.path)},()=>100000)
 try{
  const intents=await twoPhotos(f);await sync(queue,'phone',intents);await queue.approveMany(intents.map(item=>item.id));const ack=await queue.sync('phone',intents)
  await queue.sync('phone',intents.map(item=>({...item,approval:ack.find(row=>row.id===item.id)!.approval!})));await started.promise
  const cancelled=await queue.sync('phone',[{...intents[1]!,cancel:true}]);assert.equal(cancelled.find(row=>row.id===intents[1]!.id)?.state,'cancelled')
  assert.equal(moved.length,0);hold.resolve();await queue.idle();assert.equal(moved.length,2);assert.ok(await readFile(path.join(f.hq,'second.jpeg')))
 }finally{hold.resolve();await queue.stop();await f.close()}
})

test('a genuinely disconnected phone pauses unstarted work rather than silently extending its authorization',async()=>{
 const f=await fixture(),started=deferred(),hold=deferred();let blocked=false,now=100000;const moved:string[]=[]
 const queue=new DeletionQueue(f.db,()=>f.scanner.getScanRoots(),()=>f.scanner.fullScan(),async file=>{if(!blocked){blocked=true;started.resolve();await hold.promise}await rename(file.path,file.path+'.recycled');moved.push(file.path)},()=>now)
 try{
  const intents=await twoPhotos(f);await sync(queue,'phone',intents);await queue.approveMany(intents.map(item=>item.id));const ack=await queue.sync('phone',intents)
  await queue.sync('phone',intents.map(item=>({...item,approval:ack.find(row=>row.id===item.id)!.approval!})));await started.promise
  now+=90000;hold.resolve();await queue.idle();assert.equal(moved.length,2);assert.equal(queue.list().find(row=>row.id===intents[1]!.id)?.state,'pending');assert.ok(await readFile(path.join(f.hq,'second.jpeg')))
 }finally{hold.resolve();await queue.stop();await f.close()}
})

test('cancelled preparation and process restart never authorize deletion or strand an unfinished plan',async()=>{
 const f=await fixture();let queue=f.queue
 try{
  await queue.sync('phone',[f.intent]);await assert.rejects(queue.decide(f.intent.id,true),/not_pending/)
  await queue.stop();queue=new DeletionQueue(f.db,()=>f.scanner.getScanRoots(),async()=>{},async()=>{throw Error('must not recycle')},()=>100000)
  assert.equal(queue.list()[0]?.state,'preparing');await sync(queue,'phone',[f.intent]);assert.equal(queue.list()[0]?.state,'pending')
  const other={...f.intent,id:randomUUID()};await queue.sync('phone',[other]);await queue.sync('phone',[{...other,cancel:true}]);await queue.idle();assert.equal(queue.list().find(row=>row.id===other.id)?.state,'cancelled');assert.equal(f.moved.length,0)
 }finally{await queue.stop();await f.close()}
})

test('batch file events coalesce after recycling and a full pass covers prior queued watcher events',async()=>{
 const f=await fixture();const rescan=f.scanner.rescanPath.bind(f.scanner);let rescans=0
 f.scanner.rescanPath=async file=>{rescans++;return rescan(file)}
 const notify=(f.scanner as unknown as {watcherChanged(file:string):void}).watcherChanged.bind(f.scanner)
 try{
  await f.scanner.withDeferredWatchEvents(async()=>{
   await rename(f.source,f.source+'.recycled');for(let i=0;i<28;i++)notify(f.source)
   assert.equal(rescans,0);assert.notEqual(f.db.connection.prepare('SELECT asset_state FROM assets WHERE asset_id=?').get(f.intent.assetId).asset_state,'deleted')
  });assert.equal(rescans,1)
  await assert.rejects(f.scanner.withDeferredWatchEvents(async()=>{notify(f.copy);throw Error('generated failure')}),/generated failure/);assert.equal(rescans,2)
  await f.scanner.withDeferredWatchEvents(async()=>{notify(f.copy);await f.scanner.fullScan()});assert.equal(rescans,2)
  notify(f.copy);await f.scanner.stop();assert.equal(rescans,3)
 }finally{await f.close()}
})

test('approved photos sharing an exact export complete together without retrying the shared file',async()=>{
 const f=await fixture();try{
  const second=path.join(f.hq,'second.jpeg');await writeFile(second,Buffer.concat([await readFile(f.source),Buffer.from('different metadata')]));await f.scanner.fullScan()
  const row=f.db.connection.prepare('SELECT a.asset_id,a.revision FROM assets a JOIN resources r ON a.asset_id=r.asset_id WHERE r.source_path=?').get(second)
  const first=f.db.connection.prepare('SELECT revision FROM assets WHERE asset_id=?').get(f.intent.assetId)
  const intents=[{...f.intent,revision:Number(first.revision)},{id:randomUUID(),assetId:String(row.asset_id),revision:Number(row.revision)}]
  await sync(f.queue,'phone',intents);assert.ok(f.queue.list().every(item=>item.count===2));await f.queue.approveMany(intents.map(item=>item.id))
  const ack=await f.queue.sync('phone',intents);await sync(f.queue,'phone',intents.map(item=>({...item,approval:ack.find(row=>row.id===item.id)!.approval!})))
  assert.ok(f.queue.list().every(item=>item.state==='recycled'));assert.equal(f.moved.length,3);assert.equal(new Set(f.moved).size,3)
 }finally{await f.close()}
})

test('closing during filesystem preparation preserves a restartable intention instead of reporting changed media',async()=>{
 const f=await fixture();let stopping:Promise<void>|undefined,queue:DeletionQueue
 queue=new DeletionQueue(f.db,()=>{stopping??=queue.stop();return f.scanner.getScanRoots()},async()=>{},async()=>{throw Error('must not recycle')},()=>100000)
 try{
  await queue.sync('phone',[f.intent]);await queue.idle();await stopping;assert.equal(queue.list()[0]?.state,'preparing');assert.equal(f.moved.length,0)
 }finally{await queue.stop();await f.close()}
})
test('changed file, unavailable roots, stale phone, and desktop rejection never recycle',async()=>{
 const f=await fixture();try{await sync(f.queue,'phone',[f.intent]);f.advance();await assert.rejects(f.queue.decide(f.intent.id,true),/phone_offline/)
  await sync(f.queue,'phone',[f.intent]);await f.queue.decide(f.intent.id,true);const ack=await sync(f.queue,'phone',[f.intent]);await writeFile(f.source,'replacement')
  await sync(f.queue,'phone',[{...f.intent,approval:ack[0]!.approval!}]);assert.equal(f.queue.list()[0]?.state,'changed');assert.equal(f.moved.length,0)
  await f.scanner.fullScan();const asset=f.db.connection.prepare('SELECT revision FROM assets WHERE asset_id=?').get(f.intent.assetId)
  const another={...f.intent,id:randomUUID(),revision:Number(asset.revision)};await sync(f.queue,'phone',[another]);await f.queue.decide(another.id,false);assert.equal(f.queue.list().find(x=>x.id===another.id)?.state,'rejected');assert.equal(f.moved.length,0)
 }finally{await f.close()}
})
test('recycle failures are explicit and never retried, restarted approval needs another desktop confirmation',async()=>{
 const f=await fixture();try{
  const queue=new DeletionQueue(f.db,()=>f.scanner.getScanRoots(),async()=>{},async()=>{throw Error('unsupported')})
  await sync(queue,'phone',[f.intent]);await queue.decide(f.intent.id,true)
  const restarted=new DeletionQueue(f.db,()=>f.scanner.getScanRoots(),async()=>{},async()=>{throw Error('unsupported')});assert.equal(restarted.list()[0]?.state,'pending')
  await sync(restarted,'phone',[f.intent]);await restarted.decide(f.intent.id,true);const ack=await sync(restarted,'phone',[f.intent]);await sync(restarted,'phone',[{...f.intent,approval:ack[0]!.approval!}]);assert.equal(restarted.list()[0]?.state,'failed');assert.ok(await readFile(f.source));assert.equal(f.moved.length,0)
 }finally{await f.close()}
})
test('phone authentication and loopback CSRF boundaries separate submission from approval',async()=>{
 const f=await fixture();const mobile=new LocalSyncServer(f.db,{host:'127.0.0.1',port:0,mdns:false,deletions:f.queue})
 const desktop=createDesktopControlServer({deletions:f.queue,getStatus:()=>new DesktopStatusService(f.db).getStatus({host:'127.0.0.1',port:28080}),createPairingUri:()=>'',qrSvg:async()=>''})
 try{
  const address=await mobile.start();await new Promise<void>(resolve=>desktop.listen(0,'127.0.0.1',resolve));const da=desktop.address();assert.ok(da&&typeof da!=='string')
  const base=`http://127.0.0.1:${address.port}`,local=`http://127.0.0.1:${da.port}`
  assert.equal((await fetch(base+'/v1/organizer/sync',{method:'POST',body:'{}'})).status,401)
  assert.equal((await fetch(local+'/api/organizer')).status,403)
  const pair=new PairingService(f.db),keys=generateKeyPairSync('ed25519'),qr=pair.createQrPayload({host:'127.0.0.1',port:address.port,tlsFingerprintSha256:'00'.repeat(32)})
  pair.pair({pairingToken:qr.pairingToken,device:{deviceId:'phone',deviceName:'test',platform:'android',appVersion:'test',publicKey:keys.publicKey.export({format:'pem',type:'spki'}).toString()}},'PC')
  const body=JSON.stringify({items:[f.intent]}),stamp=String(Date.now()),nonce=randomUUID(),route='/v1/organizer/sync'
  const signature=sign(null,Buffer.from(['POST',route,stamp,nonce,createHash('sha256').update(body).digest('hex')].join('\n')),keys.privateKey).toString('base64url')
  const response=await fetch(base+route,{method:'POST',body,headers:{'x-nikkisync-device-id':'phone','x-nikkisync-timestamp':stamp,'x-nikkisync-nonce':nonce,'x-nikkisync-signature':signature}});assert.equal(response.status,200);assert.equal(f.moved.length,0)
  await f.queue.idle()
  assert.equal((await fetch(base+'/api/organizer/decide',{method:'POST',body:JSON.stringify({id:f.intent.id,approve:true})})).status,401)
  assert.equal((await fetch(base+'/api/organizer/approve-many',{method:'POST',body:JSON.stringify({ids:[f.intent.id]})})).status,401)
  const html=await (await fetch(local)).text(),token=html.match(/name="nikkisync-desktop-token" content="([^"]+)"/)?.[1];assert.ok(token)
  const headers={'content-type':'application/json','x-nikkisync-desktop-token':token!},bulk=JSON.stringify({ids:[f.intent.id]})
  assert.equal((await fetch(local+'/api/organizer/approve-many',{method:'POST',body:bulk})).status,403)
  assert.equal((await fetch(local+'/api/organizer/approve-many',{method:'POST',body:bulk,headers:{...headers,origin:'https://other.example'}})).status,403)
  assert.equal((await fetch(local+'/api/organizer/approve-many',{method:'POST',body:bulk,headers:{...headers,'sec-fetch-site':'cross-site'}})).status,403)
  const foreignHost=await new Promise<number|undefined>((resolve,reject)=>{const request=http.request(local+'/api/organizer/approve-many',{method:'POST',headers:{...headers,host:'other.example'}},response=>{response.resume();response.on('end',()=>resolve(response.statusCode))});request.on('error',reject);request.end(bulk)})
  assert.equal(foreignHost,403)
  assert.equal((await fetch(local+'/api/organizer/approve-many',{method:'POST',body:' '.repeat(40961),headers})).status,413)
  assert.equal((await fetch(local+'/api/organizer/approve-many',{method:'POST',body:'{"ids":[]}',headers})).status,409)
  const approved=await fetch(local+'/api/organizer/approve-many',{method:'POST',body:bulk,headers});assert.equal(approved.status,200)
  assert.equal((await approved.json() as {approved:number}).approved,1);assert.equal(f.queue.list()[0]?.state,'confirming');assert.equal(f.moved.length,0)
 }finally{await mobile.stop();await new Promise<void>(resolve=>desktop.close(()=>resolve()));await f.close()}
})
