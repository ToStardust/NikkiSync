import { createHash } from 'node:crypto'
import type { MetadataDictionaryEntry, MetadataDictionaryManifest } from '@nikkisync/core'
import type {
  MetadataDictionaryFetchResult,
  MetadataDictionaryFetchState,
  MetadataDictionaryProvider
} from './MetadataDictionaryProvider.js'

const DEFAULT_CAMERA_ENDPOINT = 'https://nuan5.pro/assets/data/spinning-momo-camera.json'
const DEFAULT_CLOTHING_ENDPOINT = 'https://raw.githubusercontent.com/dastrokes/gongeo.us-nikki-tracker/master/app/locales/zh/item.json'
const CLOTHING_THUMBNAIL_BASE = 'https://gongeo.us/images/items/icons'

export interface DefaultOnlineMetadataDictionaryProviderConfig {
  cameraEndpoint?: string
  clothingEndpoint?: string
  timeoutMs?: number
}

type JsonRecord = Record<string, unknown>

function recordOf(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : undefined
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function cameraEntries(payload: unknown): MetadataDictionaryEntry[] {
  const root = recordOf(payload)
  const data = recordOf(root?.d)
  if (!data) throw new Error('default camera dictionary is missing data field')

  const specs: Array<{ source: string; kind: MetadataDictionaryEntry['kind'] }> = [
    { source: 'filters', kind: 'filter' },
    { source: 'lights', kind: 'lighting' },
    { source: 'poses', kind: 'pose' }
  ]
  const entries: MetadataDictionaryEntry[] = []
  for (const spec of specs) {
    const values = recordOf(data[spec.source]) ?? {}
    for (const [id, rawValue] of Object.entries(values)) {
      const value = recordOf(rawValue)
      if (!value) continue
      const name = optionalString(value.zh) ?? optionalString(value.en)
      const thumbnail = optionalString(value.icon)
      if (!name && !thumbnail) continue
      entries.push({
        kind: spec.kind,
        id,
        ...(name ? { name } : {}),
        ...(thumbnail ? { thumbnail } : {})
      })
    }
  }
  return entries
}

function clothingEntries(payload: unknown): MetadataDictionaryEntry[] {
  const root = recordOf(payload)
  if (!root) throw new Error('default clothing dictionary must be a JSON object')
  const entries: MetadataDictionaryEntry[] = []
  for (const [key, rawName] of Object.entries(root)) {
    const match = /^item\.(\d+)\.name$/.exec(key)
    const name = optionalString(rawName)
    if (!match || !name) continue
    const id = match[1]!
    entries.push({
      kind: 'clothing',
      id,
      name,
      thumbnail: `${CLOTHING_THUMBNAIL_BASE}/${id}.png`
    })
  }
  if (entries.length === 0) throw new Error('default clothing dictionary contains no item IDs')
  return entries
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal
    })
    const text = await response.text()
    if (!response.ok) throw new Error(`default metadata dictionary HTTP ${response.status} from ${url}: ${text.slice(0, 160)}`)
    return text
  } finally {
    clearTimeout(timer)
  }
}

export class DefaultOnlineMetadataDictionaryProvider implements MetadataDictionaryProvider {
  readonly id = 'nikkisync-default-online'
  private readonly cameraEndpoint: string
  private readonly clothingEndpoint: string
  private readonly timeoutMs: number

  constructor(config: DefaultOnlineMetadataDictionaryProviderConfig = {}) {
    this.cameraEndpoint = config.cameraEndpoint ?? DEFAULT_CAMERA_ENDPOINT
    this.clothingEndpoint = config.clothingEndpoint ?? DEFAULT_CLOTHING_ENDPOINT
    this.timeoutMs = config.timeoutMs ?? 12_000
  }

  async fetch(state: MetadataDictionaryFetchState = {}): Promise<MetadataDictionaryFetchResult> {
    const [cameraText, clothingText] = await Promise.all([
      fetchText(this.cameraEndpoint, this.timeoutMs),
      fetchText(this.clothingEndpoint, this.timeoutMs)
    ])
    const etag = createHash('sha256').update(cameraText).update('\n').update(clothingText).digest('hex')
    if (state.etag === etag) return { status: 'not-modified', etag }

    const cameraPayload = JSON.parse(cameraText) as unknown
    const clothingPayload = JSON.parse(clothingText) as unknown
    const cameraVersion = optionalString(recordOf(cameraPayload)?.v)
    const entries = [...cameraEntries(cameraPayload), ...clothingEntries(clothingPayload)]
    const manifest: MetadataDictionaryManifest = {
      schemaVersion: 1,
      provider: this.id,
      providerVersion: cameraVersion ? `${cameraVersion}-${etag.slice(0, 12)}` : etag.slice(0, 16),
      entries
    }
    return { status: 'updated', manifest, etag }
  }
}
