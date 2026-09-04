import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { discoverInfinityNikkiInstallation } from '../src/index.js'

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
