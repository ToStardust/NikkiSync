import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { clientApi } from './client-api.mjs';
const vendor = clientApi('noise-vendor');
const now = Date.now();
const config = { type: 'NikkiSyncEncryptedTcpProbe', version: 1, host: '192.168.31.130', port: 32000,
  sessionId: 'a'.repeat(32), key: 'b'.repeat(64), expiresAt: new Date(now + 600000).toISOString() };
async function load() {
  const module = { exports: {} }, tcpModule = { exports: {} };
  const globals = { Date, Uint8Array, ArrayBuffer, setTimeout, clearTimeout };
  runInNewContext(await readFile(new URL('../../apps/wechat-mini-program/miniprogram/lib/tcp-probe.js', import.meta.url), 'utf8'), { ...globals, module: tcpModule });
  runInNewContext(await readFile(new URL('../../apps/wechat-mini-program/miniprogram/lib/encrypted-probe.js', import.meta.url), 'utf8'),
    { ...globals, module, require: x => x.includes('vendor') ? vendor : x.includes('synthetic-image') ? clientApi('synthetic-image') : tcpModule.exports });
  return module.exports;
}
test('encrypted diagnostic QR strictly rejects old codes, extra fields, bad key and expired session', async () => {
  const { parseEncryptedQr } = await load(); assert.equal(parseEncryptedQr(JSON.stringify(config)).sessionId, config.sessionId);
  for (const patch of [{ type: 'NikkiSyncLanTcpProbe' }, { key: 'password' }, { token: 'secret' }, { host: '8.8.8.8' }, { expiresAt: new Date(now).toISOString() }])
    assert.throws(() => parseEncryptedQr(JSON.stringify({ ...config, ...patch })));
});
test('framing handles fragments/coalescing, rejects overlong lengths and erases on close', async () => {
  const { createDecoder, frame } = await load(); const output = []; const d = createDecoder(x => output.push(Array.from(x)));
  const first = frame(new Uint8Array([1,2])); d.feed(first.slice(0,1)); d.feed(first.slice(1));
  d.feed(new Uint8Array([...first, ...frame(new Uint8Array([3]))])); assert.deepEqual(output, [[1,2],[1,2],[3]]);
  assert.throws(() => d.feed(new Uint8Array([255,255]))); d.close(); assert.throws(() => d.feed(first));
});
test('encrypted probe performs real Noise handshake through mock wx TCP then synthetic encrypted response', async () => {
  const p = await load(); const events = {}, wire = [], server = vendor.createPeer(false, Buffer.from(config.key, 'hex'), p.prologue(config), randomBytes(64));
  let phase = 0, result, closed = 0;
  const decoder = p.createDecoder(bytes => {
    if (phase++ === 0) { server.receiveHandshake(bytes); const reply = p.frame(server.sendHandshake()); events.message({ message: reply.slice(0,5).buffer }); events.message({ message: reply.slice(5).buffer }); }
    else { assert.equal(Buffer.from(server.decrypt(bytes)).toString(), 'NS-ENCRYPTED-PROBE/1'); const reply = p.frame(server.encrypt(Buffer.from('NS-ENCRYPTED-OK/1'))); events.message({ message: reply.buffer }); }
  });
  const socket = { onConnect: f => events.connect = f, onMessage: f => events.message = f, onError: f => events.error = f, onClose: f => events.close = f,
    connect: () => events.connect(), write: x => { wire.push(Buffer.from(x)); decoder.feed(new Uint8Array(x)); }, close: () => closed++ };
  p.runEncryptedProbe({ getRandomValues: x => x.success({ randomValues: Uint8Array.from(randomBytes(64)).buffer }), createTCPSocket: () => socket }, config, x => result = x);
  assert.equal(result.status, 'ok'); assert.equal(closed, 1); assert.equal(wire.some(x => x.includes(Buffer.from(config.key, 'hex'))), false);
  assert.equal(wire.some(x => x.includes(Buffer.from('NS-ENCRYPTED-PROBE/1'))), false); server.close(); decoder.close();
});
test('missing secure RNG opens no socket; cancellation suppresses delayed RNG', async () => {
  const { runEncryptedProbe } = await load(); let calls = 0, result, rng;
  runEncryptedProbe({ createTCPSocket: () => calls++ }, config, x => result = x); assert.equal(result.status, 'failed'); assert.equal(calls, 0);
  result = undefined; const cancel = runEncryptedProbe({ getRandomValues: x => rng = x, createTCPSocket: () => calls++ }, config, x => result = x);
  cancel(); rng.success({ randomValues: Uint8Array.from(randomBytes(64)).buffer }); assert.equal(calls, 0); assert.equal(result, undefined);
});
test('encrypted page never exposes QR key in data and cancels on leaving', async () => {
  let page, scan, starts = 0, cancelled = 0;
  runInNewContext(await readFile(new URL('../../apps/wechat-mini-program/miniprogram/pages/encrypted-diagnostics/index.js', import.meta.url), 'utf8'), {
    require: () => ({ parseEncryptedQr: () => config, runEncryptedProbe: () => { starts++; return () => cancelled++; } }),
    Page: x => page = x, wx: { scanCode: x => scan = x }
  });
  page.setData = x => Object.assign(page.data, x); page.onLoad(); page.onShow(); page.scanTest(); page.onHide();
  scan.success({ result: JSON.stringify(config) }); assert.equal(starts, 0); assert.equal(JSON.stringify(page.data).includes(config.key), false);
  page.onShow(); assert.equal(starts, 1); assert.equal(page._pending, null); page.onHide(); assert.equal(cancelled, 1);
  page.onUnload(); scan.success({ result: JSON.stringify(config) }); assert.equal(starts, 1);
});
