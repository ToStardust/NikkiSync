import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomBytes} from 'node:crypto';
import net from 'node:net';
import {runInNewContext} from 'node:vm';
import {createPreviewSource} from './source.mjs';
import {createGalleryServer} from './server.mjs';
import {clientApi} from '../wechat-crypto-spike/client-api.mjs';

test('outfit source exposes bounded named cards, only opaque icon ids and source-bound icon access',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'nikki-outfit-')),path=join(directory,'a.jpg'),bytes=Buffer.from([255,216,255,217]);await writeFile(path,bytes);let loads=0;
 try{
  const meta={identity:{uid:'PRIVATE_UID'},dressing:{clothes:[{id:'PRIVATE_ID',name:'星光裙',thumbnail:'https://images.example.test/skirt.png',thumbnailFallbacks:['https://images.example.test/type.png']},{id:'OTHER_ID'}]},raw:{dictionary:{providerVersion:'v1'},secret:'PRIVATE_TOKEN'}};
  const source=await createPreviewSource([{sourcePath:path,sizeBytes:4,sha256:createHash('sha256').update(bytes).digest('hex'),mimeType:'image/jpeg',metadata:meta}],[directory],{loadIcon:async descriptor=>{loads++;assert.equal(descriptor.versionKey,'v1');assert.equal(descriptor.candidates[0].kind,'item');return {image:Uint8Array.from(clientApi('synthetic-image').imageBytes()),mime:'image/png',source:'item'};}});
  const photoId=source.list(0).items[0].id,list=source.outfit(photoId,0);assert.equal(list.items[0].name,'星光裙');assert.equal(list.items[1].name,'名称待解析');assert.equal(list.items[1].hasIcon,false);assert.match(list.items[0].key,/^[a-f0-9]{32}$/);
  assert.doesNotMatch(JSON.stringify(list),/PRIVATE|OTHER_ID|https|thumbnail|raw|uid/);
  const icon=await source.icon(photoId,list.items[0].key);assert.equal(icon.source,'item');assert.equal(loads,1);
  await assert.rejects(()=>source.icon('b'.repeat(32),list.items[0].key));await assert.rejects(()=>source.icon(photoId,'b'.repeat(32)));assert.throws(()=>source.outfit(photoId,-1));
  assert.deepEqual(await readFile(path),bytes);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('outfit list splits large Chinese descriptions into six-card controls under existing wire limit',async()=>{
 const {outfitDescriptors}=await import('./outfit.mjs'),entries=outfitDescriptors({dressing:{clothes:Array.from({length:120},(_,n)=>({id:String(n),name:'暖'.repeat(100),thumbnail:'http://unsafe.test/x'}))}},randomBytes(32));
 assert.equal(entries.length,100);assert.equal(entries[0].name.length,64);assert.equal(entries[0].hasIcon,false);assert.doesNotThrow(()=>clientApi('gallery-channel').encode({kind:'outfit',req:1,id:'a'.repeat(32),offset:0,total:100,items:entries.slice(0,6).map(({key,name,hasIcon})=>({key,name,hasIcon})),next:6}));
});

function adapter(server){const e={};let socket;return {getRandomValues:o=>o.success({randomValues:Uint8Array.from(randomBytes(64)).buffer}),createTCPSocket:()=>({onConnect:f=>e.connect=f,onMessage:f=>e.message=f,onError:f=>e.error=f,onClose:f=>e.close=f,connect(){socket=net.connect(server.address().port,'127.0.0.1');socket.on('connect',()=>e.connect());socket.on('data',b=>e.message({message:Uint8Array.from(b).buffer}));socket.on('error',()=>e.error());socket.on('close',()=>e.close());},write:b=>socket.write(Buffer.from(b)),close:()=>socket?.destroy()})};}
test('outfit and verified icons use existing encrypted quota/profile, without counting icons as saved originals',async()=>{
 const id='a'.repeat(32),key='b'.repeat(32),config={type:'NikkiSyncLocalGalleryDownload',version:1,host:'192.168.1.2',port:32001,key:randomBytes(32).toString('hex'),sessionId:randomBytes(16).toString('hex'),expiresAt:new Date(Date.now()+600000).toISOString()};let transfers=0;
 const source={outfit:(_id,offset)=>({offset,total:1,items:[{key,name:'星光裙',hasIcon:true}],next:null}),icon:async()=>({image:Uint8Array.from(clientApi('synthetic-image').imageBytes()),mime:'image/png',source:'category'})};
 const {server,stop}=createGalleryServer(config,source,{events:{transferred:()=>transfers++}});await new Promise(r=>server.listen(0,'127.0.0.1',r));let c;
 try{c=await new Promise((r,j)=>{const channel=clientApi('gallery-channel').connectGallery(adapter(server),config,{ready:()=>r(channel),failed:j});});
  const list=await new Promise(r=>c.outfit(id,0,r));assert.equal(list.status,'ok');assert.equal(list.items[0].name,'星光裙');
  const icon=await new Promise(r=>c.icon(id,key,r));assert.equal(icon.status,'ok');assert.equal(icon.icon,true);assert.equal(icon.original,false);assert.equal(icon.source,'category');assert.equal(transfers,0);assert.throws(()=>c.icon(id,'https://evil.test',()=>{}));
 }finally{c?.close();await stop();}
});

test('phone icon cache reuses files, evicts least recent within count/byte bounds and cleans late writes',async()=>{
 const m={exports:{}};runInNewContext(await readFile(new URL('../../apps/wechat-mini-program/miniprogram/lib/icon-cache.js',import.meta.url),'utf8'),{module:m,Uint8Array,Date});let pending,removed=[];
 const wx={env:{USER_DATA_PATH:'/cache'},getFileSystemManager:()=>({writeFile:o=>pending=o,unlink:o=>removed.push(o.filePath)})};
 const cache=m.exports.createIconCache(wx,{maxEntries:2,maxBytes:10});const put=key=>new Promise(r=>{cache.put(key,new Uint8Array(4),'image/png','item',r);pending.success();});
 await put('a'.repeat(32));await put('b'.repeat(32));assert.ok(cache.get('a'.repeat(32)));await put('c'.repeat(32));assert.equal(cache.get('b'.repeat(32)),undefined);assert.equal(removed.length,1);assert.equal(cache.stats().bytes,8);
 cache.put('d'.repeat(32),new Uint8Array(4),'image/png','item',()=>assert.fail('late callback must not display icon'));const late=pending;cache.clear();late.success();assert.equal(cache.stats().bytes,0);assert.equal(cache.stats().entries,0);assert.ok(removed.includes(late.filePath));
});

test('phone outfit UI uses image cards, distinguishes category icons and has no remote image URLs or album writes',async()=>{
 const root=new URL('../../apps/wechat-mini-program/miniprogram/',import.meta.url),xml=await readFile(new URL('pages/local-gallery/index.wxml',root),'utf8'),js=await readFile(new URL('pages/local-gallery/index.js',root),'utf8');
 assert.match(xml,/outfitItems/);assert.match(xml,/item\.iconPath/);assert.match(xml,/分类示意/);assert.match(js,/loadOutfit/);assert.match(js,/createIconCache/);assert.doesNotMatch(xml,/<image[^>]+https?:/);
});

async function pageFixture(){
 const root=new URL('../../apps/wechat-mini-program/miniprogram/',import.meta.url),module={exports:{}};runInNewContext(await readFile(new URL('lib/icon-cache.js',root),'utf8'),{module,Uint8Array,Date});
 let page,pending;const removed=[],wx={env:{USER_DATA_PATH:'/cache'},getFileSystemManager:()=>({writeFile:o=>pending=o,unlink:o=>removed.push(o.filePath)})};
 runInNewContext(await readFile(new URL('pages/local-gallery/index.js',root),'utf8'),{Page:p=>page=p,Date,Uint8Array,wx,require:x=>x.includes('icon-cache')?module.exports:{}});page.setData=(x,done)=>{Object.assign(page.data,x);done?.();};page.onLoad();page.onShow();
 page.setData({viewerOpen:true,infoOpen:true,connected:true,downloadEnabled:true,selectedId:'a'.repeat(32),photos:[],infoRows:[{label:'焦距',value:'35'}]});return {page,removed,get pending(){return pending;}};
}
test('outfit panel loads only six requested cards, reuses repeated icons and stops on sheet close',async()=>{
 const f=await pageFixture(),p=f.page,key='b'.repeat(32),second='c'.repeat(32);let icons=0,outfits=0;
 p._channel={outfit:(_id,offset,done)=>{outfits++;done({status:'ok',offset,total:7,next:6,items:[{key,name:'裙子',hasIcon:true},{key:second,name:'帽子',hasIcon:false}]});},icon:(_id,_key,done)=>{icons++;done({status:'ok',icon:true,original:false,key,image:Uint8Array.from(clientApi('synthetic-image').imageBytes()),mime:'image/png',source:'category'});}};
 p.loadOutfit(p.data.selectedId,0);assert.equal(icons,1);assert.equal(p.data.infoLoading,true);f.pending.success();assert.equal(p.data.infoLoading,false);assert.equal(p.data.outfitItems[0].iconSource,'category');assert.equal(p.data.outfitItems[1].iconState,'暂无图标');
 p.loadOutfit(p.data.selectedId,0);assert.equal(outfits,1);assert.equal(icons,1);assert.equal(p.data.infoLoading,false);
 p._iconCache.clear();p.loadOutfit(p.data.selectedId,0);const late=f.pending;p.closeInfo();late.success();assert.equal(p.data.infoLoading,false);assert.equal(p.data.infoOpen,false);
});
test('background clears owned icon files; late native write cannot redraw or remain on disk',async()=>{
 const f=await pageFixture(),p=f.page,key='b'.repeat(32);
 p._channel={close(){},outfit:(_id,offset,done)=>done({status:'ok',offset,total:1,next:null,items:[{key,name:'裙子',hasIcon:true}]}),icon:(_id,_key,done)=>done({status:'ok',icon:true,original:false,image:Uint8Array.from(clientApi('synthetic-image').imageBytes()),mime:'image/png',source:'item'})};
 p.loadOutfit(p.data.selectedId,0);const late=f.pending;p.onHide();late.success();assert.ok(f.removed.includes(late.filePath));assert.equal(p._iconCache.stats().entries,0);assert.equal(p.data.connected,false);
});
test('unparsed auto-generated clothing codes are not presented as actual clothing names',async()=>{
 const {outfitDescriptors}=await import('./outfit.mjs');const items=outfitDescriptors({dressing:{clothes:[{id:'1020100111',name:'服装 1020100111'}]}},randomBytes(32));assert.equal(items[0].name,'名称待解析');
});
test('successful snapshot refresh invalidates cached outfit pages before displaying changed dictionary entries',async()=>{
 const {page:p}=await pageFixture();p.setData({viewerOpen:false,infoOpen:false,browseEnabled:false,infoLoading:false});p._outfits.set('old',{items:[]});
 p._channel={refresh:done=>done({status:'ok',offset:0,total:0,items:[],next:null})};p.refreshPhotos();assert.equal(p._outfits.size,0);
});
test('new phone cache cleans only owned orphan icons and never removes a live pending icon or photo',async()=>{
 const m={exports:{}};runInNewContext(await readFile(new URL('../../apps/wechat-mini-program/miniprogram/lib/icon-cache.js',import.meta.url),'utf8'),{module:m,Uint8Array,Date});let read,write;const removed=[];
 const wx={env:{USER_DATA_PATH:'/cache'},getFileSystemManager:()=>({readdir:o=>read=o,writeFile:o=>write=o,unlink:o=>removed.push(o.filePath)})};
 const cache=m.exports.createIconCache(wx);assert.ok(read);cache.put('a'.repeat(32),new Uint8Array(8),'image/png','item',()=>{});
 read.success({files:['nikkisync-icon-1-1.png','nikkisync-gallery-1.jpg','my-photo.png','../nikkisync-icon-1-1.png',write.filePath.split('/').at(-1)]});
 assert.deepEqual(removed,['/cache/nikkisync-icon-1-1.png']);write.success();assert.equal(cache.stats().entries,1);
});
test('PC converted icon cache does not alias Buffer memory wiped after a transport response',async()=>{
 const {WeChatIconProvider}=await import('../../apps/pc-companion/dist/src/wechat/WeChatIconProvider.js');const dir=await mkdtemp(join(tmpdir(),'nikki-icon-alias-')),path=join(dir,'icon.img'),raw=Buffer.from([1,2,3,4]),png=Buffer.from(clientApi('synthetic-image').imageBytes());await writeFile(path,raw);let reads=0,resizes=0;
 try{const provider=new WeChatIconProvider({get:async()=>{reads++;return {path,sha256:createHash('sha256').update(raw).digest('hex')};}},async()=>{resizes++;return Buffer.from(png);});
  const descriptor={candidates:[{url:'https://images.example.test/a',kind:'item'}],versionKey:'v1'},first=await provider.get(descriptor);first.image.fill(0);const again=await provider.get(descriptor);assert.deepEqual(Buffer.from(again.image),png);again.image.fill(0);assert.deepEqual(Buffer.from((await provider.get(descriptor)).image),png);assert.equal(reads,1);assert.equal(resizes,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('PC icon deadline returns a recoverable failure instead of exhausting the gallery channel timeout',async()=>{
 const {WeChatIconProvider}=await import('../../apps/pc-companion/dist/src/wechat/WeChatIconProvider.js');
 const provider=new WeChatIconProvider({get:()=>new Promise(()=>{})},async()=>new Uint8Array(),20),descriptor={candidates:[{url:'https://images.example.test/slow',kind:'item'}],versionKey:'v1'};
 const result=await Promise.race([provider.get(descriptor).then(()=>false,()=>true),new Promise(r=>setTimeout(()=>r('slow'),100))]);assert.equal(result,true);
});
test('PC converted icons coalesce simultaneous loads and keep independent caller buffers',async()=>{
 const {WeChatIconProvider}=await import('../../apps/pc-companion/dist/src/wechat/WeChatIconProvider.js');const dir=await mkdtemp(join(tmpdir(),'nikki-icon-inflight-')),path=join(dir,'icon.img'),raw=Buffer.from([1,2,3,4]),png=Buffer.from(clientApi('synthetic-image').imageBytes());await writeFile(path,raw);const releases=[];let reads=0,resizes=0;
 try{const provider=new WeChatIconProvider({get:()=>{reads++;return new Promise(r=>releases.push(()=>r({path,sha256:createHash('sha256').update(raw).digest('hex')})));}},async()=>{resizes++;return Buffer.from(png);});const descriptor={candidates:[{url:'https://images.example.test/a',kind:'item'}],versionKey:'v1'},one=provider.get(descriptor),two=provider.get(descriptor);releases.forEach(r=>r());const values=await Promise.all([one,two]);assert.equal(reads,1);assert.equal(resizes,1);values[0].image.fill(0);assert.deepEqual(Buffer.from(values[1].image),png);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('PC derived icon LRU enforces both 128 entry and 16 MiB byte limits',async()=>{
 const {WeChatIconProvider}=await import('../../apps/pc-companion/dist/src/wechat/WeChatIconProvider.js'),dir=await mkdtemp(join(tmpdir(),'nikki-icon-lru-')),path=join(dir,'icon.img'),raw=Buffer.from([1,2,3,4]);await writeFile(path,raw);
 try{for(const [size,count] of [[8,128],[262144,64]]){let reads=0;const png=Buffer.alloc(size);png.set([137,80,78,71,13,10,26,10]);const provider=new WeChatIconProvider({get:async()=>{reads++;return {path,sha256:createHash('sha256').update(raw).digest('hex')};}},async()=>Buffer.from(png));const descriptor=n=>({candidates:[{url:'https://images.example.test/'+n,kind:'item'}],versionKey:'v1'});
  for(let n=0;n<=count;n++)(await provider.get(descriptor(n))).image.fill(0);assert.equal(reads,count+1);(await provider.get(descriptor(count))).image.fill(0);assert.equal(reads,count+1);(await provider.get(descriptor(0))).image.fill(0);assert.equal(reads,count+2);
 }}finally{await rm(dir,{recursive:true,force:true});}
});

test('late converted bytes after deadline are wiped and negative cache suppresses retry storms',async()=>{
 const {WeChatIconProvider}=await import('../../apps/pc-companion/dist/src/wechat/WeChatIconProvider.js'),dir=await mkdtemp(join(tmpdir(),'nikki-icon-late-')),path=join(dir,'icon.img'),raw=Buffer.from([1,2,3,4]);await writeFile(path,raw);let release,reads=0;
 try{const provider=new WeChatIconProvider({get:async()=>{reads++;return {path,sha256:createHash('sha256').update(raw).digest('hex')};}},()=>new Promise(r=>release=r),20),descriptor={candidates:[{url:'https://images.example.test/a',kind:'item'}],versionKey:'v1'};await assert.rejects(()=>provider.get(descriptor));const late=Uint8Array.from(clientApi('synthetic-image').imageBytes());release(late);await new Promise(r=>setImmediate(r));assert.ok(late.every(x=>x===0));await assert.rejects(()=>provider.get(descriptor));assert.equal(reads,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('unavailable icon is recoverable and does not disconnect the authenticated gallery',async()=>{
 const id='a'.repeat(32),key='b'.repeat(32),config={type:'NikkiSyncLocalGalleryDownload',version:1,host:'192.168.1.2',port:32001,key:randomBytes(32).toString('hex'),sessionId:randomBytes(16).toString('hex'),expiresAt:new Date(Date.now()+600000).toISOString()};
 const {server,stop}=createGalleryServer(config,{outfit:()=>({offset:0,total:1,items:[{key,name:'星光裙',hasIcon:true}],next:null}),icon:async()=>{throw new Error('Private URL must not be disclosed');}});await new Promise(r=>server.listen(0,'127.0.0.1',r));let c;
 try{c=await new Promise((r,j)=>{const channel=clientApi('gallery-channel').connectGallery(adapter(server),config,{ready:()=>r(channel),failed:j});});const icon=await new Promise(r=>c.icon(id,key,r));assert.notEqual(icon.status,'ok');assert.doesNotMatch(JSON.stringify(icon),/Private/);const outfit=await new Promise(r=>c.outfit(id,0,r));assert.equal(outfit.status,'ok');assert.equal(outfit.items[0].name,'星光裙');
 }finally{c?.close();await stop();}
});
