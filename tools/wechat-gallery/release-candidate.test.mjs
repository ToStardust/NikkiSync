import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {buildCandidate} from '../../scripts/build-wechat-candidate.mjs';
import {runInNewContext} from 'node:vm';

test('candidate contains the real gallery without development tools or unrelated local files',async()=>{
 const root=await mkdtemp(join(tmpdir(),'momo-candidate-test-'));
 try{const target=join(root,'candidate');await buildCandidate(target);
  const app=JSON.parse(await readFile(join(target,'miniprogram/app.json'),'utf8'));
  assert.deepEqual(app.pages,['pages/index/index','pages/local-gallery/index']);
  const home=await readFile(join(target,'miniprogram/pages/index/index.wxml'),'utf8');
  assert.doesNotMatch(home,/开发预览|开发工具|诊断|识别旧版/);assert.match(home,/打开相册/);assert.match(home,/隐私保护指引/);
  assert.deepEqual((await readdir(join(target,'miniprogram/pages'))).sort(),['index','local-gallery']);
  const config=JSON.parse(await readFile(join(target,'project.config.json'),'utf8'));assert.equal(config.setting.urlCheck,true);
  await assert.rejects(()=>buildCandidate(target));
 }finally{await rm(root,{recursive:true,force:true});}
});
test('shipped homepage refreshes the saved nickname and shares the gallery fallback after clearing it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'momo-nickname-candidate-'));
  try {
    const target = join(root, 'candidate');
    await buildCandidate(target);
    const saved = new Map();
    const wx = { getStorageSync:key=>saved.get(key), setStorageSync:(key,value)=>saved.set(key,value) };
    const profile = { exports:{} };
    runInNewContext(await readFile(join(target,'miniprogram/lib/profile-page.js'),'utf8'), {module:profile,wx});
    const gallery = {...profile.exports.profilePage, data:{...profile.exports.profileData}, setData(value){Object.assign(this.data,value);}};
    let home;
    runInNewContext(await readFile(join(target,'miniprogram/pages/index/index.js'),'utf8'), {
      Page:value=>{home=value;},wx,require:()=>profile.exports,
    });
    home.setData=value=>Object.assign(home.data,value);
    gallery.initProfile(); home.onShow();
    assert.equal(home.data.albumTitle,'暖暖相册');
    gallery.data.profileName='  暖暖  ';
    gallery.saveProfile(); home.onShow();
    assert.equal(home.data.albumTitle,'暖暖家的暖暖相册');
    assert.equal(gallery.data.albumTitle,home.data.albumTitle);
    gallery.data.profileName='喵'.repeat(32); gallery.saveProfile(); home.onShow();
    assert.equal(home.data.albumTitle,'喵'.repeat(32)+'家的暖暖相册');
    gallery.clearProfile(); home.onShow();
    assert.equal(home.data.albumTitle,'暖暖相册');
    assert.equal(gallery.data.albumTitle,'暖暖相册');
    const markup=await readFile(join(target,'miniprogram/pages/index/index.wxml'),'utf8');
    assert.match(markup,/欢迎回家，搭配师/);
    assert.match(markup,/\{\{albumTitle\}\}/);
    assert.doesNotMatch(markup,/把奇迹大陆|你的暖暖相册|NIKKISYNC/);
  } finally { await rm(root,{recursive:true,force:true}); }
});
