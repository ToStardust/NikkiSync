import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../apps/wechat-mini-program/', import.meta.url);
const json = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'));

test('WeChat project uses the supplied public AppID and retains URL checks', async () => {
  const config = await json('project.config.json');
  assert.equal(config.appid, 'wx1bfaa26659e0401b');
  assert.equal(config.projectname, '大喵相机助手');
  assert.equal(config.compileType, 'miniprogram');
  assert.equal(config.miniprogramRoot, 'miniprogram/');
  assert.equal(config.setting.urlCheck, true);
  assert.equal(config.cloudfunctionRoot, undefined);
});

test('landing page remains explicitly unofficial/developmental and scopes Live to playback/file export', async () => {
  const app = await json('miniprogram/app.json');
  assert.deepEqual(app.pages, ['pages/index/index', 'pages/diagnostics/index', 'pages/tcp-diagnostics/index', 'pages/encrypted-diagnostics/index', 'pages/image-diagnostics/index', 'pages/local-gallery/index', 'pages/live-diagnostics/index']);
  assert.equal(app.window.navigationBarTitleText, '大喵相机助手');
  const page = await readFile(new URL('miniprogram/pages/index/index.wxml', root), 'utf8');
  assert.match(page, /开发预览/);
  assert.match(page, /非官方/);
  assert.match(page, /Live 播放与文件导出/);
  assert.doesNotMatch(page,/Live 一键保存到相册/);
  assert.match(page, /bindtap="toggleTools"/);
  assert.match(page, /wx:if="\{\{toolsOpen\}\}"/);
  assert.match(page, /class="primary-action"[^>]*url="\/pages\/local-gallery\/index"/);
  await Promise.all(['miniprogram/app.js', 'miniprogram/app.wxss',
    'miniprogram/pages/index/index.js', 'miniprogram/pages/index/index.wxss',
    'miniprogram/pages/index/index.json'].map(path => readFile(new URL(path, root), 'utf8')));
});
