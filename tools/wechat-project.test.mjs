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

test('landing page is present and does not claim a working download connection', async () => {
  const app = await json('miniprogram/app.json');
  assert.deepEqual(app.pages, ['pages/index/index', 'pages/diagnostics/index']);
  assert.equal(app.window.navigationBarTitleText, '大喵相机助手');
  const page = await readFile(new URL('miniprogram/pages/index/index.wxml', root), 'utf8');
  assert.match(page, /开发准备中/);
  assert.match(page, /非官方/);
  assert.match(page, /尚未开放/);
  await Promise.all(['miniprogram/app.js', 'miniprogram/app.wxss',
    'miniprogram/pages/index/index.js', 'miniprogram/pages/index/index.wxss',
    'miniprogram/pages/index/index.json'].map(path => readFile(new URL(path, root), 'utf8')));
});
