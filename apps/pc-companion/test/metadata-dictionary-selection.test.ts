import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { DefaultOnlineMetadataDictionaryProvider } from '../src/metadata/DefaultOnlineMetadataDictionaryProvider.js'
import { loadMetadataDictionaryRemoteConfigFile } from '../src/metadata/MetadataDictionaryRemoteConfigFile.js'
import { selectMetadataDictionaryRemote } from '../src/metadata/MetadataDictionarySelection.js'

test('Windows metadata dictionary defaults to the online camera and clothing adapter', () => {
  const selection = selectMetadataDictionaryRemote(undefined)
  assert.ok(selection)
  assert.ok(selection.provider instanceof DefaultOnlineMetadataDictionaryProvider)
  assert.equal(selection.provider.id, 'nikkisync-default-online')
  assert.deepEqual(selection.service, { enabled: true })
})

test('an explicit disabled dictionary config suppresses the default online updater', () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'nikkisync-dictionary-selection-'))
  const file = path.join(directory, 'metadata-dictionary-remote.json')
  try {
    writeFileSync(file, JSON.stringify({ enabled: false }))
    const loaded = loadMetadataDictionaryRemoteConfigFile(file)
    assert.deepEqual(loaded, { enabled: false })
    assert.equal(selectMetadataDictionaryRemote(loaded), undefined)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('an explicitly enabled custom remote dictionary overrides the default adapter and interval', () => {
  const selection = selectMetadataDictionaryRemote({
    enabled: true,
    provider: {
      id: 'custom-dictionary',
      endpoint: 'https://example.test/metadata.json',
      intervalMs: 123_456
    }
  })
  assert.ok(selection)
  assert.equal(selection.provider.id, 'custom-dictionary')
  assert.deepEqual(selection.service, { enabled: true, intervalMs: 123_456 })
})
