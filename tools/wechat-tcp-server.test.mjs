import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';
test('actual loopback TCP accepts split exact synthetic frame only and expires', async () => {
  const { createTcpProbeServer } = await import('./wechat-tcp-server.mjs');
  const nonce = 'b'.repeat(32); let now = 100;
  const { server, stop } = createTcpProbeServer({ nonce, expiresAtMs: 200, now: () => now });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const request = chunks => new Promise((resolve, reject) => {
    const socket = net.connect(server.address().port, '127.0.0.1'); let response = '';
    socket.on('connect', () => chunks.forEach(x => socket.write(x)));
    socket.on('data', x => response += x); socket.on('close', () => resolve(response));
    socket.on('error', error => { if (error.code !== 'ECONNRESET') reject(error); });
    socket.setTimeout(2000, () => { socket.destroy(); reject(new Error('Loopback diagnostic timed out')); });
  });
  try {
    assert.equal(await request(['NS-TCP-PROBE/1 ', nonce + '\n']), `NS-TCP-OK/1 ${nonce}\n`);
    assert.equal(await request(['GET /photos\n']), '');
    assert.equal(await request(['x'.repeat(513)]), '');
    now = 200; assert.equal(await request([`NS-TCP-PROBE/1 ${nonce}\n`]), '');
  } finally { await stop(); }
});
