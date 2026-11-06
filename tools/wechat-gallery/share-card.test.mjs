import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const m={exports:{}};
runInNewContext(readFileSync(new URL('../../apps/wechat-mini-program/miniprogram/lib/share-card.js',import.meta.url),'utf8'),{module:m,Uint8Array,Date,Promise,setTimeout,clearTimeout});
const {buildPayload,layoutCards,createShareCardJob,saveShareCard}=m.exports;
const id='a'.repeat(32);
const ctx={font:'',measureText:s=>({width:Array.from(s).length*24}),fillRect(){},fillText(){},drawImage(){},save(){},restore(){},translate(){},rotate(){},beginPath(){},moveTo(){},lineTo(){},quadraticCurveTo(){},closePath(){},fill(){},stroke(){},arc(){}};
test('explicit local profile text is drawn on the card without sending profile fields to the PC',async()=>{
 const f=api(),drawn=[],requests=[];f.canvas.getContext=()=>({...ctx,fillText:text=>drawn.push(text)});
 const channel={metadata:(...args)=>{requests.push(args.slice(0,-1));args.at(-1)({status:'ok',rows:[]});},outfit:(...args)=>{requests.push(args.slice(0,-1));args.at(-1)({status:'ok',offset:0,total:0,next:null,items:[]});}};
 const branding={title:'暖暖的大喵相机',footer:'UID：123456789 MomoCamera'},job=createShareCardJob(f.wx,{channel,id,canvas:f.canvas,originalPath:'/cache/own.jpg',branding});
 await new Promise(r=>setImmediate(r));f.exported.success({tempFilePath:'/cache/card.png'});const value=await job.result;
 assert.equal(JSON.stringify(value.payload.branding),JSON.stringify(branding));assert.ok(drawn.includes(branding.title));assert.ok(drawn.includes(branding.footer));assert.doesNotMatch(JSON.stringify(requests),/123456789|暖暖/);job.dispose();
});
test('share payload contains only presentation fields; missing/zero values and complete long outfits survive pagination',()=>{
 const payload=buildPayload({date:'2026-10-06',rows:[{label:'曝光',value:'0'},{label:'滤镜',value:'晴日'},{label:'UID',value:'PRIVATE'}],outfits:Array.from({length:100},(_,n)=>({name:'服装'+n+'长名字'.repeat(20),key:'PRIVATE'}))});
 assert.doesNotMatch(JSON.stringify(payload),/PRIVATE|UID|key/);assert.equal(payload.camera[0].value,'0');
 const cards=layoutCards(ctx,payload);assert.ok(cards.length>1);assert.ok(cards.every(p=>p.height<=4096));
 assert.equal(cards.flatMap(p=>p.outfit).length,100);assert.ok(cards.every(p=>p.parameters.filter(r=>r.label==='滤镜').length===1));
 assert.equal(layoutCards(ctx,buildPayload({rows:[],outfits:[]})).length,1);
});
function api(){let exportCallback,album;const deleted=[],written=[];
 const canvas={getContext:()=>ctx,createImage:()=>{const image={width:320,height:180};Object.defineProperty(image,'src',{set(){queueMicrotask(()=>image.onload());}});return image;}};
 const wx={env:{USER_DATA_PATH:'/cache'},getFileSystemManager:()=>({writeFile:o=>{written.push(o);o.success();},unlink:o=>deleted.push(o.filePath)}),
  canvasToTempFilePath:o=>exportCallback=o,authorize:o=>o.success(),saveImageToPhotosAlbum:o=>album=o};
 return {wx,canvas,deleted,written,get exported(){return exportCallback;},get album(){return album;}};
}
test('share background draws the verified full-resolution image, not a tiny intermediate canvas',async()=>{
 const f=api(),draws=[],image={width:3840,height:2160};
 Object.defineProperty(image,'src',{set(){queueMicrotask(()=>image.onload());}});
 f.canvas.createImage=()=>image;f.canvas.getContext=()=>({...ctx,drawImage:(...args)=>draws.push(args)});
 f.wx.createOffscreenCanvas=()=>({width:360,height:203,getContext:()=>({...ctx,drawImage(){}})});
 const channel={metadata:(_,done)=>done({status:'ok',rows:[]}),outfit:(_,offset,done)=>done({status:'ok',offset,total:0,next:null,items:[]})};
 const job=createShareCardJob(f.wx,{channel,id,canvas:f.canvas,originalPath:'/cache/original.jpg'});
 await new Promise(r=>setImmediate(r));assert.equal(draws[0][0],image,'background uses decoded original');
 assert.equal(f.exported.destWidth,1440);assert.ok(f.exported.destHeight>=1740);
 f.exported.success({tempFilePath:'/cache/card.png'});await job.result;job.dispose();
});
test('job serially collects every outfit page and verified original, wipes subarray bytes and waits for PNG export',async()=>{
 const f=api(),requests=[],bytes=new Uint8Array([9,255,216,255,217,8]);
 const channel={metadata:(_id,done)=>{requests.push('metadata');done({status:'ok',rows:[{label:'焦距',value:'35'}]});},outfit:(_id,offset,done)=>{requests.push(offset);done({status:'ok',offset,total:7,next:offset===0?6:null,items:Array.from({length:offset===0?6:1},(_,n)=>({name:'裙'+(n+offset)}))});},original:(_id,done)=>{requests.push('original');done({status:'ok',original:true,mime:'image/jpeg',image:bytes.subarray(1,5),sha256:'b'.repeat(64)});}};
 const job=createShareCardJob(f.wx,{channel,id,canvas:f.canvas,date:'2026-10-06'});
 await new Promise(r=>setImmediate(r));assert.deepEqual(requests,['metadata',0,6,'original']);
 assert.deepEqual(Array.from(bytes),[9,0,0,0,0,8]);assert.equal(f.written[0].data.byteLength,4);
 assert.equal(f.exported.fileType,'png');f.exported.success({tempFilePath:'/cache/card.png'});
 const result=await job.result;assert.equal(result.paths.length,1);assert.equal(result.payload.outfit.length,7);
 job.dispose();assert.ok(f.deleted.includes('/cache/card.png'));
});
test('late canvas callback after cancellation is cleaned and never becomes a preview',async()=>{
 const f=api(),channel={metadata:(_,done)=>done({status:'ok',rows:[]}),outfit:(_,offset,done)=>done({status:'ok',offset,total:0,next:null,items:[]})};
 const job=createShareCardJob(f.wx,{channel,id,canvas:f.canvas,originalPath:'/cache/existing.jpg'});
 const settled=job.result.catch(e=>e.message);await new Promise(r=>setImmediate(r));job.cancel();
 f.exported.success({tempFilePath:'/cache/late.png'});assert.match(await settled,/取消/);assert.ok(f.deleted.includes('/cache/late.png'));assert.ok(!f.deleted.includes('/cache/existing.jpg'));
});
test('save reports success only after album callback and preserves file for retry on permission denial',async()=>{
 const f=api();let saved=false;const result=saveShareCard(f.wx,'/cache/card.png').then(()=>saved=true);
 await new Promise(r=>setImmediate(r));assert.equal(saved,false);f.album.success();await result;assert.equal(saved,true);
 assert.equal(f.deleted.length,0);
 f.wx.authorize=o=>o.fail({errMsg:'auth deny'});await assert.rejects(saveShareCard(f.wx,'/cache/card.png'),/权限/);
});
test('combined save writes the unmodified original and retries only the share image after a partial failure',async()=>{
 const f=api(),saved=[],requests=[];let page,album;
 const original={exports:{}};
 runInNewContext(readFileSync(new URL('../../apps/wechat-mini-program/miniprogram/lib/original-save.js',import.meta.url),'utf8'),{module:original,Uint8Array,Date,Set});
 f.wx.saveImageToPhotosAlbum=o=>{saved.push(o.filePath);album=o;};
 runInNewContext(readFileSync(new URL('../../apps/wechat-mini-program/miniprogram/pages/local-gallery/index.js',import.meta.url),'utf8'),{Page:p=>page=p,require:name=>name.includes('share-card')?m.exports:name.includes('original-save')?original.exports:{},wx:f.wx,Date,Uint8Array,Promise,setTimeout,clearTimeout});
 page.setData=x=>Object.assign(page.data,x);page._alive=true;page._active=true;page._shareEpoch=1;
 Object.assign(page.data,{shareOpen:true,sharePath:'/cache/card.png',selectedId:id,connected:true,downloadEnabled:true,viewerRotation:90,writeExif:true});
 page._channel={export(){assert.fail('original must not be rotated or rewritten');},original:(key,done)=>{requests.push(key);done({status:'ok',image:new Uint8Array([255,216,255,217]),original:true,mime:'image/jpeg',sha256:'c'.repeat(64)});}};
 const first=page.saveOriginalAndShareCard();assert.match(saved[0],/nikkisync-original-/);assert.equal(saved.length,1);album.success();
 await new Promise(r=>setImmediate(r));assert.equal(saved[1],'/cache/card.png');album.fail();await first;
 assert.match(page.data.shareMessage,/原图已保存/);assert.equal(page.data.shareSaving,false);
 const retry=page.saveOriginalAndShareCard();assert.equal(saved[2],'/cache/card.png');album.success();await retry;
 assert.deepEqual(requests,[id]);assert.match(page.data.shareMessage,/原图和这张分享图已保存/);
});
test('page offers both entries, previews the PNG and closing viewer cancels ownership; stale selector cannot reopen it',async()=>{
 const f=api();let page,selected;
 f.wx.createSelectorQuery=()=>({in(){return this;},select(){return this;},fields(){return this;},exec(done){selected=done;}});
 runInNewContext(readFileSync(new URL('../../apps/wechat-mini-program/miniprogram/pages/local-gallery/index.js',import.meta.url),'utf8'),{Page:p=>page=p,require:name=>name.includes('share-card')?m.exports:{},wx:f.wx,Date,Uint8Array,Promise,setTimeout,clearTimeout});
 page.setData=(value,done)=>{Object.assign(page.data,value);done?.();};page.onLoad();page.onShow();
 page.setData({selectedId:id,selectedDate:'2026-10-06',viewerOpen:true,connected:true,downloadEnabled:true,viewerOriginalPath:'/cache/existing.jpg'});
 page._channel={metadata:(_,done)=>done({status:'ok',rows:[]}),outfit:(_,offset,done)=>done({status:'ok',offset,total:0,items:[],next:null}),close(){}};
 page.generateShareCard();assert.equal(page.data.shareBusy,true);selected([{node:f.canvas}]);
 await new Promise(r=>setImmediate(r));f.exported.success({tempFilePath:'/cache/card.png'});await new Promise(r=>setImmediate(r));
 assert.equal(page.data.shareOpen,true);assert.equal(page.data.sharePath,'/cache/card.png');assert.equal(page.data.saving,false);
 page.closePhoto();assert.equal(page.data.shareOpen,false);assert.ok(f.deleted.includes('/cache/card.png'));
 page.setData({viewerOpen:true});page.generateShareCard();const late=selected;page.onHide();late([{node:f.canvas}]);assert.equal(page.data.shareOpen,false);
 const xml=readFileSync(new URL('../../apps/wechat-mini-program/miniprogram/pages/local-gallery/index.wxml',import.meta.url),'utf8');assert.equal((xml.match(/bindtap="generateShareCard"/g)||[]).length,3);
});
test('disposing during native save pins only the output until album completes',async()=>{
 const f=api(),channel={metadata:(_,done)=>done({status:'ok',rows:[]}),outfit:(_,offset,done)=>done({status:'ok',offset,total:0,next:null,items:[]})};
 const job=createShareCardJob(f.wx,{channel,id,canvas:f.canvas,originalPath:'/cache/existing.jpg'});
 await new Promise(r=>setImmediate(r));f.exported.success({tempFilePath:'/cache/held.png'});await job.result;
 job.pin('/cache/held.png');const save=saveShareCard(f.wx,'/cache/held.png');job.dispose();assert.ok(!f.deleted.includes('/cache/held.png'));
 f.album.success();await save;job.unpin('/cache/held.png');assert.ok(f.deleted.includes('/cache/held.png'));
});
test('cancelling an in-flight channel request closes it before another page operation can reuse it',async()=>{
 const f=api();let closed=false,reply;
 const job=createShareCardJob(f.wx,{channel:{metadata:(_,done)=>reply=done,close:()=>closed=true},id,canvas:f.canvas});
 const result=job.result.catch(e=>e.message);await new Promise(r=>setImmediate(r));assert.equal(job.cancel(),true);assert.equal(closed,true);reply({status:'ok',rows:[]});assert.match(await result,/取消/);
});
test('outfits use two icon columns with captions only for parsed names; parameter values retain their real units',()=>{
 const p=buildPayload({rows:[{label:'焦距',value:'29.4'},{label:'光圈',value:'1.2'},{label:'亮度',value:'55.8'},{label:'饱和度',value:'-0.55'}],outfits:[{name:'名称待解析'},{name:'服装 102000001'},{name:'浮金星点'}]});
 assert.equal(p.outfit[0].value,'');assert.equal(p.outfit[1].value,'');assert.equal(p.outfit[2].value,'浮金星点');
 const card=layoutCards(ctx,p)[0];assert.equal(card.outfit[0].column,0);assert.equal(card.outfit[1].column,1);assert.equal(card.outfit[2].row,1);
 assert.equal(card.parameters.find(x=>x.label==='焦距').displayValue,'29.4mm');
 assert.equal(card.parameters.find(x=>x.label==='光圈').displayValue,'f/1.2');
 assert.equal(card.parameters.find(x=>x.label==='亮度').displayValue,'55.8%');
 assert.equal(card.parameters.find(x=>x.label==='饱和度').displayValue,'-0.55');
});
test('share generation reuses cached icons, serially fetches missing ones and degrades failed icons without inventing names',async()=>{
 const f=api(),key='c'.repeat(32),requests=[],png=new Uint8Array([137,80,78,71,13,10,26,10]);
 const channel={metadata:(_,done)=>done({status:'ok',rows:[]}),outfit:(_,offset,done)=>done({status:'ok',offset,total:3,next:null,items:[{key,name:'名称待解析',hasIcon:true},{key:'d'.repeat(32),name:'星点',hasIcon:true},{key:'e'.repeat(32),name:'未命名',hasIcon:true}]}),icon:(_,k,done)=>{requests.push(k);done(k==='d'.repeat(32)?{status:'ok',icon:true,mime:'image/png',source:'item',image:png}:{status:'failed'});}};
 const job=createShareCardJob(f.wx,{channel,id,canvas:f.canvas,originalPath:'/cache/existing.jpg',iconCache:{get:k=>k===key?{path:'/cache/borrowed.png',source:'category'}:null}});
 await new Promise(r=>setImmediate(r));assert.deepEqual(requests,['d'.repeat(32),'e'.repeat(32)]);assert.equal(png.every(x=>x===0),true);
 f.exported.success({tempFilePath:'/cache/grid.png'});const value=await job.result;assert.equal(value.missingIcons,1);assert.equal(value.payload.outfit[0].value,'');
 job.dispose();assert.ok(f.deleted.some(x=>/nikkisync-share-icon-/.test(x)));assert.ok(!f.deleted.includes('/cache/borrowed.png'));
});
