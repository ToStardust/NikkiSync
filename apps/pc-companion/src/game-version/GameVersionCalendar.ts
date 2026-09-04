export interface GameVersionCalendarEntry {
  version: string
  availableAt: string
}

export interface GameVersionCalendarManifest {
  schemaVersion: 1
  provider: string
  providerVersion: string
  sourceUrls: string[]
  generatedAt?: string
  fetchedAt?: string
  entries: GameVersionCalendarEntry[]
}

interface ResolvedEntry extends GameVersionCalendarEntry {
  epochMs: number
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`game version calendar ${field} is required`)
  return value.trim()
}

function optionalUtcTimestamp(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  const timestamp = requiredString(value, field)
  if (!timestamp.endsWith('Z') || !Number.isFinite(Date.parse(timestamp))) {
    throw new Error(`game version calendar ${field} must be a valid UTC timestamp ending in Z`)
  }
  return timestamp
}

export function parseGameVersionCalendarManifest(value: unknown): GameVersionCalendarManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('game version calendar manifest must be an object')
  const raw = value as Record<string, unknown>
  if (raw.schemaVersion !== 1) throw new Error('game version calendar schemaVersion must be 1')
  const provider = requiredString(raw.provider, 'provider')
  const providerVersion = requiredString(raw.providerVersion, 'providerVersion')
  if (!Array.isArray(raw.sourceUrls) || raw.sourceUrls.length === 0) throw new Error('game version calendar sourceUrls must not be empty')
  const sourceUrls = raw.sourceUrls.map((entry, index) => {
    const url = requiredString(entry, `sourceUrls[${index}]`)
    let parsed: URL
    try { parsed = new URL(url) } catch { throw new Error(`game version calendar sourceUrls[${index}] is invalid`) }
    if (parsed.protocol !== 'https:') throw new Error(`game version calendar sourceUrls[${index}] must use HTTPS`)
    return url
  })
  if (!Array.isArray(raw.entries) || raw.entries.length === 0) throw new Error('game version calendar entries must not be empty')
  const seenVersions = new Set<string>()
  const entries = raw.entries.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error(`game version calendar entries[${index}] must be an object`)
    const item = entry as Record<string, unknown>
    const version = requiredString(item.version, `entries[${index}].version`)
    if (seenVersions.has(version)) throw new Error(`game version calendar duplicate version: ${version}`)
    seenVersions.add(version)
    const availableAt = optionalUtcTimestamp(item.availableAt, `entries[${index}].availableAt`)
    if (!availableAt) throw new Error(`game version calendar entries[${index}].availableAt is required`)
    return { version, availableAt }
  })
  const generatedAt = optionalUtcTimestamp(raw.generatedAt, 'generatedAt')
  const fetchedAt = optionalUtcTimestamp(raw.fetchedAt, 'fetchedAt')
  return {
    schemaVersion: 1,
    provider,
    providerVersion,
    sourceUrls,
    ...(generatedAt ? { generatedAt } : {}),
    ...(fetchedAt ? { fetchedAt } : {}),
    entries
  }
}

export class GameVersionCalendar {
  private readonly entries: ResolvedEntry[]

  constructor(readonly manifest: GameVersionCalendarManifest) {
    this.entries = manifest.entries
      .map((entry) => ({ ...entry, epochMs: Date.parse(entry.availableAt) }))
      .filter((entry) => Number.isFinite(entry.epochMs) && entry.version.trim().length > 0)
      .sort((left, right) => left.epochMs - right.epochMs)
  }

  resolve(timestamp: string | undefined): string | undefined {
    if (!timestamp) return undefined
    const epochMs = Date.parse(timestamp)
    if (!Number.isFinite(epochMs)) return undefined
    let resolved: string | undefined
    for (const entry of this.entries) {
      if (entry.epochMs > epochMs) break
      resolved = entry.version
    }
    return resolved
  }
}
