// Actual single-file WPF startup, twice. Isolated profile/database/ports/native
// cache; no interaction with the user's running instance or online resolvers.
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, readdir, stat, rm } from 'node:fs/promises';
import { resolve, join, sep, relative } from 'node:path';
import { createHash } from 'node:crypto';
const root = resolve(import.meta.dirname, '../..');
const release = resolve(root, process.env.NIKKISYNC_DESKTOP_RELEASE ?? 'release/NikkiSync-Portable-Startup');
if (!release.startsWith(join(root, 'release') + sep)) throw new Error('Expected a workspace release directory');
const exe = join(release, 'NikkiSync-PC.exe');
const output = await mkdtemp(join(root, 'out', 'portable-startup-'));
const localdata = join(output, 'localdata'), data = join(localdata, 'NikkiSync');
await mkdir(data, { recursive: true });
const source = new DatabaseSync(join(process.env.LOCALAPPDATA, 'NikkiSync', 'nikkisync.sqlite'), { readOnly: true });
try { source.exec("VACUUM INTO '" + join(data, 'nikkisync.sqlite').replaceAll("'", "''") + "'"); }
finally { source.close(); }
await writeFile(join(data, 'metadata-resolver.json'), JSON.stringify({ enabled: false }));
await writeFile(join(data, 'metadata-dictionary-remote.json'), JSON.stringify({ enabled: false, provider: { type: 'nikki-albums-public' } }));
async function fingerprints(directory) {
  const files = {};
  for (const name of (await readdir(directory, { recursive: true })).sort()) {
    const file = join(directory, name), info = await stat(file);
    if (info.isFile()) files[relative(directory, file)] = { bytes: info.size, mtimeMs: info.mtimeMs, sha256: createHash('sha256').update(await readFile(file)).digest('hex') };
  }
  return files;
}
const runs = [];
try {
  for (let run = 0; run < 2; run++) {
    const reserve = net.createServer();
    await new Promise(r => reserve.listen(0, '127.0.0.1', r));
    const port = reserve.address().port;
    await new Promise(r => reserve.close(r));
    const started = performance.now();
    const child = spawn(exe, ['--verify-startup', output, String(port)], { windowsHide: true, stdio: 'ignore', env: {
      ...process.env, LOCALAPPDATA: localdata, DOTNET_BUNDLE_EXTRACT_BASE_DIR: join(output, 'native-cache'),
      NIKKISYNC_BIND: '127.0.0.1', NIKKISYNC_PORT: '0', NIKKISYNC_MDNS: '0',
    } });
    const watchdog = setTimeout(() => child.kill(), 200000);
    let code;
    try { [code] = await once(child, 'exit'); } finally { clearTimeout(watchdog); }
    if (code !== 0) throw new Error('Full startup verification failed, exit=' + code);
    const result = JSON.parse(await readFile(join(output, 'startup-verification.json'), 'utf8'));
    if (!result.ok || !result.browserVisible || !result.loaderHidden) throw new Error('Dashboard was not revealed correctly');
    result.processElapsedMs = Math.round(performance.now() - started);
    result.payload = await fingerprints(join(output, 'runtime-cache'));
    result.native = await fingerprints(join(output, 'native-cache'));
    runs.push(result);
  }
  const payloadReused = JSON.stringify(runs[0].payload) === JSON.stringify(runs[1].payload);
  const nativeReused = JSON.stringify(runs[0].native) === JSON.stringify(runs[1].native);
  if (!payloadReused || !nativeReused) throw new Error('Second launch rewrote cached runtime files');
  const report = { release: relative(root, release), runs, payloadReused, nativeReused, realDatabaseReadOnly: true, onlineResolversDisabled: true, actualWpfDashboardBoot: true };
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ report: relative(root, join(output, 'report.json')), runs: runs.map(({ stages, processElapsedMs }) => ({ stages, processElapsedMs })), payloadReused, nativeReused }));
} finally {
  // Private DB/browser profile is not needed in the evidence bundle.
  const target = resolve(localdata);
  if (!target.startsWith(resolve(root, 'out') + sep) || !target.startsWith(output + sep)) throw new Error('Unsafe cleanup');
  await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
