import { readdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { FileStabilityGuard } from './FileStabilityGuard.js'
import { ResourceClassifier } from './ResourceClassifier.js'
import type { DiscoveredResource, ExtraScanRoot } from './types.js'
import type { ScanActivity } from './ScanProgressTracker.js'

export class ScanCoordinator {
  constructor(
    private readonly guard = new FileStabilityGuard({ pollIntervalMs: 200, stableChecks: 3, maxWaitMs: 10_000 }),
    private readonly classifier = new ResourceClassifier()
  ) {}

  async scanRoot(root: string, onActivity?: (activity: ScanActivity) => void, extra?: ExtraScanRoot): Promise<{ resources: DiscoveredResource[]; filesObserved: number; errors: string[] }> {
    const resources: DiscoveredResource[] = []; const errors: string[] = []; let filesObserved = 0
    if(extra){try{if((await realpath(extra.path)).toLowerCase()!==path.resolve(extra.path).toLowerCase())throw new Error('scope_changed')}catch{return {resources,filesObserved,errors:['Directory unavailable']}}}
    const visit = async (directory: string): Promise<void> => {
      let entries
      try { entries = await readdir(directory, { withFileTypes: true }) } catch (error) { errors.push(String(error)); return }
      for (const entry of entries) {
        const target = path.join(directory, entry.name)
        if(entry.isSymbolicLink())continue
        if (entry.isDirectory()) { await visit(target); continue }
        filesObserved += 1
        onActivity?.({ filesObserved: 1 })
        try {
          const kind = this.classifier.classifyPath(target,extra)
          if (kind !== 'ignored' && kind !== 'unknown_image' && kind !== 'binary_companion') {
            await this.guard.waitForStable(target)
            // Hash and stat only after stability so the indexed digest and size are coherent.
            resources.push(await this.classifier.classify(target, root, bytesRead => onActivity?.({ bytesRead }),extra))
          } else resources.push(await this.classifier.classify(target, root,undefined,extra))
        } catch (error) { errors.push(`${target}: ${String(error)}`) }
        finally { onActivity?.({ filesCompleted: 1 }) }
      }
    }
    await visit(root)
    return { resources, filesObserved, errors }
  }
}
