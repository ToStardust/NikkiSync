import test from 'node:test';import assert from 'node:assert/strict';import {randomBytes} from 'node:crypto';import net from 'node:net';
import {DatabaseManager} from '../../packages/database/dist/src/index.js';
import {InspirationRepository} from '../../apps/pc-companion/dist/src/inspiration/InspirationRepository.js';
import {withWeChatInspiration} from '../../apps/pc-companion/dist/src/wechat/WeChatInspiration.js';
import {createGalleryServer} from './server.mjs';import {clientApi} from '../wechat-crypto-spike/client-api.mjs';
function adapter(server){let socket;const e={};return {getRandomValues:o=>o.success({randomValues:Uint8Array.from(randomBytes(64)).buffer}),createTCPSocket:()=>({onConnect:f=>e.connect=f,onMessage:f=>e.message=f,onError:f=>e.error=f,onClose:f=>e.close=f,connect(){socket=net.connect(server.address().port,'127.0.0.1');socket.on('connect',()=>e.connect());socket.on('data',x=>e.message({message:Uint8Array.from(x).buffer}));socket.on('error',()=>e.error());socket.on('close',()=>e.close());},write:b=>socket.write(Buffer.from(b)),close:()=>socket?.destroy()})};}
test('encrypted mini inspiration CRUD, reference transfer and stale writer rejection share the existing PC store',async()=>{
 const db=new DatabaseManager(':memory:');db.initialize();const store=new InspirationRepository(db);
 let packaging=0;const source=withWeChatInspiration({count:0,live:()=>{packaging++;throw Error('must not run')}},store),config={type:'NikkiSyncLocalGalleryLive',version:1,resume:1,host:'192.168.1.2',port:32001,key:randomBytes(32).toString('hex'),sessionId:randomBytes(16).toString('hex'),expiresAt:new Date(Date.now()+600000).toISOString()};
 const {server,stop}=createGalleryServer(config,source,{allowLivePackaging:false});await new Promise(r=>server.listen(0,'127.0.0.1',r));let channel;
 try{
  channel=await new Promise((r,j)=>{const c=clientApi('gallery-channel').connectGallery(adapter(server),config,{ready:()=>r(c),failed:j});});
  assert.equal((await new Promise(r=>channel.live('a'.repeat(32),{exif:false,rotation:0},r))).status,'failed');assert.equal(packaging,0);
  const call=(action,input)=>new Promise(r=>channel.inspiration(action,input,r));
  const saved=await call('save',{id:'',revision:0,title:'参考',code:'1wPXwKyiXS4#',type:'dye',status:'want',categories:['花园']});assert.equal(saved.status,'ok');const item=saved.value.item;
  const bytes=Buffer.alloc(12000,42);Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
  const uploaded=await new Promise(r=>channel.inspirationUpload(item.id,item.revision,'image/png',Uint8Array.from(bytes),r));assert.equal(uploaded.status,'ok');
  const withImage=uploaded.value.item;assert.equal(withImage.images.length,1);
  const list=await call('list',{after:''});assert.equal(list.value.items[0].code,'1wPXwKyiXS4#');
  const reference=await new Promise(r=>channel.reference(item.id,withImage.images[0].key,r));assert.equal(reference.status,'ok');assert.deepEqual(Buffer.from(reference.image),bytes);reference.image.fill(0);
  assert.equal((await call('delete',{id:item.id,revision:item.revision})).status,'failed','stale edits never delete an updated entry');
  assert.equal(store.list('',10).items[0].entry.images.length,1);
  assert.equal((await call('removeImage',{id:item.id,revision:withImage.revision,key:withImage.images[0].key})).status,'ok');
  const missing=await new Promise(r=>channel.reference(item.id,withImage.images[0].key,r));assert.equal(missing.status,'failed','orphan image bytes are inaccessible by arbitrary hash');
  const current=(await call('list',{after:''})).value.items[0];assert.equal((await call('delete',{id:item.id,revision:current.revision})).status,'ok');assert.equal((await call('list',{after:''})).value.items.length,0);
 }finally{channel?.close();await stop();db.close();}
});
