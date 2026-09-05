import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatabaseManager } from '@nikkisync/database'
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
