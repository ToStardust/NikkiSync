// Browser acceptance of the real desktop renderer with synthetic state and inert QR payloads.
// No game scan, real database, resolver, phone listener, native startup preference, or private QR.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createDesktopControlServer } from '../../apps/pc-companion/dist/src/desktop/DesktopControlServer.js';
import { qrSvg } from '../../apps/pc-companion/dist/src/qr.js';

const root = resolve(import.meta.dirname, '../..');
const output = join(root, 'out/desktop-ui');
await mkdir(output, { recursive: true });
const playwright = process.env.NIKKISYNC_PLAYWRIGHT;
const { chromium } = await import(playwright ? pathToFileURL(playwright).href : 'playwright');
let status = { service: 'ready', host: '192.168.1.8', port: 28080, assets: 224, pairedDevices: 1, firstRun: false };
let state = 'idle', starts = 0, stops = 0;
const code = await qrSvg('NikkiSync desktop UI preview - not a pairing or photo connection');
const server = createDesktopControlServer({
  getStatus: () => status,
  createPairingUri: () => 'NikkiSync desktop UI preview - not a pairing or photo connection',
  qrSvg: async () => code,
  brandImage: await readFile(join(root, 'assets/branding/momo-camera.png')),
  wechatGallery: {
    start: async () => { state = 'waiting'; starts++; return { state, photoCount: 215, originalsSent: 0, expiresAt: new Date(Date.now() + 600000).toISOString(), qrSvg: code }; },
    stop: async () => { state = 'closed'; stops++; },
    status: () => ({ state, photoCount: 215, originalsSent: 0 })
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
let browser;
const failures = [];
try {
  browser = await chromium.launch({ headless: true, ...(process.env.NIKKISYNC_BROWSER ? { executablePath: process.env.NIKKISYNC_BROWSER } : {}) });
  const page = await browser.newPage({ viewport: { width: 1020, height: 740 }, deviceScaleFactor: 1 });
  page.on('pageerror', (error) => failures.push(error.message));
  await page.goto(base);
  await page.getByRole('heading', { name: '暖暖相册', exact: true }).waitFor();
  assert.equal(await page.locator('#desktop-assets').textContent(), '224');
  assert.equal(await page.locator('#android-first-pairing').count(), 0);
  assert.equal(await page.locator('#wechat-modal').isVisible(), false);
  const action = await page.locator('#wechat-start').evaluate(element => {
    const style = getComputedStyle(element);
    const l = color => color.match(/\d+/g).slice(0, 3).map(Number).map(v => {
      const n = v / 255; return n <= .04045 ? n / 12.92 : ((n + .055) / 1.055) ** 2.4;
    }).reduce((sum, n, i) => sum + n * [.2126, .7152, .0722][i], 0);
    return { background: style.backgroundColor, foreground: style.color, contrast: (l(style.backgroundColor) + .05) / (l(style.color) + .05) };
  });
  assert.equal(action.background, 'rgb(246, 188, 192)');
  assert.equal(action.foreground, 'rgb(98, 66, 90)');
  assert.ok(action.contrast >= 4.5);
  await page.screenshot({ path: join(output, 'desktop-connected.png'), fullPage: true });

  await page.getByRole('button', { name: '同步设置', exact: true }).click();
  await page.getByRole('heading', { name: '同步设置', exact: true }).waitFor();
  assert.equal(await page.locator('#autostart').isDisabled(), true);
  await page.screenshot({ path: join(output, 'desktop-settings.png'), fullPage: true });
  await page.getByRole('button', { name: '手机连接', exact: true }).click();

  await page.locator('#wechat-start').click();
  await page.locator('#wechat-qr svg').waitFor();
  assert.equal(starts, 1);
  assert.equal(await page.locator('.app-shell').evaluate((element) => element.inert), true);
  await page.screenshot({ path: join(output, 'desktop-wechat-dialog.png'), fullPage: true });
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.locator('#wechat-renew').evaluate((element) => element === document.activeElement), true);
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('#wechat-close').evaluate((element) => element === document.activeElement), true);
  await page.keyboard.press('Escape');
  await page.locator('#wechat-modal').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => !document.querySelector('#wechat-start').disabled);
  assert.equal(stops, 1);
  assert.equal(await page.locator('#wechat-qr svg').count(), 0);
  assert.equal(await page.locator('.app-shell').evaluate((element) => element.inert), false);
  assert.equal(await page.locator('#wechat-start').evaluate((element) => element === document.activeElement), true);

  await page.locator('#renew').click();
  await page.locator('#modal-qr svg').waitFor();
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('#modal').isVisible(), false);
  assert.equal(await page.locator('#modal-qr svg').count(), 0);
  assert.equal(await page.locator('#renew').evaluate((element) => element === document.activeElement), true);

  await page.route('**/api/status', (route) => route.fulfill({ status: 503, body: '{}' }));
  await page.waitForFunction(() => document.querySelector('#desktop-status').dataset.state === 'offline');
  assert.equal(await page.locator('#desktop-assets').textContent(), '224');
  await page.unroute('**/api/status');
  await page.waitForFunction(() => document.querySelector('#desktop-status').dataset.state === 'ready');

  status = { ...status, pairedDevices: 0, firstRun: true };
  await page.waitForFunction(() => document.querySelector('#android-paired').hidden);
  await page.goto(base);
  await page.locator('#android-first-pairing .qr svg').waitFor();
  await page.screenshot({ path: join(output, 'desktop-first-run.png'), fullPage: true });
  status = { ...status, pairedDevices: 1, firstRun: false };
  await page.waitForFunction(() => document.querySelector('#android-first-pairing').hidden);
  assert.equal(await page.locator('#android-first-pairing .qr svg').count(), 0);
  assert.equal(await page.locator('#android-paired').isVisible(), true);

  for (const width of [600, 460, 360]) {
    await page.setViewportSize({ width, height: 740 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'No horizontal overflow at ' + width);
    await page.screenshot({ path: join(output, 'desktop-width-' + width + '.png'), fullPage: true });
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('#wechat-start').click();
  await page.locator('#wechat-qr svg').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.keyboard.press('Escape');
  assert.deepEqual(failures, []);
  console.log(JSON.stringify({ rendererBrowserAcceptance: true, firstRunAndPaired: true, settings: true, qrModalAndCleanup: true, keyboardFocusAndEscape: true, offlineRecovery: true, widths: [1020, 600, 460, 360], pageErrors: failures, screenshots: output, data: 'synthetic only', nativeWpfAcceptance: false }));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
