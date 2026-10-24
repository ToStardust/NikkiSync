import assert from 'node:assert/strict';
import http from 'node:http';
import { inflateSync } from 'node:zlib';
import test from 'node:test';

test('isolated synthetic server only exposes health/image, closes logically on expiry', async () => {
  const { createProbeHandler, syntheticPng } = await import('./wechat-lan-server.mjs');
  const nonce = 'a'.repeat(32); let now = 0;
  const handler = createProbeHandler({ nonce, expiresAtMs: 1000, now: () => now });
  const server = http.createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const health = await fetch(base + `/probe/${nonce}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { type: 'NikkiSyncLanTlsProbe', nonce });
    assert.equal(health.headers.get('cache-control'), 'no-store');
    const image = await fetch(base + `/probe/${nonce}/sample.png`);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), syntheticPng());
    assert.equal((await fetch(base + '/api/assets')).status, 404);
    assert.equal((await fetch(base + `/probe/${nonce}/health`, { method: 'POST' })).status, 405);
    now = 1000;
    assert.equal((await fetch(base + `/probe/${nonce}/health`)).status, 410);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('synthetic PNG contains a real 1x1 RGBA image payload', async () => {
  const { syntheticPng } = await import('./wechat-lan-server.mjs');
  const bytes = syntheticPng();
  assert.equal(bytes.readUInt32BE(16), 1);
  assert.equal(bytes.readUInt32BE(20), 1);
  assert.equal(bytes[25], 6);
  let offset = 8, pixels;
  while (offset < bytes.length) {
    const size = bytes.readUInt32BE(offset), name = bytes.toString('ascii', offset + 4, offset + 8);
    if (name === 'IDAT') pixels = inflateSync(bytes.subarray(offset + 8, offset + 8 + size));
    offset += size + 12;
  }
  assert.deepEqual(pixels, Buffer.from([0, 51, 91, 78, 255]));
});
