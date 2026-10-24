import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
const now = Date.now();
const config = { type: 'NikkiSyncLanTcpProbe', version: 1, host: '192.168.31.130', port: 32000, nonce: 'a'.repeat(32), expiresAt: new Date(now + 600000).toISOString() };
async function load() {
  const module = { exports: {} };
  runInNewContext(await readFile(new URL('../apps/wechat-mini-program/miniprogram/lib/tcp-probe.js', import.meta.url), 'utf8'),
    { module, Uint8Array, ArrayBuffer, Date: class extends Date { static now() { return now; } }, setTimeout, clearTimeout });
  return module.exports;
}
function mock() {
  const events = {}; const writes = []; let closes = 0, connects = 0;
  const socket = { onConnect: f => events.connect = f, onMessage: f => events.message = f,
    onError: f => events.error = f, onClose: f => events.close = f,
    connect: () => connects++, write: x => writes.push(x), close: () => closes++ };
  return { api: { createTCPSocket: () => socket }, events, writes, counts: () => ({ closes, connects }) };
}
function bytes(text) { return Uint8Array.from(Buffer.from(text)).buffer; }
test('TCP test QR rejects other protocols, credentials, public hosts and expiry', async () => {
  const { parseTcpQr } = await load();
  assert.equal(parseTcpQr(JSON.stringify(config)).host, config.host);
  for (const patch of [{ host: '8.8.8.8' }, { host: '127.0.0.1' }, { host: '192.168.01.1' }, { port: 65536 }, { port: '32000' },
    { type: 'NikkiSyncRemoteBridge' }, { token: 'secret' }, { expiresAt: new Date(now).toISOString() }, { nonce: '../x' }])
    assert.throws(() => parseTcpQr(JSON.stringify({ ...config, ...patch })));
});
test('TCP synthetic reply supports split packets and closes, no identity assurance', async () => {
  const { runTcpProbe } = await load(); const m = mock(); let result;
  runTcpProbe(m.api, config, x => result = x); m.events.connect();
  assert.equal(m.writes[0], `NS-TCP-PROBE/1 ${config.nonce}\n`);
  const reply = `NS-TCP-OK/1 ${config.nonce}\n`;
  m.events.message({ message: bytes(reply.slice(0, 10)) }); assert.equal(result, undefined);
  m.events.message({ message: bytes(reply.slice(10)) });
  assert.equal(result.status, 'ok'); assert.equal(result.authenticated, false); assert.equal(m.counts().closes, 1);
});
test('TCP wrong, oversized and multiple frames fail closed', async () => {
  const { runTcpProbe } = await load();
  for (const reply of ['wrong\n', 'x'.repeat(513), `NS-TCP-OK/1 ${config.nonce}\nextra`]) {
    const m = mock(); let result; runTcpProbe(m.api, config, x => result = x); m.events.connect();
    m.events.message({ message: bytes(reply) }); assert.equal(result.status, 'failed'); assert.equal(m.counts().closes, 1);
  }
});
test('TCP cancel suppresses late callbacks; unsupported/invalid config opens nothing', async () => {
  const { runTcpProbe } = await load(); const m = mock(); let result;
  const cancel = runTcpProbe(m.api, config, x => result = x); cancel(); m.events.connect(); m.events.error({ errMsg: 'late' });
  assert.equal(result, undefined); assert.equal(m.writes.length, 0);
  runTcpProbe(m.api, { ...config, host: 'evil.example' }, x => result = x);
  assert.equal(result.status, 'failed'); assert.equal(m.counts().connects, 1);
  runTcpProbe({}, config, x => result = x); assert.equal(result.status, 'failed');
});
test('TCP timeout closes without fallback', async () => {
  const { runTcpProbe } = await load(); const m = mock();
  const result = await new Promise(resolve => runTcpProbe(m.api, config, resolve, { timeoutMs: 5 }));
  assert.equal(result.status, 'failed'); assert.equal(m.counts().closes, 1); assert.equal(m.counts().connects, 1);
});
test('TCP page waits for foreground after scanning and cancels on hide/unload', async () => {
  let page, scan, starts = 0, cancelled = 0;
  runInNewContext(await readFile(new URL('../apps/wechat-mini-program/miniprogram/pages/tcp-diagnostics/index.js', import.meta.url), 'utf8'), {
    require: () => ({ parseTcpQr: () => config, runTcpProbe: () => { starts++; return () => cancelled++; } }),
    Page: p => page = p, wx: { scanCode: x => scan = x }
  });
  page.setData = x => Object.assign(page.data, x);
  page.onLoad(); page.onShow(); page.scanTest(); page.onHide();
  scan.success({ result: '{}' }); assert.equal(starts, 0);
  page.onShow(); assert.equal(starts, 1); page.onHide(); assert.equal(cancelled, 1);
  page.onUnload(); scan.success({ result: '{}' }); assert.equal(starts, 1);
});
