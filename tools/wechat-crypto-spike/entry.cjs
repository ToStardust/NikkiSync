const Noise = require('noise-handshake');
const Cipher = require('noise-handshake/cipher');
const dh = require('noise-handshake/dh');
const b4a = require('b4a');
const { crypto_hash_sha256 } = require('sodium-universal');
// Developer transport evaluation, not production security approval.
function makePeer(initiator, secret, context, entropy, recordLimit) {
  if (!(secret instanceof Uint8Array) || secret.length !== 32 || !(entropy instanceof Uint8Array) || entropy.length !== 64
    || typeof context !== 'string' || context.length > 512 || typeof initiator !== 'boolean') throw new Error('Invalid secure probe inputs');
  const psk = Uint8Array.from(secret), random = Uint8Array.from(entropy); let offset = 0, dead = false, noise, sendCipher, receiveCipher, sends = 0, receives = 0;
  const curve = { ...dh, dh(remote, local) {
    const shared = dh.dh(remote, local);
    if (shared.every(x => x === 0)) { shared.fill(0); throw new Error('Invalid low-order DH'); }
    return shared;
  }, generateKeyPair() {
    if (offset + 32 > random.length) throw new Error('Secure entropy exhausted');
    const key = random.slice(offset, offset + 32); random.fill(0, offset, offset + 32); offset += 32;
    return dh.generateKeyPair(key);
  } };
  const close = () => {
    if (dead) return; dead = true; psk.fill(0); random.fill(0);
    for (const x of [noise && noise.s && noise.s.secretKey, noise && noise.e && noise.e.secretKey,
      noise && noise.chainingKey, noise && noise.key, noise && noise.tx, noise && noise.rx]) if (x) x.fill(0);
    if (sendCipher) sendCipher._clear(); if (receiveCipher) receiveCipher._clear(); noise = null;
  };
  const guarded = action => { if (dead) throw new Error('Secure probe closed'); try { return action(); } catch (_) { close(); throw new Error('Secure probe rejected'); } };
  noise = new Noise('NNpsk0', initiator, null, { psk, curve }); noise.initialise(b4a.from(context));
  const finish = () => {
    if (!noise.complete || sendCipher) return;
    sendCipher = new Cipher(noise.tx); receiveCipher = new Cipher(noise.rx); psk.fill(0); random.fill(0); noise.s.secretKey.fill(0);
  };
  return {
    get complete() { return !dead && !!sendCipher; },
    sendHandshake() { return guarded(() => { if (sendCipher) throw new Error(); const frame = noise.send(); finish(); return frame; }); },
    receiveHandshake(frame) { return guarded(() => { if (sendCipher || frame.length !== 48) throw new Error(); const payload = noise.recv(frame); if (payload.length) throw new Error(); finish(); }); },
    encrypt(bytes) { return guarded(() => { if (!sendCipher || sends++ >= recordLimit || bytes.length > 4096) throw new Error(); return sendCipher.encrypt(bytes); }); },
    decrypt(bytes) { return guarded(() => { if (!receiveCipher || receives++ >= recordLimit || bytes.length < 16 || bytes.length > 4112) throw new Error(); return receiveCipher.decrypt(bytes); }); },
    close
  };
}
function createPeer(initiator, secret, context, entropy) { return makePeer(initiator, secret, context, entropy, 16); }
// Explicit, bounded developer-gallery profile. Never silently widen diagnostic limits.
function createGalleryPeer(initiator, secret, context, entropy) { return makePeer(initiator, secret, context, entropy, 4096); }
function createDownloadPeer(initiator, secret, context, entropy) { return makePeer(initiator, secret, context, entropy, 32768); }
function createLivePeer(initiator, secret, context, entropy) { return makePeer(initiator, secret, context, entropy, 131072); }
function sha256(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length > 524288) throw new Error('Hash input limit');
  const out = new Uint8Array(32); crypto_hash_sha256(out, bytes); return out;
}
function sha256Original(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length > 16777216) throw new Error('Original hash input limit');
  const out = new Uint8Array(32); crypto_hash_sha256(out, bytes); return out;
}
function sha256Live(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length > 100663296) throw new Error('Live hash input limit');
  const out = new Uint8Array(32); crypto_hash_sha256(out, bytes); return out;
}
module.exports = { createPeer, createGalleryPeer, createDownloadPeer, createLivePeer, sha256, sha256Original, sha256Live, Cipher, Noise };
