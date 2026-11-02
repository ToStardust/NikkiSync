// QR credentials must never be logged, persisted or placed in page data / URLs.
function invalid() { throw new Error('无法识别此二维码，请在 NikkiSync PC 重新生成。'); }

function privateEndpoint(value) {
  if (typeof value !== 'string') invalid();
  const match = /^https:\/\/((?:\d{1,3}\.){3}\d{1,3})(?::([1-9]\d{0,4}))?\/?$/.exec(value);
  if (!match) invalid();
  const octets = match[1].split('.');
  if (octets.some(part => String(Number(part)) !== part || Number(part) > 255)) invalid();
  const numbers = octets.map(Number);
  if (!(numbers[0] === 10 || (numbers[0] === 192 && numbers[1] === 168)
    || (numbers[0] === 172 && numbers[1] >= 16 && numbers[1] <= 31))) invalid();
  if (match[2] && Number(match[2]) > 65535) invalid();
  return 'https://' + match[1] + (match[2] && match[2] !== '443' ? ':' + match[2] : '');
}

function parseRemoteQr(raw, now) {
  if (now === undefined) now = Date.now();
  if (typeof raw !== 'string' || raw.length > 4096 || !Number.isFinite(now)) invalid();
  let value;
  try { value = JSON.parse(raw); } catch (_) { invalid(); }
  if (!value || Array.isArray(value) || typeof value !== 'object'
    || value.type !== 'NikkiSyncRemoteBridge' || value.version !== 1
    || typeof value.sessionId !== 'string' || !/^[A-Za-z0-9_-]{22}$/.test(value.sessionId)
    || typeof value.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.token)
    || typeof value.tlsFingerprintSha256 !== 'string' || !/^[a-fA-F0-9]{64}$/.test(value.tlsFingerprintSha256)
    || typeof value.expiresAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.expiresAt)) invalid();
  const expiry = Date.parse(value.expiresAt);
  if (!Number.isFinite(expiry) || new Date(expiry).toISOString() !== value.expiresAt) invalid();
  if (expiry <= now) throw new Error('二维码已过期，请在电脑上重新生成。');
  // PC sessions last ten minutes; tolerate up to one minute of clock skew.
  if (expiry > now + 660000) invalid();
  return {
    sessionId: value.sessionId, token: value.token, expiresAt: value.expiresAt,
    endpoint: privateEndpoint(value.endpoint), tlsFingerprintSha256: value.tlsFingerprintSha256.toLowerCase()
  };
}

module.exports = { parseRemoteQr };
