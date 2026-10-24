import assert from 'node:assert/strict';
import https from 'node:https';
import { randomBytes, X509Certificate } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';
import QRCode from 'qrcode';

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
export function syntheticPng() {
  const chunk = (type, data) => {
    const contents = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(contents));
    return Buffer.concat([length, contents, crc]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0,51,91,78,255]))), chunk('IEND', Buffer.alloc(0))]);
}
export function createProbeHandler({ nonce, expiresAtMs, now = Date.now }) {
  assert.match(nonce, /^[a-f0-9]{32}$/);
  const png = syntheticPng();
  return (req, res) => {
    const send = (status, type, body) => {
      res.writeHead(status, { 'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(body);
    };
    if (now() >= expiresAtMs) { send(410, 'text/plain', Buffer.from('expired')); return; }
    if (req.method !== 'GET') { send(405, 'text/plain', Buffer.from('method_not_allowed')); return; }
    if (req.url === `/probe/${nonce}/health`) send(200, 'application/json', Buffer.from(JSON.stringify({ type: 'NikkiSyncLanTlsProbe', nonce })));
    else if (req.url === `/probe/${nonce}/sample.png`) send(200, 'image/png', png);
    else send(404, 'text/plain', Buffer.from('not_found'));
  };
}

async function main() {
  const selfTest = process.argv.includes('--self-test');
  const entries = Object.entries(networkInterfaces()).flatMap(([name, addresses]) => (addresses ?? []).map(value => ({ ...value, name })));
  const privateEntries = entries.filter(value => value.family === 'IPv4' && !value.internal
    && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value.address));
  const selected = privateEntries.find(value => /WLAN|Wi-Fi|Wireless/i.test(value.name)) ?? privateEntries.find(value => value.address.startsWith('192.168.'));
  if (!selfTest && !selected) throw new Error('No unambiguous private Wi-Fi IPv4 address found');
  const host = selfTest ? '127.0.0.1' : selected.address;
  const out = resolve('out'); mkdirSync(out, { recursive: true });
  const dir = mkdtempSync(join(out, 'wechat-lan-probe-'));
  const keyPath = join(dir, 'key.pem'), certPath = join(dir, 'cert.pem');
  execFileSync('C:\\Program Files\\Git\\usr\\bin\\openssl.exe', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=NikkiSync Synthetic LAN Probe', '-addext', `subjectAltName=IP:${host}`,
    '-keyout', keyPath, '-out', certPath], { stdio: 'ignore', windowsHide: true });
  const cert = readFileSync(certPath), key = readFileSync(keyPath);
  assert.equal(new X509Certificate(cert).checkIP(host), host);
  const nonce = randomBytes(16).toString('hex'), expiresAtMs = Date.now() + 600000;
  const server = https.createServer({ key, cert, minVersion: 'TLSv1.2' }, createProbeHandler({ nonce, expiresAtMs }));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, host, resolve); });
  const endpoint = `https://${host}:${server.address().port}`;
  const stop = () => { server.closeAllConnections(); server.close(); };
  if (selfTest) {
    const request = ca => new Promise((resolve, reject) => {
      const req = https.get(endpoint + `/probe/${nonce}/sample.png`, ca ? { ca } : {}, res => {
        const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve(Buffer.concat(chunks)));
      }); req.on('error', reject);
    });
    try {
      await assert.rejects(request(), error => ['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN'].includes(error.code));
      assert.deepEqual(await request(cert), syntheticPng());
      console.log(JSON.stringify({ result: 'PASS', defaultTrustRejects: true, explicitTestCaAccepts: true, syntheticBytes: syntheticPng().length, loopbackOnly: true }));
    } finally { stop(); }
    return;
  }
  await QRCode.toFile(join(dir, 'probe-qr.png'), JSON.stringify({ type: 'NikkiSyncLanTlsProbe', version: 1, endpoint, nonce,
    expiresAt: new Date(expiresAtMs).toISOString() }), { width: 600, margin: 2 });
  console.log(JSON.stringify({ endpoint, qrFile: join(dir, 'probe-qr.png'), expiresAt: new Date(expiresAtMs).toISOString(), syntheticOnly: true, selfSigned: true }));
  const timer = setTimeout(stop, 600000); timer.unref();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await main();
