import assert from 'node:assert/strict'
import test from 'node:test'
import { GameVersionCalendar } from '../src/game-version/GameVersionCalendar.js'

test('game version calendar resolves the latest UTC availability boundary and leaves earlier timestamps unknown', () => {
  const calendar = new GameVersionCalendar({
    schemaVersion: 1,
    provider: 'fixture-calendar',
    providerVersion: '1',
    sourceUrls: ['https://example.test/versions'],
    entries: [
      { version: '2.9', availableAt: '2026-08-28T03:00:00.000Z' },
      { version: '2.8', availableAt: '2026-07-17T03:00:00.000Z' }
    ]
  })

  assert.equal(calendar.resolve('2026-08-28T02:59:59.999Z'), '2.8')
  assert.equal(calendar.resolve('2026-08-28T03:00:00.000Z'), '2.9')
  assert.equal(calendar.resolve('2026-09-05T00:00:00.000Z'), '2.9')
  assert.equal(calendar.resolve('2026-07-17T02:59:59.999Z'), undefined)
})

test('game version calendar rejects invalid timestamps instead of forcing a version', () => {
  const calendar = new GameVersionCalendar({
    schemaVersion: 1,
    provider: 'fixture-calendar',
    providerVersion: '1',
    sourceUrls: ['https://example.test/versions'],
    entries: [{ version: '2.9', availableAt: '2026-08-28T03:00:00.000Z' }]
  })

  assert.equal(calendar.resolve('not-a-date'), undefined)
  assert.equal(calendar.resolve(''), undefined)
})
