import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const root=new URL('../../apps/wechat-mini-program/miniprogram/pages/local-gallery/',import.meta.url);
const tap=index=>({currentTarget:{dataset:{index}}});
const scale=(frame,value)=>({currentTarget:{dataset:{frame}},detail:{scale:value}});
const touch=(frame,touches,type)=>({currentTarget:{dataset:{frame,image:true}},touches,type});
const end=(frame,x,y,type='touchend')=>({currentTarget:{dataset:{frame,image:true}},changedTouches:[{clientX:x,clientY:y}],type});
async function fixture(){
 let page,download,downloadCount=0;const writes=[];
 runInNewContext(await readFile(new URL('index.js',root),'utf8'),{Page:p=>page=p,Date,Uint8Array,require:()=>({}),
  wx:{getFileSystemManager:()=>({unlink(){}})}});
 page.setData=(state,done)=>{writes.push(state);Object.assign(page.data,state);done?.();};page.onLoad();page.onShow();
 page.setData({connected:true,downloadEnabled:true,total:2,pageStart:1,photos:[1,2].map(n=>({id:n.toString(16).padStart(32,'0'),path:'/cache/'+n,date:''}))});
 page._channel={original:(id,done)=>{downloadCount++;download={id,done};},close(){}};
 page.openPhoto(tap(0));writes.length=0;
 return {page,writes,get download(){return download;},get downloadCount(){return downloadCount;}};
}
test('native scale samples never feed scale-value back through setData; original request occurs once',async()=>{
 const f=await fixture(),p=f.page,key=p.data.viewerFrames[0].key;
 for(const n of [1.1,1.42,1.7,2.13,1.8,2.25,2.01])p.viewerScaled(scale(key,n));
 assert.ok(f.download);assert.equal(f.downloadCount,1);assert.equal(p._nativeScale,2.01);
 assert.equal(f.writes.some(x=>Object.hasOwn(x,'viewerScale') || Object.hasOwn(x,'viewerFrames') || Object.keys(x).some(k=>/scale/i.test(k))),false,'native movement must not write controlled zoom properties');
 const markup=await readFile(new URL('index.wxml',root),'utf8');
 assert.match(markup,/scale-value="{{item.initialScale}}"/);assert.doesNotMatch(markup,/scale-value="{{viewerScale}}"/);
 assert.match(markup,/<movable-view[^>]*data-frame="{{item.key}}"/);
});
test('old scale and touch callbacks cannot affect another photo, including same-photo reopen and background',async()=>{
 const f=await fixture(),p=f.page,first=p.data.viewerFrames[0].key;
 p.nextPhoto();const second=p.data.viewerFrames[0].key;p.viewerScaled(scale(first,5));
 assert.equal(p._nativeScale,1);assert.equal(f.download,undefined);
 p.viewerTouchStart(touch(first,[{clientX:200,clientY:10}]));p.viewerTouchMove(touch(first,[{clientX:0,clientY:10}]));p.viewerTouchEnd(end(first,0,10));
 assert.equal(p.data.viewerIndex,1);
 p.viewerScaled(scale(second,2));assert.equal(p._nativeScale,2);
 p.closePhoto();p.viewerLeft();p.openPhoto(tap(1));const third=p.data.viewerFrames[0].key;
 assert.notEqual(third,second);p.viewerScaled(scale(second,4));assert.equal(p._nativeScale,1);
 p.viewerScaled({detail:{scale:5}});assert.equal(p._nativeScale,1,'untagged events must not alter native state');
 p.onHide();p.viewerScaled(scale(third,3));assert.equal(p._nativeScale,1);
});
test('new photo has fresh immutable zoom seed; zoomed pan cannot swipe, scale-back-to-one enables swipe',async()=>{
 const {page:p,writes}=await fixture();let key=p.data.viewerFrames[0].key;
 const swipe=()=>{p.viewerTouchStart(touch(key,[{clientX:200,clientY:10}]));p.viewerTouchMove(touch(key,[{clientX:0,clientY:10}]));p.viewerTouchEnd(end(key,0,10));};
 p.viewerScaled(scale(key,2));swipe();assert.equal(p.data.viewerIndex,0);
 p.viewerScaled(scale(key,1));swipe();assert.equal(p.data.viewerIndex,1);
 const old=key;key=p.data.viewerFrames[0].key;assert.notEqual(key,old);assert.equal(p._nativeScale,1);assert.equal(p._viewerTouch,null);
 assert.equal(p.data.viewerFrames[0].initialScale,1);
 p.viewerScaled(scale(old,4));assert.equal(p._nativeScale,1);
 writes.length=0;p.viewerScaled(scale(key,1.2));p.toggleViewerChrome();assert.equal(p.data.viewerFrames[0].initialScale,1);
 assert.equal(writes.some(x=>Object.hasOwn(x,'viewerFrames')),false);
});
