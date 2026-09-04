import { watch, type FSWatcher } from 'node:fs'
import path from 'node:path'

export interface WatcherEvent { type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'; path: string }

export class ScannerWatcher {
  private watcher: FSWatcher | undefined
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private callback: ((event: WatcherEvent) => void) | undefined
  constructor(private readonly debounceMs = 250) {}

  start(roots: string[], callback: (event: WatcherEvent) => void): void {
    this.stop(); this.callback = callback
    for (const root of roots) {
      try {
        this.watcher = watch(root, { recursive: true }, (_event, fileName) => {
          if (!fileName) return
          const target = path.join(root, fileName.toString())
          this.push({ type: 'change', path: target })
        })
      } catch { /* a later full scan can still recover from unavailable watchers */ }
    }
  }

  push(event: WatcherEvent): void {
    const key = path.resolve(event.path).toLowerCase()
    const prior = this.timers.get(key)
    if (prior) clearTimeout(prior)
    this.timers.set(key, setTimeout(() => {
      this.timers.delete(key); this.callback?.(event)
    }, this.debounceMs))
  }

  stop(): void {
    this.watcher?.close(); this.watcher = undefined
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear(); this.callback = undefined
  }
}
