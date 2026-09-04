import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { AppSettingsRepository, DatabaseManager } from '@nikkisync/database'
import type { GameVersionCalendarProvider } from '../src/game-version/GameVersionCalendarProvider.js'
import { GameVersionCalendarStore } from '../src/game-version/GameVersionCalendarStore.js'
import { PcCompanionRuntime } from '../src/runtime.js'

test('runtime seeds an empty calendar cache and constructs remote updater without network activity', () => {
  let fetches = 0
  const provider: GameVersionCalendarProvider = {
    id: 'fixture-calendar',
    async fetch() {
      fetches++
      return { status: 'not-modified' }
    }
  }
  const runtime = new PcCompanionRuntime({
    gameVersionCalendarRemote: { provider, service: { enabled: true } },
    server: { host: '127.0.0.1', port: 0, mdns: false }
  })
  try {
    assert.equal(runtime.gameVersionCalendar.manifest()?.provider, 'nikkisync-builtin-official')
    assert.equal(runtime.gameVersionCalendar.resolve('2026-09-01T00:00:00.000Z'), '2.9')
    assert.ok(runtime.gameVersionCalendarUpdater)
    assert.equal(fetches, 0)
  } finally {
    runtime.database.close()
  }
})

test('runtime preserves an existing cached calendar instead of overwriting it with the built-in seed', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nikkisync-calendar-runtime-'))
  const databaseFile = path.join(directory, 'nikkisync.sqlite')
  const database = new DatabaseManager(databaseFile)
  database.initialize()
  new GameVersionCalendarStore(new AppSettingsRepository(database)).replace({
    schemaVersion: 1,
    provider: 'cached-provider',
    providerVersion: 'future',
    sourceUrls: ['https://calendar.example.test/future'],
    entries: [{ version: '2.10', availableAt: '2026-09-01T03:00:00.000Z' }]
  })
  database.close()

  const runtime = new PcCompanionRuntime({ databaseFile, server: { host: '127.0.0.1', port: 0, mdns: false } })
  try {
    assert.equal(runtime.gameVersionCalendar.manifest()?.provider, 'cached-provider')
    assert.equal(runtime.gameVersionCalendar.resolve('2026-09-02T00:00:00.000Z'), '2.10')
  } finally {
    runtime.database.close()
    await rm(directory, { recursive: true, force: true })
  }
})
