import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const required = [
  'settings.gradle.kts',
  'build.gradle.kts',
  'app/build.gradle.kts',
  'app/src/main/AndroidManifest.xml',
  'app/src/main/java/app/nikkisync/mobile/MainActivity.java',
  'app/src/main/java/app/nikkisync/mobile/PairQrScannerActivity.java',
  'app/src/main/java/app/nikkisync/mobile/model/Models.java',
  'app/src/main/java/app/nikkisync/mobile/protocol/JsonCodec.java',
  'app/src/main/java/app/nikkisync/mobile/ui/GalleryAdapter.java',
  'app/src/main/java/app/nikkisync/mobile/ui/GalleryUxStyle.java',
  'app/src/main/java/app/nikkisync/mobile/ui/GalleryVersionGroups.java',
  'app/src/main/java/app/nikkisync/mobile/ui/SuitSearchDialog.java',
  'app/src/main/java/app/nikkisync/mobile/ui/SuitSearchGrid.java',
  'app/src/main/java/app/nikkisync/mobile/ui/SuitSearchHistory.java',
  'app/src/main/res/drawable/bg_glass_card.xml',
  'app/src/main/res/drawable/bg_glass_chip.xml',
  'app/src/main/res/drawable/bg_selected_glass.xml',
  'app/src/main/res/drawable/bg_gallery_photo.xml',
  'app/src/main/res/drawable/bg_suit_coverage_track.xml',
  'app/src/main/res/drawable/bg_suit_coverage_fill.xml',
  'app/src/main/res/values/dimens_gallery_ux.xml',
  'app/src/main/java/app/nikkisync/mobile/net/NikkiSyncClient.java',
  'app/src/main/java/app/nikkisync/mobile/net/SignedHttpClient.java',
  'app/src/main/java/app/nikkisync/mobile/net/RealtimeWebSocket.java',
  'app/src/main/java/app/nikkisync/mobile/net/NsdDiscovery.java',
  'app/src/main/java/app/nikkisync/mobile/security/DeviceIdentity.java',
  'app/src/main/java/app/nikkisync/mobile/security/PinnedTls.java',
  'app/src/main/java/app/nikkisync/mobile/media/ImageLoader.java',
  'app/src/main/java/app/nikkisync/mobile/media/OriginalSaver.java',
  'app/src/main/java/app/nikkisync/mobile/media/MotionPhotoSaver.java',
  'app/src/main/java/app/nikkisync/mobile/media/OppoLivePhotoSaver.java',
  'app/src/main/java/app/nikkisync/mobile/media/SamsungMotionPhotoSaver.java',
  'app/src/main/java/app/nikkisync/mobile/media/VivoLivePhotoSaver.java',
  'app/src/main/java/app/nikkisync/mobile/media/HuaweiMovingPhotoSaver.java'
]

function text(relative) { return readFileSync(path.join(root, relative), 'utf8') }
function expect(value, message) { if (!value) throw new Error(message) }

for (const relative of required) expect(existsSync(path.join(root, relative)), `missing M2 source: ${relative}`)

const manifest = text('app/src/main/AndroidManifest.xml')
expect(manifest.includes('android:usesCleartextTraffic="false"'), 'cleartext transport must stay disabled')
expect(manifest.includes('android:scheme="nikki-sync"'), 'pairing deep link is missing')
expect(manifest.includes('android.permission.NEARBY_WIFI_DEVICES'), 'nearby Wi-Fi permission is missing')
expect(manifest.includes('android.permission.CAMERA'), 'in-app pairing scanner camera permission is missing')

const scanner = text('app/src/main/java/app/nikkisync/mobile/PairQrScannerActivity.java')
expect(scanner.includes('nikki-sync://pair?'), 'in-app QR scanner must accept NikkiSync pairing QR data')
expect(scanner.includes('DecoratedBarcodeView'), 'in-app production barcode scanner is missing')

const pairing = text('app/src/main/java/app/nikkisync/mobile/protocol/PairingUri.java')
for (const key of ['serverId', 'host', 'port', 'token', 'protocol', 'expiresAt', 'tls']) {
  expect(pairing.includes(`"${key}"`), `pairing URI field missing: ${key}`)
}

const models = text('app/src/main/java/app/nikkisync/mobile/model/Models.java')
expect(models.includes('gameVersion') && models.includes('gameVersionSource'), 'M2.3.1 AssetSummary game-version fields are missing')

const jsonCodec = text('app/src/main/java/app/nikkisync/mobile/protocol/JsonCodec.java')
expect(jsonCodec.includes('optionalString(row, "gameVersion")'), 'M2.3.1 gameVersion JSON parsing is missing')
expect(jsonCodec.includes('optionalString(row, "gameVersionSource")'), 'M2.3.1 gameVersionSource JSON parsing is missing')
expect(jsonCodec.includes('gameVersionSource = "unknown"'), 'legacy clients must default missing game-version provenance to unknown')

const versionGroups = text('app/src/main/java/app/nikkisync/mobile/ui/GalleryVersionGroups.java')
expect(versionGroups.includes('版本未知'), 'M2.3.1 unknown-version bucket is missing')
expect(versionGroups.includes('compareSemanticVersions'), 'M2.3.1 semantic-version ordering is missing')
expect(versionGroups.includes('gameVersionSource'), 'M2.3.1 grouping must retain version provenance')
expect(versionGroups.includes('allMatch'), 'M2.3.1 inferred label must only apply when the whole group is inferred')

const galleryAdapter = text('app/src/main/java/app/nikkisync/mobile/ui/GalleryAdapter.java')
expect(galleryAdapter.includes('RecyclerView.Adapter'), 'M2.3.1 gallery must use the recyclable sectioned list implementation')
expect(galleryAdapter.includes('GalleryVersionGroups.group'), 'M2.3.1 adapter must render version groups')
expect(galleryAdapter.includes('TYPE_HEADER') && galleryAdapter.includes('TYPE_PHOTO'), 'M2.3.1 section header/photo row types are missing')
expect(galleryAdapter.includes('GalleryUxStyle.glassCard'), 'M2.3.2 version headers must use the shared glass card style')
expect(galleryAdapter.includes('GalleryUxStyle.glassChip'), 'M2.3.2 gallery badges must use the shared glass chip style')
expect(galleryAdapter.includes('selectedOverlay'), 'M2.3.2 selection state must use a visible overlay instead of dimming the whole cell')
expect(galleryAdapter.includes('setClipToOutline(true)'), 'M2.3.2 thumbnails must keep rounded clipping')
expect(!galleryAdapter.includes('setAlpha(isSelected ? 0.72f'), 'M2.3.2 selection must not dim the photo itself')

const galleryUxStyle = text('app/src/main/java/app/nikkisync/mobile/ui/GalleryUxStyle.java')
expect(galleryUxStyle.includes('bg_glass_card'), 'M2.3.2 shared glass card resource is not wired')
expect(galleryUxStyle.includes('bg_glass_chip'), 'M2.3.2 shared glass chip resource is not wired')
expect(galleryUxStyle.includes('bg_selected_glass'), 'M2.3.2 selected overlay resource is not wired')

const auth = text('app/src/main/java/app/nikkisync/mobile/net/SignedHttpClient.java')
for (const header of ['X-NikkiSync-Device-Id', 'X-NikkiSync-Timestamp', 'X-NikkiSync-Nonce', 'X-NikkiSync-Signature']) {
  expect(auth.includes(header), `signed request header missing: ${header}`)
}
expect(auth.includes('SHA-256'), 'signed request body hash is missing')

const tls = text('app/src/main/java/app/nikkisync/mobile/security/PinnedTls.java')
expect(tls.includes('fingerprint mismatch'), 'TLS fingerprint enforcement is missing')

const identity = text('app/src/main/java/app/nikkisync/mobile/security/DeviceIdentity.java')
expect(identity.includes('KeyPermanentlyInvalidatedException'), 'Android Keystore invalidation recovery is missing')
expect(identity.includes('resetWrappingKeyAndBlobs'), 'invalid wrapping-key reset path is missing')
expect(identity.includes('new ServerStore(context).clear()'), 'stale pairing credentials must be cleared after identity recovery')

const nsd = text('app/src/main/java/app/nikkisync/mobile/net/NsdDiscovery.java')
expect(nsd.includes('_nikkisync._tcp.'), 'mDNS service type is missing')
expect(nsd.includes('serverId'), 'mDNS server identity matching is missing')

const websocket = text('app/src/main/java/app/nikkisync/mobile/net/RealtimeWebSocket.java')
expect(websocket.includes('/ws/v1'), 'WebSocket v1 route is missing')

const saver = text('app/src/main/java/app/nikkisync/mobile/media/OriginalSaver.java')
expect(saver.includes('X-NikkiSync-SHA256'), 'original download hash verification is missing')
expect(saver.includes('MediaStore.Images'), 'MediaStore original export is missing')
expect(saver.includes('IS_PENDING'), 'atomic MediaStore write is missing')
expect(saver.includes('rotationDegrees'), 'ordinary-photo export must accept the selected rotation')
expect(saver.includes('ExifInterface.ORIENTATION_ROTATE_90'), '90-degree JPEG orientation export is missing')
expect(saver.includes('ExifInterface.ORIENTATION_ROTATE_180'), '180-degree JPEG orientation export is missing')
expect(saver.includes('ExifInterface.ORIENTATION_ROTATE_270'), '270-degree JPEG orientation export is missing')

const motionSaver = text('app/src/main/java/app/nikkisync/mobile/media/MotionPhotoSaver.java')
expect(motionSaver.includes('Camera:MotionPhoto'), 'Motion Photo camera XMP metadata is missing')
expect(motionSaver.includes('Item:Semantic=\\"MotionPhoto\\"'), 'Motion Photo container directory is missing')
expect(motionSaver.includes('video/mp4'), 'Motion Photo MP4 item is missing')

const mainActivity = text('app/src/main/java/app/nikkisync/mobile/MainActivity.java')
expect(mainActivity.includes('编辑照片参数'), 'M4 metadata editor UI is missing')
expect(mainActivity.includes('nativeParamToken'), 'M4 native Infinity Nikki parameter-token status is missing')
expect(mainActivity.includes('解析中') && mainActivity.includes('解析失败'), 'resolver status visibility is missing')
expect(mainActivity.includes('滤镜') && mainActivity.includes('光照'), 'canonical filter/lighting summary is missing')
expect(mainActivity.includes('renderClothingSection'), 'M4.2.8 clothing detail renderer is missing')
expect(mainActivity.includes('穿搭 · '), 'M4.2.8 clothing section heading is missing')
expect(mainActivity.includes('baseMakeup') && mainActivity.includes('底妆'), 'M4.2.8 clothing category labels are missing')
expect(mainActivity.includes('new ScrollView(this)'), 'photo detail must remain scrollable when clothing rows are present')
expect(mainActivity.includes('rotationByAssetId'), 'ordinary-photo rotation state must survive until batch save')
expect(mainActivity.includes('左转 90°') && mainActivity.includes('右转 90°'), 'photo viewer rotation controls are missing')
expect(mainActivity.includes('asset.hasMotion()'), 'rotation UI must keep Live Photo separate from ordinary JPEG export')
expect(mainActivity.includes('originalSaver.save(this, current, asset, rotationDegrees)'), 'selected ordinary-photo rotation is not wired into export')
expect(mainActivity.includes('"图库"') && mainActivity.includes('"已保存"') && mainActivity.includes('"我的"'), 'M2.3.1 three-tab bottom navigation is missing')
expect(mainActivity.includes('"暖暖相册"'), 'M2.3.2 gallery shell title is missing')
expect(mainActivity.includes('bg_glass_card') && mainActivity.includes('bg_glass_chip'), 'M2.3.2 shell glass styling is missing')
expect(mainActivity.includes('"已同步 "'), 'M2.3.2 gallery sync-count copy is missing')
expect(mainActivity.includes('SuitSearchDialog.show'), 'M2.3.3 gallery suit-search entry is missing')
expect(mainActivity.includes('"搜索套装"'), 'M2.3.3 suit-search copy is missing')
expect(mainActivity.includes('GridLayoutManager') && mainActivity.includes('adapter.isHeader(position) ? 3 : 1'), 'M2.3.1 full-width RecyclerView version headers are missing')
expect(mainActivity.includes('二次修改') && mainActivity.includes('散件') && mainActivity.includes('套装'), 'M2.3 future Saved/My capability reservations are missing from UX placeholders')

const client = text('app/src/main/java/app/nikkisync/mobile/net/NikkiSyncClient.java')
expect(client.includes('PATCH'), 'M4 signed metadata update request is missing')
expect(client.includes('/metadata'), 'M4 metadata route is missing')
expect(client.includes('/clothing/'), 'M4.2.8 clothing thumbnail must be requested through the paired PC')
expect(client.includes('/v1/search/suits?q='), 'M2.3.3 suit search must use the paired PC search endpoint')

const suitSearchDialog = text('app/src/main/java/app/nikkisync/mobile/ui/SuitSearchDialog.java')
expect(suitSearchDialog.includes('observedPartCount') && suitSearchDialog.includes('totalPartCount'), 'M2.3.3 suit coverage summary is missing')
expect(suitSearchDialog.includes('"图库覆盖 "'), 'M2.3.3 suit coverage percentage is missing')
expect(suitSearchDialog.includes('bg_suit_coverage_track') && suitSearchDialog.includes('bg_suit_coverage_fill'), 'M2.3.3 suit coverage bar is missing')
expect(suitSearchDialog.includes('matchedParts'), 'M2.3.3 search results must expose matched suit parts')
expect(suitSearchDialog.includes('"最近搜索"') && suitSearchDialog.includes('SuitSearchHistory.record'), 'M2.3.3 recent suit search UX is missing')

const suitSearchHistory = text('app/src/main/java/app/nikkisync/mobile/ui/SuitSearchHistory.java')
expect(suitSearchHistory.includes('LIMIT = 5'), 'M2.3.3 recent suit search history must stay bounded')
expect(suitSearchHistory.includes('SharedPreferences'), 'M2.3.3 recent suit searches must persist locally')

const suitSearchGrid = text('app/src/main/java/app/nikkisync/mobile/ui/SuitSearchGrid.java')
expect(suitSearchGrid.includes('for (int column = 0; column < 3; column++)'), 'M2.3.3 suit results must use a three-column album grid')
expect(suitSearchGrid.includes('"全部 " + item.photoCount()'), 'M2.3.3 suit results must provide an all-photo filter')
expect(suitSearchGrid.includes('countCategories') && suitSearchGrid.includes('hasCategory'), 'M2.3.3 suit results must support part/category filtering')
expect(suitSearchGrid.includes('compactPartText'), 'M2.3.3 photo cells must label matched suit slots')
expect(suitSearchGrid.includes('"LIVE"'), 'M2.3.3 search grid must retain Live Photo visibility')
expect(suitSearchGrid.includes('CATEGORY_ORDER'), 'M2.3.3 part filters must use a stable Infinity Nikki slot order')

const imageLoader = text('app/src/main/java/app/nikkisync/mobile/media/ImageLoader.java')
expect(imageLoader.includes('loadClothingThumbnail'), 'M4.2.8 clothing thumbnail loader is missing')
expect(imageLoader.includes('showClothingPlaceholder'), 'missing clothing thumbnails must degrade to a visible placeholder instead of a blank tile')
expect(!imageLoader.includes('https://images.'), 'mobile image loader must not embed a third-party clothing image host')

const huaweiSaver = text('app/src/main/java/app/nikkisync/mobile/media/HuaweiMovingPhotoSaver.java')
expect(huaweiSaver.includes('Environment.DIRECTORY_DCIM + "/Camera"'), 'Huawei adapter must publish to Camera')
expect(huaweiSaver.includes('copy(video, output)'), 'Huawei adapter must append the MP4 payload')

const allJava = required.filter((x) => x.endsWith('.java')).map(text).join('\n').toLowerCase()
for (const forbidden of ['firebase', 'retrofit', 'okhttp', 'cloudinary', 's3.amazonaws']) {
  expect(!allJava.includes(forbidden), `M2 local-only mobile unexpectedly references ${forbidden}`)
}

console.log('M2 mobile source contract: OK')
console.log(`validated files: ${required.length}`)
console.log('transport: pinned HTTPS + Ed25519 signed requests + mDNS + WebSocket')
console.log('original export: MediaStore + SHA-256 verification + selected JPEG rotation')
console.log('clothing detail: canonical metadata + paired-PC thumbnail proxy + visible fallback')
console.log('M2.3.1 UX: three-tab shell + RecyclerView version-first gallery contract')
console.log('M2.3.2 UX: glass shell + rounded thumbnails + non-dimming selection contract')
console.log('M2.3.3 search: relevance-ranked lookup + coverage + filters + bounded recent-query history')
