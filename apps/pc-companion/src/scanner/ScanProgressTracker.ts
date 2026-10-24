import type { ScannerProgress } from './types.js'

export type ScanActivity = Partial<Omit<ScannerProgress, 'stage'>>

export class ScanProgressTracker {
  private value: ScannerProgress = { stage: 'scan-files', filesObserved: 0, filesCompleted: 0, bytesRead: 0, assetsProcessed: 0 }
  private lastReport = -Infinity
  constructor(private readonly callback?: (progress: ScannerProgress) => void) {}

  add(activity: ScanActivity): void {
    for (const key of ['filesObserved', 'filesCompleted', 'bytesRead', 'assetsProcessed'] as const)
      this.value[key] += activity[key] ?? 0
    this.report()
  }

  stage(stage: ScannerProgress['stage']): void { this.value.stage = stage; this.report(true) }

  private report(force = false): void {
    if (!this.callback) return
    const now = performance.now()
    if (!force && now - this.lastReport < 1000) return
    this.lastReport = now
    try { this.callback({ ...this.value }) } catch { /* Diagnostics must not interrupt indexing. */ }
  }
}
