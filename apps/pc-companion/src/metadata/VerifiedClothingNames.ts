import type { MetadataDictionaryManifest } from '@nikkisync/core'

/** Exact public clothing IDs, checked against the suit's BWIKI component list. */
export const VERIFIED_CLOTHING_NAMES: MetadataDictionaryManifest = {
  schemaVersion: 1,
  provider: 'nikkisync-verified-clothing-names',
  providerVersion: '2026-10-08-10419',
  generatedAt: '2026-10-08T00:00:00.000Z',
  entries: [
    ['1020720419', '兔耳糖'],
    ['1020100419', '漫步调'],
    ['1020300419', '甜心跳'],
    ['1020410419', '漫游者'],
    ['1020200419', '绒绒抱'],
    ['1020500419', '奶球堆'],
    ['1020600419', '蹦蹦兔'],
    ['1020760419', '糖渍圈'],
    ['1020940419', '抱抱出发']
  ].map(([id, name]) => ({
    kind: 'clothing', id: id!, name: name!, suitId: '10419', suitName: '蹦跳计划',
    raw: {
      verifiedAt: '2026-10-08',
      sources: [
        'https://www.nikkigallery.vip/api/v1/clothes/all',
        'https://wiki.biligame.com/wxnn/套装蹦跳计划'
      ],
      verification: 'Exact gid and clothes_set.item_gids from the public API; names and slots cross-checked on BWIKI.',
      wikiLicense: 'CC BY-SA 4.0'
    }
  }))
}

/** The optional PC-local file extends the bundled verified names by exact kind/id. */
export function clothingNameSupplement(local?: MetadataDictionaryManifest): MetadataDictionaryManifest {
  if (!local) return VERIFIED_CLOTHING_NAMES
  const entries = new Map(VERIFIED_CLOTHING_NAMES.entries.map(entry => [`${entry.kind}:${entry.id}`, entry]))
  for (const entry of local.entries) entries.set(`${entry.kind}:${entry.id}`, entry)
  return { ...VERIFIED_CLOTHING_NAMES, entries: [...entries.values()] }
}
