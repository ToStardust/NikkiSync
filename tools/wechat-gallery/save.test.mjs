import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import test from 'node:test';
async function api(){const module={exports:{}};runInNewContext(await readFile(new URL('../../apps/wechat-mini-program/miniprogram/lib/original-save.js',import.meta.url),'utf8'),{module,Date,Uint8Array});return module.exports;}
const id='a'.repeat(32),other='b'.repeat(32);
const original=()=>({status:'ok',original:true,image:new Uint8Array([255,216,255,217,10,20]),mime:'image/jpeg',sha256:'a'.repeat(64)});

test('cross-page batch accepts 100 unique selections, stays serial, rejects oversized/duplicate baskets',async()=>{
 const {saveOriginalBatch}=await api(),ids=Array.from({length:100},(_,n)=>n.toString(16).padStart(32,'0'));let finished,count=0;
 const wx={authorize:o=>o.success(),saveImageToPhotosAlbum(){},getFileSystemManager:()=>({unlink(){}})};
 const channel={original:(_id,done)=>{count++;done({status:'failed'});}};
 saveOriginalBatch(wx,channel,ids,{complete:x=>finished=x});assert.equal(count,100);assert.equal(finished.results.length,100);
 assert.throws(()=>saveOriginalBatch(wx,channel,[...ids,'f'.repeat(32)],{}));assert.throws(()=>saveOriginalBatch(wx,channel,[id,id],{}));
});
test('explicit batch saves only verified ORIGINAL bytes serially and counts success only after native album callback',async()=>{
 const {saveOriginalBatch}=await api();let download,write,save,authorize,complete;let requests=0;const removed=[];
 const wx={env:{USER_DATA_PATH:'/cache'},authorize:o=>authorize=o,saveImageToPhotosAlbum:o=>save=o,getFileSystemManager:()=>({writeFile:o=>write=o,unlink:o=>removed.push(o.filePath)})};
 const channel={original:(_id,done)=>{requests++;download=done;},close(){}};
 saveOriginalBatch(wx,channel,[id,other],{complete:x=>complete=x});
 assert.equal(requests,0);authorize.success();assert.equal(requests,1);
 download(original());assert.deepEqual(Array.from(new Uint8Array(write.data)),[255,216,255,217,10,20]);write.success();
 assert.equal(complete,undefined);assert.equal(requests,1);save.success();assert.equal(requests,2);assert.equal(removed.length,1);
 download({status:'failed'});assert.equal(complete.results[0].status,'saved');assert.equal(complete.results[1].status,'failed');
});
test('cancel during native save retains its input until callback; late writes and permission denial never save',async()=>{
 const {saveOriginalBatch}=await api();let download,write,save,authorize;const removed=[];let saves=0,requests=0;
 const wx={env:{USER_DATA_PATH:'/cache'},authorize:o=>authorize=o,saveImageToPhotosAlbum:o=>{saves++;save=o;},getFileSystemManager:()=>({writeFile:o=>write=o,unlink:o=>removed.push(o.filePath)})};
 const channel={original:(_id,done)=>{requests++;download=done;},close(){}};
 let job=saveOriginalBatch(wx,channel,[id,other],{});authorize.success();download(original());write.success();job.cancel();
 assert.equal(removed.length,0);save.success();assert.equal(removed.length,1);assert.equal(requests,1);
 job=saveOriginalBatch(wx,channel,[id],{});authorize.success();download(original());job.cancel();write.success();assert.equal(saves,1);assert.equal(removed.length,2);
 job=saveOriginalBatch(wx,channel,[id],{});authorize.fail();assert.equal(requests,2);assert.equal(saves,1);
});
test('preview data cannot masquerade as original; album denial does not report saved and halts remaining items',async()=>{
 const {saveOriginalBatch}=await api();let download,write,save,result;let requests=0,saves=0;
 const wx={env:{USER_DATA_PATH:'/cache'},authorize:o=>o.success(),saveImageToPhotosAlbum:o=>{saves++;save=o;},getFileSystemManager:()=>({writeFile:o=>write=o,unlink(){}})};
 const channel={original:(_id,done)=>{requests++;download=done;},close(){}};
 saveOriginalBatch(wx,channel,[id],{complete:x=>result=x});download({...original(),original:false});assert.equal(saves,0);assert.equal(result.results[0].status,'failed');
 saveOriginalBatch(wx,channel,[id,other],{complete:x=>result=x});download(original());write.success();save.fail({errMsg:'auth deny'});
 assert.equal(requests,2);assert.equal(result.results[0].status,'failed');assert.equal(result.permissionDenied,true);
});
