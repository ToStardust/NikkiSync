const { parseTcpQr } = require('./tcp-probe.js');
const { createPeer } = require('./noise-vendor.js');
const { verifyImagePayload } = require('./synthetic-image.js');
function parseEncryptedQr(raw) {
  let v;
  try { if (typeof raw !== 'string' || raw.length > 2048) throw new Error(); v = JSON.parse(raw); } catch (_) { throw new Error('不是有效的加密测试码。'); }
  const allowed = ['type', 'version', 'host', 'port', 'sessionId', 'key', 'expiresAt'];
  if (!v || Object.keys(v).some(x => allowed.indexOf(x) < 0) || v.type !== 'NikkiSyncEncryptedTcpProbe'
    || typeof v.key !== 'string' || !/^[a-f0-9]{64}$/.test(v.key) || typeof v.sessionId !== 'string' || !/^[a-f0-9]{32}$/.test(v.sessionId))
    throw new Error('加密测试码无效。');
  parseTcpQr(JSON.stringify({ type: 'NikkiSyncLanTcpProbe', version: v.version, host: v.host, port: v.port, nonce: v.sessionId, expiresAt: v.expiresAt }));
  return { type: v.type, version: 1, host: v.host, port: v.port, sessionId: v.sessionId, key: v.key, expiresAt: v.expiresAt };
}
function prologue(v) { return JSON.stringify([v.type, v.version, v.host, v.port, v.sessionId, v.expiresAt, 'Noise_NNpsk0_25519_ChaChaPoly_BLAKE2b']); }
function parseEncryptedImageQr(raw) {
  let v;
  try { if (typeof raw !== 'string' || raw.length > 2048) throw new Error(); v = JSON.parse(raw); } catch (_) { throw new Error('图片测试码无效。'); }
  if (!v || v.type !== 'NikkiSyncEncryptedImageProbe') throw new Error('不是图片专用测试码。');
  const checked = parseEncryptedQr(JSON.stringify(Object.assign({}, v, { type: 'NikkiSyncEncryptedTcpProbe' })));
  checked.type = v.type; return checked;
}
function frame(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 1 || bytes.length > 4112) throw new Error('Invalid frame');
  const out = new Uint8Array(bytes.length + 2); out[0] = bytes.length >>> 8; out[1] = bytes.length & 255; out.set(bytes, 2); return out;
}
function createDecoder(onFrame) {
  let buffer = new Uint8Array(0), dead = false, total = 0;
  const close = () => { dead = true; buffer.fill(0); buffer = new Uint8Array(0); };
  return { close, feed(bytes) {
    if (dead) throw new Error('Decoder closed');
    try {
      if (!(bytes instanceof Uint8Array) || (total += bytes.length) > 8192 || buffer.length + bytes.length > 8192) throw new Error();
      const next = new Uint8Array(buffer.length + bytes.length); next.set(buffer); next.set(bytes, buffer.length); buffer.fill(0); buffer = next;
      while (!dead && buffer.length >= 2) {
        const length = buffer[0] * 256 + buffer[1]; if (!length || length > 4112) throw new Error();
        if (buffer.length < length + 2) return;
        const value = buffer.slice(2, length + 2), rest = buffer.slice(length + 2); buffer.fill(0); buffer = rest;
        try { onFrame(value); } finally { value.fill(0); }
      }
    } catch (_) { close(); throw new Error('Frame rejected'); }
  } };
}
function ascii(text) { return Uint8Array.from(text.split('').map(x => x.charCodeAt(0))); }
function matches(bytes, text) { return bytes.length === text.length && bytes.every((x, i) => x === text.charCodeAt(i)); }
function decodeKey(hex) { return Uint8Array.from(hex.match(/../g).map(x => parseInt(x, 16))); }
function runSession(wxApi, config, done, imageMode) {
  let stopped = false, socket, peer, decoder, key, timer, stage = 0, checked;
  const cleanup = () => { clearTimeout(timer); if (decoder) decoder.close(); if (peer) peer.close(); if (key) key.fill(0); checked = null; config = null;
    if (socket) { try { socket.close(); } catch (_) {} } };
  const finish = value => { if (stopped) return; stopped = true; cleanup(); done(value); };
  const fail = () => finish({ status: 'failed', message: '加密诊断失败：接口、随机数、超时、密钥或响应验证未通过。未降级为明文。' });
  const cancel = () => { if (!stopped) { stopped = true; cleanup(); } };
  try {
    checked = (imageMode ? parseEncryptedImageQr : parseEncryptedQr)(JSON.stringify(config)); key = decodeKey(checked.key); checked.key = null; config = null;
    if (typeof wxApi.getRandomValues !== 'function' || typeof wxApi.createTCPSocket !== 'function') throw new Error();
    timer = setTimeout(fail, Math.min(15000, Date.parse(checked.expiresAt) - Date.now()));
    wxApi.getRandomValues({ length: 64,
      fail,
      success: value => {
        let entropy;
        try {
          if (!(value.randomValues instanceof ArrayBuffer) || value.randomValues.byteLength !== 64) throw new Error();
          entropy = new Uint8Array(value.randomValues);
          if (stopped) { entropy.fill(0); return; }
          if (Date.now() >= Date.parse(checked.expiresAt)) throw new Error();
          peer = createPeer(true, key, prologue(checked), entropy); entropy.fill(0); key.fill(0);
          socket = wxApi.createTCPSocket();
          const send = bytes => { const encoded = frame(bytes); socket.write(encoded.buffer); };
          decoder = createDecoder(bytes => {
            if (Date.now() >= Date.parse(checked.expiresAt)) throw new Error();
            if (stage === 1) { peer.receiveHandshake(bytes); stage = 2; send(peer.encrypt(ascii(imageMode ? 'NS-IMAGE-PROBE/1' : 'NS-ENCRYPTED-PROBE/1'))); }
            else if (stage === 2) {
              const plain = peer.decrypt(bytes); let image;
              try { if (imageMode) image = verifyImagePayload(plain); else if (!matches(plain, 'NS-ENCRYPTED-OK/1')) throw new Error(); }
              finally { plain.fill(0); }
              stage = 3;
              finish(imageMode ? { status: 'ok', image, message: '合成图片已通过加密认证和完整字节校验，尚未保存。' }
                : { status: 'ok', message: '加密合成文本往返成功（扫码密钥绑定）。尚未验收真实照片、保存相册或 iPhone。' });
            } else throw new Error();
          });
          socket.onConnect(() => { if (stopped) return; try { if (stage !== 0) throw new Error(); stage = 1; send(peer.sendHandshake()); } catch (_) { fail(); } });
          socket.onMessage(event => { if (stopped) return; try { if (!(event.message instanceof ArrayBuffer)) throw new Error(); decoder.feed(new Uint8Array(event.message)); } catch (_) { fail(); } });
          socket.onError(fail); socket.onClose(fail); socket.connect({ address: checked.host, port: checked.port });
        } catch (_) { if (entropy) entropy.fill(0); fail(); }
      }
    });
  } catch (_) { fail(); }
  return cancel;
}
function runEncryptedProbe(wxApi, config, done) { return runSession(wxApi, config, done, false); }
function runEncryptedImageProbe(wxApi, config, done) { return runSession(wxApi, config, done, true); }
module.exports = { parseEncryptedQr, parseEncryptedImageQr, prologue, frame, createDecoder, runEncryptedProbe, runEncryptedImageProbe };
