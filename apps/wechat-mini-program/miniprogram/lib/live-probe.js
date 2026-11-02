const { parseEncryptedQr, prologue, frame } = require('./encrypted-probe.js');
const { createGalleryDecoder, encode, decode, fields } = require('./gallery-channel.js');
const { createDownloadPeer, sha256Original } = require('./noise-vendor.js');
const NAMES = ['baseline.jpg', 'paired.jpg', 'paired.mov', 'motion.jpg', 'paired.livp'];
const MAX_FILE = 524288, MAX_TRANSFER = 2097152;
function parseLiveQr(raw) {
  let value;
  try { if (typeof raw !== 'string' || raw.length > 2048) throw Error(); value = JSON.parse(raw); } catch (_) { throw Error('Live 测试码无效。'); }
  if (!value || value.type !== 'NikkiSyncLiveImportProbe') throw Error('请使用独立的 Live 合成测试码。');
  const checked = parseEncryptedQr(JSON.stringify(Object.assign({}, value, { type: 'NikkiSyncEncryptedTcpProbe' })));
  checked.type = value.type; return checked;
}
function manifestFiles(value) {
  fields(value, ['kind', 'version', 'files']);
  if (value.kind !== 'fixtures' || value.version !== 1 || !Array.isArray(value.files) || value.files.length !== NAMES.length) throw Error('Invalid fixtures');
  let total = 0;
  value.files.forEach((file, i) => {
    fields(file, ['name', 'size', 'sha256']);
    if (file.name !== NAMES[i] || !Number.isInteger(file.size) || file.size < 4 || file.size > MAX_FILE
      || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) throw Error('Invalid fixture');
    total += file.size;
  });
  if (total > MAX_TRANSFER - 65536) throw Error('Probe limit');
  return value.files;
}
function verify(bytes, file) {
  const digest = Array.from(sha256Original(bytes)).map(x => ('0' + x.toString(16)).slice(-2)).join('');
  if (digest !== file.sha256) throw Error('Digest');
  if (file.name.slice(-4) === '.jpg' && !(bytes[0] === 255 && bytes[1] === 216)) throw Error('JPEG');
  if (file.name.slice(-4) === '.mov' && !(bytes.length >= 12 && [102,116,121,112].every((x,i)=>bytes[i+4]===x))) throw Error('MOV');
  if (file.name.slice(-5) === '.livp' && ![80,75,3,4].every((x,i)=>bytes[i]===x)) throw Error('ZIP');
}
function receiveLiveProbe(wxApi, config, done) {
  let checked, key, peer, socket, decoder, timer, stopped = false, stage = 0, specs, index = 0, buffer, offset = 0, total = 0;
  const files = {};
  const cleanup = failed => {
    clearTimeout(timer); if (decoder) decoder.close(); if (peer) peer.close(); if (key) key.fill(0);
    if (buffer) buffer.fill(0); buffer = null; config = null; checked = null;
    if (failed) Object.keys(files).forEach(name => files[name].fill(0));
    if (socket) { try { socket.close(); } catch (_) {} }
  };
  const finish = result => { if (stopped) return; stopped = true; cleanup(result.status !== 'ok'); done(result); };
  const fail = () => finish({ status: 'failed', message: '测试接收未通过：连接、超时或完整性校验失败。请在电脑重新生成测试码；未保存相册。' });
  try {
    checked = parseLiveQr(JSON.stringify(config)); key = Uint8Array.from(checked.key.match(/../g).map(x => parseInt(x,16))); checked.key = null; config = null;
    if (typeof wxApi.getRandomValues !== 'function' || typeof wxApi.createTCPSocket !== 'function') throw Error();
    timer = setTimeout(fail, Math.min(20000, Date.parse(checked.expiresAt)-Date.now()));
    wxApi.getRandomValues({ length: 64, fail, success: value => {
      let entropy;
      try {
        if (!(value.randomValues instanceof ArrayBuffer) || value.randomValues.byteLength !== 64) throw Error();
        entropy = new Uint8Array(value.randomValues);
        if (stopped) { entropy.fill(0); return; }
        peer = createDownloadPeer(true,key,prologue(checked),entropy); entropy.fill(0); key.fill(0);
        socket = wxApi.createTCPSocket();
        decoder = createGalleryDecoder(bytes => {
          if (Date.now() >= Date.parse(checked.expiresAt)) throw Error('Expired');
          if (stage === 1) { peer.receiveHandshake(bytes); stage = 2; socket.write(frame(peer.encrypt(Uint8Array.from('NS-LIVE-PROBE/1'.split('').map(x=>x.charCodeAt(0))))).buffer); return; }
          const plain = peer.decrypt(bytes);
          try {
            if (stage === 2) { specs = manifestFiles(decode(plain)); stage = 3; buffer = new Uint8Array(specs[0].size); return; }
            if (stage !== 3 || !specs) throw Error('Order');
            const spec = specs[index];
            if (offset < spec.size) {
              if (plain.length > spec.size - offset) throw Error('Overrun');
              buffer.set(plain, offset); offset += plain.length; return;
            }
            const end = decode(plain); fields(end,['kind','name']);
            if (end.kind !== 'file-end' || end.name !== spec.name) throw Error('Order');
            verify(buffer,spec); files[spec.name] = buffer; buffer = null; offset = 0; index++;
            if (index === specs.length) { stage = 4; finish({status:'ok',files}); }
            else buffer = new Uint8Array(specs[index].size);
          } finally { plain.fill(0); }
        });
        socket.onConnect(() => { if (stopped) return; try { if(stage !== 0)throw Error();stage=1;socket.write(frame(peer.sendHandshake()).buffer); } catch (_) { fail(); } });
        socket.onMessage(event => { if(stopped)return;try{if(!(event.message instanceof ArrayBuffer)||(total+=event.message.byteLength)>MAX_TRANSFER)throw Error();decoder.feed(new Uint8Array(event.message));}catch(_){fail();} });
        socket.onError(fail); socket.onClose(fail); socket.connect({address:checked.host,port:checked.port});
      } catch (_) { if(entropy)entropy.fill(0); fail(); }
    }});
  } catch (_) { fail(); }
  return () => { if(!stopped){stopped=true;cleanup(true);} };
}
module.exports = { NAMES, MAX_FILE, MAX_TRANSFER, parseLiveQr, manifestFiles, receiveLiveProbe };
