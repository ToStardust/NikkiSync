import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {runInNewContext} from 'node:vm';
const base=new URL('../../apps/wechat-mini-program/miniprogram/',import.meta.url);
async function fixture(wx={}){
 const module={exports:{}};runInNewContext(await readFile(new URL('lib/inspiration-page.js',base),'utf8'),{module,wx,Date,Set,Map,Uint8Array});
 const page={...module.exports.inspirationPage,data:structuredClone(module.exports.inspirationData),_alive:true,_active:true,_files:new Set(),stopRefresh(){},scheduleRefresh(){},removeFile(p){this._files.delete(p)}};
 page.data.connected=true;page.setData=v=>{for(const [key,value]of Object.entries(v)){const parts=key.replace(/\[(\d+)\]/g,'.$1').split('.');let target=page.data;for(const p of parts.slice(0,-1))target=target[p];target[parts.at(-1)]=value;}};
 return {page,...module.exports};
}
test('inspiration UI shares the connected channel, keeps failed drafts and ignores late response after close',async()=>{
 const {page}=await fixture();let pending;page._channel={inspiration:(_a,_b,done)=>pending=done};
 page.openInspiration();assert.equal(page.data.inspirationBusy,true);page.closeInspiration();
 pending({status:'ok',value:{items:[{id:'a'}],next:null}});assert.equal(page.data.inspirationItems.length,0);assert.equal(page.data.inspirationOpen,false);
 page.data.inspirationOpen=true;page.editInspiration();page.data.inspirationDraft.code='KEEP-DRAFT';
 page.saveInspiration();pending({status:'failed'});assert.equal(page.data.inspirationDraft.code,'KEEP-DRAFT');assert.equal(page.data.inspirationEditing,true);
});
test('paste extractor handles Chinese/emoji interference and refuses URLs or ambiguous automatic choices',async()=>{
 const {candidates}=await fixture();assert.deepEqual(Array.from(candidates('染色码：1wP🌸Xw中KyiXS4#')),['1wPXwKyiXS4#']);assert.equal(candidates('https://example.com/1wPXwKyiXS4#').length,0);assert.equal(candidates('1wPXwKyiXS4#\n1aaaaaaaaaa#').length,2);
});
test('reference picker may return before foreground; upload starts only after foreground callback',async()=>{
 let choose,reads=0,uploads=0;const {page}=await fixture({chooseMedia:o=>choose=o,getFileSystemManager:()=>({readFile:o=>{reads++;o.success({data:new Uint8Array([137,80,78,71,13,10,26,10,1]).buffer})}})});
 page.data.inspirationOpen=true;page.data.inspirationItems=[{id:'a'.repeat(32),revision:1,images:[]}];page._channel={inspirationUpload:()=>uploads++};
 page.addInspirationImage({currentTarget:{dataset:{id:'a'.repeat(32)}}});page._active=false;choose.success({tempFiles:[{tempFilePath:'/temp/image.png',size:9}]});assert.equal(reads,0);
 page._active=true;page._inspirationExternalResult();assert.equal(reads,1);assert.equal(uploads,1);
});
test('editing uses the shared bottom sheet and closing it preserves unsaved text',async()=>{
 const {page}=await fixture();const opened=[];let closed=0;page.presentPopup=mode=>opened.push(mode);page.closeConnection=()=>closed++;
 page.editInspiration();assert.equal(opened[0],'inspirationEditor');page.data.inspirationDraft.code='KEEP';page.cancelInspirationEdit();assert.equal(closed,1);assert.equal(page.data.inspirationDraft.code,'KEEP');assert.equal(page.data.inspirationEditing,false);
});
