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

const client = text('app/src/main/java/app/nikkisync/mobile/net/NikkiSyncClient.java')
expect(client.includes('PATCH'), 'M4 signed metadata update request is missing')
expect(client.includes('/metadata'), 'M4 metadata route is missing')
expect(client.includes('/clothing/'), 'M4.2.8 clothing thumbnail must be requested through the paired PC')

const imageLoader = text('app/src/main/java/app/nikkisync/mobile/media/ImageLoader.java')
expect(imageLoader.includes('loadClothingThumbnail'), 'M4.2.8 clothing thumbnail loader is missing')
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
console.log('original export: MediaStore + SHA-256 verification')
console.log('clothing detail: canonical metadata + paired-PC thumbnail proxy')
