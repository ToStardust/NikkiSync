import assert from 'node:assert/strict';
import test from 'node:test';
import net from 'node:net';
import { randomBytes, createHash } from 'node:crypto';
import { clientApi } from '../wechat-crypto-spike/client-api.mjs';

const config = () => ({ type: 'NikkiSyncLiveImportProbe', version: 1, host: '192.168.31.130', port: 32123,
  sessionId: randomBytes(16).toString('hex'), key: randomBytes(32).toString('hex'), expiresAt: new Date(Date.now() + 600000).toISOString() });
const names = ['baseline.jpg', 'paired.jpg', 'paired.mov', 'motion.jpg', 'paired.livp'];
const pack = () => new Map(names.map(name => [name, Buffer.from(name.endsWith('.jpg') ? [255,216,255,217]
  : name.endsWith('.mov') ? [0,0,0,12,102,116,121,112,113,116,32,32] : [80,75,3,4])]));

test('Live probe is a distinct QR profile; no public host, path, unknown fields or gallery QR', () => {
  const api = clientApi('live-probe');
  assert.equal(api.parseLiveQr(JSON.stringify(config())).type, 'NikkiSyncLiveImportProbe');
  for (const patch of [{type:'NikkiSyncLocalGalleryDownload'}, {host:'8.8.8.8'}, {path:'C:/private'}, {key:'weak'}, {version:2}])
    assert.throws(() => api.parseLiveQr(JSON.stringify({...config(), ...patch})));
});

test('real authenticated TCP probe delivers five bounded files exactly once, with no database/photo-file API', async () => {
  const { createLiveProbeServer } = await import('./server.mjs');
  const cfg = config(), files = pack(), { server, stop } = createLiveProbeServer(cfg, files);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const wxAdapter = () => {
    let socket; const ev = {};
    return { getRandomValues: o => o.success({randomValues:Uint8Array.from(randomBytes(64)).buffer}),
      createTCPSocket: () => ({onConnect:f=>ev.connect=f,onMessage:f=>ev.message=f,onClose:f=>ev.close=f,onError:f=>ev.error=f,
        connect:()=>{socket=net.connect(server.address().port,'127.0.0.1');socket.on('connect',ev.connect);socket.on('data',b=>ev.message({message:Uint8Array.from(b).buffer}));socket.on('close',ev.close);socket.on('error',ev.error);},
        write:b=>socket.write(Buffer.from(b)),close:()=>socket?.destroy()}) };
  };
  try {
    const api = clientApi('live-probe');
    const result = await new Promise(r => api.receiveLiveProbe(wxAdapter(),cfg,r));
    assert.equal(result.status,'ok'); assert.deepEqual(Object.keys(result.files),names);
    for (const name of names) assert.ok(Buffer.from(result.files[name]).equals(files.get(name)));
    const reuse = await new Promise(r => api.receiveLiveProbe(wxAdapter(),cfg,r));
    assert.equal(reuse.status,'failed'); assert.equal(reuse.files,undefined);
  } finally { await stop(); }
});

test('Live probe rejects incorrect hash, ciphertext, file order, excess size and truncated transfer', () => {
  const api = clientApi('live-probe'), wire = clientApi(), gallery = clientApi('gallery-channel'), vendor = clientApi('noise-vendor');
  for (const variant of ['hash','ciphertext','order','size','truncated']) {
    const cfg=config(), events={}, files=pack(), peer=vendor.createDownloadPeer(false,Buffer.from(cfg.key,'hex'),wire.prologue(cfg),randomBytes(64));
    let stage=0,result;
    const send = plain => { const b=wire.frame(peer.encrypt(plain));if(variant==='ciphertext')b[b.length-1]^=1;events.message({message:b.buffer}); };
    const decoder=gallery.createGalleryDecoder(bytes=>{
      if (!stage++) {peer.receiveHandshake(bytes);events.message({message:wire.frame(peer.sendHandshake()).buffer});return;}
      assert.equal(Buffer.from(peer.decrypt(bytes)).toString(),'NS-LIVE-PROBE/1');
      const manifest = names.map(name=>({name,size:files.get(name).length,sha256:createHash('sha256').update(files.get(name)).digest('hex')}));
      if(variant==='hash')manifest[0].sha256='0'.repeat(64);
      if(variant==='order')manifest.reverse();
      if(variant==='size')manifest[0].size=524289;
      send(gallery.encode({kind:'fixtures',version:1,files:manifest}));
      if(['order','size','ciphertext'].includes(variant))return;
      send(files.get(names[0]));
      if(variant==='truncated'){events.close();return;}
      send(gallery.encode({kind:'file-end',name:names[0]}));
    });
    const socket={onConnect:f=>events.connect=f,onMessage:f=>events.message=f,onClose:f=>events.close=f,onError:f=>events.error=f,
      connect:()=>events.connect(),write:b=>decoder.feed(new Uint8Array(b)),close(){}};
    api.receiveLiveProbe({getRandomValues:o=>o.success({randomValues:Uint8Array.from(randomBytes(64)).buffer}),createTCPSocket:()=>socket},cfg,r=>result=r);
    assert.equal(result.status,'failed',variant);assert.equal(result.files,undefined);peer.close();decoder.close();
  }
});
