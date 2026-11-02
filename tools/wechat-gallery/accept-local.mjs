// Local-only real-photo acceptance, never prints bytes, source paths, UID or QR secrets.
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { openLocalPreviewSource } from './source.mjs';
import { createGalleryServer } from './server.mjs';
import { clientApi } from '../wechat-crypto-spike/client-api.mjs';
const source = await openLocalPreviewSource(join(process.env.LOCALAPPDATA, 'NikkiSync', 'nikkisync.sqlite'));
const config = { type: 'NikkiSyncLocalGalleryPreview', version: 1, host: '192.168.31.130', port: 12345,
  sessionId: randomBytes(16).toString('hex'), key: randomBytes(32).toString('hex'), expiresAt: new Date(Date.now() + 600000).toISOString() };
const { server, stop } = createGalleryServer(config, source); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let channel;
try {
  const events = {}; let socket;
  await new Promise((resolve, reject) => {
    channel = clientApi('gallery-channel').connectGallery({ getRandomValues: o => o.success({ randomValues: Uint8Array.from(randomBytes(64)).buffer }),
      createTCPSocket: () => ({ onConnect:f=>events.connect=f,onMessage:f=>events.message=f,onError:f=>events.error=f,onClose:f=>events.close=f,
        connect:()=>{socket=net.connect(server.address().port,'127.0.0.1');socket.on('connect',()=>events.connect());socket.on('data',x=>events.message({message:Uint8Array.from(x).buffer}));socket.on('error',()=>events.error());socket.on('close',()=>events.close());},
        write:data=>socket.write(Buffer.from(data)),close:()=>socket?.destroy() }) }, config, { ready:resolve,failed:()=>reject(new Error('Acceptance connection failed')) });
  });
  const list = await new Promise(resolve => channel.list(0, resolve)); if (list.status !== 'ok') throw new Error('List failed');
  let verified = 0, bytes = 0;
  for (const item of list.items.slice(0,3)) {
    const response = await new Promise(resolve => channel.preview(item.id,resolve)); if (response.status !== 'ok') throw new Error('Real preview failed');
    verified++;bytes+=response.image.length;response.image.fill(0);
  }
  const next = await new Promise(resolve => channel.list(12, resolve)); if (next.status !== 'ok') throw new Error('Page 2 failed');
  console.log(JSON.stringify({ indexedPhotos:source.count, pageSize:list.items.length, nextPageItems:next.items.length, realPreviewsVerified:verified, previewBytes:bytes,
    databaseReadOnly:true, originalFilesWritten:false, loopbackOnly:true, cloudMediaUploaded:false, phoneAcceptance:false }));
} finally { channel?.close(); await stop(); }
