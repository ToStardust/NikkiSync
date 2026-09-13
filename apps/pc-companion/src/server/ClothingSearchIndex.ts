import type { MetadataDictionaryEntry, MetadataDictionaryManifest } from '@nikkisync/core'
import type {
  ClothingSearchResponse,
  ClothingSearchResult
} from '@nikkisync/protocol'
import type { SuitSearchAsset } from './SuitSearchIndex.js'

type Aggregate = {
  clothingId: string
  name?: string
  category?: string
  suitId?: string
  suitName?: string
  photos: ClothingSearchResult['photos']
}

function objectOf(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function stringOf(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const text = String(value).trim()
  return text || undefined
}

function matches(query: string, clothingId: string, name?: string): boolean {
  const q = query.toLocaleLowerCase()
  return clothingId.toLocaleLowerCase().includes(q)
    || Boolean(name?.toLocaleLowerCase().includes(q))
}

function relevanceRank(query: string, clothingId: string, name?: string): number {
  const q = query.toLocaleLowerCase()
  const id = clothingId.toLocaleLowerCase()
  const text = name?.toLocaleLowerCase()
  if (id === q || text === q) return 0
  if (id.startsWith(q) || text?.startsWith(q)) return 1
  return 2
}

function field(value: Record<string, unknown>, fallback: MetadataDictionaryEntry | undefined, key: string): string | undefined {
  return stringOf(value[key] ?? fallback?.[key as keyof MetadataDictionaryEntry])
}

export function searchClothingLibrary(
  assets: SuitSearchAsset[],
  manifest: MetadataDictionaryManifest | undefined,
  query: string
): ClothingSearchResponse {
  const trimmed = query.trim()
  if (!trimmed) return { query: '', items: [] }

  const dictionaryById = new Map<string, MetadataDictionaryEntry>()
  for (const entry of manifest?.entries ?? []) {
    if (entry.kind === 'clothing') dictionaryById.set(entry.id, entry)
  }

  const aggregates = new Map<string, Aggregate>()
  for (const searchable of assets) {
    if (!searchable.metadataJson) continue

    let metadata: Record<string, unknown> | undefined
    try { metadata = objectOf(JSON.parse(searchable.metadataJson)) } catch { continue }

    const dressing = objectOf(metadata?.dressing)
    const clothes = Array.isArray(dressing?.clothes) ? dressing.clothes : []
    const seenInPhoto = new Set<string>()

    for (const rawClothing of clothes) {
      const clothing = objectOf(rawClothing)
      if (!clothing) continue

      const clothingId = stringOf(clothing.id)
      if (!clothingId || seenInPhoto.has(clothingId)) continue

      const dictionaryEntry = dictionaryById.get(clothingId)
      const name = field(clothing, dictionaryEntry, 'name')
      if (!matches(trimmed, clothingId, name)) continue

      const category = field(clothing, dictionaryEntry, 'category')
      const suitId = field(clothing, dictionaryEntry, 'suitId')
      const suitName = field(clothing, dictionaryEntry, 'suitName')

      let aggregate = aggregates.get(clothingId)
      if (!aggregate) {
        aggregate = {
          clothingId,
          ...(name ? { name } : {}),
          ...(category ? { category } : {}),
          ...(suitId ? { suitId } : {}),
          ...(suitName ? { suitName } : {}),
          photos: []
        }
        aggregates.set(clothingId, aggregate)
      }

      aggregate.photos.push({ asset: searchable.asset })
      seenInPhoto.add(clothingId)
    }
  }

  const items: ClothingSearchResult[] = [...aggregates.values()]
    .map((aggregate) => ({
      clothingId: aggregate.clothingId,
      ...(aggregate.name ? { name: aggregate.name } : {}),
      ...(aggregate.category ? { category: aggregate.category } : {}),
      ...(aggregate.suitId ? { suitId: aggregate.suitId } : {}),
      ...(aggregate.suitName ? { suitName: aggregate.suitName } : {}),
      photoCount: aggregate.photos.length,
      photos: aggregate.photos
    }))
    .sort((left, right) => {
      const relevance = relevanceRank(trimmed, left.clothingId, left.name)
        - relevanceRank(trimmed, right.clothingId, right.name)
      if (relevance !== 0) return relevance
      return right.photoCount - left.photoCount
        || (left.name ?? left.clothingId).localeCompare(right.name ?? right.clothingId, 'zh-CN')
    })

  return { query: trimmed, items }
}
