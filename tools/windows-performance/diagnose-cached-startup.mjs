// Read-only capture of an idle profile; all backend writes go to a private copy.
import fs from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { spawn } from 'node:child_process'
const source = path.join(process.env.LOCALAPPDATA, 'NikkiSync')
const output = fs.mkdtempSync(path.resolve('out/cached-startup-'))
const profile = process.argv.includes('--host') ? path.join(output, 'localdata') : output
const data = path.join(profile, 'NikkiSync')
fs.mkdirSync(data, { recursive: true })
const fingerprint = file => { try { const s = fs.statSync(file); return `${s.size}:${s.mtimeMs}` } catch { return '' } }
const databaseFiles = ['nikkisync.sqlite', 'nikkisync.sqlite-wal'].map(name => path.join(source, name))
const before = databaseFiles.map(fingerprint)
for (const name of ['nikkisync.sqlite', 'nikkisync.sqlite-wal', 'game-install-root.txt', 'metadata-resolver.json', 'metadata-dictionary.json', 'metadata-dictionary-supplement.json', 'metadata-dictionary-remote.json']) {
  const file = path.join(source, name)
  if (fs.existsSync(file)) fs.copyFileSync(file, path.join(data, name))
}
if (databaseFiles.some((file, index) => fingerprint(file) !== before[index])) throw new Error('Profile changed during capture; close the PC app and retry')
process.env.LOCALAPPDATA = profile
process.env.NIKKISYNC_BIND = '127.0.0.1'
process.env.NIKKISYNC_PORT = '0'
process.env.NIKKISYNC_MDNS = '0'
process.env.NIKKISYNC_DESKTOP_PORT = '28959'
if (process.argv.includes('--fixed-port')) process.env.NIKKISYNC_PORT = '28080'
const started = performance.now()
function log(stage, event, ms) { console.log(JSON.stringify({ stage, event, elapsedMs: Math.round(performance.now() - started), ...(ms === undefined ? {} : { durationMs: Math.round(ms) }) })) }
for (const [module, name, methods] of [
  ['runtime', 'PcCompanionRuntime', ['start']],
  ['scanner/ScannerService', 'ScannerService', ['start']],
  ['metadata/CachedDecodedMetadataService', 'CachedDecodedMetadataService', ['runOnce']],
  ['metadata/MetadataDictionaryService', 'MetadataDictionaryService', ['reenrichResolvedAssets']],
  ['metadata/MetadataDictionaryUpdateService', 'MetadataDictionaryUpdateService', ['runOnce']]
]) {
  const { [name]: cls } = await import(`../../apps/pc-companion/dist/src/${module}.js`)
  for (const method of methods) {
    const original = cls.prototype[method]
    cls.prototype[method] = function (...args) {
      const begin = performance.now(); log(`${name}.${method}`, 'start')
      const result = original.apply(this, args)
      if (result?.then) return result.then(value => { log(`${name}.${method}`, 'end', performance.now() - begin); return value })
      log(`${name}.${method}`, 'end', performance.now() - begin); return result
    }
  }
}
log('profile-copy', 'ready')
let child
if (process.argv.includes('--host')) {
  child = spawn(path.resolve(process.argv[2]), ['--verify-startup', output, '28959'], { env: process.env, windowsHide: true, stdio: 'inherit' })
  child.once('exit', code => {
    log('host', `exit-${code}`)
    for (const name of ['startup-verification.json', 'localdata/NikkiSync/startup-timings.json', 'localdata/NikkiSync/startup-service-timings.json', 'localdata/NikkiSync/startup-diagnostics.log']) {
      const file = path.join(output, name)
      if (fs.existsSync(file)) console.log(fs.readFileSync(file, 'utf8'))
    }
    process.exit(code ?? 1)
  })
} else if (process.argv[2]) {
  child = spawn(path.resolve(process.argv[2]), [], { env: process.env, windowsHide: true, stdio: 'inherit' })
} else await import('../../apps/pc-companion/dist/src/windows-app.js')
const check = setInterval(async () => {
  try {
    const response = await fetch('http://127.0.0.1:28959/api/status', { signal: AbortSignal.timeout(1000) })
    if (response.ok) { log('dashboard', 'ready'); clearInterval(check); if (!process.argv.includes('--host')) { child?.kill(); process.exit(0) } }
    else log('dashboard', `http-${response.status}`)
  } catch {}
}, 1000)
setTimeout(() => { log('dashboard', 'timeout'); child?.kill(); process.exit(2) }, 30000)
