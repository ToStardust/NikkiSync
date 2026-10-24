// Aggregate-only verification. Source DB is read/copied, all writes target out.
import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'
import { DatabaseManager, AssetRepository } from '../../packages/database/dist/src/index.js'
import { GameVersionUpdateService } from '../../apps/pc-companion/dist/src/server/GameVersionUpdateService.js'
import { mapAssetSummary } from '../../apps/pc-companion/dist/src/server/row-mappers.js'
const source=path.join(process.env.LOCALAPPDATA,'NikkiSync','nikkisync.sqlite')
const output=fs.mkdtempSync(path.resolve('out/version-calendar-'))
const copied=path.join(output,'verification.sqlite')
const fingerprint=file=>{try{const s=fs.statSync(file);return `${s.size}:${s.mtimeMs}`}catch{return ''}}
const before=[fingerprint(source),fingerprint(source+'-wal')]
fs.copyFileSync(source,copied)
if(before[1])fs.copyFileSync(source+'-wal',copied+'-wal')
assert.deepEqual([fingerprint(source),fingerprint(source+'-wal')],before,'Source changed while copying; retry while idle')
const db=new DatabaseManager(copied)
let service
try {
  db.initialize(fs.readFileSync('packages/database/migrations/0001_initial.sql','utf8'));assert.equal(db.connection.prepare('PRAGMA quick_check').get().quick_check,'ok')
  const assets=new AssetRepository(db),original=assets.list()
  service=new GameVersionUpdateService(db)
  const invalidated=await service.runOnce()
  const state=db.connection.prepare('SELECT value_json FROM app_settings WHERE key = ?').get('game_version_calendar')
  assert.ok(state,'Actual official fetch must have persisted a validated calendar')
  const cached=JSON.parse(state.value_json)
  const counts={}
  for(const row of assets.list()) {
    assert.equal(row.metadata_json,original.find(r=>r.asset_id===row.asset_id)?.metadata_json)
    const summary=mapAssetSummary(row,[])
    const key=(summary.gameVersion??'unknown')+':'+summary.gameVersionSource
    counts[key]=(counts[key]??0)+1
  }
  const report={mode:'private-database-copy',officialPageFetched:true,calendarLatest:cached.releases[0].version,assets:original.length,
    invalidated,metadataUnchanged:true,versionCounts:counts,sourceDatabaseModified:false}
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2))
  console.log(JSON.stringify(report))
} finally {
  service?.stop();db.close()
  globalThis.Bun?.gc(true)
  for(const suffix of ['', '-wal', '-shm']){
    const file=copied+suffix
    try {if(fs.existsSync(file))fs.unlinkSync(file)} catch(error){
      if(error.code!=='EBUSY')throw error
      // Bun on Windows can defer the closed SQLite handle until process exit.
      console.log(JSON.stringify({privateCopyCleanupPending:true}))
    }
  }
}
