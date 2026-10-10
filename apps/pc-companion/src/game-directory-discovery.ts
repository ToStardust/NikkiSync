import { access, readdir, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readWindowsInstallationHints, type WindowsInstallationHints } from './WindowsInstallationHints.js'

const execFileAsync = promisify(execFile)

export type GameDiscoverySource = 'manual' | 'cached' | 'local-ancestor' | 'registry' | 'shortcut' | 'common-location' | 'running-process'

export interface GameDiscoveryReport {
  found: boolean
  source?: GameDiscoverySource
  checkedDirectories: number
  registryHints: number
  shortcutHints: number
  driveRoots: number
  windowsProbeFailed: boolean
  searchLimited: boolean
  elapsedMs: number
}

export interface InfinityNikkiInstallation {
  installRoot: string
  x6GameRoot: string
  photoRoots: string[]
  motionRoots: string[]
  source: GameDiscoverySource
}

export interface GameDiscoveryOptions {
  /** Explicit folder-picker choice takes precedence over a valid old cache. */
  selectedInstallRoot?: string
  /** Internal persisted value, never a required user-facing setting. */
  cachedInstallRoot?: string
  /** Primarily for portable installs and deterministic tests. */
  startingPaths?: string[]
  /** Deterministic adapters/tests can disable cwd/module/executable hints. */
  includeDefaultPaths?: boolean
  /** Omit to read installed-launcher records, shortcuts and fixed disks. */
  windowsHints?: WindowsInstallationHints
  /** Test/adapter override. Omit to inspect the running game process on Windows. */
  runningExecutablePaths?: string[]
  /** Counts/source only; no personal paths, registry contents or credentials. */
  onDiscoveryComplete?(report: GameDiscoveryReport): void
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function isDirectory(target: string): Promise<boolean> { try { return (await stat(target)).isDirectory() } catch { return false } }
async function isFile(target: string): Promise<boolean> { try { return (await stat(target)).isFile() } catch { return false } }

// These are containers, not useful search subtrees. In particular never walk
// game archives/media, application caches, Windows, or user data recursively.
const excluded = /^(?:X6Game|Engine|Content|Paks|Saved|ScreenShot|Videos?|DownloadCache|node_modules|\.git|\.cache|Windows|Users|ProgramData|AppData|\$Recycle\.Bin|System Volume Information|Recovery|MSOCache)$/i
const preferred = /infinity\s*nikki|无限\s*暖暖|^games?$|游戏|steam|epic|wegame/i

class InstallationSearch {
  checkedDirectories = 0
  limited = false
  private readonly verified = new Map<string, Promise<boolean>>()
  private readonly enumerated = new Set<string>()
  private readonly deadline = Date.now() + 12_000

  private async valid(root: string): Promise<boolean> {
    const key = root.toLowerCase()
    let result = this.verified.get(key)
    if (!result) {
      this.checkedDirectories++
      result = (async () => await isDirectory(path.join(root, 'X6Game')) && (
        await isFile(path.join(root, 'InfinityNikki.exe')) ||
        await isFile(path.join(root, 'X6Game', 'Binaries', 'Win64', 'X6Game-Win64-Shipping.exe')) ||
        await isFile(path.join(root, 'X6Game', 'Binaries', 'Win64', 'X6Game.exe'))
      ))()
      this.verified.set(key, result)
    }
    return result
  }

  async nearby(startingPath: string, descend = true): Promise<string | undefined> {
    if (!startingPath.trim()) return undefined
    const resolved = path.resolve(startingPath)
    // File extensions are not a directory test: installation folders can have
    // version numbers such as 2.9. Deleted install records are skipped outright.
    let current = await isDirectory(resolved) ? resolved : await isFile(resolved) ? path.dirname(resolved) : undefined
    if (!current) return undefined
    const startingDirectory = current
    while (true) {
      if (await this.valid(current)) return current
      const parent = path.dirname(current)
      if (parent === current) break
      current = parent
    }
    return descend ? this.children(startingDirectory, 3, 128) : undefined
  }

  async children(root: string, maxDepth: number, budget: number): Promise<string | undefined> {
    const queue = [{ directory: root, depth: 0 }]
    let examined = 0
    for (let index = 0; index < queue.length; index++) {
      if (examined >= budget || this.checkedDirectories >= 1024 || Date.now() > this.deadline) { this.limited = true; return undefined }
      const { directory, depth } = queue[index]!
      examined++
      if (await this.valid(directory)) return directory
      const key = directory.toLowerCase()
      if (depth >= maxDepth || this.enumerated.has(key) || excluded.test(path.basename(directory))) continue
      this.enumerated.add(key)
      let entries
      try { entries = await readdir(directory, { withFileTypes: true }) } catch { continue }
      const children = entries.filter(entry => entry.isDirectory() && !excluded.test(entry.name))
        .sort((a, b) => Number(preferred.test(b.name)) - Number(preferred.test(a.name)) || a.name.localeCompare(b.name))
      for (const child of children.slice(0, 128)) queue.push({ directory: path.join(directory, child.name), depth: depth + 1 })
      if (children.length > 128) this.limited = true
    }
    return undefined
  }

  async commonLocations(drives: string[]): Promise<string | undefined> {
    const containers = ['', 'GAME', 'Games', '游戏', 'Program Files', 'Program Files (x86)', 'Epic Games', 'SteamLibrary/steamapps/common', 'WeGameApps']
    const names = ['InfinityNikki', 'Infinity Nikki', 'InfinityNikki Launcher', 'Infinity Nikki Launcher', '无限暖暖']
    // Check known names on every disk before exploring broader containers, so a
    // busy system drive cannot consume the search budget before D:/E: are tried.
    for (const drive of drives) for (const container of containers) for (const name of names) {
      const root = await this.nearby(path.join(drive, container, name))
      if (root) return root
    }
    for (const drive of drives) for (const container of containers.slice(1)) {
      const root = await this.children(path.join(drive, container), 3, 192)
      if (root) return root
    }
    for (const drive of drives) {
      const root = await this.children(drive, 3, 128)
      if (root) return root
    }
    return undefined
  }
}

async function runningGameExecutablePaths(): Promise<string[]> {
  if (process.platform !== 'win32') return []
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false); Get-Process -Name InfinityNikki,X6Game,X6Game-Win64-Shipping -ErrorAction SilentlyContinue | Where-Object Path | Select-Object -ExpandProperty Path"
      ],
      { windowsHide: true, timeout: 5000 }
    )
    return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  } catch {
    return []
  }
}

async function childDirectories(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(root, entry.name))
  } catch {
    return []
  }
}

async function discoverMediaRoots(x6GameRoot: string): Promise<Pick<InfinityNikkiInstallation, 'photoRoots' | 'motionRoots'>> {
  const gamePlayPhotoCandidates = [
    path.join(x6GameRoot, 'Saved', 'GamePlayPhotos'),
    path.join(x6GameRoot, 'GamePlayPhotos')
  ]
  const exportMotionCandidates = [
    path.join(x6GameRoot, 'Video'),
    path.join(x6GameRoot, 'Videos'),
    path.join(x6GameRoot, 'Saved', 'Video'),
    path.join(x6GameRoot, 'Saved', 'Videos')
  ]

  const uniqueExisting = async (candidates: string[]) => {
    const result: string[] = []
    const seen = new Set<string>()
    for (const candidate of candidates) {
      const key = path.resolve(candidate).toLowerCase()
      if (!seen.has(key) && await exists(candidate)) {
        seen.add(key)
        result.push(path.resolve(candidate))
      }
    }
    return result
  }

  const gamePlayRoots = await uniqueExisting(gamePlayPhotoCandidates)
  if (gamePlayRoots.length > 0) {
    const nestedMotionCandidates: string[] = []
    for (const gamePlayRoot of gamePlayRoots) {
      for (const uidDirectory of await childDirectories(gamePlayRoot)) {
        for (const child of await childDirectories(uidDirectory)) {
          if (/^videos?$/i.test(path.basename(child))) nestedMotionCandidates.push(child)
        }
      }
    }
    return {
      // Hidden GamePlayPhotos files retain the original trailing metadata. ScreenShot is an export.
      photoRoots: gamePlayRoots,
      motionRoots: await uniqueExisting(nestedMotionCandidates)
    }
  }

  return {
    photoRoots: await uniqueExisting([path.join(x6GameRoot, 'ScreenShot')]),
    motionRoots: await uniqueExisting(exportMotionCandidates)
  }
}

export async function discoverInfinityNikkiInstallation(
  options: GameDiscoveryOptions = {}
): Promise<InfinityNikkiInstallation | undefined> {
  const started = Date.now(), search = new InstallationSearch()
  let hints: WindowsInstallationHints = { registryPaths: [], shortcutPaths: [], driveRoots: [] }
  const finish = async (root?: string, source?: GameDiscoverySource): Promise<InfinityNikkiInstallation | undefined> => {
    const media = root ? await discoverMediaRoots(path.join(root, 'X6Game')) : undefined
    try { options.onDiscoveryComplete?.({ found: Boolean(root), ...(root && source ? { source } : {}),
      checkedDirectories: search.checkedDirectories, registryHints: hints.registryPaths.length,
      shortcutHints: hints.shortcutPaths.length, driveRoots: hints.driveRoots.length,
      windowsProbeFailed: hints.probeFailed === true, searchLimited: search.limited, elapsedMs: Date.now() - started }) } catch { /* best-effort diagnostics */ }
    return root && source && media ? { installRoot: root, x6GameRoot: path.join(root, 'X6Game'), ...media, source } : undefined
  }
  const selected = options.selectedInstallRoot ?? process.env.NIKKISYNC_GAME_ROOT?.trim()
  if (selected) return finish(await search.nearby(selected), 'manual')
  const localCandidates: Array<{ path: string; source: GameDiscoverySource }> = []
  if (options.cachedInstallRoot) localCandidates.push({ path: options.cachedInstallRoot, source: 'cached' })
  for (const candidate of options.startingPaths ?? []) {
    localCandidates.push({ path: candidate, source: 'local-ancestor' })
  }
  if (options.includeDefaultPaths !== false) localCandidates.push(
    { path: process.cwd(), source: 'local-ancestor' },
    { path: process.execPath, source: 'local-ancestor' },
    { path: path.dirname(fileURLToPath(import.meta.url)), source: 'local-ancestor' })
  for (const candidate of localCandidates) {
    const installRoot = await search.nearby(candidate.path, candidate.source !== 'cached')
    if (installRoot) return finish(installRoot, candidate.source)
  }
  hints = options.windowsHints ?? await readWindowsInstallationHints()
  for (const [source, candidates] of [['registry', hints.registryPaths], ['shortcut', hints.shortcutPaths]] as const) {
    for (const candidate of candidates) {
      const root = await search.nearby(candidate)
      if (root) return finish(root, source)
    }
  }
  const commonRoot = await search.commonLocations(hints.driveRoots)
  if (commonRoot) return finish(commonRoot, 'common-location')
  // Optional final hint, never a prerequisite for first-run discovery.
  for (const executable of options.runningExecutablePaths ?? await runningGameExecutablePaths()) {
    const root = await search.nearby(executable, false)
    if (root) return finish(root, 'running-process')
  }
  return finish()
}
