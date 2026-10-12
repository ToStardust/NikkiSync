import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import test from 'node:test';
import { clientApi } from './client-api.mjs';
const qr = () => ({ type: 'NikkiSyncLocalGalleryPreview', version: 1, host: '192.168.31.130', port: 32123,
  sessionId: randomBytes(16).toString('hex'), key: randomBytes(32).toString('hex'), expiresAt: new Date(Date.now() + 600000).toISOString() });
test('gallery decoder consumes large coalesced TCP events frame-by-frame without widening frame/total bounds',()=>{
 const gallery=clientApi('gallery-channel'),wire=clientApi();
 const one=wire.frame(new Uint8Array(4112).fill(7)),joined=new Uint8Array(one.length*100);
 for(let i=0;i<100;i++)joined.set(one,i*one.length);
 let count=0;const decoder=gallery.createGalleryDecoder(bytes=>{count++;assert.equal(bytes.length,4112);assert.equal(bytes[0],7);});
 decoder.feed(joined.subarray(0,1));decoder.feed(joined.subarray(1));assert.equal(count,100);decoder.close();
 const bad=gallery.createGalleryDecoder(()=>{});assert.throws(()=>bad.feed(new Uint8Array([255,255])));
 const total=gallery.createGalleryDecoder(()=>{});assert.throws(()=>total.feed(new Uint8Array(gallery.MAX_TOTAL+1)));total.close();
});
test('gallery QR and decoder keep type, frame, buffer and total bounds', () => {
  const g = clientApi('gallery-channel');
  assert.equal(g.parseGalleryQr(JSON.stringify(qr())).type, 'NikkiSyncLocalGalleryPreview');
  for (const patch of [{ type: 'NikkiSyncEncryptedImageProbe' }, { path: 'C:/private' }, { host: '8.8.8.8' }, { key: 'weak' }])
    assert.throws(() => g.parseGalleryQr(JSON.stringify({ ...qr(), ...patch })));
  const decoder = g.createGalleryDecoder(() => {});
  assert.throws(() => decoder.feed(new Uint8Array(262145)));
});
test('download client rejects original corruption/oversize/wrong kind and metadata containing unexpected identity fields', () => {
  const g=clientApi('gallery-channel'),p=clientApi(),{createDownloadPeer}=clientApi('noise-vendor');
  for(const variant of ['digest','oversize','wrong-kind','truncated','metadata-uid']){
    const config={...qr(),type:'NikkiSyncLocalGalleryDownload'},events={};
    const peer=createDownloadPeer(false,Buffer.from(config.key,'hex'),p.prologue(config),randomBytes(64));
    let handshaken=false,result;
    const send=value=>events.message({message:p.frame(peer.encrypt(value)).buffer});
    const decoder=g.createGalleryDecoder(bytes=>{
      if(!handshaken){peer.receiveHandshake(bytes);handshaken=true;events.message({message:p.frame(peer.sendHandshake()).buffer});return;}
      const request=g.decode(peer.decrypt(bytes));
      if(variant==='metadata-uid'){send(g.encode({kind:'metadata',req:request.req,id:request.id,availability:'available',rows:[],uid:'PRIVATE'}));return;}
      send(g.encode({kind:variant==='wrong-kind'?'photo':'original',req:request.req,id:request.id,size:variant==='oversize'?16777217:4,sha256:'0'.repeat(64),mime:'image/jpeg'}));
      if(variant==='digest'){send(new Uint8Array([255,216,255,217]));send(g.encode({kind:'end',req:request.req,id:request.id}));}
      else if(variant==='truncated')events.close();
    },g.MAX_DOWNLOAD_TOTAL);
    const socket={onConnect:f=>events.connect=f,onMessage:f=>events.message=f,onError:f=>events.error=f,onClose:f=>events.close=f,
      connect:()=>events.connect(),write:data=>decoder.feed(new Uint8Array(data)),close(){}};
    const connection=g.connectGallery({getRandomValues:o=>o.success({randomValues:Uint8Array.from(randomBytes(64)).buffer}),createTCPSocket:()=>socket},config,{});
    if(variant==='metadata-uid')connection.metadata('a'.repeat(32),x=>result=x);else connection.original('a'.repeat(32),x=>result=x);
    assert.equal(result.status,'failed');assert.equal(result.image,undefined);assert.equal(result.rows,undefined);
    connection.close();peer.close();decoder.close();
  }
});
test('download QR permits byte-identical originals and Chinese metadata, while old preview QR cannot request them', async () => {
  const {createGalleryServer}=await import('../wechat-gallery/server.mjs');
  const id='c'.repeat(32),bytes=new Uint8Array(600000);bytes[0]=255;bytes[1]=216;bytes.set([255,217,11,22],bytes.length-4);
  const info={availability:'available',rows:[{label:'服装',value:'星光裙'}]};
  for(const download of [true,false]){
    const config={...qr(),type:download?'NikkiSyncLocalGalleryDownload':'NikkiSyncLocalGalleryPreview'};
    const source={list:offset=>({offset,total:1,items:[{id,date:''}],next:null}),original:async()=>({image:bytes.slice(),mime:'image/jpeg'}),metadata:()=>info};
    const {server,stop}=createGalleryServer(config,source);await new Promise(r=>server.listen(0,'127.0.0.1',r));
    let connection;
    try{
      connection=await new Promise((resolve,reject)=>{const c=clientApi('gallery-channel').connectGallery(socketAdapter(server),config,{ready:()=>resolve(c),failed:reject});});
      if(download){
        const result=await new Promise(r=>connection.original(id,r));assert.equal(result.status,'ok');assert.deepEqual(Array.from(result.image),Array.from(bytes));
        const metadata=await new Promise(r=>connection.metadata(id,r));assert.equal(metadata.status,'ok');assert.equal(metadata.rows[0].value,'星光裙');
      }else{
        assert.throws(()=>connection.original(id,()=>{}));assert.throws(()=>connection.metadata(id,()=>{}));
        assert.throws(()=>connection.refresh(()=>{}));
      }
    }finally{connection?.close();await stop();}
  }
});
test('authenticated refresh updates same channel, stable ids, preview and metadata; failed refresh leaves old list valid',async()=>{
 const {createGalleryServer}=await import('../wechat-gallery/server.mjs');
 const config={...qr(),type:'NikkiSyncLocalGalleryDownload'},id='a'.repeat(32),newId='b'.repeat(32);
 let items=[{id,date:''}],refreshes=0,fail=false,clock=Date.now(),eventCount=0;
 const source={get count(){return items.length;},list:offset=>({total:items.length,offset,items:items.slice(offset,offset+12),next:null}),
  refresh:async()=>{refreshes++;if(fail)throw new Error('private path');items=[{id:newId,date:''},{id,date:''}];},
  preview:async()=>new Uint8Array([255,216,255,217]),metadata:()=>({availability:'available',rows:[{label:'服装',value:'星光裙'}]})};
 const {server,stop}=createGalleryServer(config,source,{now:()=>clock,events:{refreshed:n=>eventCount=n}});await new Promise(r=>server.listen(0,'127.0.0.1',r));let c;
 try{
  c=await new Promise((r,j)=>{const channel=clientApi('gallery-channel').connectGallery(socketAdapter(server),config,{ready:()=>r(channel),failed:j});});
  const first=await new Promise(r=>c.list(0,r));assert.equal(first.items[0].id,id);
  const fresh=await new Promise(r=>c.refresh(r));assert.equal(fresh.status,'ok');assert.equal(fresh.total,2);assert.equal(fresh.items[1].id,id);assert.equal(eventCount,2);
  await new Promise(r=>c.refresh(r));assert.equal(refreshes,1,'rapid repeated refresh is throttled');
  const photo=await new Promise(r=>c.preview(newId,r));assert.equal(photo.status,'ok');photo.image.fill(0);
  const info=await new Promise(r=>c.metadata(newId,r));assert.equal(info.rows[0].value,'星光裙');
  clock+=6000;fail=true;const error=await new Promise(r=>c.refresh(r));assert.equal(error.status,'failed');assert.doesNotMatch(JSON.stringify(error),/private/);
  const retained=await new Promise(r=>c.list(0,r));assert.equal(retained.status,'ok');assert.equal(retained.total,2);
 }finally{c?.close();await stop();}
});
function socketAdapter(server) {
  const events = {}; let socket;
  return { getRandomValues: o => o.success({ randomValues: Uint8Array.from(randomBytes(64)).buffer }),
    createTCPSocket: () => ({ onConnect: f => events.connect = f, onMessage: f => events.message = f, onError: f => events.error = f, onClose: f => events.close = f,
      connect: () => { socket = net.connect(server.address().port, '127.0.0.1'); socket.on('connect', () => events.connect());
        socket.on('data', x => events.message({ message: Uint8Array.from(x).buffer })); socket.on('error', () => events.error()); socket.on('close', () => events.close()); },
      write: data => socket.write(Buffer.from(data)), close: () => socket?.destroy() }) };
}
test('request quota closes the channel clearly instead of leaving a live-looking exhausted session',()=>{
 const g=clientApi('gallery-channel'),p=clientApi(),{createDownloadPeer}=clientApi('noise-vendor'),config={...qr(),type:'NikkiSyncLocalGalleryDownload'},events={};
 const peer=createDownloadPeer(false,Buffer.from(config.key,'hex'),p.prologue(config),randomBytes(64));let handshaken=false,failed=0;
 const decoder=g.createGalleryDecoder(bytes=>{
  if(!handshaken){peer.receiveHandshake(bytes);handshaken=true;events.message({message:p.frame(peer.sendHandshake()).buffer});return;}
  const request=g.decode(peer.decrypt(bytes));events.message({message:p.frame(peer.encrypt(g.encode({kind:'metadata',req:request.req,id:request.id,availability:'unavailable',rows:[]}))).buffer});
 },g.MAX_DOWNLOAD_TOTAL);
 const socket={onConnect:f=>events.connect=f,onMessage:f=>events.message=f,onError:f=>events.error=f,onClose:f=>events.close=f,
  connect:()=>events.connect(),write:data=>decoder.feed(new Uint8Array(data)),close(){}};
 const c=g.connectGallery({getRandomValues:o=>o.success({randomValues:Uint8Array.from(randomBytes(64)).buffer}),createTCPSocket:()=>socket},config,{failed:()=>failed++});
 try{for(let n=0;n<256;n++)c.metadata('a'.repeat(32),x=>assert.equal(x.status,'ok'));assert.throws(()=>c.list(0,()=>{}));assert.equal(failed,1);}finally{c.close();peer.close();decoder.close();}
});
test('real encrypted gallery lists only public snapshot ids; verifies chunked JPEG; forbids arbitrary paths and QR reuse', async () => {
  const { createGalleryServer } = await import('../wechat-gallery/server.mjs');
  const id = 'a'.repeat(32), photo = new Uint8Array(12000); photo[0] = 255; photo[1] = 216; photo[photo.length-2] = 255; photo[photo.length-1] = 217;
  const config = qr(), source = { list: offset => ({ total: 1, offset, items: offset === 0 ? [{ id, date: '' }] : [], next: null }),
    preview: async requestId => { assert.equal(requestId, id); return photo.slice(); } };
  const { server, stop } = createGalleryServer(config, source); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let connection;
  try {
    connection = await new Promise((resolve, reject) => { const channel = clientApi('gallery-channel').connectGallery(socketAdapter(server), config, { ready: () => resolve(channel), failed: reject }); });
    const list = await new Promise(resolve => connection.list(0, resolve)); assert.equal(list.status, 'ok'); assert.equal(list.items[0].id, id);
    const picture = await new Promise(resolve => connection.preview(id, resolve)); assert.equal(picture.status, 'ok'); assert.deepEqual(Array.from(picture.image), Array.from(photo));
    const wrong = await new Promise(resolve => connection.preview('b'.repeat(32), resolve)); assert.equal(wrong.status, 'failed');
    assert.throws(() => connection.preview('../../private', () => {})); connection.close();
    const reused = await new Promise(resolve => clientApi('gallery-channel').connectGallery(socketAdapter(server), config, { ready: () => resolve('bad'), failed: () => resolve('rejected') }));
    assert.equal(reused, 'rejected');
  } finally { connection?.close(); await stop(); }
});
test('gallery never releases a preview after wrong digest, tampered ciphertext, oversized header or truncation', () => {
  const g = clientApi('gallery-channel'), p = clientApi(), { createGalleryPeer } = clientApi('noise-vendor');
  for (const variant of ['digest','tamper','oversize','truncated']) {
    const config = qr(), events = {}, server = createGalleryPeer(false, Buffer.from(config.key, 'hex'), p.prologue(config), randomBytes(64));
    let phase = 0, result, channel;
    const decoder = g.createGalleryDecoder(bytes => {
      if (!phase++) { server.receiveHandshake(bytes); events.message({ message: p.frame(server.sendHandshake()).buffer }); }
      else {
        const request = g.decode(server.decrypt(bytes)), photo = new Uint8Array([255,216,255,217]);
        const response = p.frame(server.encrypt(g.encode({ kind:'photo',req:request.req,id:request.id,size:variant === 'oversize' ? 524289 : 4,sha256:'0'.repeat(64),mime:'image/jpeg' })));
        if (variant === 'tamper') response[response.length-1] ^= 1; events.message({ message: response.buffer });
        if (variant === 'digest') { events.message({ message: p.frame(server.encrypt(photo)).buffer }); events.message({ message: p.frame(server.encrypt(g.encode({kind:'end',req:request.req,id:request.id}))).buffer }); }
        else if (variant === 'truncated') events.close();
      }
    });
    const socket = { onConnect:f=>events.connect=f,onMessage:f=>events.message=f,onError:f=>events.error=f,onClose:f=>events.close=f,
      connect:()=>events.connect(),write:data=>decoder.feed(new Uint8Array(data)),close(){} };
    channel = g.connectGallery({ getRandomValues:o=>o.success({randomValues:Uint8Array.from(randomBytes(64)).buffer}),createTCPSocket:()=>socket },config,{});
    channel.preview('a'.repeat(32),value=>result=value); assert.equal(result.status,'failed'); assert.equal(result.image,undefined);
    channel.close(); server.close(); decoder.close();
  }
});
