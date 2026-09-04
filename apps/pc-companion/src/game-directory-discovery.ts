import { access, readdir } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export type GameDiscoverySource = 'cached' | 'local-ancestor' | 'running-process'

export interface InfinityNikkiInstallation {
  installRoot: string
  x6GameRoot: string
  photoRoots: string[]
  motionRoots: string[]
  source: GameDiscoverySource
}

export interface GameDiscoveryOptions {
  /** Internal persisted value, never a required user-facing setting. */
  cachedInstallRoot?: string
  /** Primarily for portable installs and deterministic tests. */
  startingPaths?: string[]
  /** Test/adapter override. Omit to inspect the running game process on Windows. */
  runningExecutablePaths?: string[]
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function findInstallRootFromAncestor(startingPath: string): Promise<string | undefined> {
  let current = path.resolve(startingPath)
  if (path.extname(current)) current = path.dirname(current)

  while (true) {
    if (
      await exists(path.join(current, 'InfinityNikki.exe')) &&
      await exists(path.join(current, 'X6Game'))
    ) return current

    if (path.basename(current).toLowerCase() === 'x6game') {
      const parent = path.dirname(current)
      if (await exists(path.join(parent, 'InfinityNikki.exe'))) return parent
    }

    const parent = path.dirname(current)
    if (parent === current) return undefined
    current = parent
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
        "Get-Process -Name InfinityNikki -ErrorAction SilentlyContinue | Where-Object Path | Select-Object -ExpandProperty Path"
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
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url))
  const localCandidates: Array<{ path: string; source: GameDiscoverySource }> = []
  if (options.cachedInstallRoot) localCandidates.push({ path: options.cachedInstallRoot, source: 'cached' })
  for (const candidate of options.startingPaths ?? []) {
    localCandidates.push({ path: candidate, source: 'local-ancestor' })
  }
  localCandidates.push(
    { path: process.cwd(), source: 'local-ancestor' },
    { path: moduleDirectory, source: 'local-ancestor' }
  )

  const runningPaths = options.runningExecutablePaths ?? await runningGameExecutablePaths()
  for (const executable of runningPaths) {
    localCandidates.push({ path: executable, source: 'running-process' })
  }

  const checked = new Set<string>()
  for (const candidate of localCandidates) {
    const installRoot = await findInstallRootFromAncestor(candidate.path)
    if (!installRoot) continue
    const key = installRoot.toLowerCase()
    if (checked.has(key)) continue
    checked.add(key)
    const x6GameRoot = path.join(installRoot, 'X6Game')
    const media = await discoverMediaRoots(x6GameRoot)
    if (media.photoRoots.length === 0 && media.motionRoots.length === 0) continue
    return { installRoot, x6GameRoot, ...media, source: candidate.source }
  }

  return undefined
}
