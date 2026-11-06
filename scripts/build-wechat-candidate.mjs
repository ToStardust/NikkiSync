import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=join(root,'apps/wechat-mini-program');
const home=`<view class="ambient"></view>
<view class="intro">
  <view class="title">欢迎回家，搭配师</view>
  <view class="subtitle">非官方摄影助手</view>
  <view class="welcome-card glass-surface">
    <view class="album-art" aria-hidden="{{true}}"><view class="art-frame art-back"></view><view class="art-frame art-front"><view class="camera-mark"><view class="camera-lens"></view></view></view></view>
    <view class="card-title">{{albumTitle}}</view>
    <view class="card-copy">连接电脑，查看并保存你的暖暖照片</view>
    <navigator class="primary-action" url="/pages/local-gallery/index">打开相册 <text>›</text></navigator>
    <view class="local-note"><view class="status-dot"></view>与电脑连接同一 Wi-Fi</view>
  </view>
  <button class="tools-toggle" bindtap="openPrivacy">隐私保护指引</button>
</view>\n`;
const homeJs=`const { readProfile, albumTitle } = require('../../lib/profile-page.js');
Page({
  data: { albumTitle: '暖暖相册' },
  onShow() {
    this.setData({ albumTitle: albumTitle(readProfile(wx).name) });
  },
  openPrivacy() {
    if (typeof wx.openPrivacyContract !== 'function') {
      wx.showToast({ title: '请更新微信后查看', icon: 'none' });
      return;
    }
    wx.openPrivacyContract({
      fail() { wx.showToast({ title: '暂时无法打开隐私指引', icon: 'none' }); },
    });
  },
});
`;

// The output is a new, isolated build artifact. The working source is never overwritten.
export async function buildCandidate(destination){
 const target=resolve(destination);await mkdir(target,{recursive:false});
 await cp(join(source,'miniprogram'),join(target,'miniprogram'),{recursive:true,filter:path=>{
  const normalized=path.replaceAll('\\','/');return !/\/pages\/(diagnostics|tcp-diagnostics|encrypted-diagnostics|image-diagnostics|live-diagnostics)(\/|$)/.test(normalized);
 }});
 const appPath=join(target,'miniprogram/app.json'),app=JSON.parse(await readFile(appPath,'utf8'));
 app.pages=['pages/index/index','pages/local-gallery/index'];
 await writeFile(appPath,JSON.stringify(app,null,2)+'\n');
 await writeFile(join(target,'miniprogram/pages/index/index.wxml'),home);
 await writeFile(join(target,'miniprogram/pages/index/index.js'),homeJs);
 await cp(join(source,'project.config.json'),join(target,'project.config.json'));
 return target;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 if(!process.argv[2])throw Error('Specify a new output directory');
 console.log(await buildCandidate(process.argv[2]));
}
