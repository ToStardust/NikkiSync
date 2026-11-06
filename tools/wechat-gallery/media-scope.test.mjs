import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const root=new URL('../../apps/wechat-mini-program/miniprogram/',import.meta.url);
test('video saving pins its file through background cleanup and reports native failure accurately',async()=>{
 let removed=[],pending;const module={exports:{}};runInNewContext(await readFile(new URL('lib/live-gallery.js',root),'utf8'),{module,Set,Uint8Array,Date});const {createLiveCache}=module.exports;
 const cache=createLiveCache({env:{USER_DATA_PATH:'/test'},getFileSystemManager:()=>({writeFile:o=>o.success(),unlink:o=>removed.push(o.filePath)}),saveVideoToPhotosAlbum:o=>pending=o});
 let file;cache.put({status:'ok',motion:true,mime:'video/mp4',image:new Uint8Array(16)},'motion',p=>file=p);
 let outcome;cache.saveVideo(file,r=>outcome=r);cache.clear();assert.equal(removed.length,0);
 pending.fail({errMsg:'permission denied'});assert.equal(outcome.status,'failed');assert.equal(outcome.permissionDenied,true);assert.deepEqual(removed,[file]);
});
test('LIVE cover saves as a photo and the separate video action never requests a package',async()=>{
 let page,menu;runInNewContext(await readFile(new URL('pages/local-gallery/index.js',root),'utf8'),{Page:p=>page=p,require:()=>({}),wx:{showActionSheet:o=>menu=o},Date,Uint8Array});
 let saved,videos=0;page._alive=true;page._active=true;page.setData=v=>Object.assign(page.data,v);page.beginSave=ids=>saved=ids;page.saveVideo=()=>videos++;page.data.viewerOpen=true;page.data.viewerLive=true;page.data.selectedId='a'.repeat(32);
 page.exportLivePhoto=()=>assert.fail('no package export');page.saveViewed();assert.deepEqual(Array.from(menu.itemList),['照片','视频']);assert.equal(saved,undefined);menu.success({tapIndex:0});assert.deepEqual(Array.from(saved),['a'.repeat(32)]);
 page.saveViewed();menu.success({tapIndex:1});assert.equal(videos,1);
 const html=await readFile(new URL('pages/local-gallery/index.wxml',root),'utf8');
 assert.doesNotMatch(html,/导出 Live 封包|转发 \.livp/);assert.match(html,/bindtap="saveViewed"/);
});

test('rotation is per item and late save-menu responses do not apply to a different photo',async()=>{
 let page,menu;runInNewContext(await readFile(new URL('pages/local-gallery/index.js',root),'utf8'),{Page:p=>page=p,require:()=>({}),wx:{showActionSheet:o=>menu=o,getFileSystemManager:()=>({unlink(){}})},Date,Uint8Array});
 page.setData=(x,done)=>{Object.assign(page.data,x);done?.();};page.onLoad();page.onShow();
 const id='a'.repeat(32);page.setData({photos:[{id,path:'/test.jpg',live:true}],selectedId:id,viewerOpen:true,viewerLive:true,viewerRotation:0,viewerIndex:0,exportEnabled:true});
 page.rotatePhoto();assert.equal(page._rotations.get(id),90);assert.equal(page.data.viewerRotation,90);
 let saves=0;page.saveVideo=()=>saves++;page.saveViewed();page.data.selectedId='b'.repeat(32);menu.success({tapIndex:1});assert.equal(saves,0);
});
test('standalone video tiles open without an image preview and save through the video action',async()=>{
 let page;runInNewContext(await readFile(new URL('pages/local-gallery/index.js',root),'utf8'),{Page:p=>page=p,require:()=>({}),wx:{getFileSystemManager:()=>({unlink(){}})},Date,Uint8Array});
 page.setData=(v,done)=>{Object.assign(page.data,v);done?.();};page.onLoad();page.onShow();
 const id='b'.repeat(32);page._channel={preview:()=>assert.fail('video is not a JPEG preview')};
 page.applyPage({items:[{id,video:true,mime:'video/mp4',date:''}],total:1,next:null},0,page._generation);
 assert.equal(page.data.photos[0].video,true);page.openPhoto({currentTarget:{dataset:{index:0}}});assert.equal(page.data.viewerOpen,true);assert.equal(page.data.viewerVideo,true);
 let saves=0;page.saveVideo=()=>saves++;page.saveViewed();assert.equal(saves,1);
});
