import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import test from 'node:test';
import { clientApi } from './client-api.mjs';
// Public deterministic vector, NOT a pairing secret. Cacophony Unlicense; source:
// https://github.com/haskell-cryptography/cacophony/blob/master/vectors/cacophony.txt
const vector = {
  psk: '54686973206973206d7920417573747269616e20706572737065637469766521',
  prologue: '4a6f686e2047616c74',
  ephemeral: ['893e28b9dc6ca8d611ab664754b8ceb7bac5117349a4439a6b0569da977c464a', 'bbdb4cdbd309f1a1f2e1456967fe288cadd6f712d65dc7b7793d5e63da6b375b'],
  hash: 'ed5e9692d0ab507b6c2beec3f584fd5b127817a9d20b26cd50aa72c507260fa31aa7d88dd3723316338af37ce0b4cfb2923aeb848bbf2b934911306f01ffc963',
  messages: [
    ['4c756477696720766f6e204d69736573', 'ca35def5ae56cec33dc2036731ab14896bc4c75dbb07a61f879f8e3afa4c7944ed63df2f5a12aee1185ee9c50305f2ecf12421dcb53c047a63b784cf7c54a105'],
    ['4d757272617920526f746862617264', '95ebc60d2b1fa672c1f46a8aa265ef51bfe38e7ccb39ec5be34069f1448088430e0fe7d5c0c9b92f7478716c8852f1b4f389edb75e3ebe546fafafd5b6f0f7'],
    ['462e20412e20486179656b', '0fe04b26dcfbb69f8a6a94c61f1a26ef88769218d32f5d17c068a6'],
    ['4361726c204d656e676572', '2239e0c540c01f09eb1f4cc5258fd5acfefff18a5a3773f21b7bfe'],
    ['4a65616e2d426170746973746520536179', 'f216cb03d30fb8af1e561fe02a07552d09b416e27a75e62c77d193718b0bdaae9f'],
    ['457567656e2042f6686d20766f6e2042617765726b', '6e8baf98b944184dd7dc5ef14d8108cbeca626de118a5460f3308e294d61e17238bce29bd9']
  ]
};
test('browser Noise matches independent Cacophony full handshake, hash and four transport vectors', () => {
  const { Noise, Cipher } = clientApi('noise-vendor');
  const peers = [true, false].map((initiator, i) => {
    const noise = new Noise('NNpsk0', initiator, { secretKey: new Uint8Array(32), publicKey: new Uint8Array(32) }, { psk: Buffer.from(vector.psk, 'hex') });
    noise.e = noise.curve.generateKeyPair(Uint8Array.from(Buffer.from(vector.ephemeral[i], 'hex')));
    noise.initialise(Buffer.from(vector.prologue, 'hex')); return noise;
  });
  for (let i = 0; i < 2; i++) {
    const [payload, expected] = vector.messages[i], wire = peers[i].send(Buffer.from(payload, 'hex'));
    assert.equal(Buffer.from(wire).toString('hex'), expected);
    assert.equal(Buffer.from(peers[1-i].recv(wire)).toString('hex'), payload);
  }
  for (const peer of peers) assert.equal(Buffer.from(peer.hash).toString('hex'), vector.hash);
  const tx = peers.map(p => new Cipher(p.tx)), rx = peers.map(p => new Cipher(p.rx));
  for (let i = 2; i < 6; i++) {
    const sender = i % 2, [payload, expected] = vector.messages[i], wire = tx[sender].encrypt(Buffer.from(payload, 'hex'));
    assert.equal(Buffer.from(wire).toString('hex'), expected); assert.equal(Buffer.from(rx[1-sender].decrypt(wire)).toString('hex'), payload);
  }
});
test('download profile and original SHA256 are explicit, bounded and do not widen diagnostic/preview hash limits', () => {
  const v=clientApi('noise-vendor');
  assert.equal(typeof v.createDownloadPeer,'function');assert.equal(typeof v.sha256Original,'function');
  const bytes=Uint8Array.from(randomBytes(600000));
  assert.throws(()=>v.sha256(bytes));
  assert.equal(Buffer.from(v.sha256Original(bytes)).toString('hex'),createHash('sha256').update(bytes).digest('hex'));
  assert.throws(()=>v.sha256Original(new Uint8Array(16777217)));
});
test('gallery profile preserves diagnostic limits while permitting bounded chunked previews; SHA256 matches Node', () => {
  const { createPeer, createGalleryPeer, sha256 } = clientApi('noise-vendor'), secret = randomBytes(32);
  assert.equal(typeof createPeer, 'function');
  const a = createGalleryPeer(true, secret, 'gallery', randomBytes(64)), b = createGalleryPeer(false, secret, 'gallery', randomBytes(64));
  b.receiveHandshake(a.sendHandshake()); a.receiveHandshake(b.sendHandshake());
  for (let i = 0; i < 128; i++) assert.deepEqual(Array.from(b.decrypt(a.encrypt(new Uint8Array([i])))), [i]);
  const data = Uint8Array.from(randomBytes(8193));
  assert.equal(Buffer.from(sha256(data)).toString('hex'), createHash('sha256').update(data).digest('hex'));
  a.close(); b.close();
});
