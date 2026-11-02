import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
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
  if (object.thumbnailFallbacks !== undefined && (!Array.isArray(object.thumbnailFallbacks)
    || object.thumbnailFallbacks.some(value => typeof value !== 'string' || !value))) {
    throw new Error(`metadata dictionary entry ${index}.thumbnailFallbacks must be an array of nonempty strings`)
  }
  return {
    kind: object.kind as MetadataDictionaryEntry['kind'],
    id: object.id,
    ...(object.name === undefined ? {} : { name: object.name as string }),
    ...(object.category === undefined ? {} : { category: object.category as string }),
    ...(object.rarity === undefined ? {} : { rarity: object.rarity as number }),
    ...(object.thumbnail === undefined ? {} : { thumbnail: object.thumbnail as string }),
    ...(object.suitId === undefined ? {} : { suitId: object.suitId as string }),
    ...(object.suitName === undefined ? {} : { suitName: object.suitName as string }),
    ...(object.thumbnailFallbacks === undefined ? {} : { thumbnailFallbacks: [...object.thumbnailFallbacks as string[]] }),
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
  private readonly supplements = new Map<string, MetadataDictionaryManifest>()

  constructor(database: DatabaseManager, supplement?: MetadataDictionaryManifest) {
    this.assets = new AssetRepository(database)
    this.dictionary = new MetadataDictionaryRepository(database)
    if (supplement) {
      const parsed = parseMetadataDictionaryManifest(supplement)
      this.supplements.set(parsed.provider, parsed)
    }
    const active = this.dictionary.getActiveManifest()
    if (active) {
      const merged = this.withSupplement(active)
      if (merged !== active) this.dictionary.replaceSnapshot(merged)
    } else if (supplement) {
      this.dictionary.replaceSnapshot(parseMetadataDictionaryManifest(supplement))
    }
  }

  private withImageFallbackVersion(manifest: MetadataDictionaryManifest): MetadataDictionaryManifest {
    if (!manifest.entries.some(entry => entry.thumbnailFallbacks?.length)
      || manifest.providerVersion.split(':').includes('image-fallbacks-v1')) return manifest
    // Existing photos must be enriched once even when the remote source returns HTTP 304.
    return { ...manifest, providerVersion: `${manifest.providerVersion}:image-fallbacks-v1` }
  }

  private withSupplement(manifest: MetadataDictionaryManifest): MetadataDictionaryManifest {
    if (!this.supplements.size) return this.withImageFallbackVersion(manifest)
    const entries = new Map(manifest.entries.map(entry => [`${entry.kind}:${entry.id}`, entry]))
    let changed = false
    for (const source of this.supplements.values()) for (const supplement of source.entries) {
      const key = `${supplement.kind}:${supplement.id}`
      const entry = entries.get(key)
      // A conflicting suit membership invalidates this exact-ID name supplement.
      if (entry?.suitId && supplement.suitId && entry.suitId !== supplement.suitId) continue
      const patched = { ...(entry ?? { kind: supplement.kind, id: supplement.id }) }
      const fields: string[] = []
      for (const field of ['name', 'suitId', 'suitName', 'category', 'thumbnail'] as const) {
        if (!patched[field]?.trim() && supplement[field]?.trim()) {
          patched[field] = supplement[field]
          fields.push(field)
        }
      }
      if (!fields.length) continue
      patched.raw = {
        ...(entry?.raw ?? {}),
        localNameSupplement: {
          provider: source.provider,
          providerVersion: source.providerVersion,
          fields,
          values: Object.fromEntries(fields.map(field => [field, patched[field as keyof MetadataDictionaryEntry]])),
          ...(supplement.raw ?? {})
        }
      }
      entries.set(key, patched)
      changed = true
    }
    if (!changed) return this.withImageFallbackVersion(manifest)
    const digest = createHash('sha256').update(JSON.stringify([...this.supplements.values()].flatMap(source => source.entries))).digest('hex').slice(0, 16)
    return this.withImageFallbackVersion({
      ...manifest,
      providerVersion: `${manifest.providerVersion.replace(/:local-names-[a-f0-9]{16}(?=:|$)/g, '')}:local-names-${digest}`,
      entries: [...entries.values()]
    })
  }

  /** Fill gaps using a separately cached source; only its own prior values may be refreshed. */
  setSupplement(manifest: MetadataDictionaryManifest): MetadataDictionaryManifest | undefined {
    const source = parseMetadataDictionaryManifest(manifest)
    const previous = this.dictionary.getActiveManifest()
    this.supplements.set(source.provider, source)
    const supplied = new Set(source.entries.map(entry => `${entry.kind}:${entry.id}`))
    const base = previous ? { ...previous, entries: previous.entries.map(entry => {
      const origin = objectOf(entry.raw?.localNameSupplement), values = objectOf(origin?.values)
      if (origin?.provider !== source.provider || !values || !Array.isArray(origin.fields)
        || !supplied.has(`${entry.kind}:${entry.id}`)) return entry
      const restored = { ...entry, raw: { ...(entry.raw ?? {}) } }
      for (const field of ['name', 'suitId', 'suitName', 'category', 'thumbnail'] as const) {
        if (origin.fields.includes(field) && restored[field] === values[field]) {
          delete restored[field]
          if (field === 'suitId' || field === 'suitName') delete restored.raw[field]
        }
      }
      delete restored.raw.localNameSupplement
      return restored
    }) } : { schemaVersion: 1 as const, provider: 'nikkisync-local', providerVersion: '1', entries: [] }
    const merged = this.withSupplement(base)
    if (!previous || merged.providerVersion !== previous.providerVersion) this.dictionary.replaceSnapshot(merged)
    return previous
  }

  loadLocalManifest(filePath: string): MetadataDictionaryManifest {
    const manifest = parseMetadataDictionaryManifest(JSON.parse(readFileSync(filePath, 'utf8')) as unknown)
    this.replaceManifest(manifest)
    return manifest
  }

  replaceManifest(manifest: MetadataDictionaryManifest): MetadataDictionaryManifest | undefined {
    const validated = parseMetadataDictionaryManifest(manifest)
    const previous = this.dictionary.getActiveManifest()
    this.dictionary.replaceSnapshot(this.withSupplement(validated))
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
    return this.enrichAssetMetadata(assetId, metadata, manifest, previousManifest)
  }

  private enrichAssetMetadata(assetId: string, metadata: InfinityPhotoMetadata, manifest: MetadataDictionaryManifest,
    previousManifest?: MetadataDictionaryManifest): boolean {
    const state = objectOf(metadata.raw?.dictionary)
    if (state?.provider === manifest.provider && state?.providerVersion === manifest.providerVersion) return false
    const enriched = enrichPhotoMetadataWithDictionary(metadata, manifest, undefined, previousManifest)
    this.assets.updateMetadata(assetId, enriched)
    return true
  }

  reenrichResolvedAssets(previousManifest?: MetadataDictionaryManifest): number {
    const manifest = this.dictionary.getActiveManifest()
    if (!manifest) return 0
    let updated = 0
    for (const row of this.assets.list()) {
      if (!row.metadata_json) continue
      const metadata = JSON.parse(String(row.metadata_json)) as InfinityPhotoMetadata
      const resolver = objectOf(metadata.raw?.resolver)
      if (resolver?.status !== 'resolved') continue
      if (this.enrichAssetMetadata(String(row.asset_id), metadata, manifest, previousManifest)) updated++
    }
    return updated
  }
}
