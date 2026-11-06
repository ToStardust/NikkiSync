import test from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';import{runInNewContext}from'node:vm';
async function fixture(){const module={exports:{}},saved=new Map();runInNewContext(await readFile(new URL('../../apps/wechat-mini-program/miniprogram/lib/profile-page.js',import.meta.url),'utf8'),{module,wx:{getStorageSync:k=>saved.get(k),setStorageSync:(k,v)=>saved.set(k,v)}});const page={...module.exports.profilePage,data:{...module.exports.profileData},setData(v){Object.assign(this.data,v)}};return{page,saved,...module.exports};}
test('local profile persists the default UID/name and uses the same automatic share text as App',async()=>{
 const f=await fixture();f.page.initProfile();f.page.data.profileUid='123456789';f.page.data.profileName='暖暖';f.page.saveProfile();assert.ok(f.saved.size);assert.equal(f.page.shareBranding().title,'暖暖的大喵相机');assert.equal(f.page.shareBranding().footer,'UID：123456789 MomoCamera');
 f.page.data.profileUid='';f.page.data.profileName='';f.page.initProfile();assert.equal(f.page.data.profileName,'暖暖');f.page.data.profileUid='bad/uid';f.page.saveProfile();f.page.initProfile();assert.equal(f.page.data.profileUid,'123456789');
});
test('a cleared profile uses plain branding without another user UID and does not require a connection',async()=>{
 const f=await fixture();f.page.initProfile();assert.equal(f.page.shareBranding().title,'大喵相机');assert.equal(f.page.shareBranding().footer,'MomoCamera');
 f.page.data.profileUid='99';f.page.data.profileName='Name';f.page.saveProfile();f.page.clearProfile();assert.equal(f.page.shareBranding().footer,'MomoCamera');
});
