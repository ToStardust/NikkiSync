import { discoverInfinityNikkiInstallation, discoverMediaRoots, type GameDiscoveryOptions, type InfinityNikkiInstallation } from '../game-directory-discovery.js'

export class ScannerDiscovery {
  constructor(private readonly options: GameDiscoveryOptions = {}) {}
  discover(): Promise<InfinityNikkiInstallation | undefined> { return discoverInfinityNikkiInstallation(this.options) }
  async refresh(installation:InfinityNikkiInstallation):Promise<InfinityNikkiInstallation>{
    // Only revisit known media locations in the already selected installation.
    // Temporarily unavailable roots remain in scope: absence is not deletion.
    const media=await discoverMediaRoots(installation.x6GameRoot)
    const merge=(before:string[]=[],after:string[]=[])=>[...new Map([...before,...after].map(root=>[root.toLowerCase(),root])).values()]
    return {...installation,photoRoots:merge(installation.photoRoots,media.photoRoots),motionRoots:merge(installation.motionRoots,media.motionRoots),supplementalRoots:merge(installation.supplementalRoots,media.supplementalRoots)}
  }
}
