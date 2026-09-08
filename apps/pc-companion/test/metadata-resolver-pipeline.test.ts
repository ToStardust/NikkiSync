import assert from 'node:assert/strict'
import test from 'node:test'
import type { PhotoMetadataResolver } from '../src/metadata/types.js'
import { MetadataResolverPipeline } from '../src/metadata/MetadataResolverPipeline.js'

const request = {
  assetId: 'asset_pipeline',
  uid: '10001',
  nativeParamToken: 'token=='
}

test('resolver pipeline keeps higher-priority values and lets later providers fill gaps', async () => {
  const primary: PhotoMetadataResolver = {
    id: 'primary', version: '1', capabilities: ['camera', 'filter'],
    async resolve() {
      return {
        provider: 'primary', providerVersion: '1', capabilities: ['camera', 'filter'],
        metadata: { camera: { focalLength: 35 }, filter: { id: '7' } }
      }
    }
  }
  const fallback: PhotoMetadataResolver = {
    id: 'fallback', version: '2', capabilities: ['camera', 'lighting'],
    async resolve() {
      return {
        provider: 'fallback', providerVersion: '2', capabilities: ['camera', 'lighting'],
        metadata: { camera: { focalLength: 50, exposure: 0.25 }, lighting: { id: '9' } }
      }
    }
  }

  const pipeline = new MetadataResolverPipeline({ resolvers: [primary, fallback] })
  const result = await pipeline.resolve(request)
  assert.equal(result.metadata.camera?.focalLength, 35)
  assert.equal(result.metadata.camera?.exposure, 0.25)
  assert.equal(result.metadata.filter?.id, '7')
  assert.equal(result.metadata.lighting?.id, '9')
  assert.deepEqual(result.capabilities, ['camera', 'filter', 'lighting'])
})

test('resolver pipeline continues after a provider failure', async () => {
  const failing: PhotoMetadataResolver = {
    id: 'failing', capabilities: ['clothing'],
    async resolve() { throw new Error('fixture failure') }
  }
  const fallback: PhotoMetadataResolver = {
    id: 'fallback', capabilities: ['pose'],
    async resolve() {
      return { provider: 'fallback', capabilities: ['pose'], metadata: { photography: { poseId: '12' } } }
    }
  }

  const result = await new MetadataResolverPipeline({ resolvers: [failing, fallback] }).resolve(request)
  assert.equal(result.metadata.photography?.poseId, '12')
  const raw = result.rawResponse as { failures?: Array<{ provider: string }> }
  assert.equal(raw.failures?.[0]?.provider, 'failing')
})

test('resolver pipeline fails only when every provider fails', async () => {
  const one: PhotoMetadataResolver = { id: 'one', async resolve() { throw new Error('one failed') } }
  const two: PhotoMetadataResolver = { id: 'two', async resolve() { throw new Error('two failed') } }
  await assert.rejects(
    () => new MetadataResolverPipeline({ resolvers: [one, two] }).resolve(request),
    /all metadata resolver providers failed/
  )
})
