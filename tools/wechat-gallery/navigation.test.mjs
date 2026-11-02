import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const root=new URL('../../apps/wechat-mini-program/miniprogram/pages/local-gallery/',import.meta.url);
const id=n=>n.toString(16).padStart(32,'0');
const tile=n=>({id:id(n),path:'/cache/'+n+'.jpg',date:'2026-10-03',selected:false});
const tap=n=>({currentTarget:{dataset:{index:n}}});
const frameEvent=(p,extra)=>({...extra,currentTarget:{dataset:{frame:p.data.viewerFrames[0].key,image:true}}});
async function pageFixture(){
 let page,saved,original,write,refresh,timer;const removed=[];
 const wx={env:{USER_DATA_PATH:'/cache'},stopPullDownRefresh(){},getFileSystemManager:()=>({writeFile:o=>write=o,unlink:o=>removed.push(o.filePath)})};
 runInNewContext(await readFile(new URL('index.js',root),'utf8'),{Page:p=>page=p,Date,Uint8Array,wx,
  setTimeout:f=>{timer=f;return 1;},clearTimeout:()=>{timer=null;},require:()=>({saveOriginalBatch:(_w,_c,ids,h)=>{saved={ids:Array.from(ids),hooks:h};return {cancel(){}};}})});
 page.setData=(x,done)=>{Object.assign(page.data,x);done?.();};page.onLoad();page.onShow();
 page.setData({connected:true,downloadEnabled:true,total:25,photos:[tile(1),tile(2)],pageStart:1,pageEnd:2,next:12});
 page._channel={list:(offset,done)=>done({status:'ok',total:25,next:offset===0?12:24,offset,items:[{id:id(offset+1),date:''},{id:id(offset+2),date:''}]}),
  preview:(_id,done)=>done({status:'failed'}),original:(id,done)=>original={id,done},refresh:done=>refresh=done,close(){}};
 return {page,removed,get saved(){return saved;},get original(){return original;},get write(){return write;},get refresh(){return refresh;},get timer(){return timer;}};
}
test('cross-page selection is independent of preview cache, saves all pages and keeps failures selected',async()=>{
 const f=await pageFixture(),p=f.page;p.toggleSelection(tap(0));p.nextPage();
 assert.equal(p.data.pageStart,13);assert.equal(p.data.selectedCount,1);
 p.updatePhoto(0,{path:'/cache/13.jpg'});p.toggleSelection(tap(0));assert.equal(p.data.selectedCount,2);
 p.saveSelected();assert.deepEqual(f.saved.ids,[id(1),id(13)]);
 f.saved.hooks.complete({results:[{id:id(1),status:'saved'},{id:id(13),status:'failed'}]});
 assert.equal(p.data.selectedCount,1);p.firstPage();assert.equal(p.data.photos[0].saveState,'saved');assert.equal(p.data.photos[0].selected,false);
 p.cancelSelection();assert.equal(p.data.selectedCount,0);
});
test('horizontal swipe changes image only at base scale; pinch, pan, info and buttons do not navigate',async()=>{
 const {page:p}=await pageFixture();p.openPhoto(tap(0));
 const swipe=()=>{p.viewerTouchStart(frameEvent(p,{touches:[{clientX:200,clientY:80}]}));p.viewerTouchMove(frameEvent(p,{touches:[{clientX:50,clientY:85}]}));p.viewerTouchEnd(frameEvent(p,{changedTouches:[{clientX:50,clientY:85}]}));};
 swipe();assert.equal(p.data.selectedId,id(2));assert.equal(p.data.viewerOpen,true);
 p.viewerScaled(frameEvent(p,{detail:{scale:2}}));swipe();assert.equal(p.data.selectedId,id(2));
 p.viewerScaled(frameEvent(p,{detail:{scale:1}}));p.data.infoOpen=true;swipe();assert.equal(p.data.selectedId,id(2));
 p.data.infoOpen=false;p.viewerTouchStart(frameEvent(p,{touches:[{clientX:200,clientY:80},{clientX:240,clientY:80}]}));p.viewerTouchMove(frameEvent(p,{touches:[{clientX:50,clientY:85}]}));p.viewerTouchEnd(frameEvent(p,{changedTouches:[{clientX:50,clientY:85}]}));assert.equal(p.data.selectedId,id(2));
 p.previousPhoto();assert.equal(p.data.selectedId,id(1));
 p.nextPhoto();assert.equal(p.data.selectedId,id(2));
});
test('viewer crosses a page boundary without closing; selection survives and scale resets',async()=>{
 const {page:p}=await pageFixture();p.data.photos=Array.from({length:12},(_,i)=>tile(i+1));p.data.pageEnd=12;p.toggleSelection(tap(0));
 p._channel.preview=(_id,done)=>done({status:'ok',image:new Uint8Array([255,216,255,217])});
 p.openPhoto(tap(11));p.nextPhoto();assert.equal(p.data.viewerOpen,true);assert.equal(p.data.pageStart,13);assert.equal(p.data.selectedId,id(13));assert.equal(p.data.selectedCount,1);assert.equal(p._nativeScale,1);assert.equal(p.data.viewerFrames[0].initialScale,1);
});
test('zoom requests verified original without album writes; stale completion is wiped and temporary file removed',async()=>{
 const f=await pageFixture(),p=f.page;p.openPhoto(tap(0));p.viewerScaled(frameEvent(p,{detail:{scale:2}}));assert.equal(f.original.id,id(1));
 const complete=f.original.done;p.nextPhoto();const bytes=new Uint8Array([255,216,255,217]);complete({status:'ok',original:true,image:bytes,mime:'image/jpeg'});
 assert.equal(bytes.every(x=>x===0),true);assert.equal(f.write,undefined);assert.equal(p.data.selectedId,id(2));
 p.viewerScaled(frameEvent(p,{detail:{scale:2}}));f.original.done({status:'ok',original:true,image:new Uint8Array([255,216,255,217]),mime:'image/jpeg'});const write=f.write;
 assert.ok(write);write.success();assert.equal(p.data.selectedPath,write.filePath);assert.equal(p.data.viewerQuality,'original');assert.equal(f.saved,undefined);
 p.closePhoto();assert.ok(f.removed.includes(write.filePath));
});
test('refresh does not interrupt viewer/selection/save; manual and idle poll update same connection and clear timer on hide',async()=>{
 const f=await pageFixture(),p=f.page;
 p.data.viewerOpen=true;p.refreshPhotos();assert.equal(f.refresh,undefined);p.data.viewerOpen=false;
 p.toggleSelection(tap(0));p.refreshPhotos();assert.equal(f.refresh,undefined);p.cancelSelection();
 p.refreshPhotos();assert.equal(p.data.busy,true);f.refresh({status:'ok',total:26,items:[{id:id(26),date:''}],next:12,offset:0});
 assert.equal(p.data.total,26);assert.equal(p.data.photos[0].id,id(26));assert.equal(p.data.connected,true);
 p.scheduleRefresh();assert.equal(typeof f.timer,'function');f.timer();assert.equal(p.data.busy,true);
 p.onHide();assert.equal(f.timer,null);f.refresh({status:'ok',total:28,items:[],next:null,offset:0});assert.equal(p.data.connected,false);assert.equal(p.data.photos.length,0);
});
test('native markup wires swipe only on image area, retains preview while HD decodes and exposes cross-page actions',async()=>{
 const markup=await readFile(new URL('index.wxml',root),'utf8');
 assert.match(markup,/<movable-area[^>]*data-image="{{true}}"[^>]*bindtouchend="{{motion.photoEnd}}"/);
 assert.doesNotMatch(markup,/<view[^>]*class="viewer"[^>]*bindtouchstart/);
 assert.match(markup,/bindscale="{{motion.photoScale}}"/);assert.match(markup,/viewerPreviewPath/);assert.match(markup,/originalReady/);
 assert.match(markup,/bindload="originalLoaded"/);assert.match(markup,/bindtap="toggleViewedSelection"/);
 assert.doesNotMatch(markup,/disabled="{{[^}]*selectedCount[^}]*}}">(?:回到最新|下一页)/);
 const json=JSON.parse(await readFile(new URL('index.json',root),'utf8'));assert.equal(json.enablePullDownRefresh,true);
});
test('automatic refresh defers older pages and empty selection mode, stops after bounded polls; thumbnail cache is bounded',async()=>{
 const f=await pageFixture(),p=f.page;p.data.pageStart=13;p.refreshPhotos(true);assert.equal(f.refresh,undefined);
 p.data.pageStart=1;p.startSelection();p.refreshPhotos(true);assert.equal(f.refresh,undefined);p.cancelSelection();
 p._polls=18;p.scheduleRefresh();assert.equal(f.timer,null);
 for(let n=0;n<50;n++){p._previewCache.set(id(n+100),'/cache/'+n);p._files.add('/cache/'+n);}
 p.prunePreviews();assert.equal(p._previewCache.size,36);assert.equal(f.removed.length,14);
});
test('selection limit is 100 across pages and viewer can select without closing; stale HD native events are ignored',async()=>{
 const {page:p}=await pageFixture();for(let n=100;n<200;n++)p._selected.add(id(n));p.toggleSelection(tap(0));assert.equal(p._selected.size,100);
 p.cancelSelection();p.startSelection();p.openPhoto(tap(0));p.toggleViewedSelection();assert.equal(p.data.selectedCount,1);assert.equal(p.data.viewerOpen,true);assert.equal(p.data.viewerSelected,true);
 p._originalPath='/cache/current';p.data.viewerOriginalPath='/cache/current';p.originalLoaded({currentTarget:{dataset:{path:'/cache/stale'}}});assert.equal(p.data.originalReady,false);
 p.originalFailed({currentTarget:{dataset:{path:'/cache/stale'}}});assert.equal(p._originalPath,'/cache/current');
});
test('synchronous unavailable session on list/preview does not leave loading stuck or throw into native callbacks',async()=>{
 const {page:p}=await pageFixture();p._channel.list=()=>{throw new Error('expired');};
 assert.doesNotThrow(()=>p.loadPage(12));assert.equal(p.data.busy,false);assert.match(p.data.message,/重新|新码|浏览码/);
 p.data.connected=true;p._channel.list=(_o,done)=>done({status:'ok',total:1,next:null,items:[{id:id(1),date:''}]});p._channel.preview=()=>{throw new Error('exhausted');};
 assert.doesNotThrow(()=>p.loadPage(0));assert.equal(p.data.busy,false);
});
