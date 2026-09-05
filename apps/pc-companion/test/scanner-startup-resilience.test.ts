import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { DatabaseManager } from '@nikkisync/database'
import { PcCompanionRuntime } from '../src/runtime.js'
import { ScannerService } from '../src/scanner/ScannerService.js'

test('scanner startup degrades to an empty error-state scan when the game install is unavailable', async () => {
  const database = new DatabaseManager(':memory:')
  database.initialize()
  const scanner = new ScannerService(database, {
    startingPaths: [],
    runningExecutablePaths: [],
    watcher: false
  })

  const result = await scanner.start()

  assert.deepEqual(result.roots, [])
  assert.equal(result.filesObserved, 0)
  assert.equal(result.resourcesAccepted, 0)
  assert.equal(result.assetsCreated, 0)
  assert.match(result.errors.join('\n'), /Infinity Nikki installation was not found/)
  assert.equal(scanner.getStatus().status, 'error')

  await scanner.stop()
  database.close()
})

test('runtime persists a discovered install root and reuses it when the game is not running later', async () => {
  const sandbox = await mkdtemp(path.join(os.tmpdir(), 'nikkisync-install-cache-'))
  const installRoot = path.join(sandbox, 'InfinityNikki')
  const photoRoot = path.join(installRoot, 'X6Game', 'Saved', 'GamePlayPhotos')
  const databaseFile = path.join(sandbox, 'nikkisync.sqlite')
  await mkdir(photoRoot, { recursive: true })
  await writeFile(path.join(installRoot, 'InfinityNikki.exe'), '')

  const first = new PcCompanionRuntime({
    databaseFile,
    scanner: { startingPaths: [installRoot], runningExecutablePaths: [], watcher: false },
    server: { host: '127.0.0.1', port: 0, mdns: false }
  })
  await first.start()
  assert.equal(first.scanner.getStatus().installation?.installRoot, installRoot)
  await first.stop()

  const second = new PcCompanionRuntime({
    databaseFile,
    scanner: { startingPaths: [], runningExecutablePaths: [], watcher: false },
    server: { host: '127.0.0.1', port: 0, mdns: false }
  })
  await second.start()
  assert.equal(second.scanner.getStatus().installation?.installRoot, installRoot)
  assert.equal(second.scanner.getStatus().installation?.source, 'cached')
  await second.stop()

  await rm(sandbox, { recursive: true, force: true })
})
