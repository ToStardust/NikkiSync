import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';

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
