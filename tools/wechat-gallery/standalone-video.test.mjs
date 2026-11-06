import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {DatabaseManager,AssetRepository} from '../../packages/database/dist/src/index.js';import {createIndexedPreviewSource} from './source.mjs';
test('indexed standalone MP4 is a video, never a LIVE pair or photo export, and changed bytes are refused',async()=>{
 const root=await mkdtemp(join(tmpdir(),'nikki-wechat-video-')),db=new DatabaseManager(':memory:');db.initialize();
 try{
  const bytes=Buffer.from([0,0,0,16,102,116,121,112,105,115,111,109,0,0,0,0]),file=join(root,'clip.mp4');await writeFile(file,bytes);
  new AssetRepository(db).reconcile({assetId:'video',assetType:'video',assetState:'ready',discoveredAt:'2026-11-01T00:00:00Z',resources:[{resourceId:'video-resource',assetId:'video',role:'source_motion',fileName:'clip.mp4',fileExt:'.mp4',sourcePath:file,pathKey:file.toLowerCase(),mimeType:'video/mp4',sizeBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),stableState:'stable',isDerived:false}]});
  const source=await createIndexedPreviewSource(db,[root]),item=source.browse(0,{}).items[0];assert.equal(item.video,true);assert.equal(item.live,undefined);assert.equal(item.mime,'video/mp4');assert.equal(source.list(0).items[0].video,true);
  assert.deepEqual(Buffer.from((await source.motion(item.id)).image),bytes);await assert.rejects(()=>source.original(item.id));
  await writeFile(file,Buffer.alloc(bytes.length));await assert.rejects(()=>source.motion(item.id));
 }finally{db.close();await rm(root,{recursive:true,force:true})}
});
