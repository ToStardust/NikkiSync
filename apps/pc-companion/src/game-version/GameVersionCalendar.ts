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
