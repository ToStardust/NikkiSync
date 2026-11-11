import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {runInNewContext} from 'node:vm';
async function fixture(){const module={exports:{}},timers=[];let modal;
 runInNewContext(await readFile(new URL('../../apps/wechat-mini-program/miniprogram/lib/deletion-page.js',import.meta.url),'utf8'),{module,Set,Map,wx:{showModal:o=>modal=o},setTimeout:(fn,ms)=>{const timer={fn,ms};timers.push(timer);return timer;},clearTimeout(timer){const n=timers.indexOf(timer);if(n>=0)timers.splice(n,1);}});
 const page={...module.exports.deletionPage,data:{...module.exports.deletionData,connected:true,deletionEnabled:true,selectedId:'a'.repeat(32)},_alive:true,_active:true,setData(v){Object.assign(this.data,v)},_selected:new Set(['a'.repeat(32)]),adoptSelection(){}};
 return {page,timers,modal:()=>modal};}
test('request waits for user confirmation; no photo is hidden or removed until PC completes',async()=>{
 const f=await fixture();let called=0;f.page._channel={deletion:(_a,_i,done)=>{called++;done({status:'ok',value:{items:[{id:'b'.repeat(32),photoId:'a'.repeat(32),state:'pending',message:'等待电脑确认',count:1,files:[]}]}})}};
 f.page.requestViewedDeletion();assert.equal(called,0);f.modal().success({confirm:false});assert.equal(called,0);
 f.page.requestViewedDeletion();f.modal().success({confirm:true});assert.equal(called,1);assert.equal(f.page.data.deletionItems[0].state,'pending');assert.equal(f.page.data.selectedId,'a'.repeat(32));
});

test('viewer cancellation belongs to its photo and disappears after a terminal response',async()=>{
 const f=await fixture(),a='a'.repeat(32),b='b'.repeat(32),intent='c'.repeat(32);
 const row=state=>({id:intent,photoId:a,state,message:'测试',count:1,files:[]});
 let pending=true;
 f.page._channel={deletion:(action,input,done)=>{
  if(action==='sync'){assert.deepEqual(Array.from(input.cancel),[intent]);pending=false;}
  done({status:'ok',value:{items:[row(pending?'pending':'cancelled')]}});
 }};
 f.page.requestViewedDeletion();f.modal().success({confirm:true});
 assert.equal(f.page.data.viewerDeletionId,intent);
 assert.equal(f.page.deletionIdForPhoto(b),'');
 f.page.cancelDeletion({currentTarget:{dataset:{id:intent}}});
 assert.equal(f.page.data.viewerDeletionId,'');
 assert.equal(f.page.data.deletionItems[0].state,'cancelled','keep the result in the history panel');
});

test('PC approval is echoed immediately while foreground without another phone confirmation or refresh tap',async()=>{
 const f=await fixture(),id='b'.repeat(32),approval='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';let stage=0,modals=0;
 const row=state=>({id,photoId:'a'.repeat(32),state,message:'测试',count:1,files:[],...(state==='confirming'?{approval}:{})});
 f.page._channel={deletion:(action,input,done)=>{
  if(stage++===0){assert.equal(action,'request');done({status:'ok',value:{items:[row('pending')]}});}
  else if(stage===2){assert.equal(action,'sync');assert.equal(input.approvals.length,0);done({status:'ok',value:{items:[row('confirming')]}});}
  else{assert.deepEqual(JSON.parse(JSON.stringify(input.approvals)),[{id,approval}]);done({status:'ok',value:{items:[row('recycled')]}});}
 }};
 f.page.requestViewedDeletion();modals++;f.modal().success({confirm:true});assert.ok(f.timers.at(-1).ms<=1500);
 f.timers.pop().fn();assert.equal(f.page.data.deletionItems[0].state,'confirming');assert.equal(f.timers.at(-1).ms,0);
 f.timers.pop().fn();assert.equal(stage,3);assert.equal(f.page.data.deletionItems[0].state,'recycled');assert.equal(modals,1);assert.equal(f.timers.length,0);
});

test('failed approval echo is not retried in a zero-delay loop; cancellation still takes priority',async()=>{
 const f=await fixture(),id='b'.repeat(32);f.page.data.deletionItems=[{id,photoId:'a'.repeat(32),state:'confirming',approval:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'}];
 f.page._channel={deletion:(_action,_input,done)=>done({status:'failed'})};f.page.pollDeletions();assert.ok(f.timers.at(-1).ms>=1000);
});

test('repeated challenges cannot create an immediate poll loop and long waits back off within the session quota',async()=>{
 const f=await fixture(),id='b'.repeat(32),item={id,photoId:'a'.repeat(32),state:'confirming',approval:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',message:'测试',count:1,files:[]};
 f.page.data.deletionItems=[item];f.page._channel={deletion:(_a,_i,done)=>done({status:'ok',value:{items:[item]}})};
 f.page.pollDeletions();assert.equal(f.timers.length,1);assert.ok(f.timers[0].ms>0);
 for(let n=0;n<12;n++)f.timers.pop().fn();assert.equal(f.timers[0].ms,5000);
 f.page.stopDeletionPolling();assert.equal(f.timers.length,0);
});
test('queued cancellation is echoed before any challenge and late callbacks cannot revive polling after hide',async()=>{
 const f=await fixture(),id='b'.repeat(32);f.page.data.deletionItems=[{id,photoId:'a'.repeat(32),state:'confirming',approval:'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'}];let input,finish;
 f.page._channel={deletion:(_a,i,done)=>{input=i;finish=done}};f.page.data.busy=true;f.page.cancelDeletion({currentTarget:{dataset:{id}}});f.page.data.busy=false;f.page.pollDeletions();
 assert.deepEqual(Array.from(input.cancel),[id]);assert.equal(input.approvals.length,0);
 f.page.stopDeletionPolling();f.page._active=false;finish({status:'ok',value:{items:[]}});assert.equal(f.page.data.deletionItems.length,1);
});
