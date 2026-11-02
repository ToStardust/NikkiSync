import assert from 'node:assert/strict'
import test from 'node:test'
import { PcCompanionRuntime } from '../src/runtime.js'
import type { ScanResult } from '../src/scanner/types.js'

test('startup reports the exact pending stage when LAN startup never completes', async t => {
  const stages: string[] = []
  const runtime = new PcCompanionRuntime({ onStartupStage: stage => stages.push(stage) })
  t.mock.method(runtime.scanner, 'start', async () => ({} as ScanResult))
  let complete!: (value: { host: string; port: number; secure: boolean }) => void
  t.mock.method(runtime.server, 'start', () => new Promise(resolve => { complete = resolve }))
  try {
    const startup = runtime.start()
    await Promise.resolve()
    assert.deepEqual(stages, ['scanner', 'lan-listen'])
    complete({ host: '127.0.0.1', port: 1, secure: true })
    await startup
    assert.deepEqual(stages, ['scanner', 'lan-listen', 'cached-metadata', 'dictionary-enrichment', 'background-services', 'runtime-ready'])
  } finally { await runtime.stop() }
})
