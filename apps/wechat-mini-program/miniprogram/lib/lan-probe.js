function parseProbeQr(raw) {
  let value;
  try { if (typeof raw !== 'string' || raw.length > 2048) throw new Error(); value = JSON.parse(raw); } catch (_) { throw new Error('不是有效的局域网测试码。'); }
  const match = typeof value?.endpoint === 'string' && /^https:\/\/((?:\d{1,3}\.){3}\d{1,3}):([1-9]\d{0,4})$/.exec(value.endpoint);
  if (!match) throw new Error('测试仅支持私有 IPv4 HTTPS 地址。');
  const parts = match[1].split('.'); const ip = parts.map(Number);
  if (parts.some(part => String(Number(part)) !== part || Number(part) > 255)
    || Number(match[2]) > 65535 || !(ip[0] === 10 || (ip[0] === 192 && ip[1] === 168)
      || (ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31))) throw new Error('测试地址不符合局域网要求。');
  const expiry = typeof value.expiresAt === 'string' ? Date.parse(value.expiresAt) : NaN;
  if (value.type !== 'NikkiSyncLanTlsProbe' || value.version !== 1
    || typeof value.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(value.nonce)
    || !Number.isFinite(expiry) || expiry <= Date.now() || expiry > Date.now() + 660000) throw new Error('测试码无效或已过期。');
  return { type: value.type, version: 1, endpoint: value.endpoint, nonce: value.nonce, expiresAt: value.expiresAt };
}

function runProbe(wxApi, config, done) {
  let stopped = false; const tasks = [];
  const finish = result => { if (!stopped) { stopped = true; done(result); } };
  const fail = value => finish({ status: 'failed', message: String(value?.errMsg || '响应未通过测试校验。').replace(/https?:\/\/\S+/g, '[地址]').slice(0, 240) });
  let checked;
  try { checked = parseProbeQr(JSON.stringify(config)); } catch (error) { fail({ errMsg: error.message }); return () => {}; }
  const request = (path, responseType, success) => {
    if (stopped) return;
    if (Date.now() >= Date.parse(checked.expiresAt)) { fail({ errMsg: '测试码已过期。' }); return; }
    try {
      tasks.push(wxApi.request({ url: checked.endpoint + '/probe/' + checked.nonce + path,
        method: 'GET', timeout: 5000, responseType, success: result => { if (!stopped) success(result); },
        fail: result => { if (!stopped) fail(result); } }));
    } catch (_) { fail({ errMsg: '微信请求接口调用失败。' }); }
  };
  request('/health', 'text', result => {
    if (result.statusCode !== 200 || result.data?.type !== checked.type || result.data?.nonce !== checked.nonce) { fail(); return; }
    request('/sample.png', 'arraybuffer', image => {
      try {
        const bytes = new Uint8Array(image.data);
        const signature = [137,80,78,71,13,10,26,10];
        if (image.statusCode !== 200 || bytes.length < 45 || bytes.length > 65536
          || signature.some((byte, index) => bytes[index] !== byte)
          || ![73,72,68,82].every((byte, index) => bytes[index + 12] === byte)
          || ![73,69,78,68].every((byte, index) => bytes[bytes.length - 8 + index] === byte)) { fail(); return; }
        finish({ status: 'ok', bytes: bytes.length, message: 'HTTPS 合成数据及 PNG 响应已收到。这不是真实照片保存或 iPhone 验收。' });
      } catch (_) { fail(); }
    });
  });
  return () => { stopped = true; tasks.forEach(task => task?.abort?.()); };
}
module.exports = { parseProbeQr, runProbe };
