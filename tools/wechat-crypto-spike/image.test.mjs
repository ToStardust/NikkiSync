import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { inflateSync } from 'node:zlib';
import test from 'node:test';
import { clientApi } from './client-api.mjs';
const config = () => ({ type: 'NikkiSyncEncryptedImageProbe', version: 1, host: '192.168.31.130', port: 32000,
  sessionId: 'a'.repeat(32), key: 'b'.repeat(64), expiresAt: new Date(Date.now() + 600000).toISOString() });
test('synthetic PNG independently decodes to four coloured 96x96 quadrants with valid CRCs', () => {
  const png = Buffer.from(clientApi('synthetic-image').imageBytes()), compressed = [];
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  let offset = 8;
  while (offset < png.length) {
    const n = png.readUInt32BE(offset), name = png.toString('ascii', offset + 4, offset + 8), data = png.subarray(offset + 8, offset + 8 + n);
    let crc = 0xffffffff;
    for (const v of png.subarray(offset + 4, offset + 8 + n)) { crc ^= v; for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    assert.equal((crc ^ 0xffffffff) >>> 0, png.readUInt32BE(offset + 8 + n));
    if (name === 'IHDR') { assert.equal(data.readUInt32BE(0), 96); assert.equal(data.readUInt32BE(4), 96); }
    if (name === 'IDAT') compressed.push(data); offset += n + 12;
  }
  const raw = inflateSync(Buffer.concat(compressed)); assert.equal(raw.length, 96 * 289);
  for (let y = 0; y < 96; y++) {
    assert.equal(raw[y * 289], 0);
    for (let x = 0; x < 96; x++) assert.deepEqual(Array.from(raw.subarray(y * 289 + 1 + x * 3, y * 289 + 4 + x * 3)), [x < 48 ? 240 : 100, y < 48 ? 150 : 220, x < 48 ? 190 : 250]);
  }
});

test('image protocol is separate; accepts only the entire known synthetic PNG envelope', () => {
  const p = clientApi(), image = clientApi('synthetic-image');
  assert.equal(p.parseEncryptedImageQr(JSON.stringify(config())).type, config().type);
  assert.throws(() => p.parseEncryptedQr(JSON.stringify(config())));
  assert.throws(() => p.parseEncryptedImageQr(JSON.stringify({ ...config(), type: 'NikkiSyncEncryptedTcpProbe' })));
  assert.deepEqual(Array.from(image.verifyImagePayload(image.imagePayload())), Array.from(image.imageBytes()));
  for (const bytes of [image.imagePayload().slice(1), image.imagePayload().slice(0, -1), new Uint8Array(4096)])
    assert.throws(() => image.verifyImagePayload(bytes));
  const changed = image.imagePayload(); changed[changed.length - 1] ^= 1;
  assert.throws(() => image.verifyImagePayload(changed));
});

test('Noise image transfer accepts fragmented verified PNG, rejects authenticated wrong bytes and damaged ciphertext', () => {
  const p = clientApi(), image = clientApi('synthetic-image'), vendor = clientApi('noise-vendor');
  for (const variant of ['valid', 'wrong-image', 'tampered', 'truncated']) {
    const qr = config(), events = {}, server = vendor.createPeer(false, Buffer.from(qr.key, 'hex'), p.prologue(qr), randomBytes(64));
    let phase = 0, result, closed = 0;
    const decoder = p.createDecoder(bytes => {
      if (phase++ === 0) { server.receiveHandshake(bytes); events.message({ message: p.frame(server.sendHandshake()).buffer }); }
      else {
        assert.equal(Buffer.from(server.decrypt(bytes)).toString(), 'NS-IMAGE-PROBE/1');
        const payload = image.imagePayload(); if (variant === 'wrong-image') payload[payload.length - 1] ^= 1;
        const reply = p.frame(server.encrypt(payload)); if (variant === 'tampered') reply[reply.length - 1] ^= 1;
        events.message({ message: reply.slice(0, 8).buffer });
        if (variant !== 'truncated') events.message({ message: reply.slice(8).buffer });
        else events.close();
      }
    });
    const socket = { onConnect: f => events.connect = f, onMessage: f => events.message = f, onError: f => events.error = f, onClose: f => events.close = f,
      connect: () => events.connect(), write: x => decoder.feed(new Uint8Array(x)), close: () => closed++ };
    p.runEncryptedImageProbe({ getRandomValues: o => o.success({ randomValues: Uint8Array.from(randomBytes(64)).buffer }), createTCPSocket: () => socket }, qr, x => result = x);
    assert.equal(result.status, variant === 'valid' ? 'ok' : 'failed'); assert.equal(closed, 1);
    if (variant === 'valid') assert.deepEqual(Array.from(result.image), Array.from(image.imageBytes()));
    else assert.equal(result.image, undefined);
    server.close(); decoder.close();
  }
});

async function pageHarness() {
  let page, scan, response, write, save; const removed = []; let cancels = 0;
  runInNewContext(await readFile(new URL('../../apps/wechat-mini-program/miniprogram/pages/image-diagnostics/index.js', import.meta.url), 'utf8'), {
    Date, ArrayBuffer, Uint8Array, Page: x => page = x,
    require: () => ({ parseEncryptedImageQr: () => config(), runEncryptedImageProbe: (_w, _c, done) => { response = done; return () => cancels++; } }),
    wx: { env: { USER_DATA_PATH: '/own-cache' }, scanCode: x => scan = x,
      getFileSystemManager: () => ({ writeFile: x => write = x, unlink: x => removed.push(x.filePath) }), saveImageToPhotosAlbum: x => save = x }
  });
  page.setData = x => Object.assign(page.data, x); page.onLoad(); page.onShow();
  return { page, removed, scan: () => scan, write: () => write, save: () => save, cancels: () => cancels,
    receive: () => { page.scanTest(); scan.success({ result: '{}' }); response({ status: 'ok', image: new Uint8Array([1,2,3]), message: 'verified' }); } };
}

test('verified file previews before explicit save; denial is not success; unload removes only own cache', async () => {
  const h = await pageHarness(); h.receive();
  assert.equal(h.save(), undefined); assert.equal(h.page.data.imagePath, '');
  const write = h.write(); assert.ok(write.data instanceof ArrayBuffer); assert.match(write.filePath, /^\/own-cache\/nikkisync-synthetic-/);
  write.success(); assert.equal(h.page.data.imagePath, write.filePath); assert.equal(h.save(), undefined);
  h.page.saveImage(); assert.equal(h.save(), undefined); h.page.imageLoaded();
  assert.equal(JSON.stringify(h.page.data).includes(config().key), false);
  h.page.saveImage(); h.save().fail(); assert.match(h.page.data.message, /未保存/);
  h.page.saveImage(); h.save().success(); assert.match(h.page.data.message, /已保存/);
  h.page.onUnload(); assert.deepEqual(h.removed, [write.filePath]);
});
test('leaving during explicit album save retains its input until callback; preview decode failure disables save', async () => {
  const h = await pageHarness(); h.receive(); h.write().success(); h.page.imageLoaded(); h.page.saveImage(); const saving = h.save();
  h.page.onUnload(); assert.deepEqual(h.removed, []); saving.success(); assert.deepEqual(h.removed, [h.write().filePath]);
  const other = await pageHarness(); other.receive(); other.write().success(); other.page.imageFailed(); other.page.saveImage();
  assert.equal(other.save(), undefined); assert.equal(other.page.data.imagePath, ''); assert.equal(other.removed.length, 1);
});

test('late cache writes after unload are cleaned and never displayed or saved; scan background defers connection', async () => {
  const h = await pageHarness(); h.receive(); const write = h.write(); h.page.onUnload(); write.success();
  assert.equal(h.page.data.imagePath, ''); assert.equal(h.save(), undefined); assert.ok(h.removed.includes(write.filePath));
  const other = await pageHarness(); other.page.scanTest(); other.page.onHide(); other.scan().success({ result: '{}' });
  assert.equal(other.write(), undefined); other.page.onShow(); other.page.onHide(); assert.ok(other.cancels() > 0);
});
