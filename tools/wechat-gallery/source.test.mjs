import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';

test('a scoped Mini Program gallery applies the same account and source selection on refresh', async () => {
 const {DatabaseManager,AssetRepository,SyncReadRepository}=await import('../../packages/database/dist/src/index.js');
 const {toPathKey}=await import('../../packages/core/dist/src/index.js');
 const {createIndexedPreviewSource}=await import('./source.mjs');
 const root=await mkdtemp(join(tmpdir(),'nikki-mini-scope-')),db=new DatabaseManager();
 db.initialize();
 try {
  const repo=new AssetRepository(db),extra=join(root,'extra');
  await mkdir(extra);
  for(const [name,uid,assetType,dir] of [
   ['own','11111','photo',root],['other','22222','photo',root],['unknown',undefined,'photo',root],
   ['extra','11111','photo',extra],['video','22222','video',root],['live','22222','motion_photo',root],
  ]) {
   const assetId='asset_'+name;
   const resources=[];
   for(const role of assetType==='video'?['source_motion']:assetType==='motion_photo'?['source_primary','source_motion']:['source_primary']) {
    const video=role==='source_motion',fileExt=video?'.mp4':'.jpg',fileName=name+fileExt,sourcePath=join(dir,fileName);
    const bytes=video?Buffer.alloc(16,1):Buffer.from([255,216,1,255,217]);
    await writeFile(sourcePath,bytes);
    resources.push({assetId,resourceId:'resource_'+name+role,role,sourcePath,pathKey:toPathKey(sourcePath),fileName,
     mimeType:video?'video/mp4':'image/jpeg',fileExt,sizeBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),stableState:'stable',isDerived:false});
   }
   repo.reconcile({assetId,uid,assetType,assetState:'ready',discoveredAt:'2026-11-06T00:00:00Z',resources});
  }
  let selection=['11111'];
  const reads=new SyncReadRepository(db,()=>selection,()=>[{key:'source:spinning_momo',pathPrefixes:[toPathKey(extra)]}]);
  const source=await createIndexedPreviewSource(db,[root],{reads});
  const visible=()=>source.list(0).items.map(({id})=>source.deletionTarget(id).assetId).sort();
  assert.deepEqual(visible(),['asset_own']);
  selection=['source:spinning_momo',''];await source.refresh();
  assert.deepEqual(visible(),['asset_extra','asset_unknown']);
  selection=[];await source.refresh();assert.deepEqual(visible(),[]);
  selection=undefined;await source.refresh();assert.equal(source.count,6);
 } finally {db.close();await rm(root,{recursive:true,force:true});}
});

test('verified ScreenShot copies stay out of the gallery even if a stale index row remains, and the delete plan lists only verified files', async () => {
 const {DatabaseManager,AssetRepository}=await import('../../packages/database/dist/src/index.js');
 const {toPathKey}=await import('../../packages/core/dist/src/index.js');
 const {ScannerService}=await import('../../apps/pc-companion/dist/src/scanner/ScannerService.js');
 const {DeletionQueue}=await import('../../apps/pc-companion/dist/src/organizer/DeletionQueue.js');
 const {createIndexedPreviewSource}=await import('./source.mjs');
 const root=await mkdtemp(join(tmpdir(),'nikki-mini-export-copy-')),game=join(root,'InfinityNikki');
 const account=join(game,'X6Game','Saved','GamePlayPhotos','12345');
 const high=join(account,'NikkiPhotos_HighQuality'),low=join(account,'NikkiPhotos_LowQuality'),screen=join(game,'X6Game','ScreenShot');
 for(const dir of [high,low,join(screen,'other')])await mkdir(dir,{recursive:true});
 await writeFile(join(game,'InfinityNikki.exe'),'');
 const jpeg=Buffer.from([255,216,255,218,0,2,1,2,3,255,217]),different=Buffer.from([255,216,255,218,0,2,4,5,6,255,217]);
 const original=join(high,'photo.jpeg'),variant=join(low,'photo.jpeg'),copy=join(screen,'photo.jpeg'),unrelated=join(screen,'other','photo.jpeg');
 await writeFile(original,Buffer.concat([jpeg,Buffer.from('native parameters')]));
 await writeFile(variant,different);await writeFile(copy,jpeg);await writeFile(unrelated,different);
 const db=new DatabaseManager();db.initialize();
 const scanner=new ScannerService(db,{startingPaths:[game],runningExecutablePaths:[],watcher:false,stability:{pollIntervalMs:0,stableChecks:1,maxWaitMs:1000}});
 const queue=new DeletionQueue(db,()=>scanner.getScanRoots(),async()=>{},async()=>assert.fail('planning must not move files'),undefined,undefined,{exportsFor:path=>scanner.exactExportCopies(path)});
 try {
  await scanner.start();
  assert.deepEqual(scanner.exactExportCopies(original).map(file=>file.path),[copy]);
  new AssetRepository(db).reconcile({assetId:'asset_old_export',assetType:'photo',assetState:'ready',discoveredAt:'2026-11-06T00:00:00Z',
   resources:[{assetId:'asset_old_export',resourceId:'resource_old_export',role:'source_primary',sourcePath:copy,pathKey:toPathKey(copy),fileName:'photo.jpeg',mimeType:'image/jpeg',fileExt:'.jpeg',sizeBytes:jpeg.length,sha256:createHash('sha256').update(jpeg).digest('hex'),stableState:'stable',isDerived:false}]});
  const source=await createIndexedPreviewSource(db,scanner.getScanRoots(),{exportCopies:()=>scanner.verifiedExportCopies()});
  assert.equal(source.count,2,'native photo and independent same-name photo only');
  const asset=db.connection.prepare('SELECT asset_id FROM resources WHERE source_path=?').get(original);
  const target=source.list(0).items.map(({id})=>source.deletionTarget(id)).find(item=>item.assetId===asset.asset_id);
  assert.ok(target);
  await queue.sync('test-phone',[{id:'d'.repeat(32),...target}]);await queue.idle();
  const plan=queue.list()[0];assert.equal(plan.state,'pending');
  assert.deepEqual(plan.files.map(file=>file.folder).sort(),['NikkiPhotos_HighQuality','NikkiPhotos_LowQuality','ScreenShot']);
 } finally {await queue.stop();await scanner.stop();db.close();await rm(root,{recursive:true,force:true});}
});

test('owned read-only database stays open for refresh; scanner-index changes appear without rebuilding QR or a second index',async()=>{
 const {DatabaseManager,AssetRepository}=await import('../../packages/database/dist/src/index.js');
 const {openLocalPreviewSource}=await import('./source.mjs');
 const root=await mkdtemp(join(tmpdir(),'nikki-index-refresh-')),dbPath=join(root,'index.sqlite'),bytes=Buffer.from([255,216,1,2,255,217]);
 const writer=new DatabaseManager(dbPath);writer.initialize();let source;
 const add=async n=>{const p=join(root,n+'.jpg');await writeFile(p,bytes);new AssetRepository(writer).reconcile({assetId:'asset-'+n,assetType:'photo',assetState:'ready',discoveredAt:'2026-10-0'+n+'T00:00:00.000Z',
  resources:[{assetId:'asset-'+n,resourceId:'resource-'+n,role:'source_primary',sourcePath:p,pathKey:p.toLowerCase(),fileName:n+'.jpg',mimeType:'image/jpeg',fileExt:'.jpg',sizeBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),stableState:'stable',isDerived:false}]});};
 try{
  await add(1);source=await openLocalPreviewSource(dbPath,{discover:async()=>({photoRoots:[root]})});assert.equal(source.count,1);
  const first=source.list(0).items[0].id;await add(2);await source.refresh();assert.equal(source.count,2);assert.equal(source.list(0).items[1].id,first);
  assert.deepEqual(Buffer.from((await source.original(first)).image),bytes);
  source.close();await assert.rejects(()=>source.refresh());
 }finally{source?.close?.();writer.close();await rm(root,{recursive:true,force:true});}
});

test('a date filter can find a resolved photo behind 500 newer photos in the selected account', async () => {
 const {DatabaseManager,AssetRepository,SyncReadRepository}=await import('../../packages/database/dist/src/index.js');
 const {toPathKey}=await import('../../packages/core/dist/src/index.js');
 const {createIndexedPreviewSource}=await import('./source.mjs');
 const root=await mkdtemp(join(tmpdir(),'nikki-older-gallery-')), db=new DatabaseManager();
 db.initialize();
 try {
  const bytes=Buffer.from([255,216,255,217]),sha256=createHash('sha256').update(bytes).digest('hex'),assets=new AssetRepository(db);
  for(let index=0;index<502;index++){
   const old=index===500,assetId='fixture-'+index,sourcePath=join(root,assetId+'.jpg');
   await writeFile(sourcePath,bytes);
   const capturedAt=old?'2026-11-02T15:23:37.000Z':'2026-11-04T00:00:00.000Z';
   assets.reconcile({assetId,uid:index===501?'22222':'11111',assetType:'photo',assetState:'ready',discoveredAt:capturedAt,capturedAt,
    ...(old?{metadata:{camera:{focalLength:50},dressing:{clothes:[{id:'dress',name:'裙子'}]}}}:{}),
    resources:[{assetId,resourceId:assetId+'-still',role:'source_high_quality',sourcePath,pathKey:toPathKey(sourcePath),
     fileName:assetId+'.jpg',mimeType:'image/jpeg',fileExt:'.jpg',sizeBytes:bytes.length,sha256,stableState:'stable',isDerived:false}]});
  }
  const source=await createIndexedPreviewSource(db,[root],{reads:new SyncReadRepository(db,()=>['11111'])});
  const date={from:'2026-11-02',to:'2026-11-02',offsetMinutes:480};
  assert.equal(source.count,501);
  assert.equal(source.list(0,500).total,500);
  assert.equal(source.browse(0,date,500).total,0);
  const page=source.browse(0,date);
  assert.equal(page.libraryTotal,501);
  assert.equal(page.items.length,1);
  assert.equal(source.list(500).items[0].id,page.items[0].id);
  assert.equal(source.metadata(page.items[0].id).availability,'available');
  assert.deepEqual(source.outfit(page.items[0].id).items.map(item=>item.name),['裙子']);
 } finally {
  db.close();
  await rm(root,{recursive:true,force:true});
 }
});

test('an open indexed gallery reads newly resolved details without refreshing its photo list', async () => {
 const {DatabaseManager,AssetRepository,SyncReadRepository}=await import('../../packages/database/dist/src/index.js');
 const {toPathKey}=await import('../../packages/core/dist/src/index.js');
 const {createIndexedPreviewSource}=await import('./source.mjs');
 const root=await mkdtemp(join(tmpdir(),'nikki-detail-freshness-')), db=new DatabaseManager();
 db.initialize();
 try {
  const path=join(root,'photo.jpg'),bytes=Buffer.from([255,216,255,217]),assets=new AssetRepository(db);
  await writeFile(path,bytes);
  assets.reconcile({assetId:'photo',uid:'11111',assetType:'photo',assetState:'ready',discoveredAt:'2026-11-02T00:00:00Z',
   resources:[{assetId:'photo',resourceId:'still',role:'source_high_quality',sourcePath:path,pathKey:toPathKey(path),
    fileName:'photo.jpg',mimeType:'image/jpeg',fileExt:'.jpg',sizeBytes:bytes.length,
    sha256:createHash('sha256').update(bytes).digest('hex'),stableState:'stable',isDerived:false}]});
  let selection=['11111'];
  const source=await createIndexedPreviewSource(db,[root],{reads:new SyncReadRepository(db,()=>selection)});
  const id=source.list(0).items[0].id;
  assert.equal(source.metadata(id).availability,'unavailable');
  assert.equal(source.outfit(id).total,0);
  assets.updateMetadata('photo',{camera:{focalLength:50},dressing:{clothes:[{id:'dress',name:'裙子'}]}});
  assert.ok(source.metadata(id).rows.some(row=>row.label==='焦距'&&row.value==='50'));
  assert.deepEqual(source.outfit(id).items.map(item=>item.name),['裙子']);
  assert.equal(source.list(0).items[0].id,id);

  selection=['22222'];
  assert.throws(()=>source.metadata(id),/Unavailable/);
  selection=['11111'];
  db.connection.prepare('UPDATE resources SET sha256=? WHERE resource_id=?').run('b'.repeat(64),'still');
  assert.throws(()=>source.metadata(id),/Unavailable/);
  assert.throws(()=>source.outfit(id),/Unavailable/);
 } finally {
  db.close();
  await rm(root,{recursive:true,force:true});
 }
});

test('refresh replaces read-only snapshot atomically, retains opaque ids for unchanged bytes and rejects removed items',async()=>{
 const {createPreviewSource}=await import('./source.mjs');
 const root=await mkdtemp(join(tmpdir(),'nikki-refresh-')),path=join(root,'a.jpg'),other=join(root,'b.jpg');
 const bytes=Buffer.from([255,216,1,2,255,217]);await writeFile(path,bytes);await writeFile(other,bytes);
 const resource=p=>({sourcePath:p,sizeBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),mimeType:'image/jpeg'});
 let resources=[resource(path)];
 try{
  const source=await createPreviewSource(resources,[root],{refreshResources:async()=>resources,resize:async()=>bytes.slice()});
  const first=source.list(0).items[0].id;resources=[resource(other),resource(path)];await source.refresh();
  assert.equal(source.count,2);assert.equal(source.list(0).items[1].id,first);
  resources=[resource(other)];await source.refresh();assert.equal(source.count,1);await assert.rejects(()=>source.original(first));
  const before=JSON.stringify(source.list(0));resources=[resource(join(root,'missing.jpg'))];await assert.rejects(()=>source.refresh());assert.equal(JSON.stringify(source.list(0)),before);
  assert.doesNotMatch(before,/sourcePath|\.jpg|uid/);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('local preview source jails paths, checks scanner hash and re-encodes without exposing filenames or metadata', async () => {
  const { createPreviewSource } = await import('./source.mjs');
  const root = await mkdtemp(join(tmpdir(), 'nikki-gallery-')), path = join(root, 'test.jpg'), bytes = Buffer.from([255,216,1,2,255,217]);
  await writeFile(path, bytes);
  const resource = { sourcePath: path, sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length, resourceId: 'private-resource', capturedAt: '2026-10-01T00:00:00.000Z', fileName: 'private-uid.jpg' };
  let converts = 0;
  const source = await createPreviewSource([resource], [root], { resize: async raw => { converts++; assert.deepEqual(raw, bytes); return Uint8Array.from(bytes); } });
  try {
    const list = source.list(0); assert.equal(list.total, 1); assert.equal(JSON.stringify(list).includes('private'), false);
    assert.match(list.items[0].id, /^[a-f0-9]{32}$/); await source.preview(list.items[0].id); assert.equal(converts, 1);
    await writeFile(path, Buffer.from([255,216,8,9,255,217])); await assert.rejects(() => source.preview(list.items[0].id));
    assert.throws(() => source.list(-1)); await assert.rejects(() => source.preview('../../private'));
    await assert.rejects(() => createPreviewSource([{ ...resource, sourcePath: join(root, '..', 'outside.jpg') }], [root]));
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('original source keeps JPEG trailer byte-identical and returns only canonical player-facing metadata', async () => {
  const { createPreviewSource } = await import('./source.mjs');
  const root=await mkdtemp(join(tmpdir(),'nikki-original-')),path=join(root,'private.jpg');
  const bytes=Buffer.concat([Buffer.from([255,216,1,2,255,217]),Buffer.from('GAME_PARAMETER_TRAILER')]);
  await writeFile(path,bytes);
  const resource={sourcePath:path,sizeBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),mimeType:'image/jpeg',
    metadata:{identity:{uid:'SECRET_UID',gameVersion:'2.9'},camera:{focalLength:50,exposure:1},filter:{name:'柔光'},dressing:{clothes:[{id:'private-id',name:'星光裙'}]},raw:{token:'SECRET_TOKEN'}}};
  try {
    const source=await createPreviewSource([resource],[root],{resize:async()=>new Uint8Array([255,216,255,217])});
    const id=source.list(0).items[0].id,original=await source.original(id);
    assert.deepEqual(Buffer.from(original.image),bytes);assert.equal(original.mime,'image/jpeg');
    const info=source.metadata(id);assert.equal(info.availability,'available');
    assert.ok(info.rows.some(x=>x.value==='星光裙'));assert.ok(info.rows.some(x=>x.value==='50'));
    assert.doesNotMatch(JSON.stringify(info),/SECRET|private-id|sourcePath/);
    await writeFile(path,Buffer.alloc(bytes.length));await assert.rejects(()=>source.original(id));
    assert.throws(()=>source.metadata('../../private'));original.image.fill(0);
  } finally {await rm(root,{recursive:true,force:true});}
});
