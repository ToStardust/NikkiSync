import assert from 'node:assert/strict'
import test from 'node:test'
import { Nuan5CompatibleResolver } from '../src/metadata/Nuan5CompatibleResolver.js'
import { selectMetadataResolver } from '../src/metadata/MetadataResolverSelection.js'

test('Windows metadata resolution defaults to NUAN5 when no config is present', () => {
  const resolver = selectMetadataResolver(undefined, {})
  assert.ok(resolver instanceof Nuan5CompatibleResolver)
  assert.equal(resolver.id, 'nuan5-compatible')
  assert.equal(resolver.version, 'decode-photo2-v1')
})

test('an explicit disabled metadata config still disables automatic resolution', () => {
  const resolver = selectMetadataResolver({ enabled: false }, {})
  assert.equal(resolver, undefined)
})
