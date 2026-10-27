import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const root=new URL('../../apps/wechat-mini-program/miniprogram/pages/local-gallery/',import.meta.url);
const motionFile=new URL('motion.wxs',root);
async function renderFixture(){
 const module={exports:{}};runInNewContext(await readFile(motionFile,'utf8'),{module,Math});
 const writes=[],calls=[],nodes={};
 function node(name,data){return nodes[name]={data,style:{},getDataset(){return this.data;},setStyle(x){Object.assign(this.style,x);writes.push({name,...x});}};}
 node('.photo-stage',{frame:1});node('.viewer-backdrop',{frame:1});node('.viewer-chrome',{frame:1});node('.photo-info',{frame:1,infoFrame:1});node('.info-backdrop',{frame:1});
 const owner={selectComponent:s=>nodes[s],callMethod:(name,event)=>calls.push({name,event})};
 return {motion:module.exports,owner,nodes,writes,calls};
}
function event(x,y,extra={}){return {type:'touchmove',timeStamp:100,currentTarget:{dataset:{frame:1,image:true,blocked:false,infoFrame:1,expanded:false}},touches:[{clientX:x,clientY:y}],changedTouches:[{clientX:x,clientY:y}],...extra};}
async function pageFixture(){
 let page,n=0;const timers=new Map(),cancelled=[];
 const wx={getFileSystemManager:()=>({unlink(){}})};
 runInNewContext(await readFile(new URL('index.js',root),'utf8'),{Page:p=>page=p,Date,Uint8Array,wx,require:()=>({}),
  setTimeout:(fn,ms)=>{timers.set(++n,{fn,ms});return n;},clearTimeout:key=>{cancelled.push(key);timers.delete(key);}});
 page.setData=(x,done)=>{Object.assign(page.data,x);done?.();};page.onLoad();page.onShow();
 page.data.photos=[{id:'a'.repeat(32),path:'/cache/a',date:'2026-10-04'}];page.data.connected=true;page.data.downloadEnabled=true;
 page._channel={close(){},metadata:(_id,done)=>done({status:'ok',availability:'available',rows:[{label:'滤镜',value:'暖色'}]})};
 page.openPhoto({currentTarget:{dataset:{index:0}}});
 function flush(){const pending=Array.from(timers);timers.clear();for(const [,t] of pending)t.fn();}
 return {page,timers,cancelled,flush};
}

test('render-layer photo drag transforms outer stage and fades background without per-move logic calls or scale feedback',async()=>{
 const f=await renderFixture(),m=f.motion,o=f.owner;
 m.photoState({frame:1,phase:'open',settle:0,reduced:false},undefined,o,f.nodes['.photo-stage']);
 m.photoStart(event(100,100,{type:'touchstart',timeStamp:0}),o);const calls=f.calls.length;
 for(let y=112;y<=230;y+=10)m.photoMove(event(105,y),o);
 assert.equal(f.calls.length,calls,'moves stay in rendering layer');assert.match(f.nodes['.photo-stage'].style.transform,/translate3d/);assert.match(f.nodes['.photo-stage'].style.transform,/scale\(0\./);
 assert.ok(Number(f.nodes['.viewer-backdrop'].style.opacity)<1);
 assert.equal(f.writes.some(x=>['height','width','top','left','filter','scale-value'].some(k=>Object.hasOwn(x,k))),false);
 m.photoEnd(event(105,230,{type:'touchend',timeStamp:120}),o);assert.equal(f.calls.at(-1).name,'viewerTouchEnd');assert.equal(f.calls.at(-1).event.motion.moved,true);
});
test('short drag settles; pinch and stale photo do not transform next photo; reduced motion removes drag movement',async()=>{
 const f=await renderFixture(),m=f.motion,o=f.owner;
 m.photoState({frame:1,phase:'open',settle:0,reduced:false},undefined,o,f.nodes['.photo-stage']);
 m.photoStart(event(100,100,{type:'touchstart'}),o);m.photoMove(event(100,145),o);m.photoEnd(event(100,145,{type:'touchcancel'}),o);
 m.photoState({frame:1,phase:'open',settle:1,reduced:false},{frame:1,phase:'open',settle:0,reduced:false},o,f.nodes['.photo-stage']);
 assert.match(f.nodes['.photo-stage'].style.transition,/180ms/);assert.match(f.nodes['.photo-stage'].style.transform,/scale\(1\)/);
 m.photoStart(event(100,100,{type:'touchstart'}),o);m.photoMove(event(100,190,{touches:[{clientX:100,clientY:190},{clientX:120,clientY:190}]}),o);assert.match(f.nodes['.photo-stage'].style.transform,/scale\(1\)/);
 for(const n of Object.values(f.nodes))n.data.frame=2;const count=f.writes.length;m.photoMove(event(100,240),o);assert.equal(f.writes.length,count);
 for(const n of Object.values(f.nodes))n.data.frame=1;
 m.photoState({frame:1,phase:'open',settle:2,reduced:true},undefined,o,f.nodes['.photo-stage']);
 m.photoStart(event(100,100,{type:'touchstart',currentTarget:{dataset:{frame:1,image:true,blocked:false,reduced:true}}}),o);m.photoMove(event(100,230),o);
 assert.match(f.nodes['.photo-stage'].style.transform,/scale\(1\)/);
});
test('native zoom still reports scale privately; zoomed gesture never becomes outer dismissal motion',async()=>{
 const f=await renderFixture(),m=f.motion,o=f.owner;
 m.photoState({frame:1,phase:'open',settle:0,reduced:false},undefined,o,f.nodes['.photo-stage']);
 m.photoScale(event(0,0,{detail:{scale:2}}),o);assert.equal(f.calls.at(-1).name,'viewerScaled');
 m.photoStart(event(100,100,{type:'touchstart'}),o);m.photoMove(event(100,250),o);assert.match(f.nodes['.photo-stage'].style.transform,/scale\(1\)/);
});
test('sheet render-layer grip follows finger, rejects stale handle and uses interruptible transform-only settling',async()=>{
 const f=await renderFixture(),m=f.motion,o=f.owner;
 m.sheetState({frame:1,key:1,phase:'open',expanded:false,settle:0,reduced:false},undefined,o,f.nodes['.photo-info']);
 assert.match(f.nodes['.photo-info'].style.transform,/37vh/);m.sheetStart(event(100,100,{type:'touchstart'}),o);const calls=f.calls.length;
 m.sheetMove(event(100,40),o);assert.equal(f.calls.length,calls);assert.match(f.nodes['.photo-info'].style.transform,/calc/);
 m.sheetEnd(event(100,40,{type:'touchend'}),o);assert.equal(f.calls.at(-1).name,'infoTouchEnd');
 m.sheetState({frame:1,key:1,phase:'open',expanded:true,settle:1,reduced:false},{frame:1,key:1,phase:'open',expanded:false,settle:0,reduced:false},o,f.nodes['.photo-info']);
 assert.match(f.nodes['.photo-info'].style.transition,/cubic-bezier\(0.32,0.72,0,1\)/);assert.match(f.nodes['.photo-info'].style.transform,/0vh/);
 f.nodes['.photo-info'].data.infoFrame=2;const count=f.writes.length;m.sheetMove(event(100,10),o);assert.equal(f.writes.length,count);
 assert.equal(f.writes.some(x=>Object.hasOwn(x,'height') || Object.hasOwn(x,'top')),false);
});
test('viewer exit retains DOM until animation completes, ignores repeated exit and cancels old callbacks on background',async()=>{
 const f=await pageFixture(),p=f.page;f.flush();p.dismissPhoto();assert.equal(p.data.viewerOpen,true);assert.equal(p.data.viewerClosing,true);assert.equal(p.data.viewerPhase,'exit');
 const count=f.timers.size;p.dismissPhoto();assert.equal(f.timers.size,count);f.flush();assert.equal(p.data.viewerOpen,false);assert.equal(p.data.connected,true);
 p.popupLeft();p.openPhoto({currentTarget:{dataset:{index:0}}});f.flush();p.dismissPhoto();const late=Array.from(f.timers.values());p.onHide();assert.equal(f.timers.size,0);for(const t of late)t.fn();assert.equal(p.data.viewerOpen,false);
});
test('info closes semantically first but remains mounted for exit; reopening retargets and invalidates old unmount',async()=>{
 const f=await pageFixture(),p=f.page;f.flush();p.showPhotoInfo();assert.equal(p.data.infoMounted,true);assert.equal(p.data.infoPhase,'enter');f.flush();assert.equal(p.data.infoPhase,'open');
 p.closeInfo();assert.equal(p.data.infoOpen,false);assert.equal(p.data.infoMounted,true);assert.equal(p.data.infoPhase,'exit');const late=Array.from(f.timers.values());
 p.showPhotoInfo();assert.equal(p.data.infoOpen,true);assert.equal(p.data.infoPhase,'open');for(const t of late)t.fn();assert.equal(p.data.infoMounted,true);
 p.closeInfo();f.flush();assert.equal(p.data.infoMounted,false);assert.equal(p.data.viewerOpen,true);
});
test('markup wires render-layer events without changing immutable native zoom; styles honor reduced motion and never animate layout',async()=>{
 const markup=await readFile(new URL('index.wxml',root),'utf8'),styles=await readFile(new URL('index.wxss',root),'utf8');
 assert.match(markup,/<wxs[^>]*src="\.\/motion.wxs"/);assert.match(markup,/bindtouchmove="{{motion.photoMove}}"/);assert.match(markup,/change:motion="{{motion.photoState}}"/);
 assert.match(markup,/wx:if="{{infoMounted}}"/);assert.match(markup,/scale-value="{{item.initialScale}}"/);assert.equal((markup.match(/<page-container\b/g)||[]).length,1);
 assert.match(styles,/@media\s*\(prefers-reduced-motion:\s*reduce\)/);assert.doesNotMatch(styles,/transition:\s*(?:all|height|width|top|left)/);assert.doesNotMatch(styles,/@keyframes/);
});
test('unrelated rendering updates never reset a live photo or sheet drag; sheet control does not depend on dataset update order',async()=>{
 const f=await renderFixture(),m=f.motion,o=f.owner,photo={frame:1,phase:'open',settle:0,reduced:false},sheet={frame:1,key:1,phase:'open',expanded:false,settle:0,reduced:false};
 m.photoState(photo,undefined,o,f.nodes['.photo-stage']);m.photoStart(event(100,100,{type:'touchstart'}),o);m.photoMove(event(100,220),o);
 let count=f.writes.length;m.photoState({...photo},photo,o,f.nodes['.photo-stage']);assert.equal(f.writes.length,count,'HD/chrome updates must not reset drag');
 m.sheetState(sheet,undefined,o,f.nodes['.photo-info']);m.sheetStart(event(100,100,{type:'touchstart'}),o);m.sheetMove(event(100,40),o);
 count=f.writes.length;m.sheetState({...sheet},sheet,o,f.nodes['.photo-info']);assert.equal(f.writes.length,count,'metadata updates must not reset grip drag');
 m.sheetState({...sheet,key:2,expanded:true},sheet,o,f.nodes['.photo-info']);assert.match(f.nodes['.photo-info'].style.transform,/0vh/);
});
test('stationary second finger cannot turn a pinch into a toolbar tap; closing viewer cannot be reopened by a late tile action',async()=>{
 const f=await pageFixture(),p=f.page;f.flush();const currentTarget={dataset:{frame:p.data.viewerFrames[0].key,image:true}};
 p.viewerTouchStart({currentTarget,touches:[{clientX:100,clientY:100}]});p.viewerTouchEnd({currentTarget,type:'touchend',changedTouches:[{clientX:100,clientY:100}],motion:{multi:true,moved:false}});
 p.toggleViewerChrome();assert.equal(p.data.viewerChrome,true);
 p.dismissPhoto();p.openPhoto({currentTarget:{dataset:{index:0}}});f.flush();assert.equal(p.data.viewerOpen,false);
});
