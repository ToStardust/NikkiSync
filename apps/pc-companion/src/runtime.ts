import { DatabaseManager } from '@nikkisync/database'
import { buildPairingUri } from '@nikkisync/protocol'
import type { MetadataDictionaryManifest } from '@nikkisync/core'
import { LocalSyncServer, type LocalSyncServerAddress, type LocalSyncServerConfig } from './server/LocalSyncServer.js'
import { LocalTlsIdentityService } from './server/LocalTlsIdentityService.js'
import { ScannerService } from './scanner/ScannerService.js'
import type { ScannerConfig, ScanResult } from './scanner/types.js'
import { MetadataResolverService } from './metadata/MetadataResolverService.js'
import type { MetadataResolverServiceConfig, PhotoMetadataResolver } from './metadata/types.js'
import { MetadataDictionaryService } from './metadata/MetadataDictionaryService.js'
import { MetadataDictionaryUpdateService, type MetadataDictionaryUpdateServiceConfig } from './metadata/MetadataDictionaryUpdateService.js'
import type { MetadataDictionaryProvider } from './metadata/MetadataDictionaryProvider.js'
import { RemoteBridgeService } from './remote/RemoteBridgeService.js'
import { CachedDecodedMetadataService } from './metadata/CachedDecodedMetadataService.js'

export interface PcCompanionRuntimeConfig {
  onStartupStage?: (stage: PcStartupStage) => void
  databaseFile?: string
  scanner?: ScannerConfig
  server?: LocalSyncServerConfig
  remoteBridge?: boolean
  metadataResolver?: {
    resolver: PhotoMetadataResolver
    service?: MetadataResolverServiceConfig
  }
  metadataDictionary?: MetadataDictionaryManifest
  metadataDictionarySupplement?: MetadataDictionaryManifest
  metadataDictionaryRemote?: {
    provider: MetadataDictionaryProvider
    service?: MetadataDictionaryUpdateServiceConfig
  }
  metadataDictionarySupplementRemote?: {
    provider: MetadataDictionaryProvider
    service?: MetadataDictionaryUpdateServiceConfig
  }
}

export type PcStartupStage = 'scanner' | 'lan-listen' | 'cached-metadata'
  | 'dictionary-enrichment' | 'background-services' | 'runtime-ready'

export interface PcCompanionStartResult {
  scan: ScanResult
  server: LocalSyncServerAddress
}

/** Owns the process-level lifecycle: scanner first, then LAN transport, sharing one SQLite source of truth. */
export class PcCompanionRuntime {
  private readonly onStartupStage: PcCompanionRuntimeConfig['onStartupStage']
  readonly database: DatabaseManager
  readonly scanner: ScannerService
  readonly server: LocalSyncServer
  readonly remoteBridge: RemoteBridgeService | undefined
  readonly metadataResolver?: MetadataResolverService
  readonly metadataDictionary?: MetadataDictionaryService
  readonly metadataDictionaryUpdater?: MetadataDictionaryUpdateService
  readonly metadataDictionarySupplementUpdater?: MetadataDictionaryUpdateService

  constructor(config: PcCompanionRuntimeConfig = {}) {
    this.onStartupStage = config.onStartupStage
    this.database = new DatabaseManager(config.databaseFile ?? ':memory:')
    this.database.initialize()
    this.scanner = new ScannerService(this.database, config.scanner)
    if (config.metadataDictionary || config.metadataDictionaryRemote || config.metadataDictionarySupplement || config.metadataDictionarySupplementRemote) {
      this.metadataDictionary = new MetadataDictionaryService(this.database, config.metadataDictionarySupplement)
      if (config.metadataDictionary) this.metadataDictionary.replaceManifest(config.metadataDictionary)
      if (config.metadataDictionaryRemote) {
        this.metadataDictionaryUpdater = new MetadataDictionaryUpdateService(
          this.database,
          this.metadataDictionary,
          config.metadataDictionaryRemote.provider,
          config.metadataDictionaryRemote.service
        )
      }
      if (config.metadataDictionarySupplementRemote) {
        this.metadataDictionarySupplementUpdater = new MetadataDictionaryUpdateService(
          this.database, this.metadataDictionary, config.metadataDictionarySupplementRemote.provider,
          { ...config.metadataDictionarySupplementRemote.service, mode: 'supplement' }
        )
      }
    }
    if (config.metadataResolver) {
      this.metadataResolver = new MetadataResolverService(
        this.database,
        config.metadataResolver.resolver,
        config.metadataResolver.service,
        this.metadataDictionary
      )
    }
    this.remoteBridge = config.remoteBridge ? new RemoteBridgeService(this.database) : config.server?.remoteBridge
    const serverConfig = { ...config.server, ...(this.remoteBridge ? { remoteBridge: this.remoteBridge } : {}) }
    if (serverConfig.tls) {
      this.server = new LocalSyncServer(this.database, serverConfig)
    } else {
      const tls = new LocalTlsIdentityService(this.database).getOrCreate()
      this.server = new LocalSyncServer(this.database, { ...serverConfig, tls: { key: tls.keyPem, cert: tls.certPem } })
    }
  }

  async start(): Promise<PcCompanionStartResult> {
    this.onStartupStage?.('scanner')
    const scan = await this.scanner.start()
    try {
      this.onStartupStage?.('lan-listen')
      const server = await this.server.start()
      this.onStartupStage?.('cached-metadata')
      new CachedDecodedMetadataService(this.database, this.metadataDictionary).runOnce()
      this.onStartupStage?.('dictionary-enrichment')
      this.metadataDictionary?.reenrichResolvedAssets()
      this.onStartupStage?.('background-services')
      this.metadataDictionaryUpdater?.start()
      this.metadataDictionarySupplementUpdater?.start()
      this.metadataResolver?.start()
      this.onStartupStage?.('runtime-ready')
      return { scan, server }
    } catch (error) {
      await this.scanner.stop()
      throw error
    }
  }

  async stop(): Promise<void> {
    this.metadataResolver?.stop()
    this.metadataDictionaryUpdater?.stop()
    this.metadataDictionarySupplementUpdater?.stop()
    await this.server.stop()
    await this.scanner.stop()
    this.database.close()
  }

  createPairingUri(host: string, ttlMs?: number): string {
    return buildPairingUri(this.server.createPairingPayload(host, ttlMs))
  }
}
