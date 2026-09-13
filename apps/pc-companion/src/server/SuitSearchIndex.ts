import type { MetadataDictionaryEntry, MetadataDictionaryManifest } from '@nikkisync/core'
import type {
  AssetSummary,
  SuitSearchPart,
  SuitSearchResponse,
  SuitSearchResult
} from '@nikkisync/protocol'

export interface SuitSearchAsset {
  asset: AssetSummary
  metadataJson?: string
}

type SuitIdentity = { id?: string; name: string }

type Aggregate = {
  suitId?: string
  suitName: string
  observedParts: Set<string>
  totalPartCount?: number
  photos: SuitSearchResult['photos']
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

function directSuit(value: Record<string, unknown> | undefined): SuitIdentity | undefined {
  if (!value) return undefined
  const aliases: Array<[string, string]> = [
    ['suitId', 'suitName'],
    ['outfitId', 'outfitName'],
    ['setId', 'setName'],
    ['collectionId', 'collectionName']
  ]
  for (const [idKey, nameKey] of aliases) {
    const id = stringOf(value[idKey])
    const name = stringOf(value[nameKey])
    if (name) return { ...(id ? { id } : {}), name }
  }
  for (const key of ['suit', 'outfit', 'set', 'collection']) {
    const nested = objectOf(value[key])
    const id = stringOf(nested?.id ?? nested?.suitId ?? nested?.outfitId)
    const name = stringOf(nested?.name ?? nested?.title ?? nested?.suitName ?? nested?.outfitName)
    if (name) return { ...(id ? { id } : {}), name }
  }
  return undefined
}

function entrySuit(entry: MetadataDictionaryEntry | undefined): SuitIdentity | undefined {
  if (!entry) return undefined
  const id = stringOf(entry.suitId ?? entry.raw?.suitId ?? entry.raw?.outfitId ?? entry.raw?.setId)
  const name = stringOf(entry.suitName ?? entry.raw?.suitName ?? entry.raw?.outfitName ?? entry.raw?.setName)
  if (name) return { ...(id ? { id } : {}), name }
  return directSuit(entry.raw)
}

function suitKey(suit: SuitIdentity): string {
  return suit.id ? `id:${suit.id}` : `name:${suit.name.toLocaleLowerCase()}`
}

function matches(query: string, suit: SuitIdentity): boolean {
  const q = query.toLocaleLowerCase()
  return suit.name.toLocaleLowerCase().includes(q) || Boolean(suit.id?.toLocaleLowerCase().includes(q))
}

function partOf(value: Record<string, unknown>, fallback?: MetadataDictionaryEntry): SuitSearchPart | undefined {
  const clothingId = stringOf(value.id ?? fallback?.id)
  if (!clothingId) return undefined
  const name = stringOf(value.name ?? fallback?.name)
  const category = stringOf(value.category ?? fallback?.category)
  return {
    clothingId,
    ...(name ? { name } : {}),
    ...(category ? { category } : {})
  }
}

export function searchSuitLibrary(
  assets: SuitSearchAsset[],
  manifest: MetadataDictionaryManifest | undefined,
  query: string
): SuitSearchResponse {
  const trimmed = query.trim()
  if (!trimmed) return { query: '', items: [] }

  const dictionaryById = new Map<string, MetadataDictionaryEntry>()
  const totalPartsByKey = new Map<string, Set<string>>()
  const totalPartsByName = new Map<string, Set<string>>()

  for (const entry of manifest?.entries ?? []) {
    if (entry.kind !== 'clothing') continue
    dictionaryById.set(entry.id, entry)
    const suit = entrySuit(entry)
    if (!suit) continue
    const byKey = totalPartsByKey.get(suitKey(suit)) ?? new Set<string>()
    byKey.add(entry.id)
    totalPartsByKey.set(suitKey(suit), byKey)
    const nameKey = suit.name.toLocaleLowerCase()
    const byName = totalPartsByName.get(nameKey) ?? new Set<string>()
    byName.add(entry.id)
    totalPartsByName.set(nameKey, byName)
  }

  const aggregates = new Map<string, Aggregate>()
  for (const searchable of assets) {
    if (!searchable.metadataJson) continue
    let metadata: Record<string, unknown> | undefined
    try { metadata = objectOf(JSON.parse(searchable.metadataJson)) } catch { continue }
    const dressing = objectOf(metadata?.dressing)
    const clothes = Array.isArray(dressing?.clothes) ? dressing.clothes : []
    const partsBySuit = new Map<string, { suit: SuitIdentity; parts: SuitSearchPart[] }>()

    for (const rawClothing of clothes) {
      const clothing = objectOf(rawClothing)
      if (!clothing) continue
      const clothingId = stringOf(clothing.id)
      const dictionaryEntry = clothingId ? dictionaryById.get(clothingId) : undefined
      const suit = directSuit(clothing) ?? entrySuit(dictionaryEntry)
      if (!suit || !matches(trimmed, suit)) continue
      const part = partOf(clothing, dictionaryEntry)
      if (!part) continue
      const key = suitKey(suit)
      const photoGroup = partsBySuit.get(key) ?? { suit, parts: [] }
      if (!photoGroup.parts.some((candidate) => candidate.clothingId === part.clothingId)) {
        photoGroup.parts.push(part)
      }
      partsBySuit.set(key, photoGroup)
    }

    for (const [key, photoGroup] of partsBySuit) {
      let aggregate = aggregates.get(key)
      if (!aggregate) {
        const total = totalPartsByKey.get(key)
          ?? totalPartsByName.get(photoGroup.suit.name.toLocaleLowerCase())
        aggregate = {
          ...(photoGroup.suit.id ? { suitId: photoGroup.suit.id } : {}),
          suitName: photoGroup.suit.name,
          observedParts: new Set<string>(),
          ...(total ? { totalPartCount: total.size } : {}),
          photos: []
        }
        aggregates.set(key, aggregate)
      }
      for (const part of photoGroup.parts) aggregate.observedParts.add(part.clothingId)
      aggregate.photos.push({ asset: searchable.asset, matchedParts: photoGroup.parts })
    }
  }

  const items: SuitSearchResult[] = [...aggregates.values()]
    .map((aggregate) => ({
      ...(aggregate.suitId ? { suitId: aggregate.suitId } : {}),
      suitName: aggregate.suitName,
      observedPartCount: aggregate.observedParts.size,
      ...(aggregate.totalPartCount === undefined ? {} : { totalPartCount: aggregate.totalPartCount }),
      photoCount: aggregate.photos.length,
      photos: aggregate.photos
    }))
    .sort((left, right) => right.photoCount - left.photoCount || left.suitName.localeCompare(right.suitName, 'zh-CN'))

  return { query: trimmed, items }
}
