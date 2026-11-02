import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
const cache = new Map();
export function clientApi(name = 'encrypted-probe') {
  if (cache.has(name)) return cache.get(name);
  if (!['encrypted-probe', 'tcp-probe', 'noise-vendor', 'synthetic-image', 'gallery-channel', 'live-probe'].includes(name)) throw new Error('Unknown client module');
  const module = { exports: {} };
  runInNewContext(readFileSync(new URL(`../../apps/wechat-mini-program/miniprogram/lib/${name}.js`, import.meta.url), 'utf8'),
    { module, Uint8Array, ArrayBuffer, DataView, Date, setTimeout, clearTimeout,
      require: x => /^\.\/(noise-vendor|tcp-probe|synthetic-image|encrypted-probe|gallery-channel)\.js$/.test(x) ? clientApi(x.slice(2, -3)) : (() => { throw new Error('Unknown dependency'); })() });
  cache.set(name, module.exports); return module.exports;
}
