import { discoverInfinityNikkiInstallation, type GameDiscoveryOptions, type InfinityNikkiInstallation } from '../game-directory-discovery.js'

export class ScannerDiscovery {
  constructor(private readonly options: GameDiscoveryOptions = {}) {}
  discover(): Promise<InfinityNikkiInstallation | undefined> { return discoverInfinityNikkiInstallation(this.options) }
}
