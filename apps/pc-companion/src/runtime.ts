import { AppSettingsRepository, DatabaseManager } from '@nikkisync/database'
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
import { BUILTIN_GAME_VERSION_CALENDAR } from './game-version/BuiltinGameVersionCalendar.js'
import type { GameVersionCalendarProvider } from './game-version/GameVersionCalendarProvider.js'
import { GameVersionCalendarStore } from './game-version/GameVersionCalendarStore.js'
import {
  GameVersionCalendarUpdateService,
  type GameVersionCalendarUpdateServiceConfig
} from './game-version/GameVersionCalendarUpdateService.js'

const SCANNER_INSTALL_ROOT_SETTING = 'scanner.installRoot'
const SCANNER_DISCOVERY_RETRY_MS = 5_000

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
  gameVersionCalendarRemote?: {
    provider: GameVersionCalendarProvider
    service?: GameVersionCalendarUpdateServiceConfig
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
  readonly gameVersionCalendar: GameVersionCalendarStore
  readonly gameVersionCalendarUpdater?: GameVersionCalendarUpdateService
  private readonly appSettings: AppSettingsRepository
  private scannerRetryTimer: ReturnType<typeof setInterval> | undefined
  private scannerRetryInFlight = false

  constructor(config: PcCompanionRuntimeConfig = {}) {
    this.database = new DatabaseManager(config.databaseFile ?? ':memory:')
    this.database.initialize()
    this.appSettings = new AppSettingsRepository(this.database)

    let persistedInstallRoot: string | undefined
    try {
      const value = this.appSettings.get<unknown>(SCANNER_INSTALL_ROOT_SETTING)
      if (typeof value === 'string' && value.trim()) persistedInstallRoot = value
    } catch {
      // A malformed optional cache must never prevent the PC service from starting.
    }
    const scannerConfig: ScannerConfig = {
      ...(config.scanner ?? {}),
      ...(!config.scanner?.cachedInstallRoot && persistedInstallRoot
        ? { cachedInstallRoot: persistedInstallRoot }
        : {})
    }
    this.scanner = new ScannerService(this.database, scannerConfig)

    this.gameVersionCalendar = new GameVersionCalendarStore(this.appSettings)
    const cachedCalendar = this.gameVersionCalendar.manifest()
    const packagedBuiltinIsNewer = cachedCalendar?.provider === BUILTIN_GAME_VERSION_CALENDAR.provider
      && (cachedCalendar.providerVersion === undefined
        || cachedCalendar.providerVersion < (BUILTIN_GAME_VERSION_CALENDAR.providerVersion ?? ''))
    if (!cachedCalendar || packagedBuiltinIsNewer) this.gameVersionCalendar.replace(BUILTIN_GAME_VERSION_CALENDAR)
    if (config.gameVersionCalendarRemote) {
      this.gameVersionCalendarUpdater = new GameVersionCalendarUpdateService(
        this.database,
        this.gameVersionCalendar,
        config.gameVersionCalendarRemote.provider,
        config.gameVersionCalendarRemote.service
      )
    }

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
    const serverConfig: LocalSyncServerConfig = {
      ...(config.server ?? {}),
      gameVersionResolver: (timestamp) => this.gameVersionCalendar.resolve(timestamp)
    }
    if (serverConfig.tls) {
      this.server = new LocalSyncServer(this.database, serverConfig)
    } else {
      const tls = new LocalTlsIdentityService(this.database).getOrCreate()
      this.server = new LocalSyncServer(this.database, { ...serverConfig, tls: { key: tls.keyPem, cert: tls.certPem } })
    }
  }

  async start(): Promise<PcCompanionStartResult> {
    const scan = await this.scanner.start()
    this.rememberScannerInstallRoot()
    try {
      const server = await this.server.start()
      this.metadataDictionary?.reenrichResolvedAssets()
      this.metadataDictionaryUpdater?.start()
      this.gameVersionCalendarUpdater?.start()
      this.metadataResolver?.start()
      this.startScannerDiscoveryRetryIfNeeded()
      return { scan, server }
    } catch (error) {
      this.stopScannerDiscoveryRetry()
      await this.scanner.stop()
      throw error
    }
  }

  async stop(): Promise<void> {
    this.stopScannerDiscoveryRetry()
    this.metadataResolver?.stop()
    this.gameVersionCalendarUpdater?.stop()
    this.metadataDictionaryUpdater?.stop()
    await this.server.stop()
    await this.scanner.stop()
    this.database.close()
  }

  createPairingUri(host: string, ttlMs?: number): string {
    return buildPairingUri(this.server.createPairingPayload(host, ttlMs))
  }

  private rememberScannerInstallRoot(): void {
    const installRoot = this.scanner.getStatus().installation?.installRoot
    if (installRoot) this.appSettings.set(SCANNER_INSTALL_ROOT_SETTING, installRoot)
  }

  private startScannerDiscoveryRetryIfNeeded(): void {
    if (this.scanner.getStatus().status !== 'error' || this.scannerRetryTimer) return
    this.scannerRetryTimer = setInterval(() => {
      if (this.scannerRetryInFlight || this.scanner.getStatus().status !== 'error') return
      this.scannerRetryInFlight = true
      void this.scanner.start()
        .then(() => {
          this.rememberScannerInstallRoot()
          if (this.scanner.getStatus().status !== 'error') this.stopScannerDiscoveryRetry()
        })
        .catch(() => { /* retry remains best-effort; pairing service stays available */ })
        .finally(() => { this.scannerRetryInFlight = false })
    }, SCANNER_DISCOVERY_RETRY_MS)
  }

  private stopScannerDiscoveryRetry(): void {
    if (this.scannerRetryTimer) clearInterval(this.scannerRetryTimer)
    this.scannerRetryTimer = undefined
  }
}
