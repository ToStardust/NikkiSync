import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const now = Date.parse('2026-10-02T10:00:00Z');
const config = { type: 'NikkiSyncLanTlsProbe', version: 1, endpoint: 'https://192.168.31.130:32000', nonce: 'a'.repeat(32), expiresAt: new Date(now + 600000).toISOString() };
async function load() {
  const module = { exports: {} };
  runInNewContext(await readFile(new URL('../apps/wechat-mini-program/miniprogram/lib/lan-probe.js', import.meta.url), 'utf8'),
    { module, Date: class extends Date { static now() { return now; } }, Uint8Array });
  return module.exports;
}
test('probe QR rejects public/HTTP/expired/real photo session payloads', async () => {
  const { parseProbeQr } = await load();
  assert.equal(parseProbeQr(JSON.stringify(config)).endpoint, config.endpoint);
  for (const patch of [{ endpoint: 'http://192.168.1.1' }, { endpoint: 'https://8.8.8.8' },
    { endpoint: 'https://192.168.1.1/path' }, { endpoint: 'https://192.168.01.1' },
    { endpoint: 'https://192.168.1.1:65536' }, { type: 'NikkiSyncRemoteBridge' },
    { expiresAt: new Date(now).toISOString() }, { nonce: '../secret' },
    { expiresAt: new Date(now + 700000).toISOString() }]) {
    assert.throws(() => parseProbeQr(JSON.stringify({ ...config, ...patch })));
  }
});
test('probe sends no credentials, accepts exact synthetic challenge then image', async () => {
  const { runProbe } = await load();
  const requests = []; let result;
  runProbe({ request: options => { requests.push(options); return { abort() {} }; } }, config, value => { result = value; });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'GET');
  assert.equal(requests[0].timeout, 5000);
  assert.equal(requests[0].data, undefined);
  assert.equal(requests[0].header, undefined);
  requests[0].success({ statusCode: 200, data: { type: 'NikkiSyncLanTlsProbe', nonce: config.nonce } });
  assert.equal(requests.length, 2);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aXcAAAAASUVORK5CYII=', 'base64');
  const imageBytes = Uint8Array.from(png);
  requests[1].success({ statusCode: 200, data: imageBytes.buffer });
  assert.equal(result.status, 'ok');
  assert.equal(result.bytes, png.length);
});
test('TLS failure is reported, never retried through HTTP or alternate server', async () => {
  const { runProbe } = await load();
  const requests = []; let result;
  runProbe({ request: options => { requests.push(options); return { abort() {} }; } }, config, value => { result = value; });
  requests[0].fail({ errMsg: 'request:fail SSL handshake failed' });
  assert.equal(result.status, 'failed');
  assert.match(result.message, /SSL handshake failed/);
  assert.equal(requests.length, 1);
});
test('wrong challenge and non-image response cannot be reported as success', async () => {
  const { runProbe } = await load();
  for (const response of [{ statusCode: 302, data: {} }, { statusCode: 200, data: { type: config.type, nonce: 'wrong' } }]) {
    let request, result;
    runProbe({ request: options => { request = options; return { abort() {} }; } }, config, value => { result = value; });
    request.success(response);
    assert.equal(result.status, 'failed');
  }
});
test('cancel aborts active request and suppresses late callbacks', async () => {
  const { runProbe } = await load();
  let request, result, aborted = 0;
  const cancel = runProbe({ request: options => { request = options; return { abort() { aborted++; } }; } }, config, value => { result = value; });
  cancel(); request.fail({ errMsg: 'late failure' });
  assert.equal(aborted, 1); assert.equal(result, undefined);
});
test('invalid direct run configuration performs no request', async () => {
  const { runProbe } = await load();
  let requests = 0, result;
  runProbe({ request: () => { requests++; } }, { ...config, endpoint: 'https://evil.example' }, value => { result = value; });
  assert.equal(requests, 0); assert.equal(result.status, 'failed');
});
