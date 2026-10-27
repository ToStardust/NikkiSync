import assert from 'node:assert/strict';
import { randomBytes, createDecipheriv } from 'node:crypto';
import test from 'node:test';
import { clientApi } from './client-api.mjs';
const api = () => clientApi('noise-vendor');
test('Noise NNpsk0 mutually binds QR secret and context, encrypted transport interoperates with OpenSSL', () => {
  const { createPeer, Cipher } = api();
  const secret = randomBytes(32), context = 'synthetic-only:session-1';
  const a = createPeer(true, secret, context, randomBytes(64));
  const b = createPeer(false, secret, context, randomBytes(64));
  const first = a.sendHandshake(); b.receiveHandshake(first);
  const second = b.sendHandshake(); a.receiveHandshake(second);
  assert.equal(a.complete, true); assert.equal(b.complete, true);
  const msg = Buffer.from('synthetic-encrypted-text'); const encrypted = a.encrypt(msg);
  assert.equal(Buffer.from(b.decrypt(encrypted)).toString(), msg.toString());
  assert.equal(Buffer.from(encrypted).includes(msg), false);
  // Independent Node/OpenSSL ChaCha20-Poly1305 verification, nonce zero.
  const key = randomBytes(32), fixture = new Cipher(key).encrypt(msg);
  const decipher = createDecipheriv('chacha20-poly1305', key, Buffer.alloc(12), { authTagLength: 16 });
  decipher.setAuthTag(Buffer.from(fixture).subarray(-16));
  assert.deepEqual(Buffer.concat([decipher.update(Buffer.from(fixture).subarray(0, -16)), decipher.final()]), msg);
  a.close(); b.close(); assert.throws(() => a.encrypt(msg));
});
function pair() {
  const { createPeer } = api(); const secret = randomBytes(32);
  const a = createPeer(true, secret, 'context', randomBytes(64)); const b = createPeer(false, secret, 'context', randomBytes(64));
  b.receiveHandshake(a.sendHandshake()); a.receiveHandshake(b.sendHandshake()); return { a, b };
}
test('wrong QR key/context and altered handshake fail', () => {
  const { createPeer } = api(); const secret = randomBytes(32);
  for (const mismatch of ['key', 'context', 'tamper']) {
    const a = createPeer(true, secret, 'context', randomBytes(64));
    const b = createPeer(false, mismatch === 'key' ? randomBytes(32) : secret, mismatch === 'context' ? 'other' : 'context', randomBytes(64));
    const frame = a.sendHandshake(); if (mismatch === 'tamper') frame[frame.length - 1] ^= 1;
    assert.throws(() => b.receiveHandshake(frame)); assert.throws(() => b.sendHandshake()); a.close(); b.close();
  }
});
test('transport tamper, replay, reordering and cross-session replay fail closed', () => {
  for (const mode of ['tamper', 'replay', 'reorder', 'cross']) {
    const { a, b } = pair(); const frame = a.encrypt(new Uint8Array([1, 2, 3]));
    if (mode === 'tamper') frame[0] ^= 1;
    if (mode === 'replay') b.decrypt(frame);
    if (mode === 'reorder') frame.set(a.encrypt(new Uint8Array([4, 5, 6])));
    if (mode === 'cross') { const other = pair(); frame.set(other.a.encrypt(new Uint8Array([1, 2, 3]))); other.a.close(); other.b.close(); }
    assert.throws(() => b.decrypt(frame)); assert.throws(() => b.decrypt(frame)); a.close(); b.close();
  }
});
test('no entropy, premature transport and excessive records fail closed', () => {
  const { createPeer } = api();
  assert.throws(() => createPeer(true, randomBytes(32), 'context', new Uint8Array(63)));
  const a = createPeer(true, randomBytes(32), 'context', randomBytes(64)); assert.throws(() => a.encrypt(new Uint8Array([1])));
  a.close();
  const p = pair(); assert.throws(() => p.a.encrypt(new Uint8Array(4097))); p.a.close(); p.b.close();
  const limited = pair(); for (let i = 0; i < 16; i++) limited.b.decrypt(limited.a.encrypt(new Uint8Array([i])));
  assert.throws(() => limited.a.encrypt(new Uint8Array([17]))); limited.a.close(); limited.b.close();
});
test('browser bundle works without native crypto/WASM and rejects low-order DH', async () => {
  const { readFile } = await import('node:fs/promises'); const { runInNewContext } = await import('node:vm');
  const module = { exports: {} };
  runInNewContext(await readFile(new URL('../../apps/wechat-mini-program/miniprogram/lib/noise-vendor.js', import.meta.url), 'utf8'), { module, Uint8Array, ArrayBuffer, DataView });
  const { createPeer, Noise } = module.exports, secret = Uint8Array.from(randomBytes(32));
  const bad = new Noise('NNpsk0', true, null, { psk: secret, curve: {
    PKLEN: 32, ALG: '25519', generateKeyPair: () => ({ secretKey: Uint8Array.from(randomBytes(32)), publicKey: new Uint8Array(32) })
  } });
  bad.initialise(Uint8Array.from(Buffer.from('context')));
  const server = createPeer(false, secret, 'context', Uint8Array.from(randomBytes(64)));
  server.receiveHandshake(bad.send()); assert.throws(() => server.sendHandshake()); server.close();
});
