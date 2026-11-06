import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {clientApi} from '../wechat-crypto-spike/client-api.mjs';
import {createGalleryServer} from './server.mjs';
const g=clientApi('gallery-channel'),id='a'.repeat(32);
const qr=()=>({type:'NikkiSyncLocalGalleryDownload',version:1,resume:1,host:'192.168.1.8',port:32123,key:randomBytes(32).toString('hex'),sessionId:randomBytes(16).toString('hex'),expiresAt:new Date(Date.now()+600000).toISOString()});
const source=()=>({list:offset=>({offset,total:1,items:[{id,date:''}],next:null}),metadata:()=>({availability:'available',rows:[]}),preview:async()=>new Uint8Array([255,216,255,217])});
function adapter(server){
 const sockets=[],packets=[],callbacks=[];let target=server;
 return {sockets,packets,callbacks,redirect:s=>target=s,getRandomValues:o=>o.success({randomValues:Uint8Array.from(randomBytes(64)).buffer}),createTCPSocket(){
  const e={};callbacks.push(e);let s;return {onConnect:f=>e.connect=f,onMessage:f=>e.message=f,onError:f=>e.error=f,onClose:f=>e.close=f,
   connect(){s=net.connect(target.address().port,'127.0.0.1');sockets.push(s);s.on('connect',()=>e.connect());s.on('data',b=>e.message({message:Uint8Array.from(b).buffer}));s.on('error',()=>e.error());s.on('close',()=>e.close());},write:b=>{packets.push(Buffer.from(b));s.write(Buffer.from(b));},close:()=>s?.destroy()};
 }};
}
async function fixture(s=source(),options={},patch={}){const config={...qr(),...patch},service=createGalleryServer(config,s,options);await new Promise(r=>service.server.listen(0,'127.0.0.1',r));return {...service,config,wx:adapter(service.server)};}
function connect(f){let ready,failed,disconnected;const events=[];const c=g.connectGallery(f.wx,f.config,{ready:v=>{events.push(v);ready?.(v);},failed:m=>failed?.(m),disconnected:()=>disconnected?.()});
 return {c,events,ready:()=>new Promise((r,j)=>{ready=r;failed=j;}),disconnected:()=>new Promise(r=>disconnected=r)};}
test('resume QR is explicitly bounded and capability is bound to the handshake context',()=>{
 const config=qr();assert.equal(g.parseGalleryQr(JSON.stringify(config)).resume,1);
 for(const patch of [{resume:0},{resume:true},{resume:2},{path:'private'}])assert.throws(()=>g.parseGalleryQr(JSON.stringify({...config,...patch})));
 const legacy={...config};delete legacy.resume;assert.notEqual(g.galleryPrologue(config),g.galleryPrologue(legacy));
});
test('alternative addresses are private, bounded, unique and authenticated as part of the QR context',()=>{
 const config={...qr(),hosts:['192.168.1.8','10.1.2.3']};
 assert.deepEqual(Array.from(g.parseGalleryQr(JSON.stringify(config)).hosts),config.hosts);
 assert.notEqual(g.galleryPrologue(config),g.galleryPrologue({...config,hosts:['192.168.1.8','10.1.2.4']}));
 for(const hosts of [[],['10.1.2.3'],['192.168.1.8','8.8.8.8'],['192.168.1.8','192.168.1.8'],Array.from({length:9},(_,i)=>'192.168.1.'+(i+8))])
  assert.throws(()=>g.parseGalleryQr(JSON.stringify({...config,hosts})));
});
test('initial connection and recovery try the next advertised address, ignoring callbacks from the failed socket',async()=>{
 const f=await fixture(source(),{},{hosts:['192.168.1.8','10.1.2.3']});const attempts=[],original=f.wx.createTCPSocket;let stale;
 f.wx.createTCPSocket=()=>{const socket=original();const connect=socket.connect;socket.connect=options=>{
  attempts.push(options.address);
  if(options.address===f.config.host){stale=f.wx.callbacks.at(-1);setImmediate(()=>stale.error());}else connect(options);
 };return socket;};let conn;
 try{g.parseGalleryQr(JSON.stringify(f.config));conn=connect(f);await conn.ready();assert.deepEqual(attempts,f.config.hosts);
  stale.close();stale.message({message:new Uint8Array([255,255]).buffer});
  assert.equal((await new Promise(r=>conn.c.list(0,r))).status,'ok');
  conn.c.suspend();await new Promise(r=>setImmediate(r));const ready=conn.ready();conn.c.resume();await ready;
  assert.deepEqual(attempts,[...f.config.hosts,...f.config.hosts]);
  assert.equal((await new Promise(r=>conn.c.preview(id,r))).status,'ok');
 }finally{conn?.c.close();await f.stop();}
});
test('a stalled request times out once and remains recoverable without accepting late bytes',async()=>{
 const f=await fixture(),timers=[];let conn,finish;
 const module={exports:{}};
 runInNewContext(await readFile(new URL('../../apps/wechat-mini-program/miniprogram/lib/gallery-channel.js',import.meta.url),'utf8'),{
  module,Uint8Array,ArrayBuffer,Date,require:name=>clientApi(name.slice(2,-3)),
  setTimeout:(callback,delay)=>{const token={callback,delay};timers.push(token);return token;},clearTimeout:token=>{if(token)token.cleared=true;}
 });
 const old=f.wx.createTCPSocket;f.wx.createTCPSocket=()=>{const socket=old(),write=socket.write;let count=0;socket.write=bytes=>{if(++count<=2)write(bytes);};return socket;};
 try{const ready=new Promise(r=>{conn=module.exports.connectGallery(f.wx,f.config,{ready:r,disconnected:()=>finish?.(),failed:m=>assert.fail(m)});});await ready;
  let results=0;conn.list(0,result=>{results++;assert.equal(result.status,'failed');});
  const lost=new Promise(r=>finish=r);timers.findLast(x=>x.delay===20000&&!x.cleared).callback();await lost;
  assert.equal(results,1);assert.equal(conn.suspend(),true);assert.equal(conn.resume(),true);
 }finally{conn?.close();await f.stop();}
});
test('same logical session reconnects with fresh Noise, stable ids and no reuse of the original QR',async()=>{
 let authenticated=0,disconnected=0;const f=await fixture(source(),{events:{authenticated:()=>authenticated++,disconnected:()=>disconnected++}});let conn;
 try{conn=connect(f);assert.equal((await conn.ready()).resume,true);assert.equal((await new Promise(r=>conn.c.list(0,r))).items[0].id,id);
  for(let n=0;n<3;n++){assert.equal(conn.c.suspend(),true);await new Promise(r=>setImmediate(r));const ready=conn.ready();assert.equal(conn.c.resume(),true);await ready;
   assert.equal((await new Promise(r=>conn.c.preview(id,r))).status,'ok');}
  assert.equal(authenticated,4);assert.ok(disconnected>=3);assert.equal(f.wx.sockets.length,4);
  assert.notDeepEqual(f.wx.packets[0],f.wx.packets[2],'fresh handshakes must not replay previous encrypted records');
  conn.c.close();await new Promise(r=>setImmediate(r));
  const result=await new Promise(r=>g.connectGallery(adapter(f.server),f.config,{ready:()=>r('unsafe'),failed:()=>r('rejected')}));assert.equal(result,'rejected');
  assert.equal(conn.c.resume(),false,'explicit close revokes in-memory recovery');
 }finally{conn?.c.close();await f.stop();}
});
test('unexpected transport loss can recover, late old socket callbacks cannot kill the new connection',async()=>{
 const f=await fixture();let conn;
 try{conn=connect(f);await conn.ready();const disconnected=conn.disconnected();f.wx.sockets[0].destroy();await disconnected;
  const ready=conn.ready();assert.equal(conn.c.resume(),true);await ready;
  f.wx.callbacks[0].close();f.wx.callbacks[0].error();f.wx.callbacks[0].message({message:new Uint8Array([255,255]).buffer});
  assert.equal((await new Promise(r=>conn.c.list(0,r))).status,'ok');
 }finally{conn?.c.close();await f.stop();}
});
test('suspending a pending original settles once, wipes late bytes and serializes work across reconnects',async()=>{
 let finish,returned,overlap=false,running=false;const s=source();s.original=()=>new Promise(r=>{running=true;finish=()=>{returned=new Uint8Array([255,216,255,217]);running=false;r({image:returned,mime:'image/jpeg'});};});const list=s.list;s.list=o=>{if(running)overlap=true;return list(o);};
 const f=await fixture(s);let conn;
 try{conn=connect(f);await conn.ready();let callbacks=0;conn.c.original(id,v=>{callbacks++;assert.equal(v.status,'failed');});
  while(!finish)await new Promise(r=>setImmediate(r));assert.equal(conn.c.suspend(),true);const ready=conn.ready();conn.c.resume();await ready;
  const next=new Promise(r=>conn.c.list(0,r));finish();assert.equal((await next).status,'ok');assert.equal(callbacks,1);assert.equal(overlap,false);assert.ok(returned.every(x=>x===0));
 }finally{finish?.();conn?.c.close();await f.stop();}
});
test('resuming never resets the logical request quota',async()=>{
 const f=await fixture();let conn;
 try{conn=connect(f);await conn.ready();for(let n=0;n<120;n++)assert.equal((await new Promise(r=>conn.c.metadata(id,r))).status,'ok');
  conn.c.suspend();await new Promise(r=>setImmediate(r));const ready=conn.ready();conn.c.resume();await ready;
  for(let n=0;n<134;n++)assert.equal((await new Promise(r=>conn.c.metadata(id,r))).status,'ok');
  assert.throws(()=>conn.c.metadata(id,()=>{}),/quota|unavailable/i);assert.equal(conn.c.resume(),false);
 }finally{conn?.c.close();await f.stop();}
});
test('ending PC session rejects cached recovery credentials',async()=>{
 const f=await fixture();let conn;
 try{conn=connect(f);await conn.ready();conn.c.suspend();await f.stop();const result=new Promise(r=>{conn.c.resume();setTimeout(r,30);});await result;assert.equal(f.wx.sockets.at(-1).destroyed,true);
 }finally{conn?.c.close();}
});
test('untrusted recovery attempt cannot displace an authenticated phone or release another session photos',async()=>{
 let authenticated=0;const f=await fixture(source(),{events:{authenticated:()=>authenticated++}}),other=await fixture();let conn;
 try{conn=connect(f);await conn.ready();const rejected=await new Promise(r=>g.connectGallery(adapter(f.server),f.config,{ready:()=>r(false),failed:()=>r(true)}));
  assert.equal(rejected,true);assert.equal(authenticated,1);assert.equal((await new Promise(r=>conn.c.list(0,r))).status,'ok');
  conn.c.suspend();f.wx.redirect(other.server);const lost=conn.disconnected();conn.c.resume();await lost;assert.equal(authenticated,1);
  f.wx.redirect(f.server);const ready=conn.ready();conn.c.resume();await ready;assert.equal((await new Promise(r=>conn.c.list(0,r))).status,'ok');
 }finally{conn?.c.close();await f.stop();await other.stop();}
});
test('background during recovery authentication retains the credential and wipes late entropy',async()=>{
 const f=await fixture();let conn;
 try{conn=connect(f);await conn.ready();conn.c.suspend();const original=f.wx.getRandomValues;let rng;f.wx.getRandomValues=o=>rng=o;
  conn.c.resume();assert.equal(conn.c.suspend(),true);const bytes=Uint8Array.from(randomBytes(64));rng.success({randomValues:bytes.buffer});assert.ok(bytes.every(x=>x===0));
  f.wx.getRandomValues=original;const ready=conn.ready();conn.c.resume();await ready;assert.equal((await new Promise(r=>conn.c.list(0,r))).status,'ok');
 }finally{conn?.c.close();await f.stop();}
});
test('expiry is unchanged by reconnect and stops recovery even while suspended',async()=>{
 const config=qr();config.expiresAt=new Date(Date.now()+1400).toISOString();const service=createGalleryServer(config,source());await new Promise(r=>service.server.listen(0,'127.0.0.1',r));let conn;
 try{const f={...service,config,wx:adapter(service.server)};conn=connect(f);await conn.ready();conn.c.suspend();await new Promise(r=>setTimeout(r,1450));assert.equal(conn.c.resume(),false);}
 finally{conn?.c.close();await service.stop();}
});
async function pageFixture(){
 let page,hooks,saveHooks,closed=0,suspended=0,resumed=0,loads=[];const wx={getFileSystemManager:()=>({unlink(){}})};
 const channel={close(){closed++;},suspend(){suspended++;return true;},resume(){resumed++;hooks.ready({download:true,resume:true});return true;}};
 runInNewContext(await readFile(new URL('../../apps/wechat-mini-program/miniprogram/pages/local-gallery/index.js',import.meta.url),'utf8'),{Page:p=>page=p,Date,Uint8Array,wx,setTimeout,clearTimeout,require:x=>x.includes('gallery-channel')?{connectGallery:(_wx,_config,h)=>{hooks=h;return channel;}}:x.includes('original-save')?{saveOriginalBatch:(_wx,_c,_ids,h)=>{saveHooks=h;return {cancel(){}};}}:{}});
 page.setData=(v,done)=>{Object.assign(page.data,v);done?.();};page.onLoad();page.onShow();page.loadPage=o=>loads.push(o);page.connect({});hooks.ready({download:true,resume:true});page.setData({pageStart:13,selectedCount:1});page._selected.add(id);
 return {page,get closed(){return closed;},get suspended(){return suspended;},get resumed(){return resumed;},loads,get hooks(){return hooks;},get saveHooks(){return saveHooks;}};
}
test('background stops timers and media; foreground restores same page and selection without scanning or storing credentials',async()=>{
 const f=await pageFixture(),p=f.page;p._previewCache.set(id,'/cache/thumb.jpg');p._files.add('/cache/thumb.jpg');p.onHide();assert.equal(f.closed,0);assert.equal(f.suspended,1);assert.equal(p.data.connected,false);assert.equal(p._refreshTimer,null);assert.equal(p._previewCache.size,1);
 assert.equal(f.resumed,0);p.onShow();assert.equal(f.resumed,1);assert.equal(p.data.connected,true);assert.equal(f.loads.at(-1),12);assert.ok(p._selected.has(id));p.onUnload();assert.equal(f.closed,1);assert.equal(p._resumable,false);assert.equal(p._previewCache.size,0);
});
test('canceled share transfer preserves resumable channel',async()=>{
 const f=await pageFixture(),p=f.page;p.data.shareBusy=true;p._shareJob={cancel(){p._channel.interrupt?.();return true;}};p.onHide();p.onShow();assert.equal(f.closed,0);assert.equal(f.resumed,1);assert.equal(p.data.shareOpen,false);p.onUnload();
});
test('a native album save finishing after cancellation reports only actual success and retains its input until callback',async()=>{
 const module={exports:{}};runInNewContext(await readFile(new URL('../../apps/wechat-mini-program/miniprogram/lib/original-save.js',import.meta.url),'utf8'),{module,Uint8Array,Date});
 let save;const saved=[],removed=[];const wx={env:{USER_DATA_PATH:'/cache'},getFileSystemManager:()=>({writeFile:o=>o.success(),unlink:o=>removed.push(o.filePath)}),authorize:o=>o.success(),saveImageToPhotosAlbum:o=>save=o};
 const c={original:(_id,done)=>done({status:'ok',original:true,image:new Uint8Array([255,216,255,217]),mime:'image/jpeg',sha256:'a'.repeat(64)})};
 const job=module.exports.saveOriginalBatch(wx,c,[id],{saved:x=>saved.push(x)});job.cancel();assert.equal(saved.length,0);assert.equal(removed.length,0);save.success();assert.deepEqual(saved,[id]);assert.equal(removed.length,1);
});
test('late native save success updates the resumed selection but cannot mutate a replacement session',async()=>{
 const f=await pageFixture(),p=f.page,remaining='b'.repeat(32);p._selected.add(remaining);p.beginSave([id]);const h=f.saveHooks;p.onHide();h.saved(id);
 assert.equal(p._selected.has(id),false);assert.equal(p._selected.has(remaining),true);assert.equal(p._saved.get(id),'saved');
 p._connectionEpoch++;p._selected.add(id);h.saved(id);assert.equal(p._selected.has(id),true);p.onUnload();
});
