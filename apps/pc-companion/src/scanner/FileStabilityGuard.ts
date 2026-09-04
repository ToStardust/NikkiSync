import { open, stat } from 'node:fs/promises'

export class FileStabilityGuard {
  constructor(private readonly config: { pollIntervalMs: number; stableChecks: number; maxWaitMs: number; assumeStableIfOlderMs?: number } = { pollIntervalMs: 200, stableChecks: 3, maxWaitMs: 10_000, assumeStableIfOlderMs: 2000 }) {}

  async waitForStable(filePath: string): Promise<Awaited<ReturnType<typeof stat>>> {
    const started = Date.now()
    let previous: { size: number; mtimeMs: number } | undefined
    let checks = 0
    while (Date.now() - started <= this.config.maxWaitMs) {
      try {
        const current = await stat(filePath)
        let openable = true
        try {
          const handle = await open(filePath, 'r')
          await handle.close()
        } catch { openable = false }
        if (openable && Date.now() - current.mtimeMs >= (this.config.assumeStableIfOlderMs ?? 2000)) return current
        if (openable && previous && previous.size === current.size && previous.mtimeMs === current.mtimeMs) checks += 1
        else checks = openable ? 1 : 0
        previous = { size: current.size, mtimeMs: current.mtimeMs }
        if (checks >= this.config.stableChecks) return current
      } catch {
        checks = 0
        previous = undefined
      }
      await new Promise((resolve) => setTimeout(resolve, this.config.pollIntervalMs))
    }
    throw new Error(`file did not become stable within ${this.config.maxWaitMs}ms: ${filePath}`)
  }
}
