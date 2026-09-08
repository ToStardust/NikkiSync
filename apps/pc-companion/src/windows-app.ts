import { appendFileSync, mkdirSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PcCompanionRuntime } from './runtime.js'
import { qrSvg } from './qr.js'
import { RemoteJsonMetadataResolver } from './metadata/RemoteJsonMetadataResolver.js'
import { createMetadataResolverFromConfig, loadMetadataResolverConfigFile } from './metadata/MetadataResolverConfigFile.js'
import { loadMetadataDictionaryFile } from './metadata/MetadataDictionaryConfigFile.js'
import { loadMetadataDictionaryRemoteConfigFile } from './metadata/MetadataDictionaryRemoteConfigFile.js'
import { RemoteJsonMetadataDictionaryProvider } from './metadata/RemoteJsonMetadataDictionaryProvider.js'
import { createDesktopControlServer } from './desktop/DesktopControlServer.js'
import { DesktopStatusService } from './desktop/DesktopStatusService.js'
import { chooseWritableDataDirectory, isWritableDataDirectory } from './desktop/AppDataDirectory.js'

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

function isLanIpv4(address: string): boolean {
  const [first, second] = address.split('.').map(Number)
  return first === 10
    || (first === 192 && second === 168)
    || (first === 172 && second !== undefined && second >= 16 && second <= 31)
}

function preferredLanIpv4(): string | undefined {
  const candidates = Object.values(os.networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === 'IPv4' && !entry.internal)
    .map((entry) => entry.address)
  return candidates.find(isLanIpv4) ?? candidates[0]
}

async function main(): Promise<void> {
  mkdirSync(APP_DATA, { recursive: true })
  const pairingHost = preferredLanIpv4()
  if (!pairingHost) throw new Error('未找到局域网 IPv4 地址。请连接 Wi-Fi 或网线后重新打开 NikkiSync PC。')

  const resolverFile = loadMetadataResolverConfigFile(METADATA_RESOLVER_CONFIG_FILE)
  const metadataDictionary = loadMetadataDictionaryFile(METADATA_DICTIONARY_FILE)
  const metadataDictionaryRemoteConfig = loadMetadataDictionaryRemoteConfigFile(METADATA_DICTIONARY_REMOTE_CONFIG_FILE)
  const metadataDictionaryRemote = metadataDictionaryRemoteConfig?.enabled === true && metadataDictionaryRemoteConfig.provider
    ? new RemoteJsonMetadataDictionaryProvider(metadataDictionaryRemoteConfig.provider)
    : undefined

  const fileResolver = resolverFile?.enabled === false ? undefined : createMetadataResolverFromConfig(resolverFile)
  const environmentResolverConfig = process.env.NIKKISYNC_METADATA_RESOLVER_URL ? {
    endpoint: process.env.NIKKISYNC_METADATA_RESOLVER_URL,
    id: process.env.NIKKISYNC_METADATA_RESOLVER_ID ?? 'remote-json',
    ...(process.env.NIKKISYNC_METADATA_RESOLVER_VERSION
      ? { version: process.env.NIKKISYNC_METADATA_RESOLVER_VERSION }
      : {})
  } : undefined
  // Local hot-config has precedence. The environment variable remains a backwards-compatible
  // single remote provider only when no usable file provider is configured.
  const resolver = fileResolver ?? (environmentResolverConfig
    ? new RemoteJsonMetadataResolver(environmentResolverConfig)
    : undefined)

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
