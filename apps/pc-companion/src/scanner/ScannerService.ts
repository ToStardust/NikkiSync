import { AssetRepository, DatabaseManager } from '@nikkisync/database'
import path from 'node:path'
import { FileStabilityGuard } from './FileStabilityGuard.js'
import { ScannerDiscovery } from './ScannerDiscovery.js'
import { ScannerWatcher } from './ScannerWatcher.js'
import { ScanCoordinator } from './ScanCoordinator.js'
import { ScanReconciler } from './ScanReconciler.js'
import type { ScannerConfig, ScannerMetrics, ScannerStatus, ScanResult } from './types.js'

export class ScannerService {
  private status: ScannerStatus = 'stopped'; private installation?: Awaited<ReturnType<ScannerDiscovery['discover']>>
  private watcher: ScannerWatcher | undefined; private coordinator: ScanCoordinator; private reconciler: ScanReconciler
  private lastScan: ScanResult | undefined
  private readonly pendingRoots = new Map<string, string>()
  private pendingWaiters: Array<{ resolve: (result: ScanResult) => void; reject: (error: unknown) => void }> = []
  private draining: Promise<void> | undefined
  constructor(private readonly database: DatabaseManager, config: ScannerConfig = {}) {
    const stability = { pollIntervalMs: 200, stableChecks: 3, maxWaitMs: 10_000, assumeStableIfOlderMs: 2000, ...config.stability }
    this.coordinator = new ScanCoordinator(new FileStabilityGuard(stability))
    this.reconciler = new ScanReconciler(new AssetRepository(database), config.motionAssemblyGraceMs ?? 2000)
    this.config = config
  }
  private readonly config: ScannerConfig

  async start(): Promise<ScanResult> {
    this.status = 'discovering'; this.installation = await new ScannerDiscovery(this.config).discover()
    if (!this.installation) { this.status = 'error'; throw new Error('Infinity Nikki installation was not found') }
    const result = await this.fullScan()
    if (this.config.watcher !== false) {
      this.watcher = new ScannerWatcher(this.config.debounceMs ?? 250)
      this.watcher.start(result.roots, (event) => { void this.rescanPath(event.path) })
    }
    this.status = 'running'; return result
  }
  async stop(): Promise<void> {
    this.watcher?.stop(); this.watcher = undefined
    await this.draining
    this.status = 'stopped'
  }
  async fullScan(): Promise<ScanResult> {
    if (!this.installation) this.installation = await new ScannerDiscovery(this.config).discover()
    if (!this.installation) throw new Error('Infinity Nikki installation was not found')
    const roots = [...this.installation.photoRoots, ...this.installation.motionRoots.filter((motionRoot) => !this.installation?.photoRoots.some((photoRoot) => motionRoot.toLowerCase().startsWith(`${photoRoot.toLowerCase()}\\`)))]
    return this.enqueueScan(roots)
  }
  async rescanPath(filePath: string): Promise<ScanResult> {
    if (!this.installation) this.installation = await new ScannerDiscovery(this.config).discover()
    if (!this.installation) throw new Error('Infinity Nikki installation was not found')
    const allRoots = [...this.installation.photoRoots, ...this.installation.motionRoots]
    const sourceRoot = allRoots.find((root) => path.resolve(filePath).toLowerCase().startsWith(`${path.resolve(root).toLowerCase()}\\`))
    if (!sourceRoot) return this.fullScan()
    const relative = path.relative(sourceRoot, filePath).split(path.sep)
    const uid = relative.find((part) => /^\d{5,}$/.test(part))
    return this.enqueueScan([uid ? path.join(sourceRoot, uid) : sourceRoot])
  }
  private enqueueScan(roots: string[]): Promise<ScanResult> {
    // There is no queued pass to resolve waiters when a new install has no media directories.
    if (roots.length === 0) return this.runScan([])
    for (const root of roots) {
      const key = path.resolve(root).toLowerCase()
      if ([...this.pendingRoots.keys()].some(parent => key === parent || key.startsWith(parent + path.sep))) continue
      for (const child of this.pendingRoots.keys()) if (child.startsWith(key + path.sep)) this.pendingRoots.delete(child)
      this.pendingRoots.set(key, root)
    }
    const waiting = new Promise<ScanResult>((resolve, reject) => { this.pendingWaiters.push({ resolve, reject }) })
    // One microtask coalesces a burst; new events during a pass form the next pass.
    this.draining ??= Promise.resolve().then(() => this.drainScans())
    return waiting
  }
  private async drainScans(): Promise<void> {
    try {
      while (this.pendingRoots.size) {
        const roots = [...this.pendingRoots.values()], waiters = this.pendingWaiters
        this.pendingRoots.clear(); this.pendingWaiters = []
        try {
          const result = await this.runScan(roots)
          for (const waiter of waiters) waiter.resolve(result)
        } catch (error) { for (const waiter of waiters) waiter.reject(error) }
      }
    } finally { this.draining = undefined; this.config.onSettled?.() }
  }
  private async runScan(roots: string[]): Promise<ScanResult> {
    this.status = 'scanning'; const scanId = `scan_${Date.now().toString(36)}`; const all = [] as Awaited<ReturnType<ScanCoordinator['scanRoot']>>[]
    for (const root of roots) all.push(await this.coordinator.scanRoot(root))
    this.status = 'reconciling'; const resources = all.flatMap((item) => item.resources)
    const reconciled = await this.reconciler.reconcile(resources, roots)
    const result: ScanResult = { scanId, roots, filesObserved: all.reduce((sum, item) => sum + item.filesObserved, 0), resourcesAccepted: resources.filter((item) => !['ignored', 'unknown_image', 'binary_companion'].includes(item.kind)).length, resourcesIgnored: resources.filter((item) => ['ignored', 'unknown_image', 'binary_companion'].includes(item.kind)).length, errors: all.flatMap((item) => item.errors), ...reconciled }
    this.lastScan = result
    this.status = 'running'
    return result
  }
  getStatus(): ScannerMetrics {
    return { status: this.status, ...(this.installation ? { installation: this.installation } : {}), ...(this.lastScan ? { lastScan: this.lastScan } : {}) }
  }
}
