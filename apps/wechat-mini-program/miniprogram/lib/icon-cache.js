let sequence = 0;
const INDEX = 'nikkisync.iconCache.v2';
const TTL = 30 * 24 * 60 * 60 * 1000;
const stableKey = key => /^[a-f0-9]{64}$/.test(key);

function createIconCache(wxApi, options = {}) {
  const maxEntries = options.maxEntries || 256;
  const maxBytes = options.maxBytes || 16 * 1024 * 1024;
  const fs = wxApi.getFileSystemManager(), root = wxApi.env.USER_DATA_PATH;
  const entries = new Map(), owned = new Set();
  let bytes = 0, epoch = 0;
  function remove(path) {
    owned.delete(path);
    try { fs.unlink({ filePath: path, fail() {} }); } catch (_) {}
  }
  function drop(key) {
    const value = entries.get(key);
    if (!value) return;
    entries.delete(key);
    bytes -= value.size;
    remove(value.path);
  }
  function persist() {
    try {
      wxApi.setStorageSync?.(INDEX, Array.from(entries, ([key, value]) => ({
        key, file: value.path.slice(root.length + 1), size: value.size, source: value.source, time: value.time,
      })).filter(value => stableKey(value.key)));
    } catch (_) {}
  }
  try {
    const records = wxApi.getStorageSync?.(INDEX);
    if (Array.isArray(records)) for (const item of records.slice(-maxEntries)) {
      if (!item || !stableKey(item.key) || typeof item.file !== 'string'
          || !/^nikkisync-icon-v2-\d+-\d+\.png$/.test(item.file)
          || !Number.isInteger(item.size) || item.size < 1 || item.size > 262144
          || !['item', 'category'].includes(item.source) || !Number.isFinite(item.time)
          || Date.now() - item.time > TTL || item.time > Date.now()
          || bytes + item.size > maxBytes || entries.has(item.key)) continue;
      const path = root + '/' + item.file;
      try {
        if (fs.statSync && fs.statSync(path).size !== item.size) continue;
        fs.accessSync?.(path);
      } catch (_) { continue; }
      owned.add(path);
      entries.set(item.key, { path, size: item.size, source: item.source, time: item.time });
      bytes += item.size;
    }
  } catch (_) {}
  try {
    fs.readdir?.({ dirPath: root, success(value) {
      for (const name of value.files || []) {
        if (typeof name !== 'string' || !/^nikkisync-icon-(?:v2-)?\d+-\d+\.png$/.test(name)) continue;
        const path = root + '/' + name;
        if (!owned.has(path)) remove(path);
      }
    }, fail() {} });
  } catch (_) {}
  return {
    get(key) {
      const value = entries.get(key);
      if (!value) return;
      try {
        if (Date.now() - value.time > TTL) throw Error('Expired');
        fs.accessSync?.(value.path);
      } catch (_) { drop(key); persist(); return; }
      entries.delete(key);
      entries.set(key, value);
      return Object.assign({}, value);
    },
    invalidate(key) { drop(key); persist(); },
    put(key, image, mime, source, done) {
      if (!/^(?:[a-f0-9]{32}|[a-f0-9]{64})$/.test(key) || !(image instanceof Uint8Array)
          || !image.length || image.length > Math.min(maxBytes, 262144) || mime !== 'image/png'
          || !['item', 'category'].includes(source)) { image?.fill(0); done(); return; }
      const generation = epoch, size = image.length;
      const path = root + '/nikkisync-icon-' + (stableKey(key) ? 'v2-' : '') + Date.now() + '-' + (++sequence) + '.png';
      const buffer = image.buffer.slice(image.byteOffset, image.byteOffset + size);
      image.fill(0);
      owned.add(path);
      const wipe = () => new Uint8Array(buffer).fill(0);
      const failed = () => { wipe(); remove(path); if (generation === epoch) done(); };
      try {
        fs.writeFile({ filePath: path, data: buffer, success() {
          wipe();
          if (generation !== epoch) { remove(path); return; }
          drop(key);
          while (entries.size >= maxEntries || bytes + size > maxBytes) drop(entries.keys().next().value);
          const value = { path, size, source, time: Date.now() };
          entries.set(key, value);
          bytes += size;
          persist();
          done(Object.assign({}, value));
        }, fail: failed });
      } catch (_) { failed(); }
    },
    release(keepSession = false) {
      epoch++;
      if (!keepSession) for (const key of Array.from(entries.keys())) if (!stableKey(key)) drop(key);
      persist();
    },
    clear() { epoch++; for (const key of Array.from(entries.keys())) drop(key); persist(); },
    stats() { return { entries: entries.size, bytes }; },
  };
}
module.exports = { createIconCache };

