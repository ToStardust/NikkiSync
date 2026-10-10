import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
test('app-style connection sheet stays inside gallery without closing transport/cache, and resets on background', async () => {
  let page, closed = 0, removed = 0;
  const root = new URL('../../apps/wechat-mini-program/miniprogram/pages/local-gallery/', import.meta.url);
  runInNewContext(await readFile(new URL('index.js', root), 'utf8'), {
    Date, Uint8Array, Page:p=>page=p, require:()=>({}), wx:{getFileSystemManager:()=>({unlink:()=>removed++})}
  });
  page.setData=(x,done)=>{Object.assign(page.data,x);if(done)done();}; page.onLoad(); page.onShow();
  page._channel={close:()=>closed++}; page._files.add('/cache/verified.jpg');
  page.setData({connected:true,photos:[{path:'/cache/verified.jpg',date:'2026-10-02'}]});
  assert.equal(page.data.connectionOpen,false);
  page.openConnection(); assert.equal(page.data.connectionOpen,true);
  page.closeConnection(); page.popupLeft(); assert.equal(page.data.connectionOpen,false);
  assert.equal(closed,0); assert.equal(removed,0); assert.equal(page.data.connected,true);
  page.openPhoto({currentTarget:{dataset:{index:0}}});
  page.openConnection(); assert.equal(page.data.connectionOpen,false,'do not stack sheet over viewer');
  page.closePhoto(); page.viewerLeft(); page.openConnection(); page.onHide();
  assert.equal(page.data.connectionOpen,false); assert.equal(closed,1); assert.equal(removed,1);
  const markup=await readFile(new URL('index.wxml',root),'utf8');
  assert.match(markup,/class="glass-dock glass-surface"/);
  assert.match(markup,/class="date-summary"/);
  assert.match(markup,/show="\{\{viewerOpen \|\| connectionOpen\}\}"/);
  assert.match(markup,/bindbeforeleave="popupLeaving"/);
  assert.doesNotMatch(markup,/<text>\{\{item.date\}\}<\/text>/,'dates belong in compact header, not every tile');
  assert.doesNotMatch(markup,/saveImageToPhotosAlbum/);
});
test('gallery pinch uses native movable-view; selection has no album write until explicit save and metadata waits for previews', async () => {
  let page, metadata;
  const root=new URL('../../apps/wechat-mini-program/miniprogram/pages/local-gallery/',import.meta.url);
  runInNewContext(await readFile(new URL('index.js',root),'utf8'),{Date,Uint8Array,Page:p=>page=p,require:()=>({}),wx:{getFileSystemManager:()=>({unlink(){}})}});
  page.setData=(x,done)=>{Object.assign(page.data,x);if(done)done();};page.onLoad();page.onShow();
  page.setData({connected:true,downloadEnabled:true,photos:[{id:'a'.repeat(32),path:'/cache/a.jpg',date:'2026-10-03',selected:false}]});
  page._channel={metadata:(_id,done)=>metadata=done};
  page.startSelection();page.toggleSelection({currentTarget:{dataset:{index:0}}});assert.equal(page.data.selectedCount,1);
  page.setData({next:12});page.nextPage();assert.equal(page.data.selectedCount,1,'paging must not silently discard selection');
  page.openPhoto({currentTarget:{dataset:{index:0}}});assert.equal(page.data.viewerOpen,true);assert.equal(page.data.viewerFrames[0].initialScale,1);
  page.setData({busy:true});page.showPhotoInfo();assert.equal(metadata,undefined);
  page.setData({busy:false});page.showPhotoInfo();metadata({status:'ok',availability:'available',rows:[{label:'焦距',value:'50'}]});
  assert.equal(page.data.infoRows[0].value,'50');
  page.cancelSelection();assert.equal(page.data.selectedCount,0);
  const markup=await readFile(new URL('index.wxml',root),'utf8');
  assert.match(markup,/<movable-area[^>]*scale-area/);assert.match(markup,/<movable-view[^>]*scale="{{true}}"/);
  assert.match(markup,/bindtap="saveSelected"/);assert.match(markup,/bindlongpress="longSelect"/);
});
test('pinch/drag completion does not become a tap toggling viewer chrome',async()=>{
  let page;
  const root=new URL('../../apps/wechat-mini-program/miniprogram/pages/local-gallery/',import.meta.url);
  runInNewContext(await readFile(new URL('index.js',root),'utf8'),{Date,Uint8Array,Page:p=>page=p,require:()=>({}),wx:{}});
  page.setData=(x,done)=>{Object.assign(page.data,x);if(done)done();};page.onLoad();page.onShow();page.setData({photos:[{id:'a'.repeat(32),path:'/cache/a'}]});page.openPhoto({currentTarget:{dataset:{index:0}}});
  const currentTarget={dataset:{frame:page.data.viewerFrames[0].key,image:true}};
  page.viewerTouchStart({currentTarget,touches:[{clientX:10,clientY:10},{clientX:40,clientY:40}]});
  page.viewerTouchMove({currentTarget,touches:[{clientX:20,clientY:20},{clientX:60,clientY:60}]});page.viewerTouchEnd({currentTarget});page.toggleViewerChrome();assert.equal(page.data.viewerChrome,true);
  page._viewerIgnoreTapUntil=0;page.toggleViewerChrome();assert.equal(page.data.viewerChrome,false);
});
test('page wires explicit selection to original-save and keeps failures selected for retry, never saving preview paths',async()=>{
  let page,write,album,authorize;const requests=[];
  const root=new URL('../../apps/wechat-mini-program/miniprogram/',import.meta.url),module={exports:{}};
  runInNewContext(await readFile(new URL('lib/original-save.js',root),'utf8'),{module,Date,Uint8Array});
  const wx={env:{USER_DATA_PATH:'/cache'},authorize:o=>authorize=o,saveImageToPhotosAlbum:o=>album=o,getFileSystemManager:()=>({writeFile:o=>write=o,unlink(){}})};
  runInNewContext(await readFile(new URL('pages/local-gallery/index.js',root),'utf8'),{Date,Uint8Array,Page:p=>page=p,wx,require:path=>path.includes('original-save')?module.exports:{}});
  page.setData=(x,done)=>{Object.assign(page.data,x);if(done)done();};page.onLoad();page.onShow();
  page.setData({connected:true,downloadEnabled:true,photos:[{id:'a'.repeat(32),path:'/cache/preview-a.jpg',selected:true},{id:'b'.repeat(32),path:'/cache/preview-b.jpg',selected:true}],selectedCount:2});
  page._channel={original:(id,done)=>{requests.push(id);if(requests.length===1)done({status:'ok',original:true,image:new Uint8Array([255,216,255,217]),mime:'image/jpeg',sha256:'a'.repeat(64)});else done({status:'failed'});},close(){}};
  page.saveSelected();assert.equal(page.data.saving,true);assert.equal(requests.length,0);authorize.success();
  assert.match(write.filePath,/nikkisync-original-/);assert.notEqual(write.filePath,page.data.photos[0].path);write.success();
  assert.equal(page.data.saving,true);album.success();assert.equal(page.data.saving,false);
  assert.equal(page.data.photos[0].saveState,'saved');assert.equal(page.data.photos[0].selected,false);
  assert.equal(page.data.photos[1].saveState,'failed');assert.equal(page.data.photos[1].selected,true);assert.equal(page.data.selectedCount,1);
});
test('gallery page waits for scanning foreground, previews only verified files and removes cache on unload without album writes', async () => {
  let page, scan, hooks, listed, previewed; const removed = []; let connections = 0, closed = 0, albums = 0, write;
  runInNewContext(await readFile(new URL('../../apps/wechat-mini-program/miniprogram/pages/local-gallery/index.js', import.meta.url),'utf8'), {
    Date, Uint8Array, Page:p=>page=p, require:()=>({parseGalleryQr:()=>({key:'secret'}),connectGallery:(_wx,_qr,h)=>{
      connections++;hooks=h;return {close:()=>closed++,list:(_o,done)=>listed=done,preview:(_id,done)=>previewed=done};}}),
    wx:{env:{USER_DATA_PATH:'/cache'},scanCode:o=>scan=o,saveImageToPhotosAlbum:()=>albums++,getFileSystemManager:()=>({writeFile:o=>write=o,unlink:o=>removed.push(o.filePath)})}
  });
  page.setData=(x,done)=>{Object.assign(page.data,x);if(done)done();};page.onLoad();page.onShow();page.scanPc();page.onHide();scan.success({result:'{}'});
  assert.equal(connections,0);page.onShow();assert.equal(connections,1);hooks.ready();
  listed({status:'ok',total:1,next:null,items:[{id:'a'.repeat(32),date:''}]});
  assert.equal(page.data.dateSummary,'日期未知'); assert.equal(page.data.pageStart,1); assert.equal(page.data.pageEnd,1);
  previewed({status:'ok',image:new Uint8Array([255,216,255,217])});
  assert.equal(page.data.photos[0].path,'');write.success();assert.equal(page.data.photos[0].path,write.filePath);assert.equal(JSON.stringify(page.data).includes('secret'),false);
  assert.equal(page.data.ambientPath,write.filePath); assert.equal(page.data.loaded,1);
  page.openPhoto({currentTarget:{dataset:{index:0}}});assert.equal(page.data.selectedPath,write.filePath);assert.equal(albums,0);
  page.closePhoto();page.onUnload();assert.deepEqual(removed,[write.filePath]);assert.ok(closed>0);assert.equal(albums,0);
});
test('compact date summary and photo atmosphere are derived locally from the current page only', async () => {
  let page, listed;
  const root = new URL('../../apps/wechat-mini-program/miniprogram/pages/local-gallery/', import.meta.url);
  runInNewContext(await readFile(new URL('index.js',root),'utf8'), {
    Date, Uint8Array, Page:p=>page=p, require:()=>({}), wx:{getFileSystemManager:()=>({unlink(){}})}
  });
  page.setData=(x,done)=>{Object.assign(page.data,x);if(done)done();}; page.onLoad(); page.onShow();
  page.setData({connected:true});
  page._channel={list:(_offset,done)=>listed=done,preview(){}};
  page.loadPage(12);
  listed({status:'ok',total:25,next:24,items:[{id:'a',date:'2026-10-02T12:00:00Z'},{id:'b',date:'2026-09-26T11:00:00Z'}]});
  assert.equal(page.data.dateSummary,'2026-10-02 · 2026-09-26');
  assert.equal(page.data.pageStart,13); assert.equal(page.data.pageEnd,14);
  page.updatePhoto(1,{path:'/cache/verified-b.jpg'});
  assert.equal(page.data.ambientPath,'/cache/verified-b.jpg'); assert.equal(page.data.loaded,1);
  page.updatePhoto(0,{path:'/cache/verified-a.jpg'});
  assert.equal(page.data.ambientPath,'/cache/verified-a.jpg');
  page.updatePhoto(0,{path:''}); assert.equal(page.data.ambientPath,'/cache/verified-b.jpg');
  page.setData({busy:false}); page.loadPage(24);
  assert.equal(page.data.ambientPath,''); assert.equal(page.data.loaded,0);
});
test('connection failure remains visible after page generation changes and late writes never reappear after exit', async () => {
  let page,hooks,listed,previewed,write;const removed=[];
  runInNewContext(await readFile(new URL('../../apps/wechat-mini-program/miniprogram/pages/local-gallery/index.js',import.meta.url),'utf8'), {
    Date,Uint8Array,Page:p=>page=p,require:()=>({connectGallery:(_w,_q,h)=>{hooks=h;return {close(){},list:(_o,d)=>listed=d,preview:(_i,d)=>previewed=d};}}),
    wx:{env:{USER_DATA_PATH:'/cache'},getFileSystemManager:()=>({writeFile:o=>write=o,unlink:o=>removed.push(o.filePath)})}
  });
  page.setData=(x,done)=>{Object.assign(page.data,x);if(done)done();};page.onLoad();page.onShow();page.connect({});hooks.ready();
  listed({status:'ok',total:1,next:null,items:[{id:'a'.repeat(32),date:''}]});previewed({status:'ok',image:new Uint8Array([255,216,255,217])});
  hooks.failed('closed');assert.equal(page.data.connected,false);assert.equal(page.data.busy,false);
  page.onUnload();write.success();assert.equal(page.data.photos.length,0);assert.equal(page.data.message,'closed');assert.deepEqual(removed,[write.filePath]);
});
test('preview single tap toggles chrome without closing or touching connection/cache; explicit and native back close it', async () => {
  let page, closed = 0, removed = 0;
  const root = new URL('../../apps/wechat-mini-program/miniprogram/pages/local-gallery/', import.meta.url);
  runInNewContext(await readFile(new URL('index.js', root), 'utf8'), {
    Date, Uint8Array, Page:p=>page=p, require:()=>({}), wx:{getFileSystemManager:()=>({unlink:()=>removed++})}
  });
  page.setData=(x,done)=>{Object.assign(page.data,x);if(done)done();}; page.onLoad(); page.onShow();
  page._channel={close:()=>closed++}; page._files.add('/cache/verified.jpg');
  page.setData({connected:true,photos:[{path:'/cache/verified.jpg'}]});
  page.openPhoto({currentTarget:{dataset:{index:0}}});
  assert.equal(page.data.viewerOpen,true); assert.equal(page.data.viewerChrome,true);
  page.toggleViewerChrome(); assert.equal(page.data.viewerChrome,false); assert.equal(page.data.selectedPath,'/cache/verified.jpg'); assert.equal(page.data.viewerOpen,true);
  page.toggleViewerChrome(); assert.equal(page.data.viewerChrome,true); assert.equal(closed,0); assert.equal(removed,0);
  page.closePhoto(); assert.equal(page.data.viewerOpen,false); page.viewerLeft(); assert.equal(page.data.selectedPath,''); assert.equal(page.data.connected,true);
  page.openPhoto({currentTarget:{dataset:{index:0}}}); page.viewerLeaving(); page.viewerLeft(); assert.equal(page.data.viewerOpen,false); assert.equal(page.data.selectedPath,'');
  const markup = await readFile(new URL('index.wxml',root),'utf8');
  assert.match(markup, /<page-container[^>]*show="\{\{viewerOpen \|\| connectionOpen\}\}"/);
  assert.match(markup,/bindbeforeleave="popupLeaving"/); assert.match(markup,/catchtap="dismissPhoto"/);
  assert.match(markup,/bindtap="toggleViewerChrome"/); assert.doesNotMatch(markup,/bindtap="closePhoto"/);
});
test('gallery registers exactly one native popup for connection and viewer, with explicit image dimensions', async () => {
  const root = new URL('../../apps/wechat-mini-program/miniprogram/pages/local-gallery/', import.meta.url);
  const markup = await readFile(new URL('index.wxml',root),'utf8');
  assert.equal((markup.match(/<page-container\b/g)||[]).length,1,'two native containers can leave the viewer unregistered');
  assert.match(markup,/position="\{\{popupPosition\}\}"/);
  assert.match(markup,/custom-style="\{\{popupStyle\}\}"/);
  assert.match(markup,/wx:if="\{\{popupMode === 'viewer'\}\}"/);
  const style = await readFile(new URL('index.wxss',root),'utf8');
  assert.match(style,/\.viewer image\s*\{[^}]*height:\s*100vh/);
});
test('popup layout renders before showing; closing blocks mode changes and late show after hiding is ignored', async () => {
  let page, rendered;
  const root = new URL('../../apps/wechat-mini-program/miniprogram/pages/local-gallery/', import.meta.url);
  runInNewContext(await readFile(new URL('index.js',root),'utf8'), {
    Date, Uint8Array, Page:p=>page=p, require:()=>({}), wx:{getFileSystemManager:()=>({unlink(){}})}
  });
  page.setData=(x,done)=>{Object.assign(page.data,x);if(done)rendered=done;};
  page.onLoad(); page.onShow(); page.setData({photos:[{path:'/cache/a.jpg',date:'2026-10-02'}]});
  page.openPhoto({currentTarget:{dataset:{index:0}}});
  assert.equal(page.data.popupMode,'viewer'); assert.equal(page.data.popupPosition,'center');
  assert.equal(page.data.viewerOpen,false); assert.equal(page.data.selectedPath,'/cache/a.jpg');
  rendered(); assert.equal(page.data.viewerOpen,true);
  page.closePhoto(); page.openConnection(); assert.equal(page.data.popupMode,'viewer');
  page.popupLeft(); assert.equal(page.data.selectedPath,'');
  page.openConnection(); assert.equal(page.data.popupPosition,'bottom'); rendered();
  assert.equal(page.data.connectionOpen,true);
  page.popupLeaving(); page.popupLeft(); assert.equal(page.data.connectionOpen,false);
  page.openPhoto({currentTarget:{dataset:{index:0}}}); const late=rendered;
  page.onHide(); late(); assert.equal(page.data.viewerOpen,false); assert.equal(page.data.connectionOpen,false);
});
