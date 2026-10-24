import net from 'node:net';
import { randomBytes, createHash } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { mkdirSync, mkdtempSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import QRCode from 'qrcode';
import { clientApi } from '../wechat-crypto-spike/client-api.mjs';
import { openLocalPreviewSource } from './source.mjs';
export function createGalleryServer(config, source, { now = Date.now, events = {} } = {}) {
  const api = clientApi('gallery-channel'), wire = clientApi(), { createGalleryPeer, createDownloadPeer,createLivePeer } = clientApi('noise-vendor');
  const checked = api.parseGalleryQr(JSON.stringify(config)), key = Buffer.from(checked.key, 'hex'); checked.key = null; config = null;
  const liveProfile=checked.type==='NikkiSyncLocalGalleryLive',download = liveProfile||checked.type === 'NikkiSyncLocalGalleryDownload', totalLimit = liveProfile?api.MAX_LIVE_TOTAL:download ? api.MAX_DOWNLOAD_TOTAL : api.MAX_TOTAL;
  const expires = Date.parse(checked.expiresAt), sockets = new Set();let closed=false,claimed=false,attempts=0,resumeKey,activeSocket,sent=0,received=0,quota=0,lastRefresh=-Infinity,workTail=Promise.resolve();
  const server = net.createServer(socket => {
    socket.on('error', () => {});
    if (closed || claimed&&!resumeKey || now() >= expires || sockets.size>=(claimed?2:1) || attempts++ >= 32) { socket.destroy(); return; }
    const resuming=claimed;sockets.add(socket);let peer,stage=0,busy=false,lastReq=0,authenticated=false;
    const write = async bytes => {
      if (closed || socket.destroyed || now() >= expires) throw new Error('Expired');
      const encoded = wire.frame(bytes); if ((sent += encoded.length) > totalLimit) throw new Error('Transfer limit');
      if (!socket.write(encoded)) await new Promise((resolve, reject) => { const drain = () => { cleanup(); resolve(); }, ended = () => { cleanup(); reject(new Error('Closed')); }, cleanup = () => { socket.off('drain', drain); socket.off('close', ended); }; socket.once('drain', drain); socket.once('close', ended); });
    };
    const control = response => write(peer.encrypt(api.encode(response)));
    const handle = async request => {
      try {
        if(request.kind==='session'&&checked.resume===1){
          api.fields(request,['kind','req']);if(request.req!==1)throw new Error('Session order');
          if(!resumeKey)resumeKey=randomBytes(32);
          await control({kind:'session',req:request.req,key:resumeKey.toString('hex'),expiresAt:checked.expiresAt});
        } else if (request.kind === 'list') {
          api.fields(request, ['kind','req','offset']);
          if (!Number.isInteger(request.offset) || request.offset < 0 || request.offset > 500) throw new Error('Offset');
          await control({ kind: 'list', req: request.req, ...source.list(request.offset) });
        } else if(request.kind==='browse' && download) {
          api.fields(request,['kind','req','offset','query']);api.validateBrowseQuery(request.query);
          if(!Number.isInteger(request.offset)||request.offset<0||request.offset>500)throw new Error('Offset');
          try{await control({kind:'browse',req:request.req,...source.browse(request.offset,request.query)});}catch{await control({kind:'error',req:request.req});}
        } else if (request.kind === 'refresh' && download) {
          api.fields(request,['kind','req']);
          try {
            // Polling uses the current scanner index; it never triggers a parallel scanner.
            if(now()-lastRefresh>=5000) {await source.refresh();lastRefresh=now();events.refreshed?.(source.count);}
            await control({kind:'refresh',req:request.req,...source.list(0)});
          } catch { await control({kind:'error',req:request.req}); }
        } else if (request.kind === 'metadata' && download) {
          api.fields(request,['kind','req','id']);if(!/^[a-f0-9]{32}$/.test(request.id)) throw new Error('Id');
          try {await control({kind:'metadata',req:request.req,id:request.id,...source.metadata(request.id)});}
          catch {await control({kind:'error',req:request.req});}
        } else if(request.kind==='outfit'&&download){
          api.fields(request,['kind','req','id','offset']);if(!/^[a-f0-9]{32}$/.test(request.id)||!Number.isInteger(request.offset)||request.offset<0||request.offset>100)throw new Error('Outfit request');
          try{await control({kind:'outfit',req:request.req,id:request.id,...source.outfit(request.id,request.offset)});}catch{await control({kind:'error',req:request.req});}
        } else if (request.kind === 'get' || (['original','export','icon'].includes(request.kind) && download)||(['motion','live'].includes(request.kind)&&liveProfile)) {
          const live=request.kind==='live',motion=request.kind==='motion',media=live||motion,icon=request.kind==='icon',exported=request.kind==='export';api.fields(request, icon?['kind','req','id','key']:exported||live?['kind','req','id','options']:['kind','req','id']); if (!/^[a-f0-9]{32}$/.test(request.id)||icon&&!/^[a-f0-9]{32}$/.test(request.key)) throw new Error('Id');
          if(exported||live)api.validateExportOptions(request.options);
          let image, mime='image/jpeg',extra={}; const original=request.kind === 'original',full=original||exported||media;
          try { if(media){const value=live?await source.live(request.id,request.options):await source.motion(request.id);image=value.image;mime=value.mime;}
            else if(icon){const value=await source.icon(request.id,request.key);image=value.image;mime=value.mime;extra={key:request.key,source:value.source};}
            else if(full){const value=exported?await source.export(request.id,request.options):await source.original(request.id);image=value.image;mime=value.mime;
            if(exported)extra={exifApplied:value.exifApplied,rotation:value.rotation};}else image = await source.preview(request.id); }
          catch { await control({ kind: 'error', req: request.req }); return; }
          try {
            if (!(image instanceof Uint8Array) || image.length < 4 || image.length > (media?api.MAX_LIVE:icon?262144:full ? api.MAX_ORIGINAL : api.MAX_IMAGE) || !(live?mime==='application/x-livp':motion?mime==='video/mp4':['image/jpeg','image/png'].includes(mime))||icon&&(mime!=='image/png'||!['item','category'].includes(extra.source))) throw new Error('Image limit');
            await control({ kind: media?request.kind:icon?'icon':exported?'export':original ? 'original' : 'photo', req: request.req, id: request.id, size: image.length, sha256: createHash('sha256').update(image).digest('hex'), mime,...extra });
            for (let offset = 0; offset < image.length; offset += 4096) await write(peer.encrypt(image.subarray(offset, offset + 4096)));
            await control({ kind: 'end', req: request.req, id: request.id,...(icon?{key:request.key}:{}) });
            if (full) events.transferred?.();
          } finally { image.fill(0); }
        } else throw new Error('Unsupported command');
      } catch { socket.destroy(); }
      finally { busy = false; events.settled?.(); }
    };
    const decoder = api.createGalleryDecoder(bytes => {
      if (closed || now() >= expires) throw new Error('Expired');
      if (stage === 0) {
        peer = (liveProfile?createLivePeer:download ? createDownloadPeer : createGalleryPeer)(false, resuming?resumeKey:key, api.galleryPrologue(checked,resuming), randomBytes(64)); peer.receiveHandshake(bytes); stage = 1;
        void write(peer.sendHandshake()).catch(() => socket.destroy()); return;
      }
      if (busy) throw new Error('Concurrent request');
      const plain = peer.decrypt(bytes); let request;
      try { request = api.decode(plain); } finally { plain.fill(0); }
      if (!Number.isInteger(request.req) || request.req !== lastReq + 1 || ++quota > 256 || checked.resume===1&&lastReq===0&&request.kind!=='session') throw new Error('Request order');
      if(!authenticated){authenticated=true;claimed=true;key.fill(0);const previous=activeSocket;activeSocket=socket;previous?.destroy();events.authenticated?.();socket.setTimeout(Math.max(1,expires-now()),()=>socket.destroy());}
      lastReq=request.req;busy=true;
      // Recovery handshake can finish while a canceled conversion drains, but media work stays serial.
      if(request.kind==='session')void handle(request);
      else {const work=workTail.then(()=>{if(socket.destroyed||closed){busy=false;return;}return handle(request);});workTail=work.catch(()=>{socket.destroy();});}
    }, totalLimit);
    socket.setTimeout(Math.max(1, Math.min(30000, expires - now())), () => socket.destroy());
    socket.on('data', bytes => { try {if((received+=bytes.length)>totalLimit)throw new Error('Transfer limit');decoder.feed(Uint8Array.from(bytes)); } catch { socket.destroy(); } });
    socket.on('close', () => { sockets.delete(socket); decoder.close(); peer?.close(); if (authenticated&&activeSocket===socket){activeSocket=undefined;events.disconnected?.();} });
  });
  const stop = () => new Promise(resolve => { closed = true; key.fill(0);resumeKey?.fill(0);resumeKey=undefined;for (const socket of sockets) socket.destroy();server.close(()=>{source.close?.();resolve();}); });
  const timer = setTimeout(() => { void stop(); }, Math.max(1, expires - now())); timer.unref();
  return { server, stop: () => { clearTimeout(timer); return stop(); } };
}
async function main() {
  if (process.argv.length !== 2) throw new Error('No file paths or arbitrary command options accepted');
  const source = await openLocalPreviewSource(join(process.env.LOCALAPPDATA, 'NikkiSync', 'nikkisync.sqlite'));
  const wifi = Object.entries(networkInterfaces()).flatMap(([name, values]) => /WLAN|Wi-Fi|Wireless/i.test(name) ? values || [] : [])
    .filter(x => x.family === 'IPv4' && !x.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(x.address));
  if (wifi.length !== 1) throw new Error('Need one private Wi-Fi IPv4');
  const host = wifi[0].address, expiry = Date.now() + 600000;
  const reserve = net.createServer(); await new Promise((resolve, reject) => { reserve.once('error', reject); reserve.listen(0, host, resolve); });
  const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
  let config = { type: 'NikkiSyncLocalGalleryDownload', version: 1,resume:1,host,port,key:randomBytes(32).toString('hex'),sessionId:randomBytes(16).toString('hex'),expiresAt:new Date(expiry).toISOString() };
  const { server, stop } = createGalleryServer(config, source); await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  let qrFile, stopping = false;
  const shutdown = async () => { if (stopping) return; stopping = true; await stop(); if (qrFile) { try { unlinkSync(qrFile); } catch {} } };
  try {
    const out = resolve('out'); mkdirSync(out, { recursive: true }); const dir = mkdtempSync(join(out, 'wechat-local-gallery-'));
    qrFile = join(dir, 'private-gallery-qr.png'); await QRCode.toFile(qrFile, JSON.stringify(config), { width: 720, margin: 2 }); config = null;
    console.log(JSON.stringify({ qrFile, expiresAt: new Date(expiry).toISOString(), photoCount: source.count, originalDownload: true, privateQr: true }));
    const timer = setTimeout(() => { void shutdown(); }, expiry - Date.now()); timer.unref();
    process.once('SIGINT', () => { clearTimeout(timer); void shutdown(); }); process.once('SIGTERM', () => { clearTimeout(timer); void shutdown(); });
  } catch { await shutdown(); throw new Error('Local gallery could not start'); }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
