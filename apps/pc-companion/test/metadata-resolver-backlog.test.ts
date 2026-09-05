import assert from 'node:assert/strict'
import test from 'node:test'
import { AssetRepository, DatabaseManager } from '@nikkisync/database'
import { MetadataResolverService } from '../src/metadata/MetadataResolverService.js'
import type { PhotoMetadataResolver } from '../src/metadata/types.js'

test('metadata resolver progresses past already-resolved oldest assets across small batches', async () => {
  const database = new DatabaseManager(':memory:')
  database.initialize()
  const assets = new AssetRepository(database)
  try {
    for (let index = 1; index <= 3; index++) {
      assets.create({
        assetId: `asset_${index}`,
        assetType: 'photo',
        uid: '10001',
        discoveredAt: `2026-09-0${index}T00:00:00.000Z`,
        metadataSchemaVersion: 1,
        metadata: {
          schemaVersion: 1,
          raw: { nativeParamToken: `token-${index}==` }
        }
      })
    }

    const resolvedAssets: string[] = []
    const resolver: PhotoMetadataResolver = {
      id: 'backlog-fixture',
      version: '1',
      async resolve(request) {
        resolvedAssets.push(request.assetId)
        return {
          provider: 'backlog-fixture',
          providerVersion: '1',
          metadata: { camera: { focalLength: Number(request.assetId.slice(-1)) * 10 } }
        }
      }
    }
    const service = new MetadataResolverService(database, resolver, { batchSize: 1 })

    assert.equal(await service.runOnce(), 1)
    assert.equal(await service.runOnce(), 1)
    assert.equal(await service.runOnce(), 1)
    assert.deepEqual(resolvedAssets, ['asset_1', 'asset_2', 'asset_3'])
    assert.equal(JSON.parse(String(assets.getById('asset_3')?.metadata_json)).raw.resolver.status, 'resolved')
  } finally {
    database.close()
  }
})
