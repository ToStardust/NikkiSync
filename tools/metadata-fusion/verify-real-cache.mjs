import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { DatabaseManager, AssetRepository } from '../../packages/database/dist/src/index.js'
import { MetadataDictionaryService } from '../../apps/pc-companion/dist/src/metadata/MetadataDictionaryService.js'
import { MetadataDictionaryUpdateService } from '../../apps/pc-companion/dist/src/metadata/MetadataDictionaryUpdateService.js'
import { NikkiAlbumsMetadataDictionaryProvider } from '../../apps/pc-companion/dist/src/metadata/NikkiAlbumsMetadataDictionaryProvider.js'
import { NikkiGalleryMetadataDictionaryProvider } from '../../apps/pc-companion/dist/src/metadata/NikkiGalleryMetadataDictionaryProvider.js'
import { CachedDecodedMetadataService } from '../../apps/pc-companion/dist/src/metadata/CachedDecodedMetadataService.js'
import { clothingNameSupplement } from '../../apps/pc-companion/dist/src/metadata/VerifiedClothingNames.js'

const source = process.argv[2], output = process.argv[3]
if (!source || !output) throw new Error('Usage: verify-real-cache.mjs <read-only source database> <new diagnostic directory>')
if (fs.existsSync(output)) throw new Error('Choose a new directory')
fs.mkdirSync(output, { recursive: true })
const copied = path.join(output, 'verification.sqlite')
const state = file => { try { const s = fs.statSync(file); return `${s.size}:${s.mtimeMs}` } catch { return '' } }
let stable = false
for (let attempt = 0; attempt < 3; attempt++) {
  const before = [state(source), state(source + '-wal')]
  fs.copyFileSync(source, copied)
  if (before[1]) fs.copyFileSync(source + '-wal', copied + '-wal')
  else if (fs.existsSync(copied + '-wal')) fs.unlinkSync(copied + '-wal')
  if (before[0] === state(source) && before[1] === state(source + '-wal')) { stable = true; break }
}
if (!stable) throw new Error('Source changed during capture; retry while PC is idle')
const db = new DatabaseManager(copied)
function count(rows) {
  const metadata = rows.filter(r => r.metadata_json).map(r => JSON.parse(r.metadata_json))
  const result = { assets: rows.length, camera: metadata.filter(m => Object.keys(m.camera ?? {}).length).length }
  for (const key of ['pose', 'filter', 'lighting']) result[key] = { present: metadata.filter(m => m[key]).length,
    named: metadata.filter(m => m[key]?.name).length }
  result.eureka = metadata.filter(m => m.dressing?.eureka?.length).length
  result.interactions = metadata.filter(m => m.interactions?.length).length
  result.cameraRotation = metadata.filter(m => typeof m.camera?.rotation === 'number').length
  result.clothingItems = metadata.flatMap(m => m.dressing?.clothes ?? []).length
  return result
}
try {
  db.initialize()
  assert.equal(db.connection.prepare('PRAGMA quick_check').get().quick_check, 'ok')
  const assets = new AssetRepository(db), before = assets.list()
  const sourceCounts = count(before)
  const dictionary = new MetadataDictionaryService(db, clothingNameSupplement())
  const migrated = new CachedDecodedMetadataService(db, dictionary).runOnce()
  const primary = await new MetadataDictionaryUpdateService(db, dictionary, new NikkiAlbumsMetadataDictionaryProvider()).runOnce()
  const secondary = await new MetadataDictionaryUpdateService(db, dictionary, new NikkiGalleryMetadataDictionaryProvider(), { mode: 'supplement' }).runOnce()
  assert.notEqual(primary.status, 'failed', 'public primary dictionary failed')
  assert.notEqual(secondary.status, 'failed', 'public action dictionary failed')
  const after = assets.list(), byId = new Map(after.map(r => [r.asset_id, r]))
  assert.equal(after.length, before.length)
  let preservedClothing = 0
  for (const old of before) {
    const next = byId.get(old.asset_id)
    if (!old.metadata_json) continue
    const a = JSON.parse(old.metadata_json), b = JSON.parse(next.metadata_json)
    for (const [key, value] of Object.entries(a.camera ?? {})) assert.deepEqual(b.camera[key], value, `existing camera ${key}`)
    for (const key of ['nativeParamToken', 'nativeParamPayload', 'nativeParamNuan5Md5']) {
      if (a.raw?.[key] !== undefined) assert.equal(b.raw[key], a.raw[key], 'native input retained')
    }
    const clothes = b.dressing?.clothes ?? []
    for (const item of a.dressing?.clothes ?? []) {
      const found = clothes.find(v => String(v.id) === String(item.id))
      for (const key of ['name', 'category', 'thumbnail', 'thumbnailFallbacks', 'suitId', 'suitName']) {
        if (item[key] !== undefined) assert.deepEqual(found[key], item[key], 'existing clothing field retained')
      }
      preservedClothing++
    }
  }
  assert.equal(new CachedDecodedMetadataService(db, dictionary).runOnce(), 0)
  const report = { schemaVersion: 1, mode: 'private-database-copy', sourceDatabaseModified: false,
    before: sourceCounts, after: count(after), migrated, preservedClothing,
    dictionaryKinds: db.connection.prepare('SELECT kind, COUNT(*) AS count FROM metadata_dictionary_entries GROUP BY kind').all(),
    idempotent: true, phoneVerified: false, galleryExecutableModified: false }
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  db.close()
  for (const suffix of ['', '-wal', '-shm']) { const file = copied + suffix; if (fs.existsSync(file)) fs.unlinkSync(file) }
}
