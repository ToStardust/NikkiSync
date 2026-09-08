import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  createMetadataResolverFromConfig,
  loadMetadataResolverConfigFile,
  orderedMetadataProviderConfigs
} from '../src/metadata/MetadataResolverConfigFile.js'
import { MetadataResolverPipeline } from '../src/metadata/MetadataResolverPipeline.js'
import { RemoteJsonMetadataResolver } from '../src/metadata/RemoteJsonMetadataResolver.js'

test('resolver config keeps legacy single-provider shape compatible', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nikkisync-resolver-legacy-'))
  const file = path.join(directory, 'metadata-resolver.json')
  try {
    await writeFile(file, JSON.stringify({
      enabled: true,
      provider: { type: 'remote-json', id: 'legacy', endpoint: 'https://metadata.example.test/v1/resolve' }
    }))
    const config = loadMetadataResolverConfigFile(file)
    assert.equal(config?.provider?.type, 'remote-json')
    const resolver = createMetadataResolverFromConfig(config)
    assert.ok(resolver instanceof RemoteJsonMetadataResolver)
    assert.equal(resolver.id, 'legacy')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('resolver config orders providers by descending priority and preserves equal-priority file order', () => {
  const ordered = orderedMetadataProviderConfigs({
    providers: [
      { type: 'remote-json', id: 'low', priority: 10, endpoint: 'https://low.example.test' },
      { type: 'remote-json', id: 'high-a', priority: 100, endpoint: 'https://high-a.example.test' },
      { type: 'remote-json', id: 'high-b', priority: 100, endpoint: 'https://high-b.example.test' }
    ]
  })
  assert.deepEqual(ordered.map((provider) => provider.id), ['high-a', 'high-b', 'low'])
})

test('resolver config builds a pipeline for multiple providers', () => {
  const resolver = createMetadataResolverFromConfig({
    providers: [
      { type: 'nuan5-compatible', id: 'nuan5', priority: 100, endpoint: 'https://nuan5.example.test/api/decode-photo2' },
      { type: 'remote-json', id: 'cloud', priority: 50, endpoint: 'https://metadata.example.test/v1/resolve' }
    ]
  })
  assert.ok(resolver instanceof MetadataResolverPipeline)
  assert.match(resolver.id, /nuan5/)
  assert.match(resolver.id, /cloud/)
})

test('resolver config rejects invalid providers arrays and insecure remote endpoints', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'nikkisync-resolver-invalid-'))
  try {
    const empty = path.join(directory, 'empty.json')
    await writeFile(empty, JSON.stringify({ enabled: true, providers: [] }))
    assert.equal(loadMetadataResolverConfigFile(empty), undefined)

    const insecure = path.join(directory, 'insecure.json')
    await writeFile(insecure, JSON.stringify({
      enabled: true,
      providers: [{ type: 'remote-json', endpoint: 'http://metadata.example.test/v1/resolve' }]
    }))
    assert.equal(loadMetadataResolverConfigFile(insecure), undefined)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
