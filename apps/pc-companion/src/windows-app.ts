import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import {realpath} from 'node:fs/promises'
import os from 'node:os'
import { performance } from 'node:perf_hooks'
import path from 'node:path'
import { AppSettingsRepository, SyncReadRepository } from '@nikkisync/database'
import { PcCompanionRuntime } from './runtime.js'
import { RuntimeMemoryMaintenance } from './RuntimeMemoryMaintenance.js'
import { qrSvg } from './qr.js'
import { loadMetadataResolverConfigFile } from './metadata/MetadataResolverConfigFile.js'
import { metadataResolutionDiagnostics } from './metadata/MetadataResolutionDiagnostics.js'
import { loadMetadataDictionaryFile } from './metadata/MetadataDictionaryConfigFile.js'
import { clothingNameSupplement } from './metadata/VerifiedClothingNames.js'
import { loadMetadataDictionaryRemoteConfigFile } from './metadata/MetadataDictionaryRemoteConfigFile.js'
import { composeMetadataDictionaryProvider, composeMetadataDictionarySupplementProvider, composeMetadataResolver } from './metadata/MetadataStartupComposition.js'
import { MetadataOnlineConsent } from './metadata/MetadataOnlineConsent.js'
import { createLocalPhotoMetadataResolver } from './metadata/LocalPhotoMetadataResolver.js'
import { nuan5QueueStatus } from './metadata/Nuan5CompatibleResolver.js'
import { orderedMetadataProviderConfigs } from './metadata/MetadataResolverConfigFile.js'
import { MetadataThumbnailCache } from './metadata/MetadataThumbnailCache.js'
import { loadLocalClothingIconPack, withLocalPhotoEffectIcons } from './metadata/LocalClothingIconPack.js'
import { createDesktopControlServer } from './desktop/DesktopControlServer.js'
import { DesktopStatusService } from './desktop/DesktopStatusService.js'
import { chooseWritableDataDirectory, isWritableDataDirectory } from './desktop/AppDataDirectory.js'
import { WeChatGalleryService, resizeForWeChat } from './wechat/WeChatGalleryService.js'
import {withWeChatDeletion} from './wechat/WeChatDeletion.js'
import { createIndexedPreviewSource,rotatePng,exportLive } from './wechat/GalleryRuntime.mjs'
import {withWeChatInspiration} from './wechat/WeChatInspiration.js'
import {WeChatIconProvider,convertWeChatWebp,resizeWeChatIcon} from './wechat/WeChatIconProvider.js'
import { startupFailureRecord } from './desktop/StartupFailure.js'
import { GameVersionUpdateService } from './server/GameVersionUpdateService.js'
import { setRemoteGameVersionReleases as setGalleryGameVersionReleases } from './wechat/GalleryRuntime.mjs'
import { selectLanIpv4, listLanIpv4 } from './server/LanAddress.js'
import type { ScannerProgress } from './scanner/types.js'
import {ExtraScanDirectories,loadExtraScanDirectories,loadRetiredExtraDirectories} from './scanner/ExtraScanDirectories.js'
import {scanDiagnosticSummary} from './scanner/ScanDiagnostics.js'

let startupPhase: Parameters<typeof startupFailureRecord>[1] = 'configuration'

// Fixed at packaging time; both editions use the same database and Android protocol.
declare const NIKKISYNC_APP_ONLY: boolean
const wechatEnabled = typeof NIKKISYNC_APP_ONLY === 'undefined' || !NIKKISYNC_APP_ONLY

const APP_NAME = 'NikkiSync PC'
const APP_DATA = chooseWritableDataDirectory([
  path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'NikkiSync'),
  path.join(path.dirname(process.execPath), 'data'),
  path.join(process.cwd(), 'data')
], isWritableDataDirectory)
const DATABASE_FILE = path.join(APP_DATA, 'nikkisync.sqlite')
const METADATA_RESOLVER_CONFIG_FILE = path.join(APP_DATA, 'metadata-resolver.json')
const METADATA_DICTIONARY_FILE = path.join(APP_DATA, 'metadata-dictionary.json')
const METADATA_DICTIONARY_SUPPLEMENT_FILE = path.join(APP_DATA, 'metadata-dictionary-supplement.json')
const METADATA_DICTIONARY_REMOTE_CONFIG_FILE = path.join(APP_DATA, 'metadata-dictionary-remote.json')
const METADATA_THUMBNAIL_CACHE_DIR = path.join(APP_DATA, 'metadata-thumbnails')
const GAME_ROOT_CACHE_FILE = path.join(APP_DATA, 'game-install-root.txt')
const EXTRA_SCAN_DIRECTORIES_FILE=path.join(APP_DATA,'extra-scan-directories.json')

function readCachedGameRoot(): string | undefined {
  try {
    const value = readFileSync(GAME_ROOT_CACHE_FILE, 'utf8').trim()
    return value || undefined
  } catch {
    return undefined
  }
}

function currentPairingHost(): string {
  const host = selectLanIpv4()
  if (!host) throw new Error('未找到局域网 IPv4 地址。请连接可用的 Wi-Fi 或网线后重试。')
  return host
}

async function main(): Promise<void> {
  const startupBegin = performance.now()
  const milestones: Record<string, number> = {}
  let scanProgress: ScannerProgress | undefined
  let startupStage = 'configuration'
  let startupScanning = true
  const writeStartupTimings = (): void => {
    try {
      writeFileSync(path.join(APP_DATA, 'startup-service-timings.json'), JSON.stringify({
        build: '2026.10.21-scan-progress', timestamp: new Date().toISOString(), stage: startupStage, milestones,
        ...(scanProgress ? { scan: scanProgress } : {})
      }, null, 2), 'utf8')
    } catch { /* aggregate diagnostics are best effort */ }
  }
  const markStartup = (stage: string): void => {
    startupStage = stage
    milestones[stage] = Math.round(performance.now() - startupBegin)
    writeStartupTimings()
  }
  const memoryMaintenance = new RuntimeMemoryMaintenance()
  mkdirSync(APP_DATA, { recursive: true })
  markStartup('configuration')
  currentPairingHost()

  const resolverFile = loadMetadataResolverConfigFile(METADATA_RESOLVER_CONFIG_FILE)
  const invalidResolverFile = !resolverFile && existsSync(METADATA_RESOLVER_CONFIG_FILE)
  const metadataDictionary = loadMetadataDictionaryFile(METADATA_DICTIONARY_FILE)
  const metadataDictionarySupplement = clothingNameSupplement(loadMetadataDictionaryFile(METADATA_DICTIONARY_SUPPLEMENT_FILE))
  const metadataDictionaryRemoteConfig = loadMetadataDictionaryRemoteConfigFile(METADATA_DICTIONARY_REMOTE_CONFIG_FILE)
  const metadataDictionaryRemote = composeMetadataDictionaryProvider(metadataDictionaryRemoteConfig)
  const metadataDictionarySupplementRemote = composeMetadataDictionarySupplementProvider(metadataDictionaryRemoteConfig)
  const [installedIcons, filterIcons] = await Promise.all([
    loadLocalClothingIconPack(path.join(APP_DATA, 'clothing-icons')),
    loadLocalClothingIconPack(process.versions.bun
      ? path.join(path.dirname(process.execPath), 'photo-filter-icons')
      : path.join(import.meta.dirname, '..', '..', '..', '..', 'assets', 'photo-filter-icons'))
  ])
  const localClothingIcons = installedIcons && withLocalPhotoEffectIcons(installedIcons, filterIcons)
  if (localClothingIcons && !localClothingIcons.valid) {
    console.warn('[NikkiSync] 本地服装图标清单不可用，将显示占位图。')
  }
  const metadataThumbnailCache = localClothingIcons ? undefined : new MetadataThumbnailCache({ cacheDir: METADATA_THUMBNAIL_CACHE_DIR })
  const resizeIcon = (bytes: Uint8Array) => resizeWeChatIcon(bytes, process.versions.bun
    ? path.join(path.dirname(process.execPath),'wechat','resize-icon.ps1')
    : path.join(import.meta.dirname,'..','..','..','..','tools','wechat-gallery','resize-icon.ps1'))
  const wechatIcons=metadataThumbnailCache&&wechatEnabled ? new WeChatIconProvider(metadataThumbnailCache,resizeIcon) : undefined
  const cachedGameRoot = readCachedGameRoot()

  const environmentResolverConfig = process.env.NIKKISYNC_METADATA_RESOLVER_URL ? {
    endpoint: process.env.NIKKISYNC_METADATA_RESOLVER_URL,
    id: process.env.NIKKISYNC_METADATA_RESOLVER_ID ?? 'remote-json',
    ...(process.env.NIKKISYNC_METADATA_RESOLVER_VERSION
      ? { version: process.env.NIKKISYNC_METADATA_RESOLVER_VERSION }
      : {})
  } : undefined
  const configuredProviders=orderedMetadataProviderConfigs(resolverFile)
  const recipients=(configuredProviders.length?configuredProviders:environmentResolverConfig?[{...environmentResolverConfig,type:'remote-json'}]:[{type:'nuan5-compatible',endpoint:'https://nuan5.pro/api/decode-photo2'}])
    .map(provider=>({name:provider.type==='nuan5-compatible'?'NUAN5':'自定义参数解析服务',endpoint:provider.endpoint??'https://nuan5.pro/api/decode-photo2',fields:provider.type==='nuan5-compatible'?['游戏UID','原生编码参数','JPEG前缀MD5']:['游戏UID','原生编码参数或令牌','可选校验值','参数格式及长度']}))
  const onlineConsent=new MetadataOnlineConsent(path.join(APP_DATA,'metadata-online-consent.json'),recipients,invalidResolverFile||resolverFile?.enabled===false)
  const candidate=composeMetadataResolver({...resolverFile,enabled:true},environmentResolverConfig)
  const onlineResolver=candidate?onlineConsent.guard(candidate):undefined
  const localResolver = createLocalPhotoMetadataResolver(
    process.env.NIKKISYNC_RECYCLE_HELPER, path.dirname(process.execPath), onlineResolver, () => onlineConsent.enabled()
  )
  const nuan5Endpoints = recipients.filter(recipient => recipient.name === 'NUAN5').map(recipient => recipient.endpoint)
  const resolver = localResolver ?? (nuan5Endpoints.length === 0 ? onlineResolver : undefined)
  let metadataDiagnosticRevision: number | undefined

  startupPhase = 'database-and-tls'
  markStartup('database-and-tls')
  const initialExtraDirectories=loadExtraScanDirectories(EXTRA_SCAN_DIRECTORIES_FILE)
  let scanDirectories:ExtraScanDirectories|undefined
  const runtime: PcCompanionRuntime = new PcCompanionRuntime({
    onStartupStage: markStartup,
    databaseFile: DATABASE_FILE,
    remoteBridge: true,
    scanner: {
      allowMissingInstallation:true,
      extraDirectories:initialExtraDirectories,
      retiredExtraDirectories:loadRetiredExtraDirectories(EXTRA_SCAN_DIRECTORIES_FILE),
      onProgress: progress => {
        if (!startupScanning) return
        scanProgress = progress
        process.stdout.write(JSON.stringify({ type: 'nikkisync-startup-progress', ...progress }) + '\n')
        writeStartupTimings()
      },
      onSettled: () => { memoryMaintenance.schedule(); writeMetadataStatus();writeScanStatus() },
      ...(cachedGameRoot ? { cachedInstallRoot: cachedGameRoot } : {}),
      onDiscoveryComplete: report => {
        try { writeFileSync(path.join(APP_DATA, 'game-discovery.log'), JSON.stringify({ build: '2026.10.11-auto-discovery', ...report }, null, 2), 'utf8') } catch { /* best-effort diagnostics */ }
      }
    },
    ...(metadataDictionary ? { metadataDictionary } : {}),
    metadataDictionarySupplement,
    ...(metadataDictionarySupplementRemote ? { metadataDictionarySupplementRemote: {
      provider: metadataDictionarySupplementRemote,
      service: { onWorkSettled: () => memoryMaintenance.schedule(), ...(metadataDictionaryRemoteConfig?.gallery?.intervalMs === undefined ? {}
        : { intervalMs: metadataDictionaryRemoteConfig.gallery.intervalMs }) }
    } } : {}),
    ...(metadataDictionaryRemote ? {
      metadataDictionaryRemote: {
        provider: metadataDictionaryRemote,
        service: {
          enabled: true,
          onWorkSettled: () => memoryMaintenance.schedule(),
          ...(metadataDictionaryRemoteConfig?.provider?.intervalMs === undefined
            ? {}
            : { intervalMs: metadataDictionaryRemoteConfig.provider.intervalMs })
        }
      }
    } : {}),
    ...(resolver ? {
      metadataResolver: {
        resolver,
        service: {canResolve:()=>!!localResolver || onlineConsent.enabled(), onWorkSettled: () => { memoryMaintenance.schedule(); writeMetadataStatus() } }
      }
    } : {}),
    server: {
      accountSourceDirectories:()=>scanDirectories?.state().directories??initialExtraDirectories,
      host: process.env.NIKKISYNC_BIND ?? '0.0.0.0',
      port: Number(process.env.NIKKISYNC_PORT ?? 28080),
      mdns: process.env.NIKKISYNC_MDNS !== '0',
      connectionHosts: () => listLanIpv4(),
      name: APP_NAME,
      ...(metadataThumbnailCache ? { metadataThumbnailCache } : {}),
      ...(localClothingIcons ? { localClothingIcons } : {})
    }
  })
  function writeMetadataStatus(): void {
    try {
      const row = runtime.database.connection.prepare('SELECT library_revision FROM library_state WHERE id = 1').get() as { library_revision: number }
      if (metadataDiagnosticRevision === row.library_revision) return
      writeFileSync(path.join(APP_DATA, 'metadata-status.json'), JSON.stringify(metadataResolutionDiagnostics(runtime.database, onlineConsent.enabled()), null, 2), 'utf8')
      metadataDiagnosticRevision = row.library_revision
    } catch { /* best-effort aggregate diagnostics; never include raw data in a fallback */ }
  }
  const versionUpdates = new GameVersionUpdateService(runtime.database, { onCalendarChanged: setGalleryGameVersionReleases })
  function writeScanStatus():void{
    try{writeFileSync(path.join(APP_DATA,'scan-status.json'),JSON.stringify(scanDiagnosticSummary(runtime.scanner)), 'utf8')}
    catch{/* Diagnostics must never interrupt scanning or expose an error path. */}
  }
  startupPhase = 'scanner-and-lan'
  const started = await runtime.start()
  writeScanStatus()
  startupScanning = false
  writeMetadataStatus()
  const installRoot = runtime.scanner.getStatus().installation?.installRoot
  if (installRoot) {
    try { writeFileSync(GAME_ROOT_CACHE_FILE, `${installRoot}\n`, 'utf8') } catch { /* best-effort startup cache */ }
  }
  const status = new DesktopStatusService(runtime.database)
  const bundledFfmpeg = path.join(path.dirname(process.execPath), 'wechat', 'media', 'ffmpeg.exe')
  let galleryCacheSecret: string | undefined
  if (wechatEnabled) {
    const settings = new AppSettingsRepository(runtime.database)
    const stored = settings.get<string>('wechat.galleryCacheSecret')
    galleryCacheSecret = typeof stored === 'string' && /^[a-f0-9]{64}$/.test(stored) ? stored : randomBytes(32).toString('hex')
    if (stored !== galleryCacheSecret) settings.set('wechat.galleryCacheSecret', galleryCacheSecret)
  }
  const wechat = wechatEnabled ? new WeChatGalleryService({
    onWorkSettled: () => memoryMaintenance.schedule(),
    host: currentPairingHost,
    hosts: () => listLanIpv4(),
    qrSvg,
    snapshot: async () => withWeChatDeletion(withWeChatInspiration(await createIndexedPreviewSource(runtime.database, (await Promise.all(runtime.scanner.getScanRoots().map(async root=>{try{return await realpath(root)}catch{return undefined}}))).filter((root):root is string=>Boolean(root)), {
      reads: new SyncReadRepository(runtime.database, () => runtime.server.accounts.selection(), () => runtime.server.accounts.sourceGroups()),
      ...(galleryCacheSecret ? {cacheSecret:galleryCacheSecret} : {}),
      exportCopies: () => runtime.scanner.verifiedExportCopies(),
      ...(wechatIcons ? { loadIcon: descriptor => wechatIcons.get(descriptor) } : {}),
      ...(localClothingIcons ? { localClothingIcons,
        convertLocalWebp: bytes => !process.versions.bun || existsSync(bundledFfmpeg)
          ? convertWeChatWebp(bytes, process.versions.bun ? bundledFfmpeg : 'ffmpeg.exe').catch(() => resizeIcon(bytes))
          : resizeIcon(bytes)
      } : {}),
      ...(existsSync(bundledFfmpeg) ? { motionFfmpeg: bundledFfmpeg } : {}),
      exportLive:(jpeg,video,options)=>exportLive(jpeg,video,{...options,...(process.versions.bun?{ffmpeg:path.join(path.dirname(process.execPath),'wechat','media','ffmpeg.exe'),ffprobe:path.join(path.dirname(process.execPath),'wechat','media','ffprobe.exe')}:{})}),
      rotatePng:(bytes,rotation)=>rotatePng(bytes,rotation,process.versions.bun?path.join(path.dirname(process.execPath),'wechat','rotate-png.ps1'):path.join(import.meta.dirname,'..','..','..','..','tools','wechat-gallery','rotate-png.ps1')),
      resize: bytes => resizeForWeChat(bytes, process.versions.bun
        ? path.join(path.dirname(process.execPath), 'wechat', 'resize-preview.ps1')
        : path.join(import.meta.dirname, '..', '..', '..', '..', 'tools', 'wechat-gallery', 'resize-preview.ps1'))
    }),runtime.server.inspirations,bytes=>resizeForWeChat(bytes,process.versions.bun?path.join(path.dirname(process.execPath),'wechat','resize-preview.ps1'):path.join(import.meta.dirname,'..','..','..','..','tools','wechat-gallery','resize-preview.ps1'))),runtime.deletions)
  }) : undefined
  startupPhase = 'desktop-control'
  markStartup('desktop-control')
  scanDirectories=new ExtraScanDirectories(EXTRA_SCAN_DIRECTORIES_FILE,runtime.scanner,async()=>{await wechat?.stop()},()=>runtime.server.accounts.sourceDirectoriesChanged())
  const dashboard = createDesktopControlServer({
    inspirations:runtime.server.inspirations,
    accounts:runtime.server.accounts,
    deletions:runtime.deletions,
    scanDirectories,
    metadataPrivacy:{getState:()=>{
      const state = onlineConsent.state()
      const queueNotice = invalidResolverFile ? '在线解析配置无法读取，已暂停在线候补。请修正配置后重启电脑端。'
        : !resolver ? '本机缺少本地解码组件，在线候补不可用。'
        : state.enabled && nuan5Endpoints.length ? nuan5QueueStatus(runtime.database, nuan5Endpoints) : undefined
      return { ...state, available: !!resolver && !invalidResolverFile, ...(queueNotice ? { queueNotice } : {}) }
    },setEnabled:(enabled,version)=>{
      if (enabled && (!resolver || invalidResolverFile)) throw new Error('Online fallback is unavailable')
      if(enabled&&version!==onlineConsent.state().policyVersion)throw new Error('Current privacy policy must be accepted')
      if(!enabled){onlineConsent.setEnabled(false);if(!localResolver)runtime.metadataResolver?.stop()}
      const latest=loadMetadataResolverConfigFile(METADATA_RESOLVER_CONFIG_FILE)??resolverFile
      writeFileSync(METADATA_RESOLVER_CONFIG_FILE,JSON.stringify({...latest,enabled}),{encoding:'utf8',mode:0o600})
      runtime.metadataResolver?.reconsider()
      if(enabled){onlineConsent.setEnabled(true,version);runtime.metadataResolver?.start()}
      metadataDiagnosticRevision=undefined;writeMetadataStatus()
    }},
    legalDocuments:Object.fromEntries([['privacy','PRIVACY_POLICY.md'],['terms','USER_AGREEMENT.md'],['permissions','PERMISSIONS_DATA.md'],['services','SDK_SERVICES.md']].map(([name,file])=>[name,readFileSync(process.versions.bun?path.join(path.dirname(process.execPath),'legal',file!):path.join(import.meta.dirname,'..','..','..','..','docs','store-submission',file!),'utf8')])),
    getStatus: () => status.getStatus({ host: currentPairingHost(), port: started.server.port }),
    createPairingUri: () => runtime.createPairingUri(currentPairingHost(), undefined, listLanIpv4()),
    qrSvg,
    brandImage: readFileSync(process.versions.bun
      ? path.join(path.dirname(process.execPath), 'branding', 'momo-camera.png')
      : path.join(import.meta.dirname, '..', '..', '..', '..', 'assets', 'branding', 'momo-camera.png')),
    ...(wechat ? {wechatEntryImage:readFileSync(process.versions.bun
      ? path.join(path.dirname(process.execPath),'branding','wechat-mini-entry.png')
      : path.join(import.meta.dirname,'..','..','..','..','assets','branding','wechat-mini-entry.png')),wechatGallery: {
      start: () => wechat.start(),
      stop: () => wechat.stop(),
      status: () => wechat.status()
    }} : {})
  })
  await new Promise<void>((resolve, reject) => {
    dashboard.once('error', reject)
    dashboard.listen(Number(process.env.NIKKISYNC_DESKTOP_PORT ?? 0), '127.0.0.1', () => resolve())
  })
  const address = dashboard.address()
  if (!address || typeof address === 'string') throw new Error('无法启动本机配对页面')
  markStartup('dashboard-ready')
  versionUpdates.start()
  const shutdown = async () => {
    onlineConsent.abortPending()
    versionUpdates.stop()
    memoryMaintenance.stop()
    await wechat?.stop()
    await new Promise<void>((resolve) => dashboard.close(() => resolve()))
    await runtime.stop()
  }
  process.once('SIGINT', () => { void shutdown().finally(() => process.exit(0)) })
  process.once('SIGTERM', () => { void shutdown().finally(() => process.exit(0)) })
}

main().catch((error) => {
  const report = JSON.stringify({ timestamp: new Date().toISOString(), ...startupFailureRecord(error, startupPhase) })
  try {
    mkdirSync(APP_DATA, { recursive: true })
    writeFileSync(path.join(APP_DATA, 'startup-error.log'), report + '\n')
  } catch { /* best-effort startup diagnostics for a consoleless executable */ }
  console.error(report)
  process.exit(1)
})
