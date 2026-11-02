import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';

const names=['baseline.jpg','paired.jpg','paired.mov','motion.jpg','paired.livp'];
async function harness(platform='ios'){
  let page,scan,receive,save;const writes=[],removed=[];
  const fs={writeFile:o=>writes.push(o),unlink:o=>{removed.push(o.filePath);o.success?.();},readdir:o=>o.success({files:['other.jpg','nikkisync-live-probe-123-1-motion.jpg','nikkisync-live-probe-secrets']})};
  runInNewContext(await readFile(new URL('../../apps/wechat-mini-program/miniprogram/pages/live-diagnostics/index.js',import.meta.url),'utf8'),{
    Date,Promise,Uint8Array,ArrayBuffer,Page:p=>page=p,
    require: name=>name.endsWith('live-probe.js')?{NAMES:names,parseLiveQr:()=>({}),receiveLiveProbe:(_w,_c,done)=>{receive=done;return()=>{};}}
      :{saveProbeCandidate:(_w,mode,paths,alive,done)=>save={mode,paths,alive,done}},
    wx:{env:{USER_DATA_PATH:'/own'},getDeviceInfo:()=>({platform}),getAppBaseInfo:()=>({SDKVersion:'3.10.0',version:'8.test'}),
      getFileSystemManager:()=>fs,scanCode:o=>scan=o}
  });
  page.setData=o=>Object.assign(page.data,o);page.onLoad();page.onShow();
  return {page,writes,removed,getSave:()=>save,start(){page.scanTest();scan.success({result:'{}'});receive({status:'ok',files:Object.fromEntries(names.map(x=>[x,new Uint8Array([1,2,3,4])]))});},async receive(){this.start();
    for(let i=0;i<5;i++){await setImmediate();assert.ok(writes[i],JSON.stringify({i,writes:writes.length,message:page.data.message}));writes[i].success();}await setImmediate();}};
}
test('probe page receives only synthetic files, previews before explicit save, and retains Live as unverified after callback',async()=>{
  const h=await harness();await h.receive();assert.equal(h.getSave(),undefined);assert.equal(h.page.data.ready,true);
  h.page.saveCandidate();assert.equal(h.getSave(),undefined);h.page.imageLoaded();h.page.saveCandidate();
  assert.equal(h.getSave().mode,'baseline');h.getSave().done({outcome:'api_saved',saved:1,live:'unverified'});
  assert.match(h.page.data.message,/不代表.*LIVE|不等于.*LIVE/);assert.equal(h.page.data.liveVerified,false);
  assert.ok(h.page.data.device.includes('iOS'));assert.equal(h.removed.includes('/own/other.jpg'),false);
  assert.equal(h.removed.includes('/own/nikkisync-live-probe-123-1-motion.jpg'),true);
});
test('pair input remains available during an album save even when page is unloaded; late callback removes only owned caches',async()=>{
  const h=await harness();await h.receive();h.page.imageLoaded();h.page.changeMode({detail:{value:'3'}});h.page.saveCandidate();const save=h.getSave();
  assert.equal(save.mode,'pair');const owned=Object.values(save.paths);h.page.onUnload();assert.equal(save.alive(),false);
  assert.equal(owned.some(x=>h.removed.includes(x)),false);
  save.done({outcome:'partial',saved:1,live:'unverified'});assert.ok(owned.every(x=>h.removed.includes(x)));
});
test('switching to Photos to check results keeps non-private probe files for the next test, including permission-sheet backgrounding',async()=>{
  const h=await harness();await h.receive();h.page.imageLoaded();const files=h.page._files;
  h.page.saveCandidate();h.page.onHide();h.getSave().done({outcome:'api_saved',saved:1,live:'unverified'});
  assert.equal(h.page._files,files);h.page.onShow();h.page.changeMode({detail:{value:'1'}});h.page.saveCandidate();
  assert.equal(h.getSave().mode,'motion');h.getSave().done({outcome:'api_saved',saved:1,live:'unverified'});
  h.page.onHide();h.page.onShow();assert.equal(h.page._files,files);assert.equal(h.page.data.ready,true);
  h.page.onUnload();assert.ok(Object.values(files).every(path=>h.removed.includes(path)));
});
test('late filesystem writes after unload are removed and cannot appear in UI; Android is not an iPhone acceptance path',async()=>{
  const h=await harness();h.start();await setImmediate();const pending=h.writes[0];h.page.onUnload();pending.success();await setImmediate();
  assert.ok(h.removed.includes(pending.filePath));assert.equal(h.writes.length,1);
  assert.equal(h.page.data.ready,false);assert.equal(h.getSave(),undefined);
  const a=await harness('android');await a.receive();a.page.imageLoaded();a.page.saveCandidate();assert.equal(a.getSave(),undefined);assert.match(a.page.data.message,/iPhone/);
});
test('probe route remains developer-only; gallery promises Live file export, not native paired album save',async()=>{
  const base=new URL('../../apps/wechat-mini-program/miniprogram/',import.meta.url);
  const app=JSON.parse(await readFile(new URL('app.json',base),'utf8'));
  assert.ok(app.pages.includes('pages/live-diagnostics/index'));
  const landing=await readFile(new URL('pages/index/index.wxml',base),'utf8');
  assert.match(landing,/Live 播放与文件导出/);assert.match(landing,/live-diagnostics/);assert.doesNotMatch(landing,/Live 一键保存到相册/);
  for(const file of ['index.wxml','index.wxss','index.json'])await readFile(new URL('pages/live-diagnostics/'+file,base),'utf8');
});
