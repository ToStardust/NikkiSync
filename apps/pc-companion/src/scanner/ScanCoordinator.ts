import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { FileStabilityGuard } from './FileStabilityGuard.js'
import { ResourceClassifier } from './ResourceClassifier.js'
import type { DiscoveredResource } from './types.js'

export class ScanCoordinator {
  constructor(
    private readonly guard = new FileStabilityGuard({ pollIntervalMs: 200, stableChecks: 3, maxWaitMs: 10_000 }),
    private readonly classifier = new ResourceClassifier()
  ) {}

  async scanRoot(root: string): Promise<{ resources: DiscoveredResource[]; filesObserved: number; errors: string[] }> {
    const resources: DiscoveredResource[] = []; const errors: string[] = []; let filesObserved = 0
    const visit = async (directory: string): Promise<void> => {
      let entries
      try { entries = await readdir(directory, { withFileTypes: true }) } catch (error) { errors.push(String(error)); return }
      for (const entry of entries) {
        const target = path.join(directory, entry.name)
        if (entry.isDirectory()) { await visit(target); continue }
        filesObserved += 1
        try {
          const kind = this.classifier.classifyPath(target)
          if (kind !== 'ignored' && kind !== 'unknown_image' && kind !== 'binary_companion') {
            await this.guard.waitForStable(target)
            // Hash and stat only after stability so the indexed digest and size are coherent.
            resources.push(await this.classifier.classify(target, root))
          } else resources.push(await this.classifier.classify(target, root))
        } catch (error) { errors.push(`${target}: ${String(error)}`) }
      }
    }
    await visit(root)
    return { resources, filesObserved, errors }
  }
}
