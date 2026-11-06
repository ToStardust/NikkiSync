import test from 'node:test';import assert from 'node:assert/strict';import{mkdtemp,writeFile,rm}from'node:fs/promises';import{tmpdir}from'node:os';import{join}from'node:path';import{createHash}from'node:crypto';
import{DatabaseManager,AssetRepository}from'../../packages/database/dist/src/index.js';import{createIndexedPreviewSource}from'./source.mjs';import{browseSnapshot}from'./browse.mjs';
test('scan discovery time never becomes capture time or a made-up current game version',async()=>{
 const root=await mkdtemp(join(tmpdir(),'momo-mini-date-')),db=new DatabaseManager();db.initialize();const assets=new AssetRepository(db),bytes=Buffer.from([255,216,1,2,255,217]);
 try{for(const [n,capturedAt]of [[0,undefined],[1,'2026-11-01T00:00:00.000Z']]){const file=join(root,n+'.jpg');await writeFile(file,bytes);assets.reconcile({assetId:'asset_'+n,assetType:'photo',assetState:'ready',discoveredAt:'2026-11-02T00:00:00.000Z',...(capturedAt?{capturedAt}:{}),resources:[{assetId:'asset_'+n,resourceId:'resource_'+n,role:'source_primary',sourcePath:file,pathKey:file.toLowerCase(),fileName:n+'.jpg',fileExt:'.jpg',mimeType:'image/jpeg',sizeBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),stableState:'stable',isDerived:false}]});}
  const s=await createIndexedPreviewSource(db,[root]),page=s.browse(0,{}),unknown=page.items.find(i=>i.version==='');assert.ok(unknown);assert.equal(unknown.date,'');assert.equal(unknown.versionSource,'unknown');assert.equal(page.items[0].version,'2.11','App places missing capture dates last');assert.equal(page.versions.find(i=>i.version==='2.11').count,1);assert.equal(page.versions.find(i=>i.version==='').count,1);
  assert.equal(s.metadata(unknown.id).rows.some(r=>r.label==='游戏版本'&&r.value==='2.11'),false);
 }finally{db.close();await rm(root,{recursive:true,force:true})}
});
test('equal capture dates use App default reverse asset-ID order, never random session opaque IDs',()=>{
 const row={date:'2026-11-02T00:00:00Z',metadata:{}},a={...row,id:'z',orderKey:'asset_a'},b={...row,id:'a',orderKey:'asset_b'};
 assert.deepEqual(browseSnapshot([a,b],0,{}).items.map(i=>i.id),['a','z']);
});
test('version groups follow first appearance in newest-first chronology, including imported older versions',()=>{
 const rows=[{id:'a',date:'2026-11-02T00:00:00Z',metadata:{identity:{gameVersion:'2.9'}}},{id:'b',date:'2026-11-01T00:00:00Z',metadata:{identity:{gameVersion:'2.11'}}},{id:'c',date:'2026-10-31T00:00:00Z',metadata:{identity:{gameVersion:'2.9'}}}];
 assert.deepEqual(browseSnapshot(rows,0,{}).items.map(i=>i.id),['a','c','b']);
});
