import { AssetRepository, PairingRepository, type DatabaseManager } from '@nikkisync/database'

export interface DesktopStatusInput {
  host: string
  port: number
  assets?: number
}

export interface DesktopStatus {
  service: 'ready'
  host: string
  port: number
  assets: number
  pairedDevices: number
  firstRun: boolean
}

/** Shapes local-only desktop UI state without exposing phone credentials or metadata. */
export class DesktopStatusService {
  private readonly assets: AssetRepository
  private readonly pairing: PairingRepository

  constructor(database: DatabaseManager) {
    this.assets=new AssetRepository(database)
    this.pairing = new PairingRepository(database)
  }

  getStatus(input: DesktopStatusInput): DesktopStatus {
    const pairedDevices = this.pairing.countActiveDevices()
    return {
      service: 'ready',
      host: input.host,
      port: input.port,
      assets: input.assets ?? this.assets.countVisible(),
      pairedDevices,
      firstRun: pairedDevices === 0
    }
  }
}
