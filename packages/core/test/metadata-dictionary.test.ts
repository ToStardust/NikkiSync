import assert from 'node:assert/strict'
import test from 'node:test'
import {
  enrichPhotoMetadataWithDictionary,
  type InfinityPhotoMetadata,
  type MetadataDictionaryManifest
} from '../src/index.js'

const manifest: MetadataDictionaryManifest = {
  schemaVersion: 1,
  provider: 'fixture',
  providerVersion: '2026.09.03',
  generatedAt: '2026-09-03T00:00:00.000Z',
  entries: [
    { kind: 'filter', id: '7', name: '晨雾' },
    { kind: 'lighting', id: '9', name: '柔光' },
    {
      kind: 'clothing', id: '101', name: '星夜长发', category: 'hair', rarity: 5,
      thumbnail: 'https://example.test/101.webp',
      thumbnailFallbacks: ['https://example.test/type/10.webp']
    },
    { kind: 'pose', id: '12', name: '挥手' },
    { kind: 'location', id: '3001', name: '花愿镇' }
  ]
}

function metadata(): InfinityPhotoMetadata {
  return {
    schemaVersion: 1,
    identity: {}, capture: {}, camera: {},
    filter: { id: '7', strength: 0.8 },
    lighting: { id: '9', strength: 0.6 },
    dressing: { clothes: [101, 999] },
    interactions: [12, 88],
    location: { id: '3001', coordinates: { x: 1, y: 2, z: 3 } },
    raw: { nativeParamToken: 'opaque' }
  }
}

test('metadata dictionary enriches known IDs and preserves unknown IDs losslessly', () => {
  const enriched = enrichPhotoMetadataWithDictionary(metadata(), manifest)
  assert.equal(enriched.filter?.name, '晨雾')
  assert.equal(enriched.lighting?.name, '柔光')
  assert.deepEqual(enriched.dressing?.clothes, [
    {
      id: '101', name: '星夜长发', category: 'hair', rarity: 5,
      thumbnail: 'https://example.test/101.webp',
      thumbnailFallbacks: ['https://example.test/type/10.webp']
    },
    { id: '999' }
  ])
  assert.deepEqual(enriched.interactions, [{ id: '12', name: '挥手' }, { id: '88' }])
  assert.equal(enriched.location?.name, '花愿镇')
  assert.deepEqual(enriched.location?.coordinates, { x: 1, y: 2, z: 3 })
  assert.equal(enriched.raw?.nativeParamToken, 'opaque')
  const dictionary = enriched.raw?.dictionary as Record<string, unknown>
  assert.equal(dictionary.provider, 'fixture')
  assert.equal(dictionary.providerVersion, '2026.09.03')
})

test('existing canonical names win over dictionary names', () => {
  const input = metadata()
  input.filter!.name = '用户自定义滤镜名'
  input.location!.name = '用户地点名'
  const enriched = enrichPhotoMetadataWithDictionary(input, manifest)
  assert.equal(enriched.filter?.name, '用户自定义滤镜名')
  assert.equal(enriched.location?.name, '用户地点名')
})

test('dictionary updates replace prior dictionary values but preserve user overrides', () => {
  const previous: MetadataDictionaryManifest = {
    schemaVersion: 1,
    provider: 'fixture',
    providerVersion: '1',
    entries: [
      { kind: 'filter', id: '7', name: '旧滤镜' },
      { kind: 'clothing', id: '101', name: '旧衣服名', category: 'hair', rarity: 4 }
    ]
  }
  const next: MetadataDictionaryManifest = {
    schemaVersion: 1,
    provider: 'fixture',
    providerVersion: '2',
    entries: [
      { kind: 'filter', id: '7', name: '新滤镜' },
      {
        kind: 'clothing', id: '101', name: '新衣服名', category: 'hair', rarity: 5,
        thumbnailFallbacks: ['https://example.test/type/10-v2.webp']
      }
    ]
  }
  const input = metadata()
  input.filter!.name = '旧滤镜'
  input.dressing!.clothes = [
    { id: '101', name: '旧衣服名', category: 'hair', rarity: 4 },
    { id: '777', name: '用户自定义衣服名' }
  ]
  const enriched = enrichPhotoMetadataWithDictionary(input, next, '2026-09-03T09:00:00.000Z', previous)
  assert.equal(enriched.filter?.name, '新滤镜')
  assert.deepEqual(enriched.dressing?.clothes, [
    {
      id: '101', name: '新衣服名', category: 'hair', rarity: 5,
      thumbnailFallbacks: ['https://example.test/type/10-v2.webp']
    },
    { id: '777', name: '用户自定义衣服名' }
  ])
})
