import { watch, type FSWatcher } from 'node:fs'
import path from 'node:path'

export interface WatcherEvent { type: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'; path: string }

export class ScannerWatcher {
  private watchers: FSWatcher[] = []
  private timers = new Map<string, ReturnType<typeof setTimeout>>()
  private callback: ((event: WatcherEvent) => void) | undefined
  constructor(private readonly debounceMs = 250) {}

  start(roots: string[], callback: (event: WatcherEvent) => void, shallowRoots:string[]=[]): void {
    this.stop(); this.callback = callback
    for (const {root,recursive} of [...roots.map(root=>({root,recursive:true})),...shallowRoots.filter(root=>!roots.includes(root)).map(root=>({root,recursive:false}))]) {
      try {
        const watcher=watch(root, { recursive }, (_event, fileName) => {
          if (!fileName) return
          const target = path.join(root, fileName.toString())
          this.push({ type: 'change', path: target })
        })
        // Removing/unplugging a watched directory can emit an async error;
        // an unavailable media folder must not terminate the sync service.
        watcher.on('error',()=>watcher.close())
        this.watchers.push(watcher)
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
    for (const watcher of this.watchers) watcher.close()
    this.watchers = []
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear(); this.callback = undefined
  }
}
