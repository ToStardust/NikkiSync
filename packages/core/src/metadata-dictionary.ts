import type { InfinityPhotoMetadata, IsoDateTime } from './types.js'

export const METADATA_DICTIONARY_KINDS = ['clothing', 'filter', 'lighting', 'pose', 'location'] as const
export type MetadataDictionaryKind = (typeof METADATA_DICTIONARY_KINDS)[number]

export interface MetadataDictionaryEntry {
  kind: MetadataDictionaryKind
  id: string
  name?: string
  category?: string
  rarity?: number
  thumbnail?: string
  raw?: Record<string, unknown>
}

export interface MetadataDictionaryManifest {
  schemaVersion: 1
  provider: string
  providerVersion: string
  gameVersion?: string
  generatedAt?: IsoDateTime
  fetchedAt?: IsoDateTime
  entries: MetadataDictionaryEntry[]
}

type DictionaryEntity = {
  id: string
  name?: string
  category?: string
  rarity?: number
  thumbnail?: string
  [key: string]: unknown
}

function indexManifest(manifest: MetadataDictionaryManifest): Map<string, MetadataDictionaryEntry> {
  return new Map(manifest.entries.map((entry) => [`${entry.kind}:${entry.id}`, entry]))
}

function previousEntry(
  previousManifest: MetadataDictionaryManifest | undefined,
  kind: MetadataDictionaryKind,
  id: string
): MetadataDictionaryEntry | undefined {
  return previousManifest?.entries.find((entry) => entry.kind === kind && entry.id === id)
}

function applyDictionaryField(
  target: Record<string, unknown>,
  field: 'name' | 'category' | 'rarity' | 'thumbnail',
  entry: MetadataDictionaryEntry | undefined,
  previous: MetadataDictionaryEntry | undefined
): void {
  const nextValue = entry?.[field]
  if (nextValue === undefined) return
  const currentValue = target[field]
  const previousValue = previous?.[field]
  if (currentValue === undefined || currentValue === previousValue) target[field] = nextValue
}

function enrichEntity(
  value: unknown,
  kind: MetadataDictionaryKind,
  index: Map<string, MetadataDictionaryEntry>,
  previousManifest?: MetadataDictionaryManifest
): DictionaryEntity | undefined {
  const source = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
  const rawId = source?.id ?? value
  if (typeof rawId !== 'string' && typeof rawId !== 'number') return undefined
  const id = String(rawId)
  const entry = index.get(`${kind}:${id}`)
  const enriched: DictionaryEntity = { ...(source ?? {}), id }
  if (entry) {
    const previous = previousEntry(previousManifest, kind, id)
    applyDictionaryField(enriched, 'name', entry, previous)
    applyDictionaryField(enriched, 'category', entry, previous)
    applyDictionaryField(enriched, 'rarity', entry, previous)
    applyDictionaryField(enriched, 'thumbnail', entry, previous)
  }
  return enriched
}

export function enrichPhotoMetadataWithDictionary(
  metadata: InfinityPhotoMetadata,
  manifest: MetadataDictionaryManifest,
  enrichedAt = new Date().toISOString(),
  previousManifest?: MetadataDictionaryManifest
): InfinityPhotoMetadata {
  const index = indexManifest(manifest)
  const filterEntry = metadata.filter?.id ? index.get(`filter:${metadata.filter.id}`) : undefined
  const previousFilterEntry = metadata.filter?.id ? previousEntry(previousManifest, 'filter', metadata.filter.id) : undefined
  const lightingEntry = metadata.lighting?.id ? index.get(`lighting:${metadata.lighting.id}`) : undefined
  const previousLightingEntry = metadata.lighting?.id ? previousEntry(previousManifest, 'lighting', metadata.lighting.id) : undefined
  const clothes = metadata.dressing?.clothes?.map((item) => enrichEntity(item, 'clothing', index, previousManifest) ?? item)
  const interactions = metadata.interactions?.map((item) => enrichEntity(item, 'pose', index, previousManifest) ?? item)
  const locationEntry = metadata.location?.id ? index.get(`location:${metadata.location.id}`) : undefined
  const previousLocationEntry = metadata.location?.id ? previousEntry(previousManifest, 'location', metadata.location.id) : undefined

  const filter = metadata.filter ? { ...metadata.filter } : undefined
  if (filter) applyDictionaryField(filter, 'name', filterEntry, previousFilterEntry)
  const lighting = metadata.lighting ? { ...metadata.lighting } : undefined
  if (lighting) applyDictionaryField(lighting, 'name', lightingEntry, previousLightingEntry)
  const location = metadata.location ? { ...metadata.location } : undefined
  if (location) applyDictionaryField(location, 'name', locationEntry, previousLocationEntry)

  return {
    ...metadata,
    ...(filter ? { filter } : {}),
    ...(lighting ? { lighting } : {}),
    ...(metadata.dressing ? {
      dressing: {
        ...metadata.dressing,
        ...(clothes ? { clothes } : {})
      }
    } : {}),
    ...(interactions ? { interactions } : {}),
    ...(location ? { location } : {}),
    raw: {
      ...(metadata.raw ?? {}),
      dictionary: {
        provider: manifest.provider,
        providerVersion: manifest.providerVersion,
        ...(manifest.gameVersion ? { gameVersion: manifest.gameVersion } : {}),
        enrichedAt
      }
    }
  }
}
