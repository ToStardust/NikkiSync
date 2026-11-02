import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { mkdirSync, mkdtempSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import QRCode from 'qrcode';
import { clientApi } from './client-api.mjs';
const { createPeer } = clientApi('noise-vendor');
export function createEncryptedServer(config, { now = Date.now } = {}) {
  const { parseEncryptedQr, parseEncryptedImageQr, prologue, createDecoder, frame } = clientApi();
  const imageMode = config?.type === 'NikkiSyncEncryptedImageProbe';
  const checked = (imageMode ? parseEncryptedImageQr : parseEncryptedQr)(JSON.stringify(config)), key = Buffer.from(checked.key, 'hex'); checked.key = null; config = null;
  const expiresAtMs = Date.parse(checked.expiresAt), sockets = new Set(); let used = false, attempts = 0;
  const server = net.createServer(socket => {
    socket.on('error', () => {});
    if (used || now() >= expiresAtMs || sockets.size >= 1 || attempts++ >= 32) { socket.destroy(); return; }
    sockets.add(socket); let peer, stage = 0;
    const decoder = createDecoder(bytes => {
      if (used || now() >= expiresAtMs) throw new Error('Expired');
      if (stage === 0) {
        peer = createPeer(false, key, prologue(checked), randomBytes(64)); peer.receiveHandshake(bytes); stage = 1;
        socket.write(frame(peer.sendHandshake()));
      } else if (stage === 1) {
        const plain = peer.decrypt(bytes), matches = Buffer.from(plain).equals(Buffer.from(imageMode ? 'NS-IMAGE-PROBE/1' : 'NS-ENCRYPTED-PROBE/1')); plain.fill(0);
        if (!matches) throw new Error('Unexpected payload');
        used = true; key.fill(0); stage = 2;
        socket.end(frame(peer.encrypt(imageMode ? clientApi('synthetic-image').imagePayload() : Buffer.from('NS-ENCRYPTED-OK/1'))));
      } else throw new Error('Unexpected extra frame');
    });
    socket.setTimeout(Math.max(1, Math.min(10000, expiresAtMs - now())), () => socket.destroy());
    socket.on('data', bytes => { try { decoder.feed(Uint8Array.from(bytes)); } catch (_) { socket.destroy(); } });
    socket.on('close', () => { sockets.delete(socket); decoder.close(); if (peer) peer.close(); });
  });
  const stop = () => new Promise(resolve => { used = true; key.fill(0); for (const socket of sockets) socket.destroy(); server.close(resolve); });
  return { server, stop };
}
async function main() {
  if (process.argv.slice(2).some(x => x !== '--image') || process.argv.slice(2).length > 1) throw new Error('Only --image is supported');
  const imageMode = process.argv.includes('--image');
  const wifi = Object.entries(networkInterfaces()).flatMap(([name, list]) => /WLAN|Wi-Fi|Wireless/i.test(name) ? (list || []) : [])
    .filter(x => x.family === 'IPv4' && !x.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(x.address));
  if (wifi.length !== 1) throw new Error('Need exactly one private Wi-Fi IPv4');
  const expiry = Date.now() + 600000, host = wifi[0].address;
  // Reserve a random LAN port before creating the prologue-bound configuration.
  const reserve = net.createServer(); await new Promise((resolve, reject) => { reserve.once('error', reject); reserve.listen(0, host, resolve); });
  const port = reserve.address().port; await new Promise(resolve => reserve.close(resolve));
  let config = { type: imageMode ? 'NikkiSyncEncryptedImageProbe' : 'NikkiSyncEncryptedTcpProbe', version: 1, host, port, sessionId: randomBytes(16).toString('hex'),
    key: randomBytes(32).toString('hex'), expiresAt: new Date(expiry).toISOString() };
  const { server, stop } = createEncryptedServer(config);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  let qrFile, stopping = false;
  const shutdown = async () => { if (stopping) return; stopping = true; await stop(); if (qrFile) { try { unlinkSync(qrFile); } catch (_) {} } };
  try {
    const out = resolve('out'); mkdirSync(out, { recursive: true }); const dir = mkdtempSync(join(out, 'wechat-encrypted-probe-'));
    qrFile = join(dir, 'private-probe-qr.png'); await QRCode.toFile(qrFile, JSON.stringify(config), { width: 720, margin: 2 }); config = null;
    console.log(JSON.stringify({ qrFile, expiresAt: new Date(expiry).toISOString(), syntheticOnly: true, imageMode, singleUse: true, privateQr: true }));
    const timer = setTimeout(() => { void shutdown(); }, Math.max(1, expiry - Date.now())); timer.unref();
    process.once('SIGINT', () => { clearTimeout(timer); void shutdown(); }); process.once('SIGTERM', () => { clearTimeout(timer); void shutdown(); });
  } catch (error) { await shutdown(); throw error; }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
