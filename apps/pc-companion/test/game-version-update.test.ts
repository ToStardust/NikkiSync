import assert from 'node:assert/strict'
import test from 'node:test'
import './game-version-english-names.test.js'
import { readFileSync } from 'node:fs'
import { AssetRepository, AppSettingsRepository, DatabaseManager, SyncReadRepository } from '@nikkisync/database'
import { getGameVersionReleases, inferInfinityNikkiGameVersion, setRemoteGameVersionReleases } from '../src/server/GameVersionCalendar.js'
import { GameVersionUpdateService, parseOfficialGameVersion,parseOfficialReleaseNotices } from '../src/server/GameVersionUpdateService.js'
import { mapAssetSummary } from '../src/server/row-mappers.js'

test('calendar updates a library across page boundaries without materializing every metadata row',async()=>{
  const db=new DatabaseManager(':memory:');db.initialize();const assets=new AssetRepository(db),original=AssetRepository.prototype.list
  try{
    for(let i=0;i<513;i++)assets.create({assetId:`bounded_${String(i).padStart(4,'0')}`,assetType:'photo',capturedAt:'2026-09-25T00:00:00Z',discoveredAt:'2026-10-27T00:00:00Z',metadata:{raw:{nativeParamPayload:'x'.repeat(4096)}}})
    new AppSettingsRepository(db).set('game_version_calendar_applied',[])
    AssetRepository.prototype.list=()=>{throw Error('unbounded metadata list prohibited in this fixture')}
    const service=new GameVersionUpdateService(db,{fetchPage:async()=>{throw Error('offline')}})
    assert.equal(await service.runOnce(),513);assert.equal(mapAssetSummary(assets.getById('bounded_0512')!,[]).gameVersion,'2.10');service.stop()
  }finally{AssetRepository.prototype.list=original;setRemoteGameVersionReleases([]);db.close()}
})

test('official publisher maintenance notices can preseed exact future boundaries without guessing cadence',()=>{
  const now=Date.parse('2026-10-27T00:00:00Z')
  const notice={appnews:{appid:3164330,newsitems:[{feedname:'steam_community_announcements',date:Math.floor(now/1000),title:'October 29: Version 2.11 Update Notice',contents:'Infinity Nikki will undergo a version update from 12:50 to 20:00 on October 29, 2026 (UTC-7).'}]}}
  assert.deepEqual(parseOfficialReleaseNotices(JSON.stringify(notice),now),[{version:'2.11',effectiveAt:'2026-10-30T03:00:00.000Z'}])
  notice.appnews.newsitems[0]!.feedname='untrusted_feed';assert.deepEqual(parseOfficialReleaseNotices(JSON.stringify(notice),now),[])
  notice.appnews.newsitems[0]!.feedname='steam_community_announcements';notice.appnews.newsitems[0]!.contents='The event ends on October 29, 2026';assert.deepEqual(parseOfficialReleaseNotices(JSON.stringify(notice),now),[])
})

test('2.10 calendar uses confirmed reopening boundary and preserves old photos', () => {
  assert.equal(inferInfinityNikkiGameVersion('2026-09-24T02:59:59Z'), '2.9')
  assert.equal(inferInfinityNikkiGameVersion('2026-09-24T03:00:00Z'), '2.10')
  assert.equal(inferInfinityNikkiGameVersion('2026-10-13T00:00:00Z'), '2.10')
})

test('official footer parser accepts current version/date only, rejects future and malformed dates', () => {
  const html='<span>当前版本：<!-- -->2.11</span><span>更新时间：<!-- -->2026-10-20</span>'
  const now=Date.parse('2026-10-22T00:00:00Z')
  assert.equal(parseOfficialGameVersion(html,now)?.version,'2.11')
  assert.equal(parseOfficialGameVersion(html,Date.parse('2026-10-13T00:00:00Z')),undefined)
  assert.equal(parseOfficialGameVersion(html.replace('2026-10-20','2026-02-30'),now),undefined)
  assert.equal(parseOfficialGameVersion('2.11版本更新预告 2026-10-20',now),undefined)
})

test('online calendar caches history and invalidates only changed inference without rewriting metadata', async () => {
  const db=new DatabaseManager(':memory:');db.initialize(readFileSync('packages/database/migrations/0001_initial.sql','utf8'))
  try {
    const assets=new AssetRepository(db),reads=new SyncReadRepository(db)
    new AppSettingsRepository(db).set('game_version_calendar_applied',getGameVersionReleases())
    for(const [id,capturedAt,metadata] of [
      ['new','2026-10-22T00:00:00Z',{camera:{brightness:7}}],
      ['old','2026-09-10T00:00:00Z',null],
      ['explicit','2026-10-22T00:00:00Z',{identity:{gameVersion:'2.9'}}]
    ] as const) assets.create({assetId:id,assetType:'photo',discoveredAt:'2026-10-22T01:00:00Z',capturedAt,metadata})
    const before=assets.list(),revision=reads.currentRevision()
    let page='<p>当前版本：2.11</p><p>更新时间：2026-10-20</p>'
    const options={now:()=>Date.parse('2026-10-22T00:00:00Z'),fetchPage:async()=>page}
    const service=new GameVersionUpdateService(db,options)
    assert.equal(await service.runOnce(),1)
    assert.equal(reads.currentRevision(),revision+1)
    assert.equal(mapAssetSummary(assets.getById('new')!,[]).gameVersion,'2.11')
    assert.equal(mapAssetSummary(assets.getById('explicit')!,[]).gameVersion,'2.9')
    for(const row of before) assert.equal(assets.getById(String(row.asset_id))?.metadata_json,row.metadata_json)
    assert.equal(await service.runOnce(),0)
    assert.equal(reads.currentRevision(),revision+1)
    page='<p>当前版本：2.11</p><p>更新时间：2026-10-22</p>'
    assert.equal(await service.runOnce(),0,'same-version hotfix date must not move the recorded release boundary')
    assert.equal(inferInfinityNikkiGameVersion('2026-10-21T17:00:00Z'),'2.11')
    service.stop();setRemoteGameVersionReleases([])
    const offline=new GameVersionUpdateService(db,{...options,fetchPage:async()=>{throw Error('offline')}})
    assert.equal(inferInfinityNikkiGameVersion('2026-10-22T00:00:00Z'),'2.11')
    assert.equal(inferInfinityNikkiGameVersion('2026-10-20T04:00:00Z'),undefined,'date-only update day must not invent an exact reopening time')
    assert.equal(await offline.runOnce(),0)
    assert.ok(new AppSettingsRepository(db).get('game_version_calendar'))
    offline.stop()
  } finally {setRemoteGameVersionReleases([]);db.close()}
})

test('first upgrade refreshes cached inferred groups offline once, retaining null metadata', async () => {
  const db=new DatabaseManager(':memory:');db.initialize(readFileSync('packages/database/migrations/0001_initial.sql','utf8'))
  try {
    const assets=new AssetRepository(db),reads=new SyncReadRepository(db)
    assets.create({assetId:'cached-photo',assetType:'photo',capturedAt:'2026-09-25T00:00:00Z',discoveredAt:'2026-09-25T01:00:00Z',metadata:null})
    const service=new GameVersionUpdateService(db,{fetchPage:async()=>{throw Error('offline')}})
    const before=reads.currentRevision()
    assert.equal(await service.runOnce(),1)
    assert.equal(reads.currentRevision(),before+1)
    assert.equal(mapAssetSummary(assets.getById('cached-photo')!,[]).gameVersion,'2.10')
    assert.equal(JSON.parse(String(assets.getById('cached-photo')?.metadata_json)),null)
    assert.equal(await service.runOnce(),0)
    assert.equal(reads.currentRevision(),before+1)
    service.stop()
  } finally {setRemoteGameVersionReleases([]);db.close()}
})

test('calendar updates also reach the separately embedded gallery calendar', async () => {
  const embedded=await import('../src/wechat/GalleryRuntime.mjs')
  assert.equal(typeof embedded.setRemoteGameVersionReleases,'function')
  const db=new DatabaseManager(':memory:');db.initialize(readFileSync('packages/database/migrations/0001_initial.sql','utf8'))
  let notified=0
  const service=new GameVersionUpdateService(db,{now:()=>Date.parse('2026-10-22T00:00:00Z'),
    fetchPage:async()=>'<p>当前版本：2.11</p><p>更新时间：2026-10-20</p>',
    onCalendarChanged:releases=>{embedded.setRemoteGameVersionReleases(releases);notified++}})
  try {await service.runOnce();assert.equal(notified,2)}
  finally {service.stop();setRemoteGameVersionReleases([]);embedded.setRemoteGameVersionReleases([]);db.close()}
})
