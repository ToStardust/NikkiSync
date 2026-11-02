import assert from 'node:assert/strict';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { clientApi } from './client-api.mjs';
test('Node TCP server sends only fixed encrypted PNG for the separate image session', async () => {
  const { createEncryptedServer } = await import('./server.mjs');
  const config = { type: 'NikkiSyncEncryptedImageProbe', version: 1, host: '192.168.31.130', port: 12345,
    sessionId: randomBytes(16).toString('hex'), key: randomBytes(32).toString('hex'), expiresAt: new Date(Date.now() + 600000).toISOString() };
  const { server, stop } = createEncryptedServer(config);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const result = await new Promise(resolve => {
      const events = {}; let socket;
      clientApi().runEncryptedImageProbe({ getRandomValues: o => o.success({ randomValues: Uint8Array.from(randomBytes(64)).buffer }),
        createTCPSocket: () => ({ onConnect: f => events.connect = f, onMessage: f => events.message = f, onError: f => events.error = f, onClose: f => events.close = f,
          connect: () => { socket = net.connect(server.address().port, '127.0.0.1'); socket.on('connect', () => events.connect());
            socket.on('data', x => events.message({ message: Uint8Array.from(x).buffer })); socket.on('error', () => events.error()); socket.on('close', () => events.close()); },
          write: data => socket.write(Buffer.from(data)), close: () => socket?.destroy() }) }, config, resolve);
    });
    assert.equal(result.status, 'ok'); assert.deepEqual(Array.from(result.image), Array.from(clientApi('synthetic-image').imageBytes()));
  } finally { await stop(); }
});
test('real TCP encrypted roundtrip, wrong key rejection, single-use and expiry', async () => {
  const { createEncryptedServer } = await import('./server.mjs');
  const now = Date.now(), key = randomBytes(32); let clock = now;
  const config = { type: 'NikkiSyncEncryptedTcpProbe', version: 1, host: '192.168.31.130', port: 12345,
    sessionId: randomBytes(16).toString('hex'), key: key.toString('hex'), expiresAt: new Date(now + 600000).toISOString() };
  const { server, stop } = createEncryptedServer(config, { now: () => clock });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const run = (qr, tamper = false) => new Promise(resolve => {
    const events = {}; let socket;
    clientApi().runEncryptedProbe({ getRandomValues: o => o.success({ randomValues: Uint8Array.from(randomBytes(64)).buffer }),
      createTCPSocket: () => ({ onConnect: f => events.connect = f, onMessage: f => events.message = f, onError: f => events.error = f, onClose: f => events.close = f,
        connect: () => { socket = net.connect(server.address().port, '127.0.0.1'); socket.on('connect', () => events.connect()); socket.on('data', x => events.message({ message: Uint8Array.from(x).buffer }));
          socket.on('error', () => events.error()); socket.on('close', () => events.close()); },
        write: data => { const bytes = Buffer.from(data); if (tamper) bytes[bytes.length-1] ^= 1; socket.write(bytes); }, close: () => socket?.destroy() }) }, qr, resolve);
  });
  try {
    assert.equal((await run({ ...config, key: randomBytes(32).toString('hex') })).status, 'failed');
    assert.equal((await run(config, true)).status, 'failed');
    assert.equal((await run(config)).status, 'ok');
    assert.equal((await run(config)).status, 'failed');
  } finally { key.fill(0); await stop(); }
  clock += 600001;
  const expired = createEncryptedServer(config, { now: () => clock });
  await new Promise(resolve => expired.server.listen(0, '127.0.0.1', resolve));
  try {
    const received = await new Promise((resolve, reject) => {
      const socket = net.connect(expired.server.address().port, '127.0.0.1'); let bytes = 0;
      socket.on('data', x => bytes += x.length); socket.on('close', () => resolve(bytes));
      socket.on('error', error => { if (error.code !== 'ECONNRESET') reject(error); });
    });
    assert.equal(received, 0);
  } finally { await expired.stop(); }
});
