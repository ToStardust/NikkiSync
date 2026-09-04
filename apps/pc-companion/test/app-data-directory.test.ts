import assert from 'node:assert/strict'
import test from 'node:test'
import { chooseWritableDataDirectory } from '../src/desktop/AppDataDirectory.js'

test('app data directory falls back when the preferred user profile directory is not writable', () => {
  const checked: string[] = []
  const selected = chooseWritableDataDirectory(['C:/Users/Stardust/AppData/Local/NikkiSync', 'D:/NikkiSync/data'], (directory) => {
    checked.push(directory)
    return directory === 'D:/NikkiSync/data'
  })
  assert.equal(selected, 'D:/NikkiSync/data')
  assert.deepEqual(checked, ['C:/Users/Stardust/AppData/Local/NikkiSync', 'D:/NikkiSync/data'])
})
