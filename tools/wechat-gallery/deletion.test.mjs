import test from 'node:test';import assert from 'node:assert/strict';import net from 'node:net';import {randomBytes} from 'node:crypto';
import {createGalleryServer} from './server.mjs';import {clientApi} from '../wechat-crypto-spike/client-api.mjs';
import {runInNewContext} from 'node:vm';
const g=clientApi('gallery-channel');
function adapter(server){let socket;const e={};return {getRandomValues:o=>o.success({randomValues:Uint8Array.from(randomBytes(64)).buffer}),createTCPSocket:()=>({onConnect:f=>e.connect=f,onMessage:f=>e.message=f,onError:f=>e.error=f,onClose:f=>e.close=f,connect(){socket=net.connect(server.address().port,'127.0.0.1');socket.on('connect',()=>e.connect());socket.on('data',x=>e.message({message:Uint8Array.from(x).buffer}));socket.on('error',()=>e.error());socket.on('close',()=>e.close());},write:b=>socket.write(Buffer.from(b)),close:()=>socket?.destroy()})};}
test('deletion capability is optional, bounded and authenticated in the QR context',()=>{
 const value={type:'NikkiSyncLocalGalleryLive',version:1,resume:1,host:'192.168.1.2',port:32001,key:'ab'.repeat(32),sessionId:'bc'.repeat(16),expiresAt:new Date(Date.now()+600000).toISOString()};
 const parsed=g.parseGalleryQr(JSON.stringify({...value,deletion:1}));assert.equal(parsed.deletion,1);assert.notEqual(g.galleryPrologue(parsed),g.galleryPrologue(g.parseGalleryQr(JSON.stringify(value))));
 for(const deletion of [0,2,true,'1'])assert.throws(()=>g.parseGalleryQr(JSON.stringify({...value,deletion})));
});
test('encrypted deletion uses only the bound session and stop/disconnect revokes pending work',async()=>{
 let online=false,closed=0;const requests=[];
 const source={count:0,deletionConnected(){online=true},async deletionDisconnected(){online=false;closed++},async deletion(action,input){assert.equal(online,true);requests.push({action,input});return {items:[{id:'b'.repeat(32),photoId:'a'.repeat(32),state:'pending',message:'等待电脑确认',count:1,files:[{name:'generated.png',size:4}]}]}}};
 const config={type:'NikkiSyncLocalGalleryLive',version:1,resume:1,deletion:1,host:'192.168.1.2',port:32001,key:randomBytes(32).toString('hex'),sessionId:randomBytes(16).toString('hex'),expiresAt:new Date(Date.now()+600000).toISOString()};
 const service=createGalleryServer(config,source);await new Promise(r=>service.server.listen(0,'127.0.0.1',r));let c,cap;
 try{
  await new Promise((r,j)=>{c=g.connectGallery(adapter(service.server),config,{ready:v=>{cap=v;r()},failed:j})});assert.equal(cap.deletion,true);
  const result=await new Promise(r=>c.deletion('request',{ids:['a'.repeat(32)]},r));assert.equal(result.status,'ok');assert.equal(result.value.items[0].state,'pending');assert.equal(requests.length,1);
  c.close();await service.stop();assert.equal(online,false);assert.ok(closed>=1);
 }finally{c?.close();await service.stop()}
});
test('indexed photo -> Noise request -> authenticated desktop confirmation -> queue result is a complete local chain',async()=>{
 const {mkdtemp,writeFile,rename,readFile,rm}=await import('node:fs/promises'),{tmpdir}=await import('node:os'),{join}=await import('node:path'),{createHash}=await import('node:crypto');
 const {DatabaseManager,AssetRepository}=await import('../../packages/database/dist/src/index.js');
 const {DeletionQueue}=await import('../../apps/pc-companion/dist/src/organizer/DeletionQueue.js');
 const {withWeChatDeletion}=await import('../../apps/pc-companion/dist/src/wechat/WeChatDeletion.js');
 const {createIndexedPreviewSource}=await import('./source.mjs');
 const {createDesktopControlServer}=await import('../../apps/pc-companion/dist/src/desktop/DesktopControlServer.js');
 const {DesktopStatusService}=await import('../../apps/pc-companion/dist/src/desktop/DesktopStatusService.js');
 const root=await mkdtemp(join(tmpdir(),'momo-wechat-chain-')),db=new DatabaseManager();db.initialize();
 const bytes=Buffer.from([137,80,78,71,13,10,26,10,1]),file=join(root,'generated.png');await writeFile(file,bytes);
 new AssetRepository(db).reconcile({assetId:'asset_generated',assetType:'photo',assetState:'ready',discoveredAt:'2026-11-02T00:00:00Z',resources:[{assetId:'asset_generated',resourceId:'resource_generated',role:'source_primary',sourcePath:file,pathKey:file.toLowerCase(),fileName:'generated.png',mimeType:'image/png',fileExt:'.png',sizeBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),stableState:'stable',isDerived:false}]});
 // Only this generated fixture is renamed to simulate the native recycle boundary.
 const queue=new DeletionQueue(db,()=>[root],async()=>{},async plan=>{assert.equal(plan.path,file);await rename(file,file+'.recycled')});
 const source=withWeChatDeletion(await createIndexedPreviewSource(db,[root]),queue);
 const config={type:'NikkiSyncLocalGalleryLive',version:1,resume:1,deletion:1,host:'192.168.1.2',port:32001,key:randomBytes(32).toString('hex'),sessionId:randomBytes(16).toString('hex'),expiresAt:new Date(Date.now()+600000).toISOString()};
 const service=createGalleryServer(config,source),desktop=createDesktopControlServer({deletions:queue,getStatus:()=>new DesktopStatusService(db).getStatus({host:'127.0.0.1',port:28080}),createPairingUri:()=>'',qrSvg:async()=>''});let c;
 try{
  await new Promise(r=>service.server.listen(0,'127.0.0.1',r));await new Promise(r=>desktop.listen(0,'127.0.0.1',r));
  await new Promise((r,j)=>{c=g.connectGallery(adapter(service.server),config,{ready:r,failed:j})});const call=(action,input)=>new Promise(r=>c.deletion(action,input,r));
  const listed=await new Promise(r=>c.list(0,r)),id=listed.items[0].id;assert.equal(source.deletionTarget(id).assetId,'asset_generated');assert.doesNotMatch(JSON.stringify(listed),/asset_generated|sourcePath|deletionTarget/);
  const module={exports:{}},timers=new Set();let modal,modalCount=0;
  runInNewContext(await readFile(new URL('../../apps/wechat-mini-program/miniprogram/lib/deletion-page.js',import.meta.url),'utf8'),{module,Set,wx:{showModal:value=>{modal=value;modalCount++;}},setTimeout:(fn,ms)=>{const timer={fn,ms};timers.add(timer);return timer;},clearTimeout:timer=>timers.delete(timer)});
  const page={...module.exports.deletionPage,data:{...module.exports.deletionData,connected:true,deletionEnabled:true,selectedId:id},_alive:true,_active:true,_channel:c,setData(value){Object.assign(this.data,value)}};
  const until=async predicate=>{for(let n=0;n<100&&!predicate();n++)await new Promise(r=>setTimeout(r,10));assert.ok(predicate(),'client state progressed');};
  page.requestViewedDeletion();assert.equal(modalCount,1);modal.success({confirm:true});await until(()=>page.data.deletionItems.length===1);await queue.idle();assert.deepEqual(await readFile(file),bytes);
  const url='http://127.0.0.1:'+desktop.address().port,html=await(await fetch(url)).text(),token=html.match(/name="nikkisync-desktop-token" content="([^"]+)"/)[1];
  const body=JSON.stringify({id:page.data.deletionItems[0].id,approve:true});assert.equal((await fetch(url+'/api/organizer/decide',{method:'POST',body})).status,403);
  assert.equal((await fetch(url+'/api/organizer/decide',{method:'POST',body,headers:{'content-type':'application/json','x-nikkisync-desktop-token':token}})).status,200);
  assert.deepEqual(await readFile(file),bytes);
  const runTimer=()=>{const timer=timers.values().next().value;assert.ok(timer);timers.delete(timer);timer.fn();};
  runTimer();await until(()=>page.data.deletionItems[0].state==='confirming');assert.equal(timers.values().next().value.ms,0);
  runTimer();await until(()=>!page.data.busy);await queue.idle();assert.equal(modalCount,1,'no third phone confirmation');page.stopDeletionPolling();
  assert.equal((await call('sync',{cancel:[],approvals:[]})).value.items[0].state,'recycled');assert.deepEqual(await readFile(file+'.recycled'),bytes);assert.equal((await new Promise(r=>c.original(id,r))).status,'failed');
 }finally{c?.close();await service.stop();await new Promise(r=>desktop.close(r));await queue.stop();db.close();await rm(root,{recursive:true,force:true})}
});
