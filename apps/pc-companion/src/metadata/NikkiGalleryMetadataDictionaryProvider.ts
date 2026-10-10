import { createHash } from 'node:crypto'
import type { MetadataDictionaryEntry, MetadataDictionaryManifest } from '@nikkisync/core'
import type { MetadataDictionaryProvider, MetadataDictionaryFetchState, MetadataDictionaryFetchResult } from './MetadataDictionaryProvider.js'

export const NIKKI_GALLERY_ENDPOINT = 'https://www.nikkigallery.vip/api/v1/clothes/all'
const IMAGE_ROOT = 'https://nikkigallery.vip/static/img/clothes/'
const MAX_BYTES = 8 * 1024 * 1024
const CATEGORIES: Record<string, string> = {
  hair: 'hair', dress: 'dresses', coat: 'outerwear', tops: 'tops', bottoms: 'bottoms', socks: 'socks', shoes: 'shoes',
  'accessory.hat': 'headwear', 'accessory.hairdress': 'hairAccessories', 'accessory.eardress': 'earrings',
  'accessory.choker': 'chokers', 'accessory.neckdress': 'neckwear', 'accessory.gloves': 'gloves',
  'accessory.wristdress': 'bracelets', 'accessory.ring': 'rings', 'accessory.armdress': 'armDecorations',
  'accessory.handdress': 'handhelds', 'accessory.backdress': 'backpieces', 'accessory.chestdress': 'chestAccessories',
  'accessory.facedress': 'faceDecorations', 'accessory.hangdress': 'pendants', 'accessory.skinpaint': 'bodyPaint',
  'makeup.base': 'baseMakeup', 'makeup.eyebrow': 'eyebrows', 'makeup.eyelash': 'eyelashes',
  'makeup.eyelens': 'contacts', 'makeup.lip': 'lips', 'makeup.skin': 'skinTones'
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('NikkiGallery requires object rows')
  return value as Record<string, unknown>
}

function idOf(value: unknown): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value)
  if (typeof value === 'string' && /^[1-9]\d{0,15}$/.test(value)) return value
  throw new Error('NikkiGallery clothing ID must be a positive integer')
}

function manifestFrom(value: unknown): MetadataDictionaryManifest {
  const data = object(value)
  if (!Array.isArray(data.clothes) || !data.clothes.length || data.clothes.length > 30_000 || !Array.isArray(data.clothes_set)) {
    throw new Error('NikkiGallery requires nonempty clothes and clothes_set arrays')
  }
  const rows = new Map<string, Record<string, unknown>>()
  for (const value of data.clothes) {
    const row = object(value), id = idOf(row.gid)
    if (rows.has(id)) throw new Error(`NikkiGallery duplicate clothing ID ${id}`)
    if (typeof row.name !== 'string' || typeof row.part !== 'string') throw new Error('NikkiGallery name/part must be strings')
    rows.set(id, row)
  }
  const membership = new Map<string, Set<string>>()
  for (const value of data.clothes_set) {
    const row = object(value), suitId = idOf(row.clothes_gid)
    if (!Array.isArray(row.item_gids) || row.item_gids.length > 200) throw new Error('NikkiGallery requires an item_gids array')
    for (const value of row.item_gids) {
      const id = idOf(value), suits = membership.get(id) ?? new Set<string>()
      suits.add(suitId); membership.set(id, suits)
    }
  }
  const entries: MetadataDictionaryEntry[] = []
  for (const [id, row] of rows) {
    if (row.part === 'set' || !String(row.name).trim()) continue
    const suits = [...(membership.get(id) ?? [])].sort()
    const suitId = suits.length === 1 ? suits[0] : undefined
    const suit = suitId ? rows.get(suitId) : undefined
    const suitName = suit?.part === 'set' && typeof suit.name === 'string' ? suit.name.trim() : undefined
    const filename = typeof row.filename === 'string' && /^[a-z0-9_-]+\.(png|jpe?g|webp)$/i.test(row.filename) ? row.filename : undefined
    entries.push({
      kind: 'clothing', id, name: String(row.name).trim(),
      ...(CATEGORIES[String(row.part)] ? { category: CATEGORIES[String(row.part)]! } : {}),
      ...(filename ? { thumbnail: `${IMAGE_ROOT}${filename}` } : {}),
      ...(suitId ? { suitId } : {}), ...(suitName ? { suitName } : {}),
      raw: { source: 'nikki-gallery-public', sourceEndpoint: NIKKI_GALLERY_ENDPOINT, part: row.part,
        ...(typeof row.level === 'number' ? { galleryLevel: row.level } : {}),
        ...(suits.length > 1 ? { gallerySuitIds: suits } : {}) }
    })
  }
  if (!entries.length) throw new Error('NikkiGallery has no named clothing entries')
  entries.sort((a, b) => a.id.localeCompare(b.id))
  return { schemaVersion: 1, provider: 'nikki-gallery-public',
    providerVersion: `v1-${createHash('sha256').update(JSON.stringify(entries)).digest('hex')}`, entries }
}

/** Anonymous bodyless public dictionary GET; it has no access to photo identifiers or media. */
export class NikkiGalleryMetadataDictionaryProvider implements MetadataDictionaryProvider {
  readonly id = 'nikki-gallery-public'

  constructor(private readonly config: { timeoutMs?: number } = {}, private readonly fetcher: typeof fetch = fetch) {}

  async fetch(state: MetadataDictionaryFetchState = {}): Promise<MetadataDictionaryFetchResult> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? 15_000)
    try {
      const response = await this.fetcher(NIKKI_GALLERY_ENDPOINT, { method: 'GET', redirect: 'error', credentials: 'omit',
        headers: { accept: 'application/json', ...(state.etag ? { 'if-none-match': state.etag } : {}),
          ...(state.lastModified ? { 'if-modified-since': state.lastModified } : {}) }, signal: controller.signal })
      const headers = { ...(response.headers.get('etag') ? { etag: response.headers.get('etag')! } : {}),
        ...(response.headers.get('last-modified') ? { lastModified: response.headers.get('last-modified')! } : {}) }
      if (response.status === 304) return { status: 'not-modified', ...headers }
      if (!response.ok) { await response.body?.cancel(); throw new Error(`NikkiGallery dictionary HTTP ${response.status}`) }
      if (Number(response.headers.get('content-length')) > MAX_BYTES) {
        await response.body?.cancel(); throw new Error('NikkiGallery dictionary size limit exceeded')
      }
      const reader = response.body?.getReader()
      if (!reader) throw new Error('NikkiGallery empty response')
      const chunks: Uint8Array[] = []; let size = 0
      try {
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          size += chunk.value.byteLength
          if (size > MAX_BYTES) throw new Error('NikkiGallery dictionary size limit exceeded')
          chunks.push(chunk.value)
        }
      } finally { await reader.cancel(); reader.releaseLock() }
      const manifest = manifestFrom(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown)
      return state.contentVersion === manifest.providerVersion
        ? { status: 'not-modified', ...headers }
        : { status: 'updated', manifest, ...headers }
    } finally { clearTimeout(timer) }
  }
}
