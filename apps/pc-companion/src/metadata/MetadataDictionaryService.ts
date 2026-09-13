import { readFileSync } from 'node:fs'
import {
  METADATA_DICTIONARY_KINDS,
  enrichPhotoMetadataWithDictionary,
  type InfinityPhotoMetadata,
  type MetadataDictionaryEntry,
  type MetadataDictionaryManifest
} from '@nikkisync/core'
import { AssetRepository, MetadataDictionaryRepository, type DatabaseManager } from '@nikkisync/database'

function objectOf(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function validateEntry(value: unknown, index: number): MetadataDictionaryEntry {
  const object = objectOf(value)
  if (!object) throw new Error(`metadata dictionary entry ${index} must be an object`)
  if (!METADATA_DICTIONARY_KINDS.includes(object.kind as any)) {
    throw new Error(`metadata dictionary entry ${index} has an unsupported kind`)
  }
  if (typeof object.id !== 'string' || !object.id) throw new Error(`metadata dictionary entry ${index} requires a string id`)
  for (const key of ['name', 'category', 'thumbnail', 'suitId', 'suitName'] as const) {
    if (object[key] !== undefined && typeof object[key] !== 'string') throw new Error(`metadata dictionary entry ${index}.${key} must be a string`)
  }
  if (object.rarity !== undefined && (typeof object.rarity !== 'number' || !Number.isFinite(object.rarity))) {
    throw new Error(`metadata dictionary entry ${index}.rarity must be a finite number`)
  }
  if (object.raw !== undefined && !objectOf(object.raw)) throw new Error(`metadata dictionary entry ${index}.raw must be an object`)
  return {
    kind: object.kind as MetadataDictionaryEntry['kind'],
    id: object.id,
    ...(object.name === undefined ? {} : { name: object.name as string }),
    ...(object.category === undefined ? {} : { category: object.category as string }),
    ...(object.rarity === undefined ? {} : { rarity: object.rarity as number }),
    ...(object.thumbnail === undefined ? {} : { thumbnail: object.thumbnail as string }),
    ...(object.suitId === undefined ? {} : { suitId: object.suitId as string }),
    ...(object.suitName === undefined ? {} : { suitName: object.suitName as string }),
    ...(object.raw === undefined ? {} : { raw: object.raw as Record<string, unknown> })
  }
}

export function parseMetadataDictionaryManifest(value: unknown): MetadataDictionaryManifest {
  const object = objectOf(value)
  if (!object || object.schemaVersion !== 1) throw new Error('metadata dictionary schemaVersion must be 1')
  if (typeof object.provider !== 'string' || !object.provider) throw new Error('metadata dictionary provider is required')
  if (typeof object.providerVersion !== 'string' || !object.providerVersion) throw new Error('metadata dictionary providerVersion is required')
  if (!Array.isArray(object.entries)) throw new Error('metadata dictionary entries must be an array')
  const duplicateKeys = new Set<string>()
  const entries = object.entries.map((entry, index) => {
    const parsed = validateEntry(entry, index)
    const key = `${parsed.kind}:${parsed.id}`
    if (duplicateKeys.has(key)) throw new Error(`metadata dictionary contains duplicate entry ${key}`)
    duplicateKeys.add(key)
    return parsed
  })
  for (const key of ['gameVersion', 'generatedAt', 'fetchedAt'] as const) {
    if (object[key] !== undefined && typeof object[key] !== 'string') throw new Error(`metadata dictionary ${key} must be a string`)
  }
  return {
    schemaVersion: 1,
    provider: object.provider,
    providerVersion: object.providerVersion,
    ...(object.gameVersion === undefined ? {} : { gameVersion: object.gameVersion as string }),
    ...(object.generatedAt === undefined ? {} : { generatedAt: object.generatedAt as string }),
    ...(object.fetchedAt === undefined ? {} : { fetchedAt: object.fetchedAt as string }),
    entries
  }
}

export class MetadataDictionaryService {
  private readonly assets: AssetRepository
  private readonly dictionary: MetadataDictionaryRepository

  constructor(database: DatabaseManager) {
    this.assets = new AssetRepository(database)
    this.dictionary = new MetadataDictionaryRepository(database)
  }

  loadLocalManifest(filePath: string): MetadataDictionaryManifest {
    const manifest = parseMetadataDictionaryManifest(JSON.parse(readFileSync(filePath, 'utf8')) as unknown)
    this.replaceManifest(manifest)
    return manifest
  }

  replaceManifest(manifest: MetadataDictionaryManifest): MetadataDictionaryManifest | undefined {
    const validated = parseMetadataDictionaryManifest(manifest)
    const previous = this.dictionary.getActiveManifest()
    this.dictionary.replaceSnapshot(validated)
    return previous
  }

  enrichMetadata(
    metadata: Partial<InfinityPhotoMetadata>,
    previousManifest?: MetadataDictionaryManifest
  ): Partial<InfinityPhotoMetadata> {
    const manifest = this.dictionary.getActiveManifest()
    if (!manifest) return metadata
    return enrichPhotoMetadataWithDictionary(metadata as InfinityPhotoMetadata, manifest, undefined, previousManifest)
  }

  enrichAsset(assetId: string, previousManifest?: MetadataDictionaryManifest): boolean {
    const manifest = this.dictionary.getActiveManifest()
    if (!manifest) return false
    const row = this.assets.getById(assetId)
    if (!row?.metadata_json) return false
    const metadata = JSON.parse(String(row.metadata_json)) as InfinityPhotoMetadata
    const state = objectOf(metadata.raw?.dictionary)
    if (state?.provider === manifest.provider && state?.providerVersion === manifest.providerVersion) return false
    const enriched = this.enrichMetadata(metadata, previousManifest)
    this.assets.updateMetadata(assetId, enriched)
    return true
  }

  reenrichResolvedAssets(previousManifest?: MetadataDictionaryManifest): number {
    let updated = 0
    for (const row of this.assets.list()) {
      if (!row.metadata_json) continue
      const metadata = JSON.parse(String(row.metadata_json)) as InfinityPhotoMetadata
      const resolver = objectOf(metadata.raw?.resolver)
      if (resolver?.status !== 'resolved') continue
      if (this.enrichAsset(String(row.asset_id), previousManifest)) updated++
    }
    return updated
  }
}
