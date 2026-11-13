import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdtemp,mkdir,writeFile,readFile,rename,rm,symlink,realpath} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {AssetRepository,DatabaseManager} from '@nikkisync/database'
import {ScannerService} from '../src/scanner/ScannerService.js'
import {ExtraScanDirectories,loadExtraScanDirectories,loadRetiredExtraDirectories} from '../src/scanner/ExtraScanDirectories.js'
import {createDesktopControlServer} from '../src/desktop/DesktopControlServer.js'
import {jpegImageLength} from '../src/scanner/JpegImageBoundary.js'
import {ResourceClassifier} from '../src/scanner/ResourceClassifier.js'

async function fixture(){
  const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'momo-extra-')))
  const game=path.join(root,'InfinityNikki'),native=path.join(game,'X6Game/Saved/GamePlayPhotos/10001/NikkiPhotos_HighQuality')
  await mkdir(native,{recursive:true});await writeFile(path.join(game,'InfinityNikki.exe'),'')
  await writeFile(path.join(native,'Original.jpg'),'native')
  const database=new DatabaseManager(':memory:');database.initialize()
  const scanner=new ScannerService(database,{startingPaths:[game],runningExecutablePaths:[],watcher:false,stability:{pollIntervalMs:0,stableChecks:1,maxWaitMs:1000}})
  await scanner.start()
  const file=path.join(root,'extra.json'),extra=new ExtraScanDirectories(file,scanner)
  return {root,game,native,database,scanner,extra,file,ready:()=>Number(database.connection.prepare("SELECT COUNT(*) AS c FROM assets WHERE asset_state='ready'").get()?.c),close:async()=>{await scanner.stop();database.close();await rm(root,{recursive:true,force:true})}}
}

const exportedJpeg=Buffer.from([255,216,255,218,0,2,1,2,3,255,217])
const nativeJpeg=Buffer.concat([exportedJpeg,Buffer.from('native-parameters'),Buffer.from([255,217]),Buffer.from(Buffer.alloc(32,7).toString('base64'))])

test('a failed directory scan can retry the same confirmed proposal without falsely reporting expiration',async()=>{
 const f=await fixture();try{
  const folder=path.join(f.root,'additional');await mkdir(folder);await writeFile(path.join(folder,'photo.jpeg'),'fixture')
  const proposal=await f.extra.inspect(folder)
  const original=f.scanner.setExtraDirectories.bind(f.scanner);let fails=true
  f.scanner.setExtraDirectories=async roots=>{if(fails&&roots.length){fails=false;throw new Error('transient scan failure')}return original(roots)}
  await assert.rejects(f.extra.add(proposal.id),/transient scan failure/)
  assert.equal(f.extra.state().directories.length,0)
  const state=await f.extra.add(proposal.id)
  assert.equal(state.directories.length,1)
  assert.equal(f.ready(),2)
 }finally{await f.close()}
})

test('native cloud, magazine, check-in and collage sources retain separate parameter envelopes and prefer their originals',async()=>{
 const f=await fixture();try{
  const uid=path.dirname(f.native),screen=path.join(f.game,'X6Game/ScreenShot')
  const folders=['CloudPhotos','MagazinePhotos','ClockInPhoto','Collage/HighQuality','Collage/CollagePhoto']
  for(let i=0;i<folders.length;i++){
   const folder=path.join(uid,folders[i]!);await mkdir(folder,{recursive:true})
   const jpeg=Buffer.from([255,216,255,218,0,2,i+10,2,3,255,217])
   const payload=Buffer.from('own metadata '+i).toString('base64'),tail=Buffer.concat([jpeg,Buffer.from(payload),Buffer.from([255,217]),Buffer.from(Buffer.alloc(32,i+1).toString('base64'))])
   await writeFile(path.join(folder,'Same.jpeg'),tail)
   if(i===0){await mkdir(screen);await writeFile(path.join(screen,'CloudExport.jpeg'),jpeg)}
  }
  for(const name of ['CloudPhotos_LowQuality','Collage/LowQuality']){const dir=path.join(uid,name);await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'Same.jpeg'),'thumbnail')}
  await f.scanner.stop()
  const scanner=new ScannerService(f.database,{startingPaths:[f.game],runningExecutablePaths:[],watcher:false,stability:{pollIntervalMs:0,stableChecks:1,maxWaitMs:1000}})
  try{
   await scanner.start();assert.equal(f.ready(),6,'original HQ + five distinct supplemental originals, without a duplicate export')
   const rows=f.database.connection.prepare("SELECT metadata_json FROM assets WHERE asset_state='ready' AND metadata_json LIKE '%nativeParamPayload%'").all()
   assert.equal(rows.length,5)
   const payloads=rows.map(row=>JSON.parse(String(row.metadata_json)).raw.nativeParamPayload)
   assert.equal(new Set(payloads).size,5,'equal names in different categories must not merge or borrow parameters')
   assert.equal(scanner.exactExportCopies(path.join(uid,'CloudPhotos/Same.jpeg')).length,1)
   const ids=f.database.connection.prepare("SELECT asset_id FROM assets WHERE asset_state='ready' ORDER BY asset_id").all().map(row=>row.asset_id)
   const repeat=await scanner.fullScan();assert.equal(repeat.assetsCreated,0)
   assert.deepEqual(f.database.connection.prepare("SELECT asset_id FROM assets WHERE asset_state='ready' ORDER BY asset_id").all().map(row=>row.asset_id),ids)
   const manager=new ExtraScanDirectories(f.file,scanner)
   for(const name of ['CloudPhotos_LowQuality','Collage/LowQuality'])await assert.rejects(manager.inspect(path.join(uid,name)),/thumbnail_only/)
  }finally{await scanner.stop()}
 }finally{await f.close()}
})

test('selecting a nested ScreenShot selection discovers the nearby native source without broadening the export selection',async()=>{
 const f=await fixture();try{
  const base=path.join(f.root,'Moved/X6Game'),screen=path.join(base,'ScreenShot/Chosen'),native=path.join(base,'Saved/GamePlayPhotos/30003/NikkiPhotos_HighQuality')
  await mkdir(screen,{recursive:true});await mkdir(native,{recursive:true});await writeFile(path.join(screen,'Collage.png'),'collage');await writeFile(path.join(native,'Native.jpeg'),nativeJpeg)
  const proposal=await f.extra.inspect(screen)
  assert.ok(proposal.roots.some(root=>root.path===path.join(base,'Saved/GamePlayPhotos')&&root.mode==='native'))
  assert.ok(proposal.roots.some(root=>root.path===screen));assert.ok(!proposal.roots.some(root=>root.path===path.dirname(screen)))
 }finally{await f.close()}
})

test('selecting a moved high-quality directory proposes its UID with companions, never another account',async()=>{
 const f=await fixture();try{
  const uid=path.join(f.root,'Backup/GamePlayPhotos/30003'),hq=path.join(uid,'NikkiPhotos_HighQuality')
  await mkdir(hq,{recursive:true});await mkdir(path.join(uid,'NikkiPhotos_LowQuality'));await mkdir(path.join(uid,'Videos'))
  await writeFile(path.join(hq,'Native.jpeg'),nativeJpeg)
  const proposal=await f.extra.inspect(hq)
  assert.deepEqual(proposal.roots.map(root=>root.path),[uid]);assert.equal(proposal.roots[0]?.mode,'native')
 }finally{await f.close()}
})

test('detached moved UID categories keep their explicit UID and complete parameter inputs',async()=>{
 const f=await fixture();try{
  for(const [index,category]of ['CloudPhotos','MagazinePhotos','ClockInPhoto','Collage/HighQuality'].entries()){
   const uid=String(30003+index),account=path.join(f.root,'Detached',uid),folder=path.join(account,category)
   await mkdir(folder,{recursive:true});await writeFile(path.join(folder,'Native.jpeg'),nativeJpeg)
   const proposal=await f.extra.inspect(folder)
   assert.deepEqual(proposal.roots.map(root=>({path:root.path,mode:root.mode})),[{path:account,mode:'native'}])
   await f.extra.add(proposal.id)
   const row=f.database.connection.prepare("SELECT metadata_json FROM assets WHERE uid=? AND asset_state='ready'").get(uid)
   assert.ok(row,'an explicit UID folder next to a known game photo category must survive a move')
   const raw=JSON.parse(String(row.metadata_json)).raw
   assert.ok(raw.nativeParamToken&&raw.nativeParamPayload&&raw.nativeParamNuan5Md5)
  }
 }finally{await f.close()}
})

test('custom spinning-momo source identity survives restart and ordinary folders stay ordinary',async()=>{
 const f=await fixture();try{
  const custom=path.join(f.root,'custom-captures'),ordinary=path.join(f.root,'other-captures');await mkdir(custom);await mkdir(ordinary)
  await writeFile(f.file,JSON.stringify({directories:[{path:custom,mode:'images',source:'spinning_momo'},{path:ordinary,mode:'images'}]}))
  const loaded=loadExtraScanDirectories(f.file)
  assert.deepEqual(loaded.map(root=>({...root,id:'omitted'})),[{id:'omitted',path:custom,mode:'images',source:'spinning_momo'},{id:'omitted',path:ordinary,mode:'images'}])
  let notified=0;const restored=new ExtraScanDirectories(f.file,f.scanner,undefined,()=>{notified++})
  const image=path.join(custom,'original.jpeg');await writeFile(image,exportedJpeg)
  await restored.setSource(loaded[0]!.id,'other');assert.equal(loadExtraScanDirectories(f.file)[0]!.source,'other')
  await restored.setSource(loaded[0]!.id,'spinning_momo');assert.equal(loadExtraScanDirectories(f.file)[0]!.source,'spinning_momo');assert.equal(notified,2)
  assert.ok((await readFile(image)).equals(exportedJpeg),'relabeling never alters photos')
 }finally{await f.close()}
})

test('removing an extra ScreenShot folder also retires its exact deletion-copy lookup',async()=>{
 const f=await fixture();try{
  const source=path.join(f.native,'Source.jpeg'),screen=path.join(f.root,'OldGame/X6Game/ScreenShot'),copy=path.join(screen,'Export.jpeg')
  await writeFile(source,nativeJpeg);await f.scanner.fullScan();await mkdir(screen,{recursive:true});await writeFile(copy,exportedJpeg)
  await f.extra.add((await f.extra.inspect(screen)).id);assert.deepEqual(f.scanner.exactExportCopies(source).map(file=>file.path),[copy])
  await f.extra.remove(f.extra.state().directories.find(item=>item.path===screen)!.id)
  assert.equal(f.scanner.exactExportCopies(source).length,0);assert.ok((await readFile(copy)).equals(exportedJpeg))
 }finally{await f.close()}
})

test('JPEG identity skips thumbnail EOI, handles stuffed bytes/restarts and rejects truncated data',async()=>{
  const f=await fixture()
  try{
    const jpeg=Buffer.from([255,216,255,225,0,6,255,216,255,217,255,218,0,2,1,255,0,2,255,208,3,255,217])
    const file=path.join(f.root,'sample.jpeg');await writeFile(file,Buffer.concat([jpeg,Buffer.from('parameter tail')]))
    assert.equal(await jpegImageLength(file,jpeg.length+14),jpeg.length)
    await writeFile(file,jpeg.subarray(0,jpeg.length-2));assert.equal(await jpegImageLength(file,jpeg.length-2),undefined)
  }finally{await f.close()}
})

test('default ScreenShot supplements collages without duplicating native photos and updates on native changes',async()=>{
  const f=await fixture()
  try{
    const screen=path.join(f.game,'X6Game/ScreenShot');await mkdir(screen)
    await writeFile(path.join(f.native,'Source.jpeg'),nativeJpeg)
    await writeFile(path.join(screen,'Export.jpeg'),exportedJpeg)
    await writeFile(path.join(screen,'Collage.png'),'collage')
    await f.scanner.stop()
    const scanner=new ScannerService(f.database,{startingPaths:[f.game],runningExecutablePaths:[],watcher:false,stability:{pollIntervalMs:0,stableChecks:1,maxWaitMs:1000}})
    try{
      await scanner.start();assert.equal(f.ready(),3,'original fixture + native source + collage only')
      await writeFile(path.join(screen,'New.png'),'new screenshot');await scanner.rescanPath(path.join(screen,'New.png'));assert.equal(f.ready(),4)
      await writeFile(path.join(f.native,'New.png'),'new screenshot');await scanner.rescanPath(path.join(f.native,'New.png'));assert.equal(f.ready(),4,'new native must replace the duplicate export in the index')
      const manager=new ExtraScanDirectories(f.file,scanner);await assert.rejects(manager.inspect(screen),/already_covered/)
    }finally{await scanner.stop()}
  }finally{await f.close()}
})

test('selecting moved ScreenShot discovers hidden neighboring originals and retains unique exports',async()=>{
  const f=await fixture()
  try{
    const base=path.join(f.root,'OldGame/X6Game'),screen=path.join(base,'ScreenShot'),native=path.join(base,'Saved/GamePlayPhotos/30003/NikkiPhotos_HighQuality')
    await mkdir(screen,{recursive:true});await mkdir(native,{recursive:true})
    await writeFile(path.join(native,'DifferentName.jpeg'),nativeJpeg);await writeFile(path.join(screen,'Export.jpeg'),exportedJpeg);await writeFile(path.join(screen,'Collage.png'),'collage')
    const proposal=await f.extra.inspect(screen)
    assert.ok(proposal.roots.some(root=>root.mode==='native'))
    assert.ok(proposal.roots.some(root=>root.path===screen))
    assert.equal(f.ready(),1,'nearby folders require confirmation')
    await f.extra.add(proposal.id);assert.equal(f.ready(),3)
    const metadata=f.database.connection.prepare("SELECT metadata_json FROM assets WHERE uid='30003'").get()
    assert.match(String(metadata?.metadata_json),/nativeParamToken/,'prefer native metadata-bearing original')
    await f.extra.remove(f.extra.state().directories.find(item=>item.mode==='native')!.id)
    assert.equal(f.ready(),3,'removing native source makes its preserved export visible again')
    assert.equal(await readFile(path.join(screen,'Export.jpeg')).then(value=>value.equals(exportedJpeg)),true)
  }finally{await f.close()}
})

test('extra folders import plain exports, isolate equal filenames, persist and stop sharing without deleting originals',async()=>{
  const f=await fixture()
  try{
    const a=path.join(f.root,'Exports A'),b=path.join(f.root,'Exports A_2')
    for(const folder of [a,b]){await mkdir(folder);await writeFile(path.join(folder,'Same.png'),'export')}
    const preview=await f.extra.inspect(a)
    assert.equal(f.ready(),1,'preview must not index or share before confirmation')
    assert.equal(preview.images,1)
    const scanned:string[]=[],coordinator=f.scanner['coordinator'],scan=coordinator.scanRoot.bind(coordinator)
    coordinator.scanRoot=async(...args)=>{scanned.push(args[0]);return scan(...args)}
    await f.extra.add(preview.id);assert.deepEqual(scanned,[a],'adding exports must not rehash the default game album')
    await f.extra.add((await f.extra.inspect(b)).id)
    assert.equal(f.ready(),3,'same-name files in different selected folders cannot overwrite each other')
    assert.equal(loadExtraScanDirectories(f.file).length,2)
    await assert.rejects(f.extra.inspect(a),/already_covered/)
    const entry=f.extra.state().directories[0]!
    await f.extra.remove(entry.id)
    assert.equal(f.ready(),2,'removing one folder cannot hide its similarly prefixed sibling')
    assert.equal(await readFile(path.join(a,'Same.png'),'utf8'),'export')
    assert.equal(loadExtraScanDirectories(f.file).length,1)
    assert.equal(f.extra.state().directories[0]!.path,b)
  }finally{await f.close()}
})

test('unavailable extra folders preserve the index and recover, and nested duplicate scope is rejected',async()=>{
  const f=await fixture()
  try{
    const folder=path.join(f.root,'Portable'),nested=path.join(folder,'20261022');await mkdir(nested,{recursive:true})
    await writeFile(path.join(nested,'Photo.jpg'),'external')
    await f.extra.add((await f.extra.inspect(folder)).id)
    assert.equal(f.ready(),2)
    const row=f.database.connection.prepare("SELECT uid FROM assets WHERE asset_id<> (SELECT asset_id FROM assets WHERE uid='10001')").get()
    assert.equal(row?.uid,null,'date folders must not become a game UID')
    await assert.rejects(f.extra.inspect(nested),/already_covered/)
    await rename(folder,folder+'-offline');await f.scanner.fullScan();assert.equal(f.ready(),2)
    await rename(folder+'-offline',folder);await writeFile(path.join(nested,'New.jpg'),'second')
    await f.scanner.rescanPath(path.join(nested,'New.jpg'));assert.equal(f.ready(),3)
    await assert.rejects(f.extra.inspect(f.native),/already_covered/)
    await assert.rejects(f.extra.inspect(path.parse(f.root).root),/choose_subfolder/)
  }finally{await f.close()}
})

test('moved native folders keep HQ/LQ and LIVE together; low-quality-only selection is explained',async()=>{
  const f=await fixture()
  try{
    const album=path.join(f.root,'Moved/GamePlayPhotos'),uid=path.join(album,'20002')
    for(const name of ['NikkiPhotos_HighQuality','NikkiPhotos_LowQuality','Videos'])await mkdir(path.join(uid,name),{recursive:true})
    await writeFile(path.join(uid,'NikkiPhotos_HighQuality/A.jpg'),'high');await writeFile(path.join(uid,'NikkiPhotos_LowQuality/A.jpg'),'low')
    await writeFile(path.join(uid,'Videos/Live_cover.jpg'),'cover');await writeFile(path.join(uid,'Videos/Live.mp4'),'video')
    await assert.rejects(f.extra.inspect(path.join(uid,'NikkiPhotos_LowQuality')),/thumbnail_only/)
    const proposal=await f.extra.inspect(album);assert.equal(proposal.roots[0]?.mode,'native')
    await f.extra.add(proposal.id);assert.equal(f.ready(),3)
    const motion=f.database.connection.prepare("SELECT asset_id FROM assets WHERE asset_type='motion_photo'").get()
    assert.equal(f.database.connection.prepare('SELECT COUNT(*) AS c FROM resources WHERE asset_id=?').get(motion?.asset_id)?.c,2)
  }finally{await f.close()}
})

test('directory traversal does not follow a child junction outside the selected scope',async()=>{
  const f=await fixture()
  try{
    const folder=path.join(f.root,'Chosen'),outside=path.join(f.root,'Outside')
    await mkdir(folder);await mkdir(outside);await writeFile(path.join(outside,'Private.jpg'),'outside')
    await symlink(outside,path.join(folder,'linked'),'junction')
    await f.extra.add((await f.extra.inspect(folder)).id)
    assert.equal(f.ready(),1)
  }finally{await f.close()}
})

test('extra-directory HTTP actions require a local desktop token and origin, and confirmation stops old resource access on removal',async()=>{
  const f=await fixture(),server=createDesktopControlServer({getStatus:()=>({service:'ready',host:'10.1.2.3',port:28080,assets:f.ready(),pairedDevices:1,firstRun:false}),createPairingUri:()=>'',qrSvg:async()=>'<svg/>',scanDirectories:f.extra})
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  try{
    const address=server.address();assert.ok(address&&typeof address!=='string');const url='http://127.0.0.1:'+address.port
    const html=await(await fetch(url)).text(),token=/name="nikkisync-desktop-token" content="([^"]+)"/.exec(html)![1]!
    assert.equal((await fetch(url+'/api/scan-directories')).status,403)
    const folder=path.join(f.root,'API exports');await mkdir(folder);await writeFile(path.join(folder,'External.jpg'),'external')
    const headers={'x-nikkisync-desktop-token':token,'content-type':'application/json'}
    assert.equal((await fetch(url+'/api/scan-directories/inspect',{method:'POST',headers:{...headers,origin:'https://untrusted.test'},body:JSON.stringify({path:folder})})).status,403)
    const preview=await(await fetch(url+'/api/scan-directories/inspect',{method:'POST',headers,body:JSON.stringify({path:folder})})).json() as {id:string}
    assert.equal(f.ready(),1)
    assert.equal((await fetch(url+'/api/scan-directories/confirm',{method:'POST',headers,body:JSON.stringify({proposalId:preview.id})})).status,200)
    assert.equal(f.ready(),2)
    // The desktop may miss the first successful response and repeat the same confirmation.
    const retry=await fetch(url+'/api/scan-directories/confirm',{method:'POST',headers,body:JSON.stringify({proposalId:preview.id})})
    assert.equal(retry.status,200)
    assert.equal((await retry.json() as ReturnType<ExtraScanDirectories['state']>).directories.length,1)
    assert.equal(f.ready(),2)
    const id=f.extra.state().directories[0]!.id
    await fetch(url+'/api/scan-directories/remove',{method:'POST',headers,body:JSON.stringify({id})})
    assert.equal(f.ready(),1)
    assert.equal(f.database.connection.prepare("SELECT COUNT(*) AS c FROM resources WHERE source_path=? AND stable_state='stable'").get(path.join(folder,'External.jpg'))?.c,0)
    assert.equal((await fetch(url+'/api/scan-directories/confirm',{method:'POST',headers,body:JSON.stringify({proposalId:preview.id})})).status,400)
    assert.equal(f.ready(),1)
    const bad=await fetch(url+'/api/scan-directories/confirm',{method:'POST',headers,body:JSON.stringify({proposalId:'not-issued'})});assert.equal(bad.status,400)
    assert.equal((await bad.json() as {error:string}).error,'selection_expired')
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await f.close()}
})

test('restarting with persisted extras restores a stable library and native UID inside a dated backup stays correct',async()=>{
  const f=await fixture();let restarted:ScannerService|undefined
  try{
    const root=path.join(f.root,'Backup'),photo=path.join(root,'20261022','GamePlayPhotos','20002','NikkiPhotos_HighQuality')
    await mkdir(photo,{recursive:true});await writeFile(path.join(photo,'Saved.jpg'),'native-backup')
    await f.extra.add((await f.extra.inspect(root)).id);assert.equal(f.ready(),2)
    assert.equal(f.database.connection.prepare("SELECT COUNT(*) AS c FROM assets WHERE uid='20002'").get()?.c,1)
    await f.scanner.stop()
    restarted=new ScannerService(f.database,{startingPaths:[f.game],runningExecutablePaths:[],watcher:false,extraDirectories:loadExtraScanDirectories(f.file),stability:{pollIntervalMs:0,stableChecks:1,maxWaitMs:1000}})
    const result=await restarted.start();assert.equal(result.assetsCreated,0);assert.equal(f.ready(),2)
  }finally{await restarted?.stop();await f.close()}
})

test('the desktop can open without an installed game and use only explicitly selected photo exports',async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'momo-exports-only-')),database=new DatabaseManager(':memory:');database.initialize()
  const scanner=new ScannerService(database,{allowMissingInstallation:true,watcher:false,startingPaths:[],includeDefaultPaths:false,runningExecutablePaths:[],windowsHints:{registryPaths:[],shortcutPaths:[],driveRoots:[]},stability:{pollIntervalMs:0,stableChecks:1,maxWaitMs:1000}})
  try{
    assert.equal((await scanner.start()).filesObserved,0)
    const folder=path.join(root,'Exports');await mkdir(folder);await writeFile(path.join(folder,'Only.jpg'),'photo')
    const extra=new ExtraScanDirectories(path.join(root,'sources.json'),scanner)
    const result=await extra.add((await extra.inspect(folder)).id)
    assert.equal(result.busy,false)
    assert.equal(database.connection.prepare("SELECT COUNT(*) AS c FROM assets WHERE asset_state='ready'").get()?.c,1)
  }finally{await scanner.stop();database.close();await rm(root,{recursive:true,force:true})}
})

test('a removal interrupted before indexing is recovered before sharing on the next startup',async()=>{
  const f=await fixture();let restarted:ScannerService|undefined
  try{
    const folder=path.join(f.root,'Interrupted exports');await mkdir(folder);await writeFile(path.join(folder,'Photo.jpg'),'photo')
    await f.extra.add((await f.extra.inspect(folder)).id);assert.equal(f.ready(),2)
    await f.scanner.stop()
    await writeFile(f.file,JSON.stringify({version:1,directories:[],retiredRoots:[folder]}))
    restarted=new ScannerService(f.database,{startingPaths:[f.game],runningExecutablePaths:[],watcher:false,extraDirectories:loadExtraScanDirectories(f.file),retiredExtraDirectories:loadRetiredExtraDirectories(f.file)})
    await restarted.start();assert.equal(f.ready(),1)
    assert.equal(await readFile(path.join(folder,'Photo.jpg'),'utf8'),'photo')
  }finally{await restarted?.stop();await f.close()}
})

test('actual filesystem watchers import newly created exports and stop watching a removed directory',async()=>{
  const f=await fixture();let watching:ScannerService|undefined
  try{
    await f.scanner.stop()
    watching=new ScannerService(f.database,{startingPaths:[f.game],runningExecutablePaths:[],watcher:true,debounceMs:10,stability:{pollIntervalMs:0,stableChecks:1,maxWaitMs:1000}})
    await watching.start()
    const extra=new ExtraScanDirectories(f.file,watching),folder=path.join(f.root,'Watched exports');await mkdir(folder)
    await extra.add((await extra.inspect(folder)).id)
    await writeFile(path.join(folder,'New.jpg'),'new')
    for(let attempt=0;attempt<80&&f.ready()!==2;attempt++)await new Promise(resolve=>setTimeout(resolve,25))
    assert.equal(f.ready(),2,'new exports should be indexed without a manual scan')
    await extra.remove(extra.state().directories[0]!.id)
    await writeFile(path.join(folder,'After-removal.jpg'),'retained locally')
    await new Promise(resolve=>setTimeout(resolve,80));assert.equal(f.ready(),1)
  }finally{await watching?.stop();await f.close()}
})

test('a physical game album cannot be added again through a different automatic-root spelling',async()=>{
  const f=await fixture();let aliased:ScannerService|undefined
  try{
    await f.scanner.stop()
    const alias=path.join(f.root,'Game alias');await symlink(f.game,alias,'junction')
    aliased=new ScannerService(f.database,{startingPaths:[alias],runningExecutablePaths:[],watcher:false})
    await aliased.start()
    const extra=new ExtraScanDirectories(f.file,aliased)
    await assert.rejects(extra.inspect(f.native),/already_covered/)
  }finally{await aliased?.stop();await f.close()}
})

test('interrupted removal through an alternate root spelling retires the indexed physical folder',async()=>{
  const f=await fixture();let restarted:ScannerService|undefined
  try{
    const folder=path.join(f.root,'Retired exports');await mkdir(folder);await writeFile(path.join(folder,'Photo.jpg'),'photo')
    await f.extra.add((await f.extra.inspect(folder)).id);assert.equal(f.ready(),2);await f.scanner.stop()
    const alias=path.join(f.root,'Retired alias');await symlink(folder,alias,'junction')
    await writeFile(f.file,JSON.stringify({version:1,directories:[],retiredRoots:[alias]}))
    restarted=new ScannerService(f.database,{startingPaths:[f.game],runningExecutablePaths:[],watcher:false,retiredExtraDirectories:loadRetiredExtraDirectories(f.file)})
    await restarted.start();assert.equal(f.ready(),1)
    assert.equal(await readFile(path.join(folder,'Photo.jpg'),'utf8'),'photo')
  }finally{await restarted?.stop();await f.close()}
})

test('external LIVE requires an exact cover/video name pair rather than a similar recording',async()=>{
  const f=await fixture()
  try{
    const folder=path.join(f.root,'Exported motion');await mkdir(folder)
    await writeFile(path.join(folder,'Photo_123_cover.jpg'),'cover');await writeFile(path.join(folder,'Recording_123.mp4'),'unrelated recording')
    await f.extra.add((await f.extra.inspect(folder)).id)
    const motions=()=>Number(f.database.connection.prepare("SELECT COUNT(*) AS c FROM assets WHERE asset_type='motion_photo' AND asset_state='ready'").get()?.c)
    assert.equal(motions(),0)
    await writeFile(path.join(folder,'Photo_123.mp4'),'matching video');await f.scanner.rescanPath(path.join(folder,'Photo_123.mp4'))
    assert.equal(motions(),1)
  }finally{await f.close()}
})

test('extra folders share independent MP4 recordings and cover-named pictures without inventing LIVE',async()=>{
  const f=await fixture()
  try{
    const folder=path.join(f.root,'SpinningMomo','Window');await mkdir(folder,{recursive:true})
    await writeFile(path.join(folder,'capture_cover.png'),'still')
    await writeFile(path.join(folder,'recording.mp4'),'video')
    const proposal=await f.extra.inspect(path.dirname(folder),'spinning_momo')
    assert.equal(proposal.images,1);assert.equal(proposal.videos,1)
    await f.extra.add(proposal.id)
    const rows=()=>f.database.connection.prepare("SELECT a.asset_id,a.asset_type,r.source_path FROM assets a JOIN resources r ON r.asset_id=a.asset_id WHERE a.asset_state='ready' AND r.source_path LIKE ? ORDER BY r.source_path").all(folder+'%') as Array<{asset_id:string;asset_type:string;source_path:string}>
    assert.deepEqual(rows().map(row=>row.asset_type),['photo','video'])
    const before=rows();await f.scanner.fullScan();assert.deepEqual(rows(),before)
    await rename(path.dirname(folder),path.dirname(folder)+'-offline');await f.scanner.fullScan();assert.deepEqual(rows(),before)
    await rename(path.dirname(folder)+'-offline',path.dirname(folder));await f.extra.remove(f.extra.state().directories[0]!.id)
    assert.equal(rows().length,0);assert.equal(await readFile(path.join(folder,'recording.mp4'),'utf8'),'video')
  }finally{await f.close()}
})

test('external files move safely between independent media and an exact LIVE pair on rescans',async()=>{
  const f=await fixture()
  try{
    const folder=path.join(f.root,'Exported media');await mkdir(folder)
    const cover=path.join(folder,'Pair_cover.jpeg'),video=path.join(folder,'Pair.mp4')
    await writeFile(video,'video');await f.extra.add((await f.extra.inspect(folder)).id)
    assert.equal(f.database.connection.prepare("SELECT COUNT(*) c FROM assets WHERE asset_type='video' AND asset_state='ready'").get()?.c,1)
    await writeFile(cover,'cover');await f.scanner.rescanPath(cover)
    assert.equal(f.database.connection.prepare("SELECT COUNT(*) c FROM assets WHERE asset_type='motion_photo' AND asset_state='ready'").get()?.c,1)
    assert.equal(f.database.connection.prepare("SELECT COUNT(*) c FROM assets WHERE asset_type='video' AND asset_state='ready'").get()?.c,0)
    await rm(cover);await f.scanner.rescanPath(cover)
    assert.equal(f.database.connection.prepare("SELECT COUNT(*) c FROM assets WHERE asset_type='video' AND asset_state='ready'").get()?.c,1)
    assert.equal(f.database.connection.prepare("SELECT COUNT(*) c FROM assets WHERE asset_type='motion_photo' AND asset_state='ready'").get()?.c,0)
    assert.equal(await readFile(video,'utf8'),'video')
  }finally{await f.close()}
})

test('replacing a photo at the same path never attaches the former photo parameters to new bytes',async()=>{
  const f=await fixture()
  try{
    const file=path.join(f.native,'Original.jpg');await writeFile(file,nativeJpeg);await f.scanner.fullScan()
    const row=f.database.connection.prepare("SELECT asset_id FROM resources WHERE source_path=?").get(file)!
    const assets=new AssetRepository(f.database),assetId=String(row.asset_id)
    assets.updateMetadata(assetId,{camera:{exposure:0.8},dressing:{clothes:[{id:'old-outfit'}]},userNotes:'keep the note',raw:{resolver:{status:'resolved'}}})
    await f.scanner.fullScan()
    assert.equal(JSON.parse(String(assets.getById(assetId)?.metadata_json)).camera.exposure,0.8,'unchanged source keeps enrichment')
    await writeFile(file,exportedJpeg);await f.scanner.fullScan()
    const metadata=JSON.parse(String(assets.getById(assetId)?.metadata_json))
    assert.equal(metadata.raw.nativeParamToken,undefined);assert.equal(metadata.raw.nativeParamPayload,undefined)
    assert.equal(metadata.raw.resolver,undefined);assert.equal(metadata.dressing,undefined);assert.deepEqual(metadata.camera,{})
    assert.equal(metadata.userNotes,'keep the note')
    assert.equal(metadata.raw.previousSourceMetadata.camera.exposure,0.8,'prior edits remain recoverable locally')
  }finally{await f.close()}
})

test('unchanged external video hashes are reused across scans and invalidated on changes',async()=>{
  const f=await fixture()
  try{
    const folder=path.join(f.root,'SpinningMomo');await mkdir(folder);const file=path.join(folder,'large.mp4')
    await writeFile(file,Buffer.alloc(1024*1024,4))
    const classifier=new ResourceClassifier(),extra={id:'recordings',path:folder,mode:'images' as const}
    let bytes=0;const first=await classifier.classify(file,folder,n=>{bytes+=n},extra);assert.equal(bytes,1024*1024);assert.equal(first.imageSha256,undefined)
    bytes=0;const second=await classifier.classify(file,folder,n=>{bytes+=n},extra);assert.equal(bytes,0);assert.equal(second.sha256,first.sha256)
    await writeFile(file,Buffer.alloc(1024*1024+1,5));bytes=0
    const changed=await classifier.classify(file,folder,n=>{bytes+=n},extra);assert.equal(bytes,1024*1024+1);assert.notEqual(changed.sha256,first.sha256)
    classifier.invalidate(file);bytes=0;await classifier.classify(file,folder,n=>{bytes+=n},extra);assert.equal(bytes,1024*1024+1)
  }finally{await f.close()}
})
