import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

async function api() {
  const module={exports:{}};
  runInNewContext(await readFile(new URL('../../apps/wechat-mini-program/miniprogram/lib/live-probe-save.js',import.meta.url),'utf8'),{module});
  return module.exports;
}
const files = Object.fromEntries(['baseline.jpg','paired.jpg','paired.mov','motion.jpg','paired.livp'].map(x=>[x,'/own/nikkisync-live-probe-1-1-'+x]));
test('image, motion JPEG and LIVP tests call only documented image-save API after explicit action; success stays unverified',async()=>{
  const {saveProbeCandidate}=await api();
  for(const [mode,name] of [['baseline','baseline.jpg'],['motion','motion.jpg'],['livp','paired.livp']]){
    let options,result;
    saveProbeCandidate({saveImageToPhotosAlbum:o=>options=o},mode,files,()=>true,r=>result=r);
    assert.equal(options.filePath,files[name]);assert.deepEqual(Object.keys(options).sort(),['fail','filePath','success']);
    options.success();assert.equal(result.outcome,'api_saved');assert.equal(result.live,'unverified');assert.equal(result.saved,1);
  }
});
test('single-tap pair candidate preserves names, saves both only in sequence, and never asserts a paired Photos asset',async()=>{
  const {saveProbeCandidate}=await api();let image,video,result;
  saveProbeCandidate({saveImageToPhotosAlbum:o=>image=o,saveVideoToPhotosAlbum:o=>video=o},'pair',files,()=>true,r=>result=r);
  assert.equal(image.filePath,files['paired.jpg']);assert.equal(video,undefined);
  image.success();assert.equal(video.filePath,files['paired.mov']);video.success();
  assert.equal(result.outcome,'api_saved');assert.equal(result.saved,2);assert.equal(result.live,'unverified');
});
test('denial, unsupported format, second-save failure and cancellation are not Live success; no deletion of album assets',async()=>{
  const {saveProbeCandidate}=await api();let image,video,result,alive=true;
  const wx={saveImageToPhotosAlbum:o=>image=o,saveVideoToPhotosAlbum:o=>video=o};
  saveProbeCandidate(wx,'livp',files,()=>true,r=>result=r);image.fail({errMsg:'saveImageToPhotosAlbum:fail invalid image'});
  assert.equal(result.outcome,'failed');assert.equal(result.saved,0);
  saveProbeCandidate(wx,'pair',files,()=>true,r=>result=r);image.success();video.fail({errMsg:'denied'});
  assert.equal(result.outcome,'partial');assert.equal(result.saved,1);assert.equal(result.live,'unverified');
  video=undefined;saveProbeCandidate(wx,'pair',files,()=>alive,r=>result=r);alive=false;image.success();
  assert.equal(video,undefined);assert.equal(result.outcome,'partial');
  assert.throws(()=>saveProbeCandidate(wx,'unknown',files,()=>true,()=>{}));
});
test('invalid cached path cannot call save API and duplicate platform callbacks cannot trigger repeated video saves',async()=>{
  const {saveProbeCandidate}=await api();let image,count=0;
  assert.throws(()=>saveProbeCandidate({saveImageToPhotosAlbum(){throw Error('must not call');}},'motion',{...files,'motion.jpg':'https://private/'},()=>true,()=>{}));
  saveProbeCandidate({saveImageToPhotosAlbum:o=>image=o,saveVideoToPhotosAlbum:o=>{count++;o.success();}},'pair',files,()=>true,()=>{});
  image.success();image.success();image.fail();assert.equal(count,1);
});
