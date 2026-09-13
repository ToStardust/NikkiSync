import type { MetadataDictionaryEntry, MetadataDictionaryManifest } from '@nikkisync/core'
import type {
  ProfileClothingStat,
  ProfileStatsResponse,
  ProfileSuitStat,
  Revision
} from '@nikkisync/protocol'
import type { SuitSearchAsset } from './SuitSearchIndex.js'

type SuitIdentity = { id?: string; name: string }

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

export function buildProfileStats(
  assets: SuitSearchAsset[],
  manifest: MetadataDictionaryManifest | undefined,
  libraryRevision: Revision
): ProfileStatsResponse {
  const dictionaryById = new Map<string, MetadataDictionaryEntry>()
  for (const entry of manifest?.entries ?? []) {
    if (entry.kind === 'clothing') dictionaryById.set(entry.id, entry)
  }

  const suits = new Map<string, ProfileSuitStat>()
  const clothing = new Map<string, ProfileClothingStat>()

  for (const searchable of assets) {
    if (!searchable.metadataJson) continue

    let metadata: Record<string, unknown> | undefined
    try {
      metadata = objectOf(JSON.parse(searchable.metadataJson))
    } catch {
      continue
    }

    const dressing = objectOf(metadata?.dressing)
    const clothes = Array.isArray(dressing?.clothes) ? dressing.clothes : []
    const seenSuits = new Set<string>()
    const seenClothing = new Set<string>()

    for (const raw of clothes) {
      const item = objectOf(raw)
      if (!item) continue

      const clothingId = stringOf(item.id)
      if (!clothingId) continue
      const fallback = dictionaryById.get(clothingId)

      if (!seenClothing.has(clothingId)) {
        const name = stringOf(item.name ?? fallback?.name)
        const category = stringOf(item.category ?? fallback?.category)
        const suit = directSuit(item) ?? entrySuit(fallback)
        const previous = clothing.get(clothingId)
        clothing.set(clothingId, {
          clothingId,
          ...(name ? { name } : {}),
          ...(category ? { category } : {}),
          ...(suit?.name ? { suitName: suit.name } : {}),
          photoCount: (previous?.photoCount ?? 0) + 1
        })
        seenClothing.add(clothingId)
      }

      const suit = directSuit(item) ?? entrySuit(fallback)
      if (!suit) continue
      const key = suitKey(suit)
      if (seenSuits.has(key)) continue

      const previous = suits.get(key)
      suits.set(key, {
        ...(suit.id ? { suitId: suit.id } : {}),
        suitName: suit.name,
        photoCount: (previous?.photoCount ?? 0) + 1
      })
      seenSuits.add(key)
    }
  }

  const topSuits = [...suits.values()]
    .sort((left, right) =>
      right.photoCount - left.photoCount || left.suitName.localeCompare(right.suitName, 'zh-CN'))
    .slice(0, 5)

  const topClothing = [...clothing.values()]
    .sort((left, right) =>
      right.photoCount - left.photoCount
      || (left.name ?? left.clothingId).localeCompare(right.name ?? right.clothingId, 'zh-CN'))
    .slice(0, 5)

  return {
    libraryRevision,
    ...(manifest ? {
      dictionary: {
        provider: manifest.provider,
        providerVersion: manifest.providerVersion,
        ...(manifest.gameVersion ? { gameVersion: manifest.gameVersion } : {}),
        ...(manifest.fetchedAt ? { fetchedAt: manifest.fetchedAt } : {}),
        clothingEntries: [...dictionaryById.values()].length
      }
    } : {}),
    topSuits,
    topClothing
  }
}
