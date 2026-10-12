import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import net from 'node:net';import {randomBytes} from 'node:crypto';import {runInNewContext} from 'node:vm';
import {createPreviewSource} from './source.mjs';import {createGalleryServer} from './server.mjs';import {clientApi} from '../wechat-crypto-spike/client-api.mjs';
const id='a'.repeat(32),root=new URL('../../apps/wechat-mini-program/miniprogram/',import.meta.url);
const image=Buffer.from([255,216,255,217]);
test('indexed source offers whole-library browse and safe distinct JPEG exports while originals remain unchanged',async()=>{
 const {fixtureJpeg,tagsOf}=await import('./jpeg-fixture.mjs');const dir=await mkdtemp(join(tmpdir(),'nikki-export-'));
 try{const path=join(dir,'photo.jpg'),bytes=fixtureJpeg();await writeFile(path,bytes);const hash=clientApi('gallery-channel').hashHex(Uint8Array.from(bytes),true);
  const source=await createPreviewSource([{sourcePath:path,sha256:hash,sizeBytes:bytes.length,mimeType:'image/jpeg',capturedAt:'2026-09-05T00:00:00.000Z',metadata:{camera:{focalLength:35,apertureSection:1.2},dressing:{clothes:[{name:'星光裙',id:'PRIVATE'}]},raw:{uid:'PRIVATE'}}}],[dir]);
  const found=source.browse(0,{text:'星光裙'});assert.equal(found.total,1);assert.equal(found.items[0].version,'2.9');assert.doesNotMatch(JSON.stringify(found),/PRIVATE|sourcePath|sha256/);
  const output=await source.export(found.items[0].id,{exif:true,rotation:90});assert.equal(tagsOf(Buffer.from(output.image))[0x112],6);assert.equal(output.exifApplied,true);
  const original=await source.original(found.items[0].id);assert.deepEqual(Buffer.from(original.image),bytes);assert.deepEqual(await readFile(path),bytes);
 }finally{await rm(dir,{recursive:true,force:true});}
});
function adapter(server){const e={};let socket;return {getRandomValues:o=>o.success({randomValues:Uint8Array.from(randomBytes(64)).buffer}),createTCPSocket:()=>({onConnect:f=>e.connect=f,onMessage:f=>e.message=f,onError:f=>e.error=f,onClose:f=>e.close=f,connect(){socket=net.connect(server.address().port,'127.0.0.1');socket.on('connect',()=>e.connect());socket.on('data',x=>e.message({message:Uint8Array.from(x).buffer}));socket.on('error',()=>e.error());socket.on('close',()=>e.close());},write:b=>socket.write(Buffer.from(b)),close:()=>socket?.destroy()})};}
test('authenticated browse/export commands keep existing framing, bounds and derivative SHA separate from original',async()=>{
 const config={type:'NikkiSyncLocalGalleryDownload',version:1,host:'192.168.1.2',port:32001,key:randomBytes(32).toString('hex'),sessionId:randomBytes(16).toString('hex'),expiresAt:new Date(Date.now()+600000).toISOString()};let options,query;
 const source={browse:(offset,q)=>{query=q;return {offset,total:1,items:[{id,date:'',version:'2.9',versionSource:'explicit',mime:'image/jpeg'}],next:null,versions:[{version:'2.9',count:1,inferred:false}],libraryTotal:1};},export:async(_id,o)=>{options=o;return {image:Uint8Array.from(image),mime:'image/jpeg',exifApplied:true,rotation:o.rotation};}};
 const {server,stop}=createGalleryServer(config,source);await new Promise(r=>server.listen(0,'127.0.0.1',r));let channel;
 try{channel=await new Promise((r,j)=>{const c=clientApi('gallery-channel').connectGallery(adapter(server),config,{ready:()=>r(c),failed:j});});
  const list=await new Promise(r=>channel.browse(0,{text:'星光裙'},r));assert.equal(list.status,'ok');assert.equal(query.text,'星光裙');assert.equal(list.versions[0].version,'2.9');
  const out=await new Promise(r=>channel.export(id,{exif:true,rotation:90},r));assert.equal(out.status,'ok');assert.equal(out.original,false);assert.equal(out.exported,true);assert.equal(out.rotation,90);assert.equal(options.exif,true);assert.deepEqual(Buffer.from(out.image),image);
  assert.throws(()=>channel.export(id,{exif:true,rotation:91},()=>{}));assert.throws(()=>channel.browse(0,{path:'PRIVATE'},()=>{}));
 }finally{channel?.close();await stop();}
});
async function fixture(){let page,save;runInNewContext(await readFile(new URL('pages/local-gallery/index.js',root),'utf8'),{Page:p=>page=p,Date,Uint8Array,wx:{getWindowInfo:()=>({windowHeight:800,windowWidth:400}),getStorageSync:()=>undefined,setStorageSync(){},getFileSystemManager:()=>({unlink(){}})},require:()=>({saveOriginalBatch:(_w,_c,ids,h,options)=>{save={ids:Array.from(ids),hooks:h,options};return {cancel(){}};}})});
 page.setData=(x,done)=>{Object.assign(page.data,x);done?.();};page.onLoad();page.onShow();page.setData({connected:true,downloadEnabled:true,exportEnabled:true,browseEnabled:true,total:2,libraryTotal:2,photos:[{id,path:'/cache/a',date:'2026-09-05',version:'2.9',mime:'image/jpeg',index:0}]});
 return {page,get save(){return save;}};}
test('rotation is per photo across pages, resets zoom without changing native scale control and freezes batch options',async()=>{
 const f=await fixture(),p=f.page;p.openPhoto({currentTarget:{dataset:{index:0}}});p.rotatePhoto();assert.equal(p.data.viewerRotation,90);assert.equal(p._nativeScale,1);assert.equal(p.data.photos[0].rotation,90);
 p.saveViewed();assert.equal(f.save.options.exif,true);assert.equal(f.save.options.rotations[id],90);p.rotatePhoto();assert.equal(p.data.viewerRotation,90,'rotation locked during save');
 f.save.hooks.complete({results:[{id,status:'saved'}]});p.restoreRotation();assert.equal(p.data.viewerRotation,0);
});
test('query applies to every paged request, preserves selected basket and stale responses cannot replace newer filter',async()=>{
 const {page:p}=await fixture();let received;p._selected.add(id);p._channel={browse:(offset,q,done)=>received={offset,q,done},preview:(_id,done)=>done({status:'failed'}),close(){}};
 p.setData({searchText:'星光裙',filterVersion:'2.9',filterFrom:'2026-09-01',filterTo:'2026-09-30'});p.applyFilters();assert.equal(received.q.text,'星光裙');assert.equal(received.q.version,'2.9');assert.equal(p._selected.size,1);
 received.done({status:'ok',total:0,items:[],next:null,versions:[],libraryTotal:2});assert.equal(p.data.busy,false);assert.match(p.data.message,/没有/);
 p.setData({searchText:'a'.repeat(81)});p.applyFilters();assert.equal(p.data.busy,false);assert.match(p.data.message,/80/);
});
test('saving derivative bytes requires explicit verified export marker and uses native album callback, not preview',async()=>{
 const m={exports:{}};runInNewContext(await readFile(new URL('lib/original-save.js',root),'utf8'),{module:m,Date,Uint8Array});let write,album,result,opts;
 const wx={env:{USER_DATA_PATH:'/cache'},authorize:o=>o.success(),getFileSystemManager:()=>({writeFile:o=>write=o,unlink(){}}),saveImageToPhotosAlbum:o=>album=o};
 const channel={export:(_id,o,done)=>{opts=o;done({status:'ok',original:false,exported:true,image:new Uint8Array([255,216,255,217]),mime:'image/jpeg',sha256:'a'.repeat(64),rotation:90,exifApplied:true});}};
 m.exports.saveOriginalBatch(wx,channel,[id],{complete:x=>result=x},{exif:true,rotations:{[id]:90}});assert.equal(opts.rotation,90);assert.match(write.filePath,/nikkisync-export-/);write.success();assert.equal(result,undefined);album.success();assert.equal(result.results[0].status,'saved');
});
test('Android ordinary save requests the same PC JPEG export, verifies derivative header/hash and does not rotate twice',async()=>{
 const saver=await readFile(new URL('../../apps/mobile/app/src/main/java/app/nikkisync/mobile/media/OriginalSaver.java',import.meta.url),'utf8');
 assert.match(saver,/client\.exportStill\(/);assert.match(saver,/X-NikkiSync-Rotation/);assert.match(saver,/X-NikkiSync-Exif/);assert.match(saver,/!exported.*normalizedRotation/);
 const main=await readFile(new URL('../../apps/mobile/app/src/main/java/app/nikkisync/mobile/MainActivity.java',import.meta.url),'utf8');assert.match(main,/保存时附带拍摄参数/);
});
test('PNG export rotates native pixels without lossy conversion and never claims JPEG EXIF',async()=>{
 const {rotatePng}=await import('./png-export.mjs');const png=Buffer.from(clientApi('synthetic-image').imageBytes());
 const {spawn}=await import('node:child_process'),{fileURLToPath}=await import('node:url');
 const native=(bytes,angle)=>new Promise((resolve,reject)=>{
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',fileURLToPath(new URL('./native-exif-probe.ps1',import.meta.url)),'-AdditionalRotation',String(angle)],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='';
  const timer=setTimeout(()=>{child.kill();reject(new Error('Native pixel check timeout'));},20000);
  child.on('error',reject);child.stdin.on('error',reject);child.stderr.on('data',()=>{});child.stdout.on('data',b=>out+=b.toString());child.on('close',code=>{clearTimeout(timer);if(code)return reject(new Error('Native pixel check failed'));try{resolve(JSON.parse(out));}catch(error){reject(error);}});child.stdin.end(bytes);
 });
 for(const rotation of [90,180,270]){const result=await rotatePng(png,rotation);assert.deepEqual(Array.from(result.subarray(0,8)),[137,80,78,71,13,10,26,10]);assert.equal(result.readUInt32BE(16),96);assert.equal(result.readUInt32BE(20),96);
  const expected=await native(png,rotation),actual=await native(result,0);assert.equal(actual.displayedPixelFingerprint,expected.displayedPixelFingerprint,'decoded RGBA pixels have the requested direction');result.fill(0);}
});

test('high bit-depth PNG is rejected before a native decoder can silently reduce its precision',async()=>{
 const {rotatePng}=await import('./png-export.mjs'),png=Buffer.from(clientApi('synthetic-image').imageBytes());png[24]=16;
 assert.throws(()=>{const pending=rotatePng(png,90);pending?.catch(()=>{});},/High bit-depth PNG/);
});
test('empty filtered page still exposes selection cancel and PNG never advertises attached EXIF',async()=>{
 const xml=await readFile(new URL('pages/local-gallery/index.wxml',root),'utf8');
 assert.match(xml,/wx:if="{{photos.length \|\| selectedCount \|\| selectionMode}}"/);assert.match(xml,/viewerMime === 'image\/jpeg'/);
});

test('authenticated export rejects wrong digest, angle, EXIF flag, extra identity fields and original masquerade',()=>{
 const g=clientApi('gallery-channel'),p=clientApi(),{createDownloadPeer}=clientApi('noise-vendor');
 for(const variant of ['digest','rotation','exif','uid','kind']){
  const config={type:'NikkiSyncLocalGalleryDownload',version:1,host:'192.168.1.2',port:32001,key:randomBytes(32).toString('hex'),sessionId:randomBytes(16).toString('hex'),expiresAt:new Date(Date.now()+600000).toISOString()},events={};
  const peer=createDownloadPeer(false,Buffer.from(config.key,'hex'),p.prologue(config),randomBytes(64));let handshaken=false,result;
  const send=value=>events.message({message:p.frame(peer.encrypt(value)).buffer});
  const decoder=g.createGalleryDecoder(bytes=>{
   if(!handshaken){peer.receiveHandshake(bytes);handshaken=true;events.message({message:p.frame(peer.sendHandshake()).buffer});return;}
   const request=g.decode(peer.decrypt(bytes)),header={kind:variant==='kind'?'original':'export',req:request.req,id:request.id,size:4,sha256:'0'.repeat(64),mime:'image/jpeg',rotation:variant==='rotation'?0:90,exifApplied:variant!=='exif'};
   if(variant==='uid')header.uid='PRIVATE';send(g.encode(header));
   if(variant==='digest'){send(Uint8Array.from(image));send(g.encode({kind:'end',req:request.req,id:request.id}));}
  },g.MAX_DOWNLOAD_TOTAL);
  const socket={onConnect:f=>events.connect=f,onMessage:f=>events.message=f,onError:f=>events.error=f,onClose:f=>events.close=f,connect:()=>events.connect(),write:data=>decoder.feed(new Uint8Array(data)),close(){}};
  const c=g.connectGallery({getRandomValues:o=>o.success({randomValues:Uint8Array.from(randomBytes(64)).buffer}),createTCPSocket:()=>socket},config,{});
  try{c.export(id,{exif:true,rotation:90},x=>result=x);assert.equal(result.status,'failed',variant);assert.equal(result.image,undefined);}finally{c.close();peer.close();decoder.close();}
 }
});

test('disabling EXIF with unchanged orientation keeps the byte-identical original save path',async()=>{
 const m={exports:{}};runInNewContext(await readFile(new URL('lib/original-save.js',root),'utf8'),{module:m,Date,Uint8Array});let written,album,result,originalRequests=0;
 const wx={env:{USER_DATA_PATH:'/cache'},authorize:o=>o.success(),getFileSystemManager:()=>({writeFile:o=>written=o,unlink(){}}),saveImageToPhotosAlbum:o=>album=o};
 const channel={original:(_id,done)=>{originalRequests++;done({status:'ok',original:true,image:Uint8Array.from(image),mime:'image/jpeg',sha256:'a'.repeat(64)});},export:()=>assert.fail('disabled EXIF must not request a derivative')};
 m.exports.saveOriginalBatch(wx,channel,[id],{complete:x=>result=x},{exif:false,rotations:{[id]:0}});assert.equal(originalRequests,1);assert.match(written.filePath,/nikkisync-original-/);assert.deepEqual(Array.from(new Uint8Array(written.data)),Array.from(image));written.success();album.success();assert.equal(result.results[0].status,'saved');
});
