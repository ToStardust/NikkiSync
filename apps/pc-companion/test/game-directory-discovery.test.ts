import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { discoverInfinityNikkiInstallation } from '../src/index.js'

const isolated = { includeDefaultPaths: false, runningExecutablePaths: [], windowsHints: { registryPaths: [], shortcutPaths: [], driveRoots: [] } }

async function installation(root: string, binaryOnly = false) {
  await mkdir(path.join(root, 'X6Game', 'Binaries', 'Win64'), { recursive: true })
  await writeFile(binaryOnly ? path.join(root, 'X6Game', 'Binaries', 'Win64', 'X6Game-Win64-Shipping.exe') : path.join(root, 'InfinityNikki.exe'), '')
}

test('manual fallback accepts a launcher folder, resolves its child game, and overrides a stale valid cache', async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), 'nikkisync-launcher-selection-'))
  try {
    const launcher = path.join(sandbox, 'InfinityNikki Launcher'), root = path.join(launcher, 'InfinityNikki')
    const old = path.join(sandbox, 'old-game')
    await installation(root); await installation(old)
    const result = await discoverInfinityNikkiInstallation({ ...isolated, selectedInstallRoot: launcher, cachedInstallRoot: old })
    assert.equal(result?.installRoot, root)
    assert.equal(result?.source, 'manual')
  } finally { await rm(sandbox, { recursive: true, force: true }) }
})

test('directory names with dots and a game with only its shipping binary are recognized', async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), 'nikkisync-dotted-install-'))
  try {
    const root = path.join(sandbox, 'Infinity Nikki 2.9')
    await installation(root, true)
    const result = await discoverInfinityNikkiInstallation({ ...isolated, selectedInstallRoot: root })
    assert.equal(result?.installRoot, root)
    assert.equal(result?.source, 'manual')
  } finally { await rm(sandbox, { recursive: true, force: true }) }
})

test('first run discovers from the launcher install record with the game closed and no cache', async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), 'nikkisync-registry-install-'))
  try {
    const launcher = path.join(sandbox, 'arbitrary launcher folder'), root = path.join(launcher, 'InfinityNikki')
    await installation(root)
    const result = await discoverInfinityNikkiInstallation({ ...isolated,
      windowsHints: { registryPaths: [path.join(sandbox, 'removed-game'), launcher], shortcutPaths: [], driveRoots: [] } })
    assert.equal(result?.installRoot, root)
    assert.equal(result?.source, 'registry')
  } finally { await rm(sandbox, { recursive: true, force: true }) }
})

test('a moved installation is discovered from its shortcut even when the old registry path is gone', async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), 'nikkisync-shortcut-install-'))
  try {
    const launcher = path.join(sandbox, 'moved launcher'), root = path.join(launcher, 'InfinityNikki')
    await installation(root)
    const launcherExe = path.join(launcher, 'launcher.exe'); await writeFile(launcherExe, '')
    const result = await discoverInfinityNikkiInstallation({ ...isolated,
      windowsHints: { registryPaths: [path.join(sandbox, 'removed', 'launcher.exe')], shortcutPaths: [launcherExe], driveRoots: [] } })
    assert.equal(result?.installRoot, root)
    assert.equal(result?.source, 'shortcut')
  } finally { await rm(sandbox, { recursive: true, force: true }) }
})

test('closed-game fallback checks common game locations on all fixed disks without requiring a shortcut', async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), 'nikkisync-disk-install-'))
  try {
    const root = path.join(sandbox, 'GAME', 'custom-location', 'InfinityNikki Launcher', 'InfinityNikki')
    await installation(root)
    const result = await discoverInfinityNikkiInstallation({ ...isolated,
      windowsHints: { registryPaths: [], shortcutPaths: [], driveRoots: [sandbox] } })
    assert.equal(result?.installRoot, root)
    assert.equal(result?.source, 'common-location')
  } finally { await rm(sandbox, { recursive: true, force: true }) }
})

test('an invalid manual folder fails explicitly and a misleading X6Game directory is not an installation', async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), 'nikkisync-invalid-selection-'))
  try {
    const old = path.join(sandbox, 'valid'), invalid = path.join(sandbox, 'invalid')
    await installation(old)
    await mkdir(path.join(invalid, 'InfinityNikki.exe'), { recursive: true })
    await mkdir(path.join(invalid, 'X6Game'), { recursive: true })
    const result = await discoverInfinityNikkiInstallation({ ...isolated, selectedInstallRoot: invalid, cachedInstallRoot: old })
    assert.equal(result, undefined, 'an invalid user choice must not silently reopen a different cached game')
  } finally { await rm(sandbox, { recursive: true, force: true }) }
})

test('a valid new game installation is recognized before its first photo folders exist', async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), 'nikkisync-empty-install-'))
  try {
    const installRoot = path.join(sandbox, 'InfinityNikki')
    await mkdir(path.join(installRoot, 'X6Game'), { recursive: true })
    await writeFile(path.join(installRoot, 'InfinityNikki.exe'), '')
    const result = await discoverInfinityNikkiInstallation({ startingPaths: [installRoot], runningExecutablePaths: [] })
    assert.equal(result?.installRoot, installRoot)
    assert.deepEqual(result?.photoRoots, [])
    assert.deepEqual(result?.motionRoots, [])
  } finally { await rm(sandbox, { recursive: true, force: true }) }
})

test('discovers a portable installation and current ScreenShot/Video roots without user configuration', async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), 'nikkisync-discovery-'))
  try {
    const installRoot = path.join(sandbox, 'InfinityNikki')
    const nestedApp = path.join(installRoot, 'X6Game', 'CameraPartner', 'NikkiSync')
    await mkdir(path.join(installRoot, 'X6Game', 'ScreenShot'), { recursive: true })
    await mkdir(path.join(installRoot, 'X6Game', 'Video'), { recursive: true })
    await mkdir(nestedApp, { recursive: true })
    await writeFile(path.join(installRoot, 'InfinityNikki.exe'), '')

    const result = await discoverInfinityNikkiInstallation({
      startingPaths: [nestedApp],
      runningExecutablePaths: []
    })

    assert.equal(result?.installRoot, installRoot)
    assert.deepEqual(result?.photoRoots, [path.join(installRoot, 'X6Game', 'ScreenShot')])
    assert.deepEqual(result?.motionRoots, [path.join(installRoot, 'X6Game', 'Video')])
    assert.equal(result?.source, 'local-ancestor')
  } finally {
    await rm(sandbox, { recursive: true, force: true })
  }
})

test('uses a persisted internal install root without asking the user again', async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), 'nikkisync-cached-discovery-'))
  try {
    const installRoot = path.join(sandbox, 'InfinityNikki')
    await mkdir(path.join(installRoot, 'X6Game', 'Saved', 'GamePlayPhotos'), { recursive: true })
    await writeFile(path.join(installRoot, 'InfinityNikki.exe'), '')
    const result = await discoverInfinityNikkiInstallation({
      cachedInstallRoot: installRoot,
      startingPaths: [],
      runningExecutablePaths: []
    })
    assert.equal(result?.source, 'cached')
    assert.deepEqual(result?.photoRoots, [path.join(installRoot, 'X6Game', 'Saved', 'GamePlayPhotos')])
  } finally {
    await rm(sandbox, { recursive: true, force: true })
  }
})

test('uses the internal game-root environment fallback when the app runs outside the game directory', async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), 'nikkisync-env-discovery-'))
  const previousRoot = process.env.NIKKISYNC_GAME_ROOT
  try {
    const installRoot = path.join(sandbox, 'InfinityNikki')
    await mkdir(path.join(installRoot, 'X6Game', 'ScreenShot'), { recursive: true })
    await writeFile(path.join(installRoot, 'InfinityNikki.exe'), '')
    process.env.NIKKISYNC_GAME_ROOT = installRoot

    const result = await discoverInfinityNikkiInstallation({
      startingPaths: [],
      runningExecutablePaths: []
    })

    assert.equal(result?.installRoot, installRoot)
    assert.equal(result?.source, 'manual')
  } finally {
    if (previousRoot === undefined) delete process.env.NIKKISYNC_GAME_ROOT
    else process.env.NIKKISYNC_GAME_ROOT = previousRoot
    await rm(sandbox, { recursive: true, force: true })
  }
})

test('prefers original hidden GamePlayPhotos and nested Videos over stripped export copies', async () => {
  const sandbox = await mkdtemp(path.join(tmpdir(), 'nikkisync-source-priority-'))
  try {
    const installRoot = path.join(sandbox, 'InfinityNikki')
    const originalRoot = path.join(installRoot, 'X6Game', 'Saved', 'GamePlayPhotos')
    const nestedVideos = path.join(originalRoot, '102773537', 'Videos')
    await mkdir(path.join(installRoot, 'X6Game', 'ScreenShot'), { recursive: true })
    await mkdir(path.join(installRoot, 'X6Game', 'Video'), { recursive: true })
    await mkdir(nestedVideos, { recursive: true })
    await writeFile(path.join(installRoot, 'InfinityNikki.exe'), '')

    const result = await discoverInfinityNikkiInstallation({
      startingPaths: [installRoot],
      runningExecutablePaths: []
    })

    assert.deepEqual(result?.photoRoots, [originalRoot])
    assert.deepEqual(result?.motionRoots, [nestedVideos])
  } finally {
    await rm(sandbox, { recursive: true, force: true })
  }
})
