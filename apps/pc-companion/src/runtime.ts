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

export interface PcCompanionRuntimeConfig {
  databaseFile?: string
  scanner?: ScannerConfig
  server?: LocalSyncServerConfig
  metadataResolver?: {
    resolver: PhotoMetadataResolver
    service?: MetadataResolverServiceConfig
  }
  metadataDictionary?: MetadataDictionaryManifest
  metadataDictionaryRemote?: {
    provider: MetadataDictionaryProvider
    service?: MetadataDictionaryUpdateServiceConfig
  }
}

export interface PcCompanionStartResult {
  scan: ScanResult
  server: LocalSyncServerAddress
}

/** Owns the process-level lifecycle: scanner first, then LAN transport, sharing one SQLite source of truth. */
export class PcCompanionRuntime {
  readonly database: DatabaseManager
  readonly scanner: ScannerService
  readonly server: LocalSyncServer
  readonly metadataResolver?: MetadataResolverService
  readonly metadataDictionary?: MetadataDictionaryService
  readonly metadataDictionaryUpdater?: MetadataDictionaryUpdateService

  constructor(config: PcCompanionRuntimeConfig = {}) {
    this.database = new DatabaseManager(config.databaseFile ?? ':memory:')
    this.database.initialize()
    this.scanner = new ScannerService(this.database, config.scanner)
    if (config.metadataDictionary || config.metadataDictionaryRemote) {
      this.metadataDictionary = new MetadataDictionaryService(this.database)
      if (config.metadataDictionary) this.metadataDictionary.replaceManifest(config.metadataDictionary)
      if (config.metadataDictionaryRemote) {
        this.metadataDictionaryUpdater = new MetadataDictionaryUpdateService(
          this.database,
          this.metadataDictionary,
          config.metadataDictionaryRemote.provider,
          config.metadataDictionaryRemote.service
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
    const serverConfig = config.server ?? {}
    if (serverConfig.tls) {
      this.server = new LocalSyncServer(this.database, serverConfig)
    } else {
      const tls = new LocalTlsIdentityService(this.database).getOrCreate()
      this.server = new LocalSyncServer(this.database, { ...serverConfig, tls: { key: tls.keyPem, cert: tls.certPem } })
    }
  }

  async start(): Promise<PcCompanionStartResult> {
    const scan = await this.scanner.start()
    try {
      const server = await this.server.start()
      this.metadataDictionary?.reenrichResolvedAssets()
      this.metadataDictionaryUpdater?.start()
      this.metadataResolver?.start()
      return { scan, server }
    } catch (error) {
      await this.scanner.stop()
      throw error
    }
  }

  async stop(): Promise<void> {
    this.metadataResolver?.stop()
    this.metadataDictionaryUpdater?.stop()
    await this.server.stop()
    await this.scanner.stop()
    this.database.close()
  }

  createPairingUri(host: string, ttlMs?: number): string {
    return buildPairingUri(this.server.createPairingPayload(host, ttlMs))
  }
}
