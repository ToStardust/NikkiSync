import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseManager } from '@nikkisync/database'
import { ResourceClassifier } from '../src/scanner/ResourceClassifier.js'
import { ScannerService } from '../src/scanner/ScannerService.js'
import type { ScannerProgress } from '../src/scanner/types.js'

test('large file hashing reports actual bytes before classification finishes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'scan-progress-'))
  try {
    const directory = path.join(root, 'NikkiPhotos_HighQuality')
    await mkdir(directory)
    const file = path.join(directory, 'photo.jpg'), bytes = Buffer.alloc(3 * 1024 * 1024, 7)
    await writeFile(file, bytes)
    let finished = false, read = 0, events = 0
    const resource = await new ResourceClassifier().classify(file, root, count => {
      assert.equal(finished, false)
      read += count; events++
    })
    finished = true
    assert.equal(read, bytes.length + 64 * 1024, 'include the bounded JPEG trailer read as well as hashing')
    assert.ok(events > 1, 'a single large file must keep startup alive while streaming')
    assert.equal(resource.sizeBytes, bytes.length)
    assert.match(resource.sha256!, /^[0-9a-f]{64}$/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('startup scanning reports bounded, path-free counters through indexing and watching', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'scan-progress-'))
  const game = path.join(root, 'InfinityNikki'), directory = path.join(game, 'X6Game', 'Saved', 'GamePlayPhotos', '10001', 'NikkiPhotos_HighQuality')
  await mkdir(directory, { recursive: true })
  await writeFile(path.join(game, 'InfinityNikki.exe'), '')
  await writeFile(path.join(directory, 'photo.jpg'), Buffer.alloc(1024, 7))
  const database = new DatabaseManager(); database.initialize()
  const reports: ScannerProgress[] = []
  const scanner = new ScannerService(database, { startingPaths: [game], runningExecutablePaths: [],
    stability: { pollIntervalMs: 0, stableChecks: 1 }, onProgress: value => reports.push(value) })
  try {
    const result = await scanner.start()
    assert.equal(result.assetsCreated, 1)
    assert.deepEqual([...new Set(reports.map(value => value.stage))], ['scan-files', 'scan-index', 'scan-watch'])
    const last = reports.at(-1)!
    assert.equal(last.filesObserved, 1)
    assert.equal(last.filesCompleted, 1)
    assert.equal(last.bytesRead, 2048, 'hash plus trailer inspection')
    assert.equal(last.assetsProcessed, 1)
    assert.equal(reports[0]!.filesCompleted, 0, 'previous snapshots must remain immutable')
    assert.deepEqual(Object.keys(last).sort(), ['assetsProcessed', 'bytesRead', 'filesCompleted', 'filesObserved', 'stage'])
    assert.ok(reports.length < 10, 'progress must be throttled instead of logging every read chunk')
    assert.doesNotMatch(JSON.stringify(reports), /10001|photo\.jpg|InfinityNikki/)
  } finally { await scanner.stop(); database.close(); await rm(root, { recursive: true, force: true }) }
})
