/** Collect after completed bulk work, once the event loop has become quiet. */
export class RuntimeMemoryMaintenance {
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopped = false

  constructor(
    private readonly collect: () => void = () => {
      const runtime = (globalThis as typeof globalThis & { Bun?: { gc(force?: boolean): void } }).Bun
      runtime?.gc(true)
    },
    private readonly quietMs = 5000
  ) {}

  schedule(): void {
    if (this.stopped) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      this.collect()
    }, this.quietMs)
    this.timer.unref()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }
}
