import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {runInNewContext} from 'node:vm';import {randomBytes,createHash} from 'node:crypto';import net from 'node:net';
import {clientApi} from '../wechat-crypto-spike/client-api.mjs';import {createGalleryServer} from './server.mjs';
const root=new URL('../../apps/wechat-mini-program/miniprogram/',import.meta.url),id='a'.repeat(32);
function adapter(server){const e={};let socket;return {getRandomValues:o=>o.success({randomValues:Uint8Array.from(randomBytes(64)).buffer}),createTCPSocket:()=>({onConnect:f=>e.connect=f,onMessage:f=>e.message=f,onError:f=>e.error=f,onClose:f=>e.close=f,connect(){socket=net.connect(server.address().port,'127.0.0.1');socket.on('connect',()=>e.connect());socket.on('data',x=>e.message({message:Uint8Array.from(x).buffer}));socket.on('error',()=>e.error());socket.on('close',()=>e.close());},write:b=>socket.write(Buffer.from(b)),close:()=>socket?.destroy()})};}

test('failed media work also schedules memory cleanup without reporting a transfer',async()=>{
 const config={type:'NikkiSyncLocalGalleryLive',version:1,host:'192.168.1.2',port:32001,key:randomBytes(32).toString('hex'),sessionId:randomBytes(16).toString('hex'),expiresAt:new Date(Date.now()+600000).toISOString()};
 let settled=0,transfers=0,channel;
 const {server,stop}=createGalleryServer(config,{motion:async()=>{throw new Error('fixture');}},{events:{settled:()=>settled++,transferred:()=>transfers++}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  channel=await new Promise((r,j)=>{const c=clientApi('gallery-channel').connectGallery(adapter(server),config,{ready:()=>r(c),failed:j});});
  const result=await new Promise(r=>channel.motion(id,r));assert.equal(result.status,'failed');
  assert.equal(settled,1);assert.equal(transfers,0);
 }finally{channel?.close();await stop();}
});
test('authenticated Live video and package use existing download profile and integrity checks',async()=>{
 const config={type:'NikkiSyncLocalGalleryLive',version:1,host:'192.168.1.2',port:32001,key:randomBytes(32).toString('hex'),sessionId:randomBytes(16).toString('hex'),expiresAt:new Date(Date.now()+600000).toISOString()};
 const video=Buffer.from([0,0,0,16,102,116,121,112,105,115,111,109,0,0,0,0]),livp=Buffer.from([80,75,3,4,1,2,3,4]);
 const source={list:offset=>({offset,total:1,items:[{id,date:'',live:true}],next:null}),motion:async()=>({image:Buffer.from(video),mime:'video/mp4'}),live:async(_id,o)=>{assert.equal(o.rotation,0);return {image:Buffer.from(livp),mime:'application/x-livp'};}};
 const {server,stop}=createGalleryServer(config,source);await new Promise(r=>server.listen(0,'127.0.0.1',r));let channel;
 try{channel=await new Promise((r,j)=>{const c=clientApi('gallery-channel').connectGallery(adapter(server),config,{ready:()=>r(c),failed:j});});assert.equal((await new Promise(r=>channel.list(0,r))).items[0].live,true);
  const motion=await new Promise(r=>channel.motion(id,r));assert.equal(motion.status,'ok');assert.equal(motion.motion,true);assert.deepEqual(Buffer.from(motion.image),video);
  const pack=await new Promise(r=>channel.live(id,{exif:true,rotation:0},r));assert.equal(pack.status,'ok');assert.equal(pack.live,true);assert.equal(pack.original,false);assert.deepEqual(Buffer.from(pack.image),livp);
 }finally{channel?.close();await stop();}
});
test('Live transfer handles a payload above the ordinary-photo limit without widening the old profile',async()=>{
 const config={type:'NikkiSyncLocalGalleryLive',version:1,host:'192.168.1.2',port:32001,key:randomBytes(32).toString('hex'),sessionId:randomBytes(16).toString('hex'),expiresAt:new Date(Date.now()+600000).toISOString()};
 const video=Buffer.alloc(17*1024*1024,71);Buffer.from([0,0,0,16,102,116,121,112,105,115,111,109,0,0,0,0]).copy(video);const expected=createHash('sha256').update(video).digest('hex');
 const {server,stop}=createGalleryServer(config,{motion:async()=>({image:Buffer.from(video),mime:'video/mp4'})});await new Promise(r=>server.listen(0,'127.0.0.1',r));let channel;
 try{channel=await new Promise((r,j)=>{const c=clientApi('gallery-channel').connectGallery(adapter(server),config,{ready:()=>r(c),failed:j});});const actual=await new Promise(r=>channel.motion(id,r));assert.equal(actual.status,'ok');assert.equal(actual.image.length,video.length);assert.equal(actual.sha256,expected);assert.equal(createHash('sha256').update(actual.image).digest('hex'),expected);actual.image.fill(0);
 }finally{video.fill(0);channel?.close();await stop();}
});
test('Live client rejects wrong hash, signature, oversize, response kind and extra identity fields before releasing bytes',()=>{
 const g=clientApi('gallery-channel'),wire=clientApi(),crypto=clientApi('noise-vendor');
 for(const variant of ['hash','signature','oversize','kind','identity']){
  const config={type:'NikkiSyncLocalGalleryLive',version:1,host:'192.168.1.2',port:32001,key:randomBytes(32).toString('hex'),sessionId:randomBytes(16).toString('hex'),expiresAt:new Date(Date.now()+600000).toISOString()},events={};
  const peer=crypto.createLivePeer(false,Buffer.from(config.key,'hex'),wire.prologue(config),randomBytes(64));let handshake=false,result;
  const bytes=new Uint8Array(variant==='signature'?[255,216,255,217]:[80,75,3,4,0]);
  const send=value=>events.message({message:wire.frame(peer.encrypt(value)).buffer});
  let channel;channel=g.connectGallery({getRandomValues:o=>o.success({randomValues:Uint8Array.from(randomBytes(64)).buffer}),createTCPSocket:()=>({onConnect:f=>events.connect=f,onMessage:f=>events.message=f,onError(){},onClose(){},connect(){events.connect();},close(){},write(packet){const payload=new Uint8Array(packet).slice(2);if(!handshake){peer.receiveHandshake(payload);handshake=true;events.message({message:wire.frame(peer.sendHandshake()).buffer});return;}const plain=peer.decrypt(payload),request=g.decode(plain);plain.fill(0);
    const header={kind:variant==='kind'?'original':'live',req:request.req,id,size:variant==='oversize'?g.MAX_LIVE+1:bytes.length,mime:'application/x-livp',sha256:variant==='hash'?'0'.repeat(64):createHash('sha256').update(bytes).digest('hex'),...(variant==='identity'?{uid:'private'}:{})};send(g.encode(header));if(variant!=='oversize'&&variant!=='kind'&&variant!=='identity'){send(bytes);send(g.encode({kind:'end',req:request.req,id}));}
  }})},config,{});
  try{channel.live(id,{exif:true,rotation:0},x=>result=x);assert.equal(result?.status,'failed',variant);assert.equal(result.image,undefined);}finally{channel.close();peer.close();}
 }
});
test('Live has a separately bounded hash/profile; original and diagnostic limits remain unchanged',()=>{
 const g=clientApi('gallery-channel'),crypto=clientApi('noise-vendor');assert.equal(g.MAX_LIVE,96*1024*1024);assert.equal(g.MAX_LIVE_TOTAL,512*1024*1024);
 assert.throws(()=>crypto.sha256Original(new Uint8Array(16777217)));assert.throws(()=>crypto.sha256Live(new Uint8Array(g.MAX_LIVE+1)));
 const b=new Uint8Array(524289);assert.equal(Buffer.from(crypto.sha256Live(b)).toString('hex'),(awaitHash(b)));assert.throws(()=>crypto.sha256(b));
});
function awaitHash(bytes){return clientApi('gallery-channel').hashHex(bytes,true);}
async function cacheFixture(){let write,share;const deleted=[];const module={exports:{}};runInNewContext(await readFile(new URL('lib/live-gallery.js',root),'utf8'),{module,Uint8Array,Date});
 const wx={env:{USER_DATA_PATH:'/cache'},getFileSystemManager:()=>({writeFile:o=>write=o,unlink:o=>deleted.push(o.filePath),readdir:o=>o.success({files:[]})}),shareFileMessage:o=>share=o};
 return {cache:module.exports.createLiveCache(wx),deleted,get write(){return write;},get share(){return share;}};
}
test('Live file is pinned across share picker background; shared is never recorded as album saved',async()=>{
 const f=await cacheFixture();let path,result;const bytes=new Uint8Array([80,75,3,4,0]);f.cache.put({status:'ok',live:true,image:bytes,mime:'application/x-livp'},'live',p=>path=p);f.write.success();assert.ok(bytes.every(x=>x===0));assert.match(path,/\.livp$/);
 f.cache.share(path,r=>result=r);assert.match(f.share.fileName,/\.livp$/);f.cache.clear();assert.equal(f.deleted.includes(path),false);f.share.success();assert.equal(result.status,'shared');assert.equal(f.deleted.includes(path),true);f.share.fail();assert.equal(result.status,'shared');
});
test('stale Live writes and wrong type are wiped; cancelled file shares are retryable and never saved',async()=>{
 const f=await cacheFixture();let result;const bytes=new Uint8Array([80,75,3,4,0]);f.cache.put({status:'ok',live:true,image:bytes,mime:'application/x-livp'},'live',r=>result=r);const stale=f.write;f.cache.clear();stale.success();assert.equal(result,null);assert.equal(f.deleted.includes(stale.filePath),true);
 const wrong=new Uint8Array([255,216,255,217]);f.cache.put({status:'ok',original:true,image:wrong,mime:'image/jpeg'},'live',r=>result=r);assert.equal(result,null);assert.ok(wrong.every(x=>x===0));
 let path;f.cache.put({status:'ok',live:true,image:new Uint8Array([80,75,3,4,0]),mime:'application/x-livp'},'live',p=>path=p);f.write.success();f.cache.share(path,r=>result=r);f.share.fail({errMsg:'cancel'});assert.equal(result.status,'cancelled');assert.equal(f.deleted.includes(path),false);f.cache.clear();
});
test('ordinary batch refuses selected Live across pages and viewer exposes dedicated export rather than static success',async()=>{
 let page,batches=0;runInNewContext(await readFile(new URL('pages/local-gallery/index.js',root),'utf8'),{Page:p=>page=p,Date,Uint8Array,wx:{getFileSystemManager:()=>({unlink(){}})},require:()=>({saveOriginalBatch:()=>{batches++;return {};}})});
 page.setData=(x,done)=>{Object.assign(page.data,x);done?.();};page.onLoad();page.onShow();page.setData({connected:true,downloadEnabled:true,photos:[{id,path:'/cache/cover.jpg',live:true}],total:1});page._liveIds.add(id);page._selected.add(id);page.saveSelected();assert.equal(batches,0);assert.match(page.data.saveMessage,/Live/);assert.equal(page._selected.has(id),true);
 page.openPhoto({currentTarget:{dataset:{index:0}}});assert.equal(page.data.viewerLive,true);const xml=await readFile(new URL('pages/local-gallery/index.wxml',root),'utf8');assert.match(xml,/导出 Live 封包/);assert.match(xml,/<video/);assert.doesNotMatch(xml,/Live 暂未开放/);
});
