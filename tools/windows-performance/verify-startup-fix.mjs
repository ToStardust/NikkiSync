// Isolated-profile boot and real early-exit diagnostics. Optional cached-library mode
// reads existing game media/cache only; it never writes the real user's DB/settings.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve, sep, relative } from 'node:path';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
const root = resolve(import.meta.dirname, '../..');
const release = resolve(root, process.argv[2] ?? 'release/NikkiSync-Portable-StartupHealth');
if (!release.startsWith(join(root, 'release') + sep)) throw new Error('Release must be inside workspace/release');
const cachedLibrary = process.argv[3] === '--cached-library';
const cacheFile = join(process.env.LOCALAPPDATA, 'NikkiSync', 'game-install-root.txt');
const originalCache = cachedLibrary ? await readFile(cacheFile) : null;
const output = await mkdtemp(join(root, 'out', 'startup-fix-'));
const relocated = await mkdtemp(join(tmpdir(), 'nikkisync-startup-fix-'));
const exe = join(relocated, 'NikkiSync-PC.exe');
await copyFile(join(release, 'NikkiSync-PC.exe'), exe);
const game = cachedLibrary ? originalCache.toString('utf8').trim() : join(output, 'new-game', 'InfinityNikki');
if (!cachedLibrary) {
  await mkdir(join(game, 'X6Game'), { recursive: true });
  await writeFile(join(game, 'InfinityNikki.exe'), ''); // Discovery marker; never executed.
}
async function prepareProfile(directory) {
  const data = join(directory, 'localdata', 'NikkiSync');
  await mkdir(data, { recursive: true });
  await writeFile(join(data, 'metadata-resolver.json'), JSON.stringify({ enabled: false }));
  await writeFile(join(data, 'metadata-dictionary-remote.json'), JSON.stringify({ enabled: false, provider: { type: 'nikki-albums-public' }, gallery: { enabled: false } }));
  if (cachedLibrary) await writeFile(join(data, 'game-install-root.txt'), originalCache);
}
async function fingerprints(directory) {
  const files = {};
  for (const name of (await readdir(directory, { recursive: true })).sort()) {
    const file = join(directory, name), info = await stat(file);
    if (info.isFile()) files[relative(directory, file)] = { size: info.size, mtimeMs: info.mtimeMs, sha256: createHash('sha256').update(await readFile(file)).digest('hex') };
  }
  return files;
}
async function boot(directory, occupied = false, gameRoot = game) {
  await prepareProfile(directory);
  const reserve = http.createServer((_, response) => { response.writeHead(503); response.end(); });
  await new Promise((resolve, reject) => { reserve.once('error', reject); reserve.listen(0, '127.0.0.1', resolve); });
  const port = reserve.address().port;
  if (!occupied) await new Promise(resolve => reserve.close(resolve));
  const environment = {
    ...process.env, LOCALAPPDATA: join(directory, 'localdata'),
    DOTNET_BUNDLE_EXTRACT_BASE_DIR: join(output, 'native-cache'),
    NIKKISYNC_GAME_ROOT: gameRoot, NIKKISYNC_BIND: '127.0.0.1', NIKKISYNC_PORT: '0', NIKKISYNC_MDNS: '0'
  };
  if (cachedLibrary) delete environment.NIKKISYNC_GAME_ROOT;
  const child = spawn(exe, ['--verify-startup', directory, String(port)], { cwd: relocated, windowsHide: true, stdio: 'ignore', env: environment });
  const watchdog = setTimeout(() => child.kill(), 120000);
  try {
    const [exit] = await once(child, 'exit');
    if (exit !== 0) throw new Error('Verification host failed, exit=' + exit);
    const result = JSON.parse(await readFile(join(directory, 'startup-verification.json'), 'utf8'));
    if (!result.ok) {
      result.diagnostics = JSON.parse(await readFile(join(directory, 'localdata', 'NikkiSync', 'startup-diagnostics.log'), 'utf8'));
      await writeFile(join(directory, 'failure-diagnostics.json'), JSON.stringify(result.diagnostics, null, 2));
    }
    return result;
  } finally {
    clearTimeout(watchdog);
    if (occupied) await new Promise(resolve => reserve.close(resolve));
  }
}
try {
  const success = join(output, 'fresh-profile'), runs = [];
  for (let run = 0; run < 2; run++) {
    const result = await boot(success);
    if (!result.ok || !result.browserVisible || !result.loaderHidden) throw new Error('Fresh-profile dashboard did not open: ' + JSON.stringify(result.diagnostics));
    if ((await readFile(join(success, 'localdata', 'NikkiSync', 'game-install-root.txt'), 'utf8')).trim() !== game) throw new Error('Selected game directory was not persisted');
    const timing = JSON.parse(await readFile(join(success, 'localdata', 'NikkiSync', 'startup-timings.json'), 'utf8'));
    if (timing.status !== 'ready') throw new Error('Successful startup did not persist phase timings');
    const discovery = JSON.parse(await readFile(join(success, 'localdata', 'NikkiSync', 'game-discovery.log'), 'utf8'));
    if (cachedLibrary && discovery.source !== 'cached') throw new Error('Valid cache was not reused');
    const database = new DatabaseSync(join(success, 'localdata', 'NikkiSync', 'nikkisync.sqlite'), { readOnly: true });
    let assetCount;
    try { assetCount = database.prepare("SELECT count(*) AS count FROM assets WHERE asset_state = 'ready'").get().count; }
    finally { database.close(); }
    if (cachedLibrary && assetCount === 0) throw new Error('Actual library was not indexed');
    runs.push({ stages: result.stages, discovery, assetCount, payload: await fingerprints(join(success, 'runtime-cache')) });
    console.log(JSON.stringify({ run: run + 1, stages: result.stages, assetCount, cached: discovery.source === 'cached', discoveryMs: discovery.elapsedMs }));
  }
  const payloadReused = JSON.stringify(runs[0].payload) === JSON.stringify(runs[1].payload);
  if (!payloadReused) throw new Error('Restart rewrote the runtime');
  const actualRuntime = (await readdir(join(success, 'runtime-cache'))).find(name => /^[A-Fa-f0-9]{64}$/.test(name));
  const bundledApk = join(success, 'runtime-cache', actualRuntime, 'runtime', 'NikkiSync-Android.apk');
  const apkHash = createHash('sha256').update(await readFile(bundledApk)).digest('hex');
  const originalApkHash = createHash('sha256').update(await readFile(join(root, 'release', 'NikkiSync', 'NikkiSync-Android.apk'))).digest('hex');
  if (apkHash !== originalApkHash) throw new Error('Embedded Android APK changed');
  const failure = join(output, 'port-conflict'), failed = await boot(failure, true);
  if (failed.ok) throw new Error('An occupied desktop port was accepted as ready');
  const diagnostics = JSON.parse(await readFile(join(failure, 'localdata', 'NikkiSync', 'startup-diagnostics.log'), 'utf8'));
  if (diagnostics.code !== 'PORT_IN_USE' || diagnostics.exitCode !== 1) throw new Error('Real child error/exit code was lost');
  if (cachedLibrary && !(await readFile(cacheFile)).equals(originalCache)) throw new Error('Actual user cache changed');
  const report = { actualSingleExe: true, relocatedExe: true, freshProfile: true, noPhotoFolders: !cachedLibrary, actualCachedLibrary: cachedLibrary, selectedRootPersisted: true,
    payloadReused, apkUnchanged: true, apkHash, errorCode: diagnostics.code, exitCode: diagnostics.exitCode,
    onlineResolversDisabled: true, userDataUntouched: true, runs };
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ report: relative(root, join(output, 'report.json')), runs: runs.map(({ stages }) => stages), payloadReused, apkUnchanged: true, actualErrorCode: diagnostics.code }));
} finally {
  for (const directory of [join(output, 'fresh-profile', 'localdata'), join(output, 'port-conflict', 'localdata')]) {
    if (!resolve(directory).startsWith(output + sep)) throw new Error('Unsafe profile cleanup');
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
  if (!resolve(relocated).startsWith(resolve(tmpdir()) + sep) || !relative(tmpdir(), relocated).startsWith('nikkisync-startup-fix-')) throw new Error('Unsafe executable cleanup');
  await rm(relocated, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
