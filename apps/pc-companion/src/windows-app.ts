import { appendFileSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PcCompanionRuntime } from './runtime.js'
import { qrSvg } from './qr.js'
import { loadMetadataResolverConfigFile } from './metadata/MetadataResolverConfigFile.js'
import { selectMetadataResolver } from './metadata/MetadataResolverSelection.js'
import { loadMetadataDictionaryFile } from './metadata/MetadataDictionaryConfigFile.js'
import { loadMetadataDictionaryRemoteConfigFile } from './metadata/MetadataDictionaryRemoteConfigFile.js'
import { RemoteJsonMetadataDictionaryProvider } from './metadata/RemoteJsonMetadataDictionaryProvider.js'
import { loadGameVersionCalendarRemoteConfigFile } from './game-version/GameVersionCalendarRemoteConfigFile.js'
import { RemoteJsonGameVersionCalendarProvider } from './game-version/RemoteJsonGameVersionCalendarProvider.js'
import { createDesktopControlServer } from './desktop/DesktopControlServer.js'
import { DesktopStatusService } from './desktop/DesktopStatusService.js'
import { chooseWritableDataDirectory, isWritableDataDirectory } from './desktop/AppDataDirectory.js'
import { selectPairingHost } from './desktop/PairingHostSelector.js'

const APP_NAME = 'NikkiSync PC'
const APP_DATA = chooseWritableDataDirectory([
  path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'NikkiSync'),
  path.join(path.dirname(process.execPath), 'data'),
  path.join(process.cwd(), 'data')
], isWritableDataDirectory)
const DATABASE_FILE = path.join(APP_DATA, 'nikkisync.sqlite')
const METADATA_RESOLVER_CONFIG_FILE = path.join(APP_DATA, 'metadata-resolver.json')
const METADATA_DICTIONARY_FILE = path.join(APP_DATA, 'metadata-dictionary.json')
const METADATA_DICTIONARY_REMOTE_CONFIG_FILE = path.join(APP_DATA, 'metadata-dictionary-remote.json')
const GAME_VERSION_CALENDAR_REMOTE_CONFIG_FILE = path.join(APP_DATA, 'game-version-calendar-remote.json')

async function main(): Promise<void> {
  mkdirSync(APP_DATA, { recursive: true })
  const pairingHost = selectPairingHost(os.networkInterfaces())
  if (!pairingHost) throw new Error('未找到可用于手机配对的局域网 IPv4 地址。请连接 Wi-Fi 或网线后重新打开 NikkiSync PC。')

  const resolverFile = loadMetadataResolverConfigFile(METADATA_RESOLVER_CONFIG_FILE)
  const metadataDictionary = loadMetadataDictionaryFile(METADATA_DICTIONARY_FILE)
  const metadataDictionaryRemoteConfig = loadMetadataDictionaryRemoteConfigFile(METADATA_DICTIONARY_REMOTE_CONFIG_FILE)
  const metadataDictionaryRemote = metadataDictionaryRemoteConfig?.enabled === true && metadataDictionaryRemoteConfig.provider
    ? new RemoteJsonMetadataDictionaryProvider(metadataDictionaryRemoteConfig.provider)
    : undefined
  const gameVersionCalendarRemoteConfig = loadGameVersionCalendarRemoteConfigFile(GAME_VERSION_CALENDAR_REMOTE_CONFIG_FILE)
  const gameVersionCalendarRemote = gameVersionCalendarRemoteConfig?.provider
    ? new RemoteJsonGameVersionCalendarProvider(gameVersionCalendarRemoteConfig.provider)
    : undefined
  const resolver = selectMetadataResolver(resolverFile, {
    ...(process.env.NIKKISYNC_METADATA_RESOLVER_URL
      ? { endpoint: process.env.NIKKISYNC_METADATA_RESOLVER_URL }
      : {}),
    ...(process.env.NIKKISYNC_METADATA_RESOLVER_ID
      ? { id: process.env.NIKKISYNC_METADATA_RESOLVER_ID }
      : {}),
    ...(process.env.NIKKISYNC_METADATA_RESOLVER_VERSION
      ? { version: process.env.NIKKISYNC_METADATA_RESOLVER_VERSION }
      : {})
  })

  const runtime = new PcCompanionRuntime({
    databaseFile: DATABASE_FILE,
    ...(metadataDictionary ? { metadataDictionary } : {}),
    ...(metadataDictionaryRemote ? {
      metadataDictionaryRemote: {
        provider: metadataDictionaryRemote,
        service: {
          enabled: true,
          ...(metadataDictionaryRemoteConfig?.provider?.intervalMs === undefined
            ? {}
            : { intervalMs: metadataDictionaryRemoteConfig.provider.intervalMs })
        }
      }
    } : {}),
    ...(gameVersionCalendarRemote ? {
      gameVersionCalendarRemote: {
        provider: gameVersionCalendarRemote,
        service: {
          enabled: true,
          ...(gameVersionCalendarRemoteConfig?.provider.intervalMs === undefined
            ? {}
            : { intervalMs: gameVersionCalendarRemoteConfig.provider.intervalMs })
        }
      }
    } : {}),
    ...(resolver ? {
      metadataResolver: {
        resolver
      }
    } : {}),
    server: {
      host: process.env.NIKKISYNC_BIND ?? '0.0.0.0',
      port: Number(process.env.NIKKISYNC_PORT ?? 28080),
      mdns: process.env.NIKKISYNC_MDNS !== '0',
      name: APP_NAME
    }
  })
  const started = await runtime.start()
  const status = new DesktopStatusService(runtime.database)
  const dashboard = createDesktopControlServer({
    getStatus: () => status.getStatus({ host: pairingHost, port: started.server.port }),
    createPairingUri: () => runtime.createPairingUri(pairingHost),
    qrSvg
  })
  await new Promise<void>((resolve, reject) => {
    dashboard.once('error', reject)
    dashboard.listen(Number(process.env.NIKKISYNC_DESKTOP_PORT ?? 0), '127.0.0.1', () => resolve())
  })
  const address = dashboard.address()
  if (!address || typeof address === 'string') throw new Error('无法启动本机配对页面')
  const shutdown = async () => {
    await new Promise<void>((resolve) => dashboard.close(() => resolve()))
    await runtime.stop()
  }
  process.once('SIGINT', () => { void shutdown().finally(() => process.exit(0)) })
  process.once('SIGTERM', () => { void shutdown().finally(() => process.exit(0)) })
}

main().catch((error) => {
  try {
    mkdirSync(APP_DATA, { recursive: true })
    appendFileSync(path.join(APP_DATA, 'startup-error.log'), `[${new Date().toISOString()}] ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`)
  } catch { /* best-effort startup diagnostics for a consoleless executable */ }
  console.error(error)
  process.exit(1)
})
