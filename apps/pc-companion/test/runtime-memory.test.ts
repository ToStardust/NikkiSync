import assert from 'node:assert/strict'
import test from 'node:test'
import { RuntimeMemoryMaintenance } from '../src/RuntimeMemoryMaintenance.js'

test('memory maintenance coalesces completed work and has no permanent idle timer', async () => {
  let collections = 0
  const maintenance = new RuntimeMemoryMaintenance(() => { collections++ }, 10)
  maintenance.schedule(); maintenance.schedule(); maintenance.schedule()
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(collections, 1)
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(collections, 1, 'remaining idle must not keep forcing collection')
  maintenance.schedule(); maintenance.stop()
  await new Promise(resolve => setTimeout(resolve, 30))
  assert.equal(collections, 1, 'shutdown cancels maintenance')
})
