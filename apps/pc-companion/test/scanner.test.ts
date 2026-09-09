import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { DatabaseManager } from '@nikkisync/database'
import { FileStabilityGuard } from '../src/scanner/FileStabilityGuard.js'
import { ResourceClassifier } from '../src/scanner/ResourceClassifier.js'
import { ScannerService } from '../src/scanner/ScannerService.js'
import { ScannerWatcher } from '../src/scanner/ScannerWatcher.js'

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nikkisync-scanner-'))
  const game = path.join(root, 'InfinityNikki'); const photos = path.join(game, 'X6Game', 'Saved', 'GamePlayPhotos'); const uid = path.join(photos, '10001')
  await mkdir(path.join(game, 'X6Game'), { recursive: true }); await writeFile(path.join(game, 'InfinityNikki.exe'), '')
  await mkdir(path.join(uid, 'NikkiPhotos_HighQuality'), { recursive: true }); await mkdir(path.join(uid, 'NikkiPhotos_LowQuality'), { recursive: true }); await mkdir(path.join(uid, 'Videos'), { recursive: true })
  return { root, game, photos, uid }
}

test('classifier separates HQ/LQ, motion bundle, binary and pending files', async () => {
  const f = await fixture(); const classifier = new ResourceClassifier()
  const hq = await classifier.classify(path.join(f.uid, 'NikkiPhotos_HighQuality', 'A.jpg'), f.photos).catch(() => undefined)
  assert.equal(hq, undefined) // file does not exist: classifier never invents resources
  await writeFile(path.join(f.uid, 'NikkiPhotos_HighQuality', 'A.jpg'), 'hq')
  await writeFile(path.join(f.uid, 'NikkiPhotos_LowQuality', 'A.jpg'), 'lq')
  await writeFile(path.join(f.uid, 'Videos', 'C_cover.jpeg'), 'cover')
  await writeFile(path.join(f.uid, 'Videos', 'C.mp4'), 'video')
  await writeFile(path.join(f.uid, 'DIY.bin'), 'binary')
  assert.equal((await classifier.classify(path.join(f.uid, 'NikkiPhotos_HighQuality', 'A.jpg'), f.photos)).kind, 'high_quality')
  assert.equal((await classifier.classify(path.join(f.uid, 'NikkiPhotos_LowQuality', 'A.jpg'), f.photos)).kind, 'low_quality')
  assert.equal((await classifier.classify(path.join(f.uid, 'Videos', 'C_cover.jpeg'), f.photos)).kind, 'motion_cover')
  assert.equal((await classifier.classify(path.join(f.uid, 'Videos', 'C.mp4'), f.photos)).kind, 'motion_video')
  assert.equal((await classifier.classify(path.join(f.uid, 'DIY.bin'), f.photos)).kind, 'binary_companion')
  await rm(f.root, { recursive: true, force: true })
})

test('classifier extracts Infinity Nikki payload envelope and trailing token', async () => {
  const f = await fixture(); const classifier = new ResourceClassifier()
  const target = path.join(f.uid, 'NikkiPhotos_HighQuality', 'Params.jpeg')
  const payload = Buffer.from('parameter-envelope-data').toString('base64')
  const token = Buffer.alloc(32, 7).toString('base64')
  await writeFile(target, Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
    Buffer.from(payload, 'ascii'),
    Buffer.from([0xff, 0xd9]),
    Buffer.from(token, 'ascii')
  ]))
  const resource = await classifier.classify(target, f.photos)
  assert.equal(resource.nativeParamPayload, payload)
  assert.equal(resource.nativeParamToken, token)
  await rm(f.root, { recursive: true, force: true })
})

test('classifier derives NUAN5 MD5 from local JPEG bytes before the final EOI', async () => {
  const f = await fixture(); const classifier = new ResourceClassifier()
  const target = path.join(f.uid, 'NikkiPhotos_HighQuality', 'Nuan5.jpeg')
  const payload = Buffer.from('parameter-envelope-data').toString('base64')
  const token = Buffer.alloc(32, 9).toString('base64')
  const prefix = Buffer.from([0xff, 0xd8, 0x12, 0x34, 0xff, 0xd9])
  await writeFile(target, Buffer.concat([prefix, Buffer.from(payload, 'ascii'), Buffer.from([0xff, 0xd9]), Buffer.from(token, 'ascii')]))
  const resource = await classifier.classify(target, f.photos)
  assert.equal(resource.nativeParamNuan5Md5, createHash('md5').update(Buffer.concat([prefix, Buffer.from(payload, 'ascii')])).digest('hex'))
  await rm(f.root, { recursive: true, force: true })
})

test('classifier extracts the 2.9 trailer token and payload before the versioned suffix', async () => {
  const f = await fixture(); const classifier = new ResourceClassifier()
  const target = path.join(f.uid, 'NikkiPhotos_HighQuality', 'Nuan5-v29.jpeg')
  const payload = Buffer.from('parameter-envelope-data-v29').toString('base64')
  const token = Buffer.alloc(32, 11).toString('base64')
  const prefix = Buffer.from([0xff, 0xd8, 0x12, 0x34, 0xff, 0xd9])
  const suffix = Buffer.from('[V2]0000038', 'ascii')
  const hashWindow = Buffer.concat([prefix, Buffer.from(payload, 'ascii')]).subarray(-38)
  await writeFile(target, Buffer.concat([
    prefix, Buffer.from(payload, 'ascii'), Buffer.from([0xff, 0xd9]), Buffer.from(token, 'ascii'), suffix
  ]))
  const resource = await classifier.classify(target, f.photos)
  assert.equal(resource.nativeParamPayload, payload)
  assert.equal(resource.nativeParamToken, token)
  assert.equal(resource.nativeParamNuan5Md5, createHash('md5').update(hashWindow).digest('hex'))
  await rm(f.root, { recursive: true, force: true })
})

test('scanner persists the local NUAN5 MD5 without persisting source bytes', async () => {
  const f = await fixture()
  const target = path.join(f.uid, 'NikkiPhotos_HighQuality', 'Persisted.jpeg')
  const payload = Buffer.from('parameter-envelope-data').toString('base64')
  const token = Buffer.alloc(32, 3).toString('base64')
  const prefix = Buffer.from([0xff, 0xd8, 0xaa, 0xbb, 0xff, 0xd9])
  await writeFile(target, Buffer.concat([prefix, Buffer.from(payload, 'ascii'), Buffer.from([0xff, 0xd9]), Buffer.from(token, 'ascii')]))
  const database = new DatabaseManager(':memory:'); database.initialize()
  const scanner = new ScannerService(database, { startingPaths: [f.game], runningExecutablePaths: [], watcher: false, stability: { pollIntervalMs: 0, stableChecks: 1, maxWaitMs: 1000 } })
  await scanner.start()
  const row = database.connection.prepare('SELECT metadata_json FROM assets WHERE uid = ?').get('10001') as { metadata_json: string }
  const raw = JSON.parse(row.metadata_json).raw as Record<string, unknown>
  assert.equal(raw.nativeParamNuan5Md5, createHash('md5').update(Buffer.concat([prefix, Buffer.from(payload, 'ascii')])).digest('hex'))
  assert.equal('nativeParamSourceBytes' in raw, false)
  database.close(); await rm(f.root, { recursive: true, force: true })
})

test('file stability guard waits for stable readable content', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nikkisync-stable-')); const target = path.join(dir, 'x.jpg')
  await writeFile(target, 'a')
  const guard = new FileStabilityGuard({ pollIntervalMs: 1, stableChecks: 2, maxWaitMs: 1000 })
  const info = await guard.waitForStable(target); assert.equal(info.size, 1)
  await rm(dir, { recursive: true, force: true })
})

test('scanner cold scan is idempotent and deletion is journaled', async () => {
  const f = await fixture(); const hqDir = path.join(f.uid, 'NikkiPhotos_HighQuality'); const lqDir = path.join(f.uid, 'NikkiPhotos_LowQuality'); const videoDir = path.join(f.uid, 'Videos')
  await writeFile(path.join(hqDir, 'A.jpg'), 'hq-a'); await writeFile(path.join(lqDir, 'A.jpg'), 'lq-a'); await writeFile(path.join(hqDir, 'B.jpg'), 'hq-b'); await writeFile(path.join(videoDir, 'C_cover.jpeg'), 'cover'); await writeFile(path.join(videoDir, 'C.mp4'), 'video'); await writeFile(path.join(f.uid, 'DIY.bin'), 'ignore')
  const database = new DatabaseManager(); database.initialize()
  const scanner = new ScannerService(database, { startingPaths: [f.game], runningExecutablePaths: [], watcher: false, stability: { pollIntervalMs: 0, stableChecks: 1, maxWaitMs: 1000 } })
  const first = await scanner.start(); assert.equal(first.assetsCreated, 3); assert.equal(first.resourcesAccepted, 5); assert.equal(first.resourcesIgnored, 1)
  const second = await scanner.fullScan(); assert.equal(second.assetsCreated, 0); assert.equal(second.assetsUpdated, 0); assert.equal(second.journalRevisions.length, 0)
  await rm(path.join(hqDir, 'B.jpg'))
  const third = await scanner.fullScan(); assert.equal(third.assetsDeleted, 1); assert.equal(database.connection.prepare("SELECT COUNT(*) AS c FROM assets WHERE asset_state='deleted'").get()?.c, 1)
  await scanner.stop(); database.close(); await rm(f.root, { recursive: true, force: true })
})

test('watcher debounces duplicate events by canonical path', async () => {
  const watcher = new ScannerWatcher(5); const seen: string[] = []
  watcher.start([], (event) => seen.push(event.path)); const p = path.join(os.tmpdir(), 'nikkisync-duplicate.jpg')
  watcher.push({ type: 'change', path: p }); watcher.push({ type: 'change', path: p }); await new Promise((resolve) => setTimeout(resolve, 20)); watcher.stop()
  assert.equal(seen.length, 1)
})

test('arrival order and UID isolation keep deterministic asset identity', async () => {
  const f = await fixture(); const hq = path.join(f.uid, 'NikkiPhotos_HighQuality', 'Same.jpg'); const lq = path.join(f.uid, 'NikkiPhotos_LowQuality', 'Same.jpg'); const cover = path.join(f.uid, 'Videos', 'Live_cover.jpeg'); const video = path.join(f.uid, 'Videos', 'Live.mp4')
  const otherUid = path.join(f.photos, '20002', 'NikkiPhotos_HighQuality'); await mkdir(otherUid, { recursive: true })
  await writeFile(lq, 'lq'); await writeFile(path.join(otherUid, 'Same.jpg'), 'other')
  const database = new DatabaseManager(); database.initialize(); const scanner = new ScannerService(database, { startingPaths: [f.game], runningExecutablePaths: [], watcher: false, stability: { pollIntervalMs: 0, stableChecks: 1, maxWaitMs: 1000 } })
  assert.equal((await scanner.start()).assetsCreated, 1)
  await writeFile(hq, 'hq'); await writeFile(video, 'video'); assert.equal((await scanner.fullScan()).assetsCreated, 1)
  await writeFile(cover, 'cover'); const final = await scanner.fullScan(); assert.equal(final.assetsCreated, 1)
  assert.equal(database.connection.prepare('SELECT COUNT(*) AS c FROM assets').get()?.c, 3)
  const ids = (database.connection.prepare('SELECT asset_id FROM assets ORDER BY asset_id').all() as Array<{ asset_id: string }>).map((row) => row.asset_id)
  assert.equal(new Set(ids).size, 3); await scanner.stop(); database.close(); await rm(f.root, { recursive: true, force: true })
})
