import { AssetRepository, DatabaseManager } from '@nikkisync/database'
import path from 'node:path'
import {realpath} from 'node:fs/promises'
import { FileStabilityGuard } from './FileStabilityGuard.js'
import { ScannerDiscovery } from './ScannerDiscovery.js'
import { ScannerWatcher } from './ScannerWatcher.js'
import { ScanCoordinator } from './ScanCoordinator.js'
import { ScanReconciler } from './ScanReconciler.js'
import { ScanProgressTracker } from './ScanProgressTracker.js'
import {idFor} from './ExtraScanDirectories.js'
import type { ExtraScanRoot, ScannerConfig, ScannerMetrics, ScannerStatus, ScanResult } from './types.js'

export class ScannerService {
  private status: ScannerStatus = 'stopped'; private installation?: Awaited<ReturnType<ScannerDiscovery['discover']>>
  private watcher: ScannerWatcher | undefined; private coordinator: ScanCoordinator; private reconciler: ScanReconciler
  private lastScan: ScanResult | undefined
  private progress: ScanProgressTracker | undefined
  private readonly pendingRoots = new Map<string, string>()
  private pendingWaiters: Array<{ resolve: (result: ScanResult) => void; reject: (error: unknown) => void }> = []
  private draining: Promise<void> | undefined
  private extraDirectories:ExtraScanRoot[]=[]
  private nativeImages=new Map<string,string>()
  private watcherHolds=0
  private deferredWatchPaths=new Set<string>()
  constructor(private readonly database: DatabaseManager, config: ScannerConfig = {}) {
    const stability = { pollIntervalMs: 200, stableChecks: 3, maxWaitMs: 10_000, assumeStableIfOlderMs: 2000, ...config.stability }
    this.coordinator = new ScanCoordinator(new FileStabilityGuard(stability))
    this.reconciler = new ScanReconciler(new AssetRepository(database), config.motionAssemblyGraceMs ?? 2000)
    this.config = config
    this.extraDirectories=[...(config.extraDirectories??[])]
  }
  private readonly config: ScannerConfig

  async start(): Promise<ScanResult> {
    this.status = 'discovering'; this.installation = await new ScannerDiscovery(this.config).discover()
    if (!this.installation&&!this.config.allowMissingInstallation&&this.extraDirectories.length===0) { this.status = 'error'; throw new Error('Infinity Nikki installation was not found') }
    // Compare physical scope aliases without changing existing asset/resource path identities.
    const active=await Promise.all(this.getScanRoots().map(root=>realpath(root).catch(()=>root)))
    const retired:string[]=[]
    for(const root of this.config.retiredExtraDirectories??[]){
      const physical=await realpath(root).catch(()=>root)
      if(!active.some(scope=>within(physical,scope)||within(scope,physical)))retired.push(root,physical)
    }
    if(retired.length)new AssetRepository(this.database).markMissingByRoots([],retired)
    const result = await this.fullScan()
    this.progress?.stage('scan-watch')
    if (this.config.watcher !== false) {
      this.watcher = new ScannerWatcher(this.config.debounceMs ?? 250)
      this.watcher.start(result.roots, event=>this.watcherChanged(event.path))
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
    if (!this.installation&&!this.config.allowMissingInstallation&&this.extraDirectories.length===0) throw new Error('Infinity Nikki installation was not found')
    // This pass covers events already collected by an active deletion batch.
    if(this.watcherHolds)this.deferredWatchPaths.clear()
    return this.enqueueScan(this.getScanRoots())
  }
  private watcherChanged(file:string){if(this.watcherHolds){this.deferredWatchPaths.add(file);return}void this.rescanPath(file).catch(()=>{})}
  async withDeferredWatchEvents(work:()=>Promise<void>):Promise<void>{
    this.watcherHolds++
    try{await work()}finally{
      if(--this.watcherHolds===0){const changed=[...this.deferredWatchPaths];this.deferredWatchPaths.clear();await Promise.allSettled(changed.map(file=>this.rescanPath(file)))}
    }
  }
  async rescanPath(filePath: string): Promise<ScanResult> {
    if (!this.installation) this.installation = await new ScannerDiscovery(this.config).discover()
    const allRoots = this.getScanRoots()
    const sourceRoot = allRoots.find((root) => within(filePath,root))
    if (!sourceRoot) return this.fullScan()
    if(this.extraDirectories.some(item=>within(sourceRoot,item.path)))return this.enqueueScan([sourceRoot,...this.screenRoots()])
    const relative = path.relative(sourceRoot, filePath).split(path.sep)
    const uid = relative.find((part) => /^\d{5,}$/.test(part))
    return this.enqueueScan([uid ? path.join(sourceRoot, uid) : sourceRoot,...this.screenRoots()])
  }
  getExtraDirectoryCount():number{return this.extraDirectories.length}
  getAutomaticRoots():string[]{return [...(this.installation?.photoRoots??[]),...(this.installation?.motionRoots??[]),...(this.installation?.supplementalRoots??[])]}
  private screenRoots():string[]{return this.getScanRoots().filter(root=>/^ScreenShot$/i.test(path.basename(root)))}
  getScanRoots():string[]{
    const roots=[...this.getAutomaticRoots(),...this.extraDirectories.map(item=>item.path)].map(root=>path.resolve(root))
    return roots.filter((root,index)=>!roots.some((parent,other)=>other!==index&&within(root,parent)&&(root.length>parent.length||other<index)))
  }
  async setExtraDirectories(next:ExtraScanRoot[]):Promise<ScanResult>{
    await this.draining
    const removed=this.extraDirectories.filter(old=>!next.some(item=>item.id===old.id))
    const added=next.filter(item=>!this.extraDirectories.some(old=>old.id===item.id&&old.mode===item.mode))
    this.watcher?.stop()
    this.extraDirectories=[...next]
    if(removed.length){
      new AssetRepository(this.database).markMissingByRoots([],removed.map(item=>item.path))
      for(const file of this.nativeImages.keys())if(removed.some(item=>within(file,item.path)))this.nativeImages.delete(file)
    }
    if(this.config.watcher!==false){this.watcher??=new ScannerWatcher(this.config.debounceMs??250);this.watcher.start(this.getScanRoots(),event=>this.watcherChanged(event.path))}
    // Adding a small export folder must not rehash an already indexed, potentially huge game album.
    // Watchers stay active during the new pass; their events join the same serialized scan queue.
    return added.length?this.enqueueScan([...added.map(item=>item.path),...(added.some(item=>item.mode==='native')?this.screenRoots():[])]):removed.length?this.enqueueScan([...this.screenRoots(),...this.getAutomaticRoots().filter(root=>removed.some(item=>within(root,item.path)||within(item.path,root)))]):this.fullScan()
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
    const progress = this.progress = new ScanProgressTracker(this.config.onProgress)
    progress.stage('scan-files')
    this.status = 'scanning'; const scanId = `scan_${Date.now().toString(36)}`; const all = [] as Awaited<ReturnType<ScanCoordinator['scanRoot']>>[]
    for (const root of roots) all.push(await this.coordinator.scanRoot(root, activity => progress.add(activity),this.extraDirectories.find(item=>within(root,item.path))??(/^ScreenShot$/i.test(path.basename(root))?{id:idFor(root),path:root,mode:'images'}:undefined)))
    this.status = 'reconciling'; const discovered = all.flatMap((item) => item.resources)
    progress.stage('scan-index')
    // An unplugged drive or unreadable folder is not evidence that its originals were deleted.
    const completedRoots=roots.filter((_root,index)=>all[index]?.errors.length===0)
    for(const file of this.nativeImages.keys())if(completedRoots.some(root=>within(file,root)))this.nativeImages.delete(file)
    for(const resource of discovered)if(resource.imageSha256&&/[/\\]NikkiPhotos_HighQuality[/\\]/i.test(resource.absolutePath))this.nativeImages.set(resource.absolutePath,resource.imageSha256)
    const nativeHashes=new Set(this.nativeImages.values())
    // Only suppress exact exported image bytes, never equal filenames or visually similar photos.
    const resources=discovered.filter(resource=>!(/[/\\]ScreenShot[/\\]/i.test(resource.absolutePath)&&resource.imageSha256&&nativeHashes.has(resource.imageSha256)))
    const reconciled = await this.reconciler.reconcile(resources, completedRoots, () => progress.add({ assetsProcessed: 1 }))
    progress.stage('scan-index')
    const result: ScanResult = { scanId, roots, filesObserved: all.reduce((sum, item) => sum + item.filesObserved, 0), resourcesAccepted: resources.filter((item) => !['ignored', 'unknown_image', 'binary_companion'].includes(item.kind)).length, resourcesIgnored: resources.filter((item) => ['ignored', 'unknown_image', 'binary_companion'].includes(item.kind)).length, errors: all.flatMap((item) => item.errors), ...reconciled }
    this.lastScan = result
    this.status = 'running'
    return result
  }
  getStatus(): ScannerMetrics {
    return { status: this.status, ...(this.installation ? { installation: this.installation } : {}), ...(this.lastScan ? { lastScan: this.lastScan } : {}) }
  }
}

function within(candidate:string,root:string):boolean{
  const key=path.resolve(candidate).toLowerCase(),parent=path.resolve(root).toLowerCase()
  return key===parent||key.startsWith(parent+path.sep)
}
