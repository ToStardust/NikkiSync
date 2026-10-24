// Actual closed-game first run. The EXE, native cache and WebView/runtime profile
// all live OUTSIDE the game tree, so no ancestor-directory shortcut can pass.
// Clear only NikkiSync's game location default, with an exact-file backup. Never
// erase photos, pairing/TLS credentials, SQLite, dictionaries or user settings.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { promisify } from 'node:util';
import net from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { resolve, join, sep, relative } from 'node:path';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm, readdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '../..');
const release = resolve(root, process.env.NIKKISYNC_DESKTOP_RELEASE ?? 'release/NikkiSync-Portable-AutoDiscovery');
assert.ok(release.startsWith(join(root, 'release') + sep));
const userData = resolve(process.env.LOCALAPPDATA, 'NikkiSync');
const cache = join(userData, 'game-install-root.txt');
assert.equal(relative(userData, cache), 'game-install-root.txt');
const output = await mkdtemp(join(root, 'out', 'game-autodiscovery-'));
const relocated = await mkdtemp(join(tmpdir(), 'nikkisync-auto-first-run-'));
const profile = join(relocated, 'verification');
const data = join(profile, 'localdata', 'NikkiSync');
const executable = join(relocated, 'NikkiSync-PC.exe');
const backup = join(output, 'game-install-root.before.txt');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function optionalRead(file) { try { return await readFile(file); } catch (error) { if (error.code === 'ENOENT') return undefined; throw error; } }
async function verifyClosedGame() {
  const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
    '@(Get-Process -Name InfinityNikki,X6Game,X6Game-Win64-Shipping,NikkiSync-PC,NikkiSync-PC-service,NikkiSync.WindowsShell -ErrorAction SilentlyContinue).Count'], { windowsHide: true, timeout: 8000 });
  assert.equal(Number(stdout.trim()), 0, 'Close the game and the existing NikkiSync tray instance before acceptance; do not kill user processes.');
}
async function protectedFiles() {
  const files = {};
  for (const name of await readdir(userData)) {
    if (name === 'game-install-root.txt') continue;
    const file = join(userData, name), info = await stat(file);
    if (info.isFile()) files[name] = hash(await readFile(file));
  }
  return files;
}
async function fingerprints(directory) {
  const files = {};
  for (const name of (await readdir(directory, { recursive: true })).sort()) {
    const file = join(directory, name), info = await stat(file);
    if (info.isFile()) files[name] = { length: info.size, mtime: info.mtimeMs, sha256: hash(await readFile(file)) };
  }
  return files;
}
async function boot(env = {}) {
  await verifyClosedGame();
  const reserve = net.createServer();
  await new Promise((done, reject) => { reserve.once('error', reject); reserve.listen(0, '127.0.0.1', done); });
  const port = reserve.address().port;
  await new Promise(done => reserve.close(done));
  const environment = { ...process.env, LOCALAPPDATA: join(profile, 'localdata'),
    DOTNET_BUNDLE_EXTRACT_BASE_DIR: join(relocated, 'native-cache'),
    NIKKISYNC_BIND: '127.0.0.1', NIKKISYNC_PORT: '0', NIKKISYNC_MDNS: '0', ...env };
  if (!('NIKKISYNC_GAME_ROOT' in env)) delete environment.NIKKISYNC_GAME_ROOT;
  const child = spawn(executable, ['--verify-startup', profile, String(port)], { cwd: relocated, windowsHide: true, stdio: 'ignore', env: environment });
  const watchdog = setTimeout(() => child.kill(), 170000);
  let exit;
  try { [exit] = await once(child, 'exit'); } finally { clearTimeout(watchdog); }
  assert.equal(exit, 0, 'Actual WPF verification host failed or timed out.');
  const ui = JSON.parse(await readFile(join(profile, 'startup-verification.json'), 'utf8'));
  const discovery = JSON.parse(await readFile(join(data, 'game-discovery.log'), 'utf8'));
  if (!ui.ok) {
    const failure = JSON.parse(await readFile(join(data, 'startup-diagnostics.log'), 'utf8'));
    throw new Error('Actual dashboard failed: ' + JSON.stringify(failure));
  }
  assert.ok(ui.browserVisible && ui.loaderHidden && discovery.found);
  const database = new DatabaseSync(join(data, 'nikkisync.sqlite'), { readOnly: true });
  let assets;
  try { assets = Number(database.prepare("SELECT COUNT(*) AS total FROM assets WHERE asset_state != 'deleted'").get().total); }
  finally { database.close(); }
  assert.ok(assets > 0, 'The real photo library must be indexed, not an empty synthetic installation.');
  return { stages: ui.stages, discovery, assets };
}

let cleared = false, succeeded = false;
const before = await protectedFiles();
try {
  await verifyClosedGame();
  await copyFile(join(release, 'NikkiSync-PC.exe'), executable);
  await mkdir(data, { recursive: true });
  await writeFile(join(data, 'metadata-resolver.json'), JSON.stringify({ enabled: false }));
  await writeFile(join(data, 'metadata-dictionary-remote.json'), JSON.stringify({ enabled: false, provider: { type: 'nikki-albums-public' }, gallery: { enabled: false } }));
  const oldDefault = await optionalRead(cache);
  if (oldDefault) {
    // AppData may be on C: while this workspace is on D:. Back up and verify
    // before removing the one exact cache file; rename cannot cross volumes.
    await copyFile(cache, backup);
    assert.equal(hash(await readFile(backup)), hash(oldDefault));
    await rm(cache);
    cleared = true;
  }
  assert.equal(await optionalRead(cache), undefined);
  assert.equal(await optionalRead(join(data, 'game-install-root.txt')), undefined);
  const first = await boot();
  assert.ok(['registry', 'shortcut', 'common-location'].includes(first.discovery.source), 'First run must use real Windows/disk evidence, not a cache, env or game-tree ancestor.');
  const gameRoot = (await readFile(join(data, 'game-install-root.txt'), 'utf8')).trim();
  assert.ok(!resolve(executable).toLowerCase().startsWith(resolve(gameRoot).toLowerCase() + sep));
  assert.ok(!resolve(profile).toLowerCase().startsWith(resolve(gameRoot).toLowerCase() + sep));
  const payload = await fingerprints(join(profile, 'runtime-cache'));
  const native = await fingerprints(join(relocated, 'native-cache'));
  const second = await boot();
  assert.equal(second.discovery.source, 'cached');
  assert.equal(second.assets, first.assets);
  assert.deepEqual(await fingerprints(join(profile, 'runtime-cache')), payload, 'Repeated startup must reuse the unpacked service runtime.');
  assert.deepEqual(await fingerprints(join(relocated, 'native-cache')), native, 'Repeated startup must reuse the .NET runtime.');
  // Simulate the game's move with a dead remembered path; no injected correct root.
  await writeFile(join(data, 'game-install-root.txt'), join(relocated, 'no-longer-installed') + '\n');
  const moved = await boot();
  assert.ok(['registry', 'shortcut', 'common-location'].includes(moved.discovery.source));
  assert.equal(moved.assets, first.assets);
  // Folder-picker fallback uses the actual launcher parent, not just the exact game root.
  const manual = await boot({ NIKKISYNC_GAME_ROOT: resolve(gameRoot, '..') });
  assert.equal(manual.discovery.source, 'manual');
  assert.equal((await readFile(join(data, 'game-install-root.txt'), 'utf8')).trim(), gameRoot);
  assert.deepEqual(await protectedFiles(), before, 'User database, pairing and other settings must remain byte-for-byte intact.');
  const report = { actualSingleExe: true, gameClosedAllRuns: true, realGameLibrary: true, relocatedExecutableAndProfile: true,
    realGameDefaultCleared: true, previousDefaultBackedUp: cleared, noInjectedPathOnAutomaticRuns: true,
    userOtherFilesUnchanged: true, onlineProvidersDisabled: true, payloadReused: true, nativeReused: true,
    exeSha256: hash(await readFile(executable)), runs: { first, cached: second, moved, manual } };
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  await copyFile(join(profile, 'startup-screen.png'), join(output, 'startup-screen.png'));
  // Repopulate only the root default from the independently discovered real install.
  await writeFile(cache, gameRoot + '\n');
  succeeded = true;
  console.log(JSON.stringify({ report: relative(root, join(output, 'report.json')), assets: first.assets,
    sources: Object.fromEntries(Object.entries(report.runs).map(([name, run]) => [name, run.discovery.source])),
    gameClosed: true, realDefaultCleared: true, userOtherFilesUnchanged: true }));
} finally {
  if (!succeeded && cleared && !(await optionalRead(cache))) await copyFile(backup, cache);
  // Both are exact helper-owned locations. Validate their resolved boundary before deleting.
  const target = resolve(relocated), temp = resolve(tmpdir());
  assert.ok(target.startsWith(temp + sep) && relative(temp, target).startsWith('nikkisync-auto-first-run-'));
  await rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
