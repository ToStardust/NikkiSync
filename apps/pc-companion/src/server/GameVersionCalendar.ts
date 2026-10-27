export interface VersionRelease {
  version: string
  effectiveAt: string
  uncertainFrom?: string
  tentative?: boolean
}

// Official update notices define the version boundary at server reopening after maintenance.
// Recent update maintenance ends at 20:00 UTC-7, i.e. 03:00 UTC the following day.
// 1.0 uses the global launch time instead of an update-maintenance boundary.
const RELEASES: VersionRelease[] = [
  // Official 2.11 event notices specify Oct 29 (UTC-7), not a maintenance end.
  // Keep the transition unknown until the end of that date; precise notices override it.
  { version:'2.11',effectiveAt:'2026-10-30T07:00:00.000Z',uncertainFrom:'2026-10-29T19:49:00.000Z',tentative:true },
  { version: '2.10', effectiveAt: '2026-09-24T03:00:00.000Z' },
  { version: '2.9', effectiveAt: '2026-08-28T03:00:00.000Z' },
  { version: '2.8', effectiveAt: '2026-07-17T03:00:00.000Z' },
  { version: '2.7', effectiveAt: '2026-06-24T03:00:00.000Z' },
  { version: '2.6', effectiveAt: '2026-05-29T03:00:00.000Z' },
  { version: '2.5', effectiveAt: '2026-04-24T03:00:00.000Z' },
  { version: '2.4', effectiveAt: '2026-03-27T03:00:00.000Z' },
  { version: '2.3', effectiveAt: '2026-03-03T03:00:00.000Z' },
  { version: '2.2', effectiveAt: '2026-01-30T03:00:00.000Z' },
  { version: '2.1', effectiveAt: '2026-01-07T03:00:00.000Z' },
  { version: '2.0', effectiveAt: '2025-11-26T03:00:00.000Z' },
  { version: '1.11', effectiveAt: '2025-10-28T03:00:00.000Z' },
  { version: '1.10', effectiveAt: '2025-09-29T03:00:00.000Z' },
  { version: '1.9', effectiveAt: '2025-09-02T03:00:00.000Z' },
  { version: '1.8', effectiveAt: '2025-07-30T03:00:00.000Z' },
  { version: '1.7', effectiveAt: '2025-07-08T03:00:00.000Z' },
  { version: '1.6', effectiveAt: '2025-06-13T03:00:00.000Z' },
  { version: '1.5', effectiveAt: '2025-04-29T03:00:00.000Z' },
  { version: '1.4', effectiveAt: '2025-03-26T03:00:00.000Z' },
  { version: '1.3', effectiveAt: '2025-02-26T03:00:00.000Z' },
  { version: '1.2', effectiveAt: '2025-01-24T03:00:00.000Z' },
  { version: '1.1', effectiveAt: '2024-12-30T03:00:00.000Z' },
  { version: '1.0', effectiveAt: '2024-12-05T02:00:00.000Z' }
]

let activeReleases = [...RELEASES]

export function getGameVersionReleases(): VersionRelease[] { return activeReleases.map(r => ({ ...r })) }

export function setRemoteGameVersionReleases(releases: readonly VersionRelease[]): void {
  const merged = new Map<string, VersionRelease>()
  for (const release of releases.slice(0, 256)) {
    if (!/^\d{1,3}\.\d{1,3}$/.test(release.version) || !Number.isFinite(Date.parse(release.effectiveAt))) continue
    if (release.uncertainFrom && (!Number.isFinite(Date.parse(release.uncertainFrom))
      || Date.parse(release.uncertainFrom) >= Date.parse(release.effectiveAt))) continue
    merged.set(release.version, { ...release })
  }
  // Confirmed maintenance times outrank a footer that provides only a date.
  for (const release of RELEASES) if(!release.tentative||!merged.has(release.version))merged.set(release.version, release)
  activeReleases = [...merged.values()].sort((a,b) => Date.parse(b.effectiveAt)-Date.parse(a.effectiveAt))
}

export function inferInfinityNikkiGameVersion(capturedAt: string | undefined, releases: readonly VersionRelease[] = activeReleases): string | undefined {
  if (!capturedAt) return undefined
  const capturedMs = Date.parse(capturedAt)
  if (!Number.isFinite(capturedMs)) return undefined
  for (const release of releases) {
    if (release.uncertainFrom && capturedMs >= Date.parse(release.uncertainFrom) && capturedMs < Date.parse(release.effectiveAt)) return undefined
    if (capturedMs >= Date.parse(release.effectiveAt)) return release.version
  }
  return undefined
}
