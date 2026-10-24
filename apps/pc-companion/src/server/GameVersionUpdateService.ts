import { AppSettingsRepository, AssetRepository, ChangeJournalRepository, type DatabaseManager } from '@nikkisync/database'
import { getGameVersionReleases, inferInfinityNikkiGameVersion, setRemoteGameVersionReleases, type VersionRelease } from './GameVersionCalendar.js'
import {restoreEnglishNames,updateEnglishNames} from './GameVersionEnglishNames.js'

const OFFICIAL_PAGE = 'https://infinitynikki.nuanpaper.com/home'
const CACHE_KEY = 'game_version_calendar'
const APPLIED_KEY = 'game_version_calendar_applied'
const INTERVAL = 6 * 60 * 60_000

export function parseOfficialGameVersion(html: string, now = Date.now()): VersionRelease | undefined {
  const text = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ')
  const match = /当前版本\s*[：:]\s*(\d{1,3}\.\d{1,3})\s*更新时间\s*[：:]\s*(\d{4}-\d{2}-\d{2})/.exec(text)
  if (!match) return undefined
  const date = match[2]!, start = Date.parse(`${date}T00:00:00+08:00`)
  if (!Number.isFinite(start) || start > now || start < Date.parse('2024-12-05T00:00:00+08:00')
    || new Date(start + 8 * 60 * 60_000).toISOString().slice(0,10) !== date) return undefined
  // The footer supplies a date, not an exact reopening time. Keep the update day
  // unknown unless a confirmed built-in boundary exists; never invent maintenance hours.
  return { version: match[1]!, effectiveAt: new Date(start + 86400000).toISOString(), uncertainFrom: new Date(start).toISOString() }
}

async function fetchOfficialPage(signal: AbortSignal): Promise<string> {
  const response = await fetch(OFFICIAL_PAGE, { signal, redirect: 'error', headers: { accept: 'text/html' } })
  if (!response.ok || !response.body) throw new Error('Official version page unavailable')
  const chunks: Uint8Array[] = []; let size = 0
  const reader = response.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break
      size += value.length; if (size > 1024 * 1024) throw new Error('Official version page too large')
      chunks.push(value)
    }
    return Buffer.concat(chunks).toString('utf8')
  } finally { await reader.cancel().catch(() => undefined) }
}

interface Options {
  now?: () => number
  fetchPage?: (signal: AbortSignal) => Promise<string>
  onCalendarChanged?: (releases: VersionRelease[]) => void
}

export class GameVersionUpdateService {
  private readonly settings: AppSettingsRepository
  private readonly assets: AssetRepository
  private readonly journal: ChangeJournalRepository
  private timer: NodeJS.Timeout | undefined
  private running = false
  private stopped = false
  private controller: AbortController | undefined

  constructor(private readonly database: DatabaseManager, private readonly options: Options = {}) {
    this.settings = new AppSettingsRepository(database); this.assets = new AssetRepository(database); this.journal = new ChangeJournalRepository(database)
    restoreEnglishNames(database)
    let cached: VersionRelease[] = []
    try {
      const state = this.settings.get<{ releases?: VersionRelease[] }>(CACHE_KEY)
      if (Array.isArray(state?.releases)) cached = state.releases.filter(r => r && typeof r.version === 'string' && typeof r.effectiveAt === 'string')
    } catch { /* malformed optional cache does not block startup */ }
    setRemoteGameVersionReleases(cached)
    this.options.onCalendarChanged?.(getGameVersionReleases())
  }

  start(): void {
    if (this.timer) return
    this.stopped = false
    void this.runOnce()
    if(!this.options.fetchPage)void updateEnglishNames(this.database,AbortSignal.timeout(8000)).catch(()=>{})
    this.timer = setInterval(() => { void this.runOnce();if(!this.options.fetchPage)void updateEnglishNames(this.database,AbortSignal.timeout(8000)).catch(()=>{}) }, INTERVAL)
  }

  stop(): void { this.stopped = true; this.controller?.abort(); if (this.timer) clearInterval(this.timer); this.timer = undefined }

  private applyCalendar(): number {
    const next = getGameVersionReleases()
    let previous: VersionRelease[] | undefined
    try { previous = this.settings.get<VersionRelease[]>(APPLIED_KEY) } catch {}
    if (JSON.stringify(previous) === JSON.stringify(next)) return 0
    return this.database.transaction(() => {
      let changed = 0
      const updatedAt = new Date(this.options.now?.() ?? Date.now()).toISOString()
      for (const row of this.assets.list()) {
        if (row.asset_state === 'deleted' || !row.captured_at) continue
        try {
          const explicit = row.metadata_json ? JSON.parse(String(row.metadata_json))?.identity?.gameVersion : undefined
          if (typeof explicit === 'string' && explicit.trim()) continue
        } catch { /* summaries can infer independently of malformed metadata */ }
        const capturedAt = String(row.captured_at)
        const before = Array.isArray(previous) ? inferInfinityNikkiGameVersion(capturedAt, previous) : undefined
        if (before === inferInfinityNikkiGameVersion(capturedAt)) continue
        const revision = this.journal.record('asset.updated', String(row.asset_id), { gameVersion: true }, updatedAt)
        this.database.connection.prepare('UPDATE assets SET revision = ?, updated_at = ? WHERE asset_id = ?').run(revision, updatedAt, row.asset_id)
        changed++
      }
      this.settings.set(APPLIED_KEY, next, updatedAt)
      return changed
    })
  }

  async runOnce(): Promise<number> {
    if (this.running || this.stopped) return 0
    this.running = true; this.controller = new AbortController()
    let changed = 0
    try {
      changed = this.applyCalendar()
      const now = this.options.now?.() ?? Date.now()
      const page = await (this.options.fetchPage ?? fetchOfficialPage)(AbortSignal.any([this.controller.signal, AbortSignal.timeout(8000)]))
      if (this.stopped) return changed
      const release = parseOfficialGameVersion(page, now)
      if (!release) return changed
      const current = getGameVersionReleases()
      const versionParts = (v: string) => v.split('.').map(Number)
      const [major, minor] = versionParts(release.version)
      const newest = current[0]
      if (newest) {
        const [oldMajor, oldMinor] = versionParts(newest.version)
        if (major! < oldMajor! || (major === oldMajor && minor! < oldMinor!)) return changed
        if (major !== oldMajor || minor !== oldMinor) {
          if (Date.parse(release.uncertainFrom!) <= Date.parse(newest.effectiveAt)) return changed
        }
      }
      // A hotfix may change the footer date without changing the game version.
      // Preserve its first verified release date instead of moving old photos backwards.
      setRemoteGameVersionReleases(current.some(r => r.version === release.version) ? current : [...current, release])
      changed += this.applyCalendar()
      const releases = getGameVersionReleases()
      this.settings.set(CACHE_KEY, { schemaVersion: 1, source: OFFICIAL_PAGE, checkedAt: new Date(now).toISOString(), releases })
      this.options.onCalendarChanged?.(releases)
      return changed
    } catch { return changed } finally { this.controller = undefined; this.running = false }
  }
}
