import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdtemp,mkdir,writeFile,readFile,rename,rm,symlink} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {DatabaseManager} from '@nikkisync/database'
import {ScannerService} from '../src/scanner/ScannerService.js'
import {ExtraScanDirectories,loadExtraScanDirectories,loadRetiredExtraDirectories} from '../src/scanner/ExtraScanDirectories.js'
import {createDesktopControlServer} from '../src/desktop/DesktopControlServer.js'

async function fixture(){
  const root=await mkdtemp(path.join(os.tmpdir(),'momo-extra-'))
  const game=path.join(root,'InfinityNikki'),native=path.join(game,'X6Game/Saved/GamePlayPhotos/10001/NikkiPhotos_HighQuality')
  await mkdir(native,{recursive:true});await writeFile(path.join(game,'InfinityNikki.exe'),'')
  await writeFile(path.join(native,'Original.jpg'),'native')
  const database=new DatabaseManager(':memory:');database.initialize()
  const scanner=new ScannerService(database,{startingPaths:[game],runningExecutablePaths:[],watcher:false,stability:{pollIntervalMs:0,stableChecks:1,maxWaitMs:1000}})
  await scanner.start()
  const file=path.join(root,'extra.json'),extra=new ExtraScanDirectories(file,scanner)
  return {root,game,native,database,scanner,extra,file,ready:()=>Number(database.connection.prepare("SELECT COUNT(*) AS c FROM assets WHERE asset_state='ready'").get()?.c),close:async()=>{await scanner.stop();database.close();await rm(root,{recursive:true,force:true})}}
}

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
    const id=f.extra.state().directories[0]!.id
    await fetch(url+'/api/scan-directories/remove',{method:'POST',headers,body:JSON.stringify({id})})
    assert.equal(f.ready(),1)
    assert.equal(f.database.connection.prepare("SELECT COUNT(*) AS c FROM resources WHERE source_path=? AND stable_state='stable'").get(path.join(folder,'External.jpg'))?.c,0)
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
