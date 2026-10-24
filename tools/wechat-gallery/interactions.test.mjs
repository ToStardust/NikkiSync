import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const root=new URL('../../apps/wechat-mini-program/miniprogram/',import.meta.url);
const id=n=>n.toString(16).padStart(32,'0');
const original=()=>({status:'ok',original:true,image:new Uint8Array([255,216,255,217,10,20]),mime:'image/jpeg',sha256:'a'.repeat(64)});
async function saveApi(){const module={exports:{}};runInNewContext(await readFile(new URL('lib/original-save.js',root),'utf8'),{module,Date,Uint8Array});return module.exports;}
async function fixture(){
 let page,download,write,album,authorize,closed=0;const requests=[],removed=[];
 const wx={env:{USER_DATA_PATH:'/cache'},authorize:o=>authorize=o,saveImageToPhotosAlbum:o=>album=o,
  getFileSystemManager:()=>({writeFile:o=>write=o,unlink:o=>removed.push(o.filePath)})};
 const api=await saveApi();
 runInNewContext(await readFile(new URL('pages/local-gallery/index.js',root),'utf8'),{Page:p=>page=p,Date,Uint8Array,wx,require:p=>p.includes('original-save')?api:{}});
 page.setData=(value,done)=>{Object.assign(page.data,value);done?.();};page.onLoad();page.onShow();
 page.setData({connected:true,downloadEnabled:true,total:2,pageStart:1,photos:[1,2].map(n=>({id:id(n),path:'/cache/preview-'+n,date:'2026-10-04'}))});
 page._channel={original:(key,done)=>{requests.push(key);download=done;},close:()=>closed++};
 page.openPhoto({currentTarget:{dataset:{index:0}}});
 return {page,wx,requests,removed,get download(){return download;},get write(){return write;},get album(){return album;},get authorize(){return authorize;},get closed(){return closed;}};
}
function event(p,x,y,type='touchend',extra={}){return {type,currentTarget:{dataset:{frame:p.data.viewerFrames[0].key,image:true}},touches:[{clientX:x,clientY:y}],changedTouches:[{clientX:x,clientY:y}],...extra};}
function swipe(p,x,y,options={}){
 p.viewerTouchStart(event(p,100,100,'touchstart',options));p.viewerTouchMove(event(p,x,y,'touchmove'));p.viewerTouchEnd(event(p,x,y,options.cancel?'touchcancel':'touchend'));
}
function sheetSwipe(p,x,y,options={}){
 p.infoTouchStart(event(p,100,100,'touchstart',options));p.infoTouchMove(event(p,x,y,'touchmove'));p.infoTouchEnd(event(p,x,y,options.cancel?'touchcancel':'touchend'));
}

test('photo-body downward gesture closes only viewer and keeps connection and cross-page selection',async()=>{
 const f=await fixture(),p=f.page;p.toggleViewedSelection();swipe(p,108,210);
 assert.equal(p.data.viewerOpen,false);assert.equal(p.data.connected,true);assert.equal(f.closed,0);assert.equal(p.data.selectedCount,1);
 assert.equal(p._activeViewerFrame,0);assert.equal(f.requests.length,0);
});
test('downward dismissal rejects zoomed pan, pinch, short/diagonal/cancelled gestures and active work',async()=>{
 const {page:p}=await fixture();
 swipe(p,110,160);assert.equal(p.data.viewerOpen,true);
 swipe(p,220,210);assert.equal(p.data.viewerOpen,true);
 swipe(p,110,210,{cancel:true});assert.equal(p.data.viewerOpen,true);
 swipe(p,110,210,{touches:[{clientX:100,clientY:100},{clientX:120,clientY:100}]});assert.equal(p.data.viewerOpen,true);
 p._nativeScale=2;swipe(p,110,210);assert.equal(p.data.viewerOpen,true);p._nativeScale=1;
 for(const key of ['saving','busy','infoLoading','infoOpen']){p.data[key]=true;swipe(p,110,210);assert.equal(p.data.viewerOpen,true,key);p.data[key]=false;}
});
test('info handle expands then collapses then dismisses; outside tap closes only info, not viewer chrome',async()=>{
 const {page:p}=await fixture();p.data.infoOpen=true;assert.equal(p.data.infoExpanded,false);
 sheetSwipe(p,105,35);assert.equal(p.data.infoExpanded,true);assert.equal(p.data.infoOpen,true);
 sheetSwipe(p,105,170);assert.equal(p.data.infoExpanded,false);assert.equal(p.data.infoOpen,true);
 sheetSwipe(p,105,170);assert.equal(p.data.infoOpen,false);assert.equal(p.data.viewerOpen,true);
 p.data.infoOpen=true;p.toggleViewerChrome();assert.equal(p.data.infoOpen,false);assert.equal(p.data.viewerChrome,true);assert.equal(p.data.viewerOpen,true);
});
test('info handle ignores stale photo, multitouch and cancel; no sheet gesture changes native zoom',async()=>{
 const {page:p}=await fixture();p.data.infoOpen=true;const stale=event(p,100,10);p.closeInfo();p.nextPhoto();p.data.infoOpen=true;
 p.infoTouchStart(stale);p.infoTouchEnd(stale);assert.equal(p.data.infoExpanded,false);
 sheetSwipe(p,100,30,{touches:[{clientX:100,clientY:100},{clientX:120,clientY:100}]});assert.equal(p.data.infoExpanded,false);
 sheetSwipe(p,100,30,{cancel:true});assert.equal(p.data.infoExpanded,false);assert.equal(p._nativeScale,1);
 p.onHide();p.infoTouchStart(stale);p.infoTouchEnd(stale);assert.equal(p.data.infoOpen,false);
});
test('batch stop during download finishes current actual save once, skips queue and keeps channel reusable',async()=>{
 const api=await saveApi();let download,write,album,result;const requests=[],removed=[];let closed=0;
 const wx={env:{USER_DATA_PATH:'/cache'},authorize:o=>o.success(),saveImageToPhotosAlbum:o=>album=o,getFileSystemManager:()=>({writeFile:o=>write=o,unlink:o=>removed.push(o.filePath)})};
 const channel={original:(key,done)=>{requests.push(key);download=done;},close:()=>closed++};
 const job=api.saveOriginalBatch(wx,channel,[id(1),id(2)],{complete:x=>result=x});
 job.stopAfterCurrent();job.stopAfterCurrent();assert.equal(result,undefined);assert.equal(closed,0);
 download(original());write.success();assert.equal(result,undefined);album.success();
 assert.equal(result.cancelled,true);assert.deepEqual(Array.from(result.results,x=>[x.id,x.status]),[[id(1),'saved']]);assert.equal(requests.length,1);assert.equal(removed.length,1);
 job.stopAfterCurrent();assert.equal(closed,0);
 api.saveOriginalBatch(wx,channel,[id(2)],{});assert.equal(requests.length,2);
});
test('batch stop during write or native save retains input until actual callback, records success and cleans file',async()=>{
 const api=await saveApi();
 for(const phase of ['write','save']){
  let download,write,album,result,requests=0;const removed=[];
  const wx={env:{USER_DATA_PATH:'/cache'},authorize:o=>o.success(),saveImageToPhotosAlbum:o=>album=o,getFileSystemManager:()=>({writeFile:o=>write=o,unlink:o=>removed.push(o.filePath)})};
  const job=api.saveOriginalBatch(wx,{original:(_key,done)=>{requests++;download=done;},close(){assert.fail('stop must not close transport');}},[id(1),id(2)],{complete:x=>result=x});
  download(original());if(phase==='save')write.success();job.stopAfterCurrent();assert.equal(removed.length,0);assert.equal(result,undefined);
  if(phase==='write')write.success();album.success();assert.equal(result.results[0].status,'saved');assert.equal(result.cancelled,true);assert.equal(requests,1);assert.equal(removed.length,1);
 }
});
test('batch stop while permission is pending makes no request; failure of current item still stops queue',async()=>{
 const api=await saveApi();let authorize,download,result,requests=0;
 const wx={authorize:o=>authorize=o,saveImageToPhotosAlbum(){},getFileSystemManager:()=>({unlink(){}})};
 const channel={original:(_key,done)=>{requests++;download=done;},close(){assert.fail();}};
 let job=api.saveOriginalBatch(wx,channel,[id(1),id(2)],{complete:x=>result=x});job.stopAfterCurrent();authorize.success();assert.equal(requests,0);assert.equal(result.cancelled,true);
 result=undefined;job=api.saveOriginalBatch(wx,channel,[id(1),id(2)],{complete:x=>result=x});authorize.success();job.stopAfterCurrent();download({status:'failed'});
 assert.equal(requests,1);assert.equal(result.results[0].status,'failed');assert.equal(result.cancelled,true);
});
test('page stops after actual current save, retries only unsaved ids and clears retry state on background',async()=>{
 const f=await fixture(),p=f.page;p.toggleViewedSelection();p.nextPhoto();p.toggleViewedSelection();p.saveSelected();f.authorize.success();
 p.stopSaving();assert.equal(p.data.saving,true);assert.equal(p.data.saveStopping,true);assert.equal(f.closed,0);
 f.download(original());f.write.success();f.album.success();assert.equal(p.data.saving,false);assert.equal(p.data.saveStopping,false);
 assert.equal(p.data.retryCount,1);assert.equal(p.data.selectedCount,1);assert.equal(p._saved.get(id(1)),'saved');
 p.retryUnfinished();f.authorize.success();assert.deepEqual(f.requests,[id(1),id(2)]);
 f.download(original());f.write.success();f.album.success();assert.equal(p.data.retryCount,0);assert.equal(p.data.selectedCount,0);
 p.retryUnfinished();assert.equal(f.requests.length,2);p.onHide();assert.equal(p.data.retryCount,0);
});
test('permission-denied retry never saves before explicit retry; unavailable channel cannot claim retry success',async()=>{
 const f=await fixture(),p=f.page;p.saveViewed();f.authorize.fail();assert.equal(p.data.retryCount,1);assert.equal(f.requests.length,0);assert.equal(p.data.permissionDenied,true);
 p.data.connected=false;p.retryUnfinished();assert.equal(f.requests.length,0);assert.equal(p.data.retryCount,1);
 p.onUnload();assert.equal(p._retryIds.length,0);
});
test('markup keeps one popup, isolates info handle from scroll and exposes stop/retry without scale feedback',async()=>{
 const markup=await readFile(new URL('pages/local-gallery/index.wxml',root),'utf8');
 assert.equal((markup.match(/<page-container\b/g)||[]).length,1);
 assert.match(markup,/class="info-backdrop"[^>]*catchtap="closeInfo"/);
 assert.match(markup,/class="info-handle-zone"[^>]*catchtouchstart="{{motion.sheetStart}}"/);
 assert.doesNotMatch(markup,/<scroll-view[^>]*touch(?:start|move|end)="info/);
 assert.match(markup,/bindtap="stopSaving"/);assert.match(markup,/bindtap="retryUnfinished"/);
 assert.match(markup,/scale-value="{{item.initialScale}}"/);
});
