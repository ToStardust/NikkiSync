// Connectivity diagnostic ONLY. Plain synthetic challenge is not authentication.
function parseTcpQr(raw) {
  let v;
  try { if (typeof raw !== 'string' || raw.length > 2048) throw new Error(); v = JSON.parse(raw); } catch (_) { throw new Error('不是有效的 TCP 测试码。'); }
  const allowed = ['type', 'version', 'host', 'port', 'nonce', 'expiresAt'];
  if (!v || typeof v !== 'object' || Object.keys(v).some(key => allowed.indexOf(key) < 0)) throw new Error('测试码包含不支持的字段。');
  const parts = typeof v.host === 'string' ? v.host.split('.') : [];
  const ip = parts.map(Number);
  if (parts.length !== 4 || parts.some(x => !/^\d{1,3}$/.test(x) || String(Number(x)) !== x || Number(x) > 255)
    || !(ip[0] === 10 || (ip[0] === 192 && ip[1] === 168) || (ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31))
    || !Number.isInteger(v.port) || v.port < 1 || v.port > 65535) throw new Error('测试仅支持私有 IPv4 和有效端口。');
  const expiry = typeof v.expiresAt === 'string' ? Date.parse(v.expiresAt) : NaN;
  if (v.type !== 'NikkiSyncLanTcpProbe' || v.version !== 1 || typeof v.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(v.nonce)
    || !Number.isFinite(expiry) || new Date(expiry).toISOString() !== v.expiresAt || expiry <= Date.now() || expiry > Date.now() + 660000)
    throw new Error('TCP 测试码无效或已过期。');
  return { type: v.type, version: 1, host: v.host, port: v.port, nonce: v.nonce, expiresAt: v.expiresAt };
}
function runTcpProbe(wxApi, config, done, options) {
  let socket, timer, stopped = false, text = '', connected = false;
  const close = () => { clearTimeout(timer); if (socket) { try { socket.close(); } catch (_) {} } };
  const finish = result => { if (stopped) return; stopped = true; close(); done(result); };
  const fail = () => finish({ status: 'failed', authenticated: false, message: 'TCP 测试未完成：连接失败、超时、过期或响应不匹配。没有重试其他通道。' });
  try {
    const v = parseTcpQr(JSON.stringify(config));
    if (typeof wxApi.createTCPSocket !== 'function') throw new Error();
    socket = wxApi.createTCPSocket();
    socket.onConnect(() => {
      if (stopped || connected) return;
      if (Date.now() >= Date.parse(v.expiresAt)) { fail(); return; }
      connected = true;
      try { socket.write('NS-TCP-PROBE/1 ' + v.nonce + '\n'); } catch (_) { fail(); }
    });
    socket.onMessage(event => {
      if (stopped) return;
      try {
        if (!connected || Date.now() >= Date.parse(v.expiresAt) || !(event.message instanceof ArrayBuffer)) throw new Error();
        const bytes = new Uint8Array(event.message);
        if (text.length + bytes.length > 512) throw new Error();
        for (let i = 0; i < bytes.length; i++) { if (bytes[i] !== 10 && (bytes[i] < 32 || bytes[i] > 126)) throw new Error(); text += String.fromCharCode(bytes[i]); }
        if (text.indexOf('\n') < 0) return;
        if (text !== 'NS-TCP-OK/1 ' + v.nonce + '\n') throw new Error();
        finish({ status: 'ok', authenticated: false, message: 'TCP 合成数据往返成功。此测试没有加密或身份保证，不代表照片下载或 iPhone 验收。' });
      } catch (_) { fail(); }
    });
    socket.onError(fail); socket.onClose(fail);
    timer = setTimeout(fail, options && options.timeoutMs || 5000);
    socket.connect({ address: v.host, port: v.port });
  } catch (_) { fail(); }
  return () => { if (!stopped) { stopped = true; close(); } };
}
module.exports = { parseTcpQr, runTcpProbe };
