// No media, credentials, DB, resolver or native pairing access.
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import QRCode from 'qrcode';
export function createTcpProbeServer({ nonce, expiresAtMs, now = Date.now }) {
  if (!/^[a-f0-9]{32}$/.test(nonce) || !Number.isFinite(expiresAtMs)) throw new Error('Invalid synthetic test configuration');
  const sockets = new Set();
  const server = net.createServer(socket => {
    socket.on('error', () => {});
    if (now() >= expiresAtMs || sockets.size >= 16) { socket.destroy(); return; }
    sockets.add(socket); socket.on('close', () => sockets.delete(socket));
    socket.setTimeout(5000, () => socket.destroy());
    let input = Buffer.alloc(0), finished = false;
    socket.on('data', chunk => {
      if (finished) return;
      if (now() >= expiresAtMs || input.length + chunk.length > 512) { finished = true; socket.end(); return; }
      input = Buffer.concat([input, chunk]);
      if (!input.includes(10)) return;
      finished = true;
      if (input.equals(Buffer.from(`NS-TCP-PROBE/1 ${nonce}\n`))) socket.end(`NS-TCP-OK/1 ${nonce}\n`);
      else socket.end();
    });
  });
  const stop = () => new Promise(resolve => { for (const socket of sockets) socket.destroy(); server.close(resolve); });
  return { server, stop };
}
async function main() {
  const entries = Object.entries(networkInterfaces()).flatMap(([name, list]) => (list || []).map(x => ({ ...x, name })));
  const candidates = entries.filter(x => x.family === 'IPv4' && !x.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(x.address));
  const wifi = candidates.filter(x => /WLAN|Wi-Fi|Wireless/i.test(x.name));
  if (wifi.length !== 1) throw new Error('Need exactly one identifiable private Wi-Fi IPv4; no broad-interface fallback');
  const host = wifi[0].address, nonce = randomBytes(16).toString('hex'), expiresAtMs = Date.now() + 600000;
  const { server, stop } = createTcpProbeServer({ nonce, expiresAtMs });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, host, resolve); });
  try {
    const out = resolve('out'); mkdirSync(out, { recursive: true }); const dir = mkdtempSync(join(out, 'wechat-tcp-probe-'));
    const payload = { type: 'NikkiSyncLanTcpProbe', version: 1, host, port: server.address().port, nonce, expiresAt: new Date(expiresAtMs).toISOString() };
    const qrFile = join(dir, 'probe-qr.png'); await QRCode.toFile(qrFile, JSON.stringify(payload), { width: 600, margin: 2 });
    console.log(JSON.stringify({ qrFile, expiresAt: payload.expiresAt, syntheticOnly: true, encrypted: false }));
    const timer = setTimeout(() => { void stop(); }, 600000); timer.unref();
    process.once('SIGINT', () => { clearTimeout(timer); void stop(); });
    process.once('SIGTERM', () => { clearTimeout(timer); void stop(); });
  } catch (error) { await stop(); throw error; }
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
