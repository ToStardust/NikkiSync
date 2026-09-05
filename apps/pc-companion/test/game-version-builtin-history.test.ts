import assert from 'node:assert/strict'
import test from 'node:test'
import { BUILTIN_GAME_VERSION_CALENDAR } from '../src/game-version/BuiltinGameVersionCalendar.js'
import { GameVersionCalendar } from '../src/game-version/GameVersionCalendar.js'

const EXPECTED_VERSIONS = [
  '1.0', '1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '1.8', '1.9', '1.10', '1.11',
  '2.0', '2.1', '2.2', '2.3', '2.4', '2.5', '2.6', '2.7', '2.8', '2.9'
]

test('built-in calendar covers every verified release from 1.0 through 2.9', () => {
  assert.deepEqual(
    BUILTIN_GAME_VERSION_CALENDAR.entries.map((entry) => entry.version),
    EXPECTED_VERSIONS
  )

  const calendar = new GameVersionCalendar(BUILTIN_GAME_VERSION_CALENDAR)
  assert.equal(calendar.resolve('2024-12-05T01:59:59.999Z'), undefined)
  assert.equal(calendar.resolve('2024-12-05T02:00:00.000Z'), '1.0')
  assert.equal(calendar.resolve('2025-09-29T03:00:00.000Z'), '1.10')
  assert.equal(calendar.resolve('2025-10-28T03:00:00.000Z'), '1.11')
  assert.equal(calendar.resolve('2025-11-26T03:00:00.000Z'), '2.0')
  assert.equal(calendar.resolve('2026-06-24T03:00:00.000Z'), '2.7')
  assert.equal(calendar.resolve('2026-07-17T03:00:00.000Z'), '2.8')
  assert.equal(calendar.resolve('2026-08-28T03:00:00.000Z'), '2.9')
})
