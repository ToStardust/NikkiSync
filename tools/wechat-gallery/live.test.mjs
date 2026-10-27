import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {prepareFixtures} from '../wechat-live-probe/prepare.mjs';
import {createPreviewSource,createIndexedPreviewSource} from './source.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
const resource=(path,bytes,mime)=>({sourcePath:path,sizeBytes:bytes.length,sha256:hash(bytes),mimeType:mime});
function entries(zip){const result={};let offset=0;while(zip.readUInt32LE(offset)===0x04034b50){const size=zip.readUInt32LE(offset+18),n=zip.readUInt16LE(offset+26),extra=zip.readUInt16LE(offset+28),start=offset+30+n+extra;
 result[zip.toString('utf8',offset+30,offset+30+n)]=zip.subarray(start,start+size);offset=start+size;}return result;}
test('real generic LIVP keeps all video/audio packets and pairs JPEG/MOV at actual cover PTS, not fixed two seconds',async()=>{
 const {exportLive}=await import('./live-export.mjs');const dir=await mkdtemp(join(tmpdir(),'nikki-live-export-'));
 try{await prepareFixtures(dir);const jpeg=await readFile(join(dir,'baseline.jpg')),video=await readFile(join(dir,'baseline.mp4'));
  const result=await exportLive(jpeg,video,{presentationUs:1000000,metadata:{camera:{focalLength:50}}});
  const pair=entries(Buffer.from(result.image));assert.deepEqual(Object.keys(pair),['photo.jpg','photo.mov']);
  assert.match(pair['photo.jpg'].toString('latin1'),/Apple iOS/);assert.equal(result.mime,'application/x-livp');
  await writeFile(join(dir,'actual.mov'),pair['photo.mov']);
  const probe=path=>{const p=spawnSync('ffprobe',['-v','error','-show_streams','-show_packets','-show_data_hash','sha256','-of','json',path],{encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024});assert.equal(p.status,0);return JSON.parse(p.stdout);};
  const before=probe(join(dir,'baseline.mp4')),after=probe(join(dir,'actual.mov'));
  for(const type of ['video','audio']){const a=before.streams.find(x=>x.codec_type===type),b=after.streams.find(x=>x.codec_type===type);assert.ok(b);assert.equal(b.codec_name,a.codec_name);
   assert.deepEqual(after.packets.filter(x=>x.stream_index===b.index).map(x=>[x.pts_time,x.duration_time,x.data_hash]),before.packets.filter(x=>x.stream_index===a.index).map(x=>[x.pts_time,x.duration_time,x.data_hash]));}
  assert.ok(after.streams.some(x=>x.codec_tag_string==='mebx'));assert.match(pair['photo.mov'].toString('latin1'),new RegExp(result.identifier));
  assert.match(pair['photo.jpg'].toString('latin1'),new RegExp(result.identifier));
  assert.deepEqual(await readFile(join(dir,'baseline.mp4')),video);assert.deepEqual(await readFile(join(dir,'baseline.jpg')),jpeg);
  const inferred=await exportLive(jpeg,video,{});assert.equal(inferred.presentationUs,1000000,'match decoded cover to real frame PTS');assert.notEqual(inferred.identifier,result.identifier);
  await assert.rejects(()=>exportLive(jpeg,video,{presentationUs:3000000}));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('generic export supports silent non-two-second video and preserves display rotation',async()=>{
 const {exportLive}=await import('./live-export.mjs');const dir=await mkdtemp(join(tmpdir(),'nikki-live-silent-'));try{
  const raw=join(dir,'raw.mp4'),input=join(dir,'source.mp4'),cover=join(dir,'cover.jpg');
  const ff=args=>{const r=spawnSync('ffmpeg',['-v','error','-nostdin',...args],{encoding:'utf8',windowsHide:true});assert.equal(r.status,0,r.stderr);};
  ff(['-n','-f','lavfi','-i','testsrc2=size=320x180:rate=25:duration=1.6','-c:v','libx264','-pix_fmt','yuv420p',raw]);
  ff(['-n','-display_rotation:v:0','90','-i',raw,'-c','copy',input]);ff(['-n','-i',input,'-ss','0.8','-frames:v','1',cover]);
  const before=spawnSync('ffprobe',['-v','error','-show_streams','-of','json',input],{encoding:'utf8',windowsHide:true});assert.equal(JSON.parse(before.stdout).streams[0].side_data_list.find(x=>x.side_data_type==='Display Matrix').rotation,90);
  const video=await readFile(input),jpeg=await readFile(cover),result=await exportLive(jpeg,video,{}),pair=entries(Buffer.from(result.image));assert.equal(result.presentationUs,800000);
  const output=join(dir,'pair.mov');await writeFile(output,pair['photo.mov']);const p=spawnSync('ffprobe',['-v','error','-count_frames','-show_streams','-of','json',output],{encoding:'utf8',windowsHide:true});assert.equal(p.status,0);
  const streams=JSON.parse(p.stdout).streams,v=streams.find(x=>x.codec_type==='video');assert.equal(Number(v.nb_read_frames),40);assert.equal(streams.some(x=>x.codec_type==='audio'),false);assert.equal(v.side_data_list.find(x=>x.side_data_type==='Display Matrix').rotation,90);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('Live source lists a paired asset once, verifies both resources, and cannot silently export a static cover',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'nikki-live-source-'));try{
  const still=Buffer.from([255,216,1,2,255,217]),video=Buffer.from([0,0,0,16,102,116,121,112,105,115,111,109,0,0,0,0]);
  const jpg=join(dir,'private-cover.jpg'),mp4=join(dir,'private-video.mp4');await writeFile(jpg,still);await writeFile(mp4,video);
  let seen;const source=await createPreviewSource([{...resource(jpg,still,'image/jpeg'),motion:{...resource(mp4,video,'video/mp4'),presentationUs:123}}],[dir],{exportLive:async(a,b,o)=>{seen={a:Buffer.from(a),b:Buffer.from(b),o};return {image:Buffer.from('PKfake'),mime:'application/x-livp'};}});
  const item=source.browse(0,{}).items[0];assert.equal(item.live,true);assert.equal(source.list(0).items[0].live,true);assert.doesNotMatch(JSON.stringify(source.list(0)),/private|sourcePath|sha256/);
  assert.deepEqual(Buffer.from((await source.motion(item.id)).image),video);await source.live(item.id,{exif:true,rotation:0});assert.deepEqual(seen.a,still);assert.deepEqual(seen.b,video);assert.equal(seen.o.presentationUs,123);
  await assert.rejects(()=>source.export(item.id,{exif:true,rotation:90}));
  await assert.rejects(()=>source.live(item.id,{exif:true,rotation:90}));
  await writeFile(mp4,Buffer.alloc(video.length));await assert.rejects(()=>source.live(item.id,{exif:true,rotation:0}));await assert.rejects(()=>source.motion(item.id));
  await assert.rejects(()=>createPreviewSource([{...resource(jpg,still,'image/jpeg'),motion:resource(join(dir,'..','outside.mp4'),video,'video/mp4')}],[dir]));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('canonical scanner motion assets reach WeChat without widening ordinary RemoteFileProvider permissions',async()=>{
 const {DatabaseManager,AssetRepository}=await import('../../packages/database/dist/src/index.js');const dir=await mkdtemp(join(tmpdir(),'nikki-live-index-')),db=new DatabaseManager(join(dir,'db.sqlite'));db.initialize();
 try{const still=Buffer.from([255,216,1,2,255,217]),video=Buffer.from([0,0,0,16,102,116,121,112,105,115,111,109,0,0,0,0]),jpg=join(dir,'cover.jpg'),mp4=join(dir,'video.mp4');await writeFile(jpg,still);await writeFile(mp4,video);
  const assetId='live-asset';new AssetRepository(db).reconcile({assetId,assetType:'motion_photo',assetState:'ready',discoveredAt:'2026-10-05T00:00:00.000Z',resources:[[jpg,still,'source_primary','image/jpeg'],[mp4,video,'source_motion','video/mp4']].map(([p,b,role,mime])=>({...resource(p,b,mime),assetId,resourceId:role,pathKey:p.toLowerCase(),fileName:role,fileExt:role==='source_primary'?'.jpg':'.mp4',role,stableState:'stable',isDerived:false}))});
  const source=await createIndexedPreviewSource(db,[dir]);assert.equal(source.count,1);assert.equal(source.browse(0,{}).items[0].live,true);
  const {RemoteFileProvider}=await import('../../apps/pc-companion/dist/src/remote/RemoteFileProvider.js');assert.equal(new RemoteFileProvider(db).getPhoto('source_primary'),undefined);
 }finally{db.close();await rm(dir,{recursive:true,force:true});}
});
