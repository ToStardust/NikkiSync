import { randomBytes, createHash, createHmac } from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import { relative, isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SyncReadRepository } from '../../packages/database/dist/src/sync-read-repository.js';
import { playerMetadata } from './metadata.mjs';
import { RemoteFileProvider } from '../../apps/pc-companion/dist/src/remote/RemoteFileProvider.js';
import { discoverInfinityNikkiInstallation } from '../../apps/pc-companion/dist/src/game-directory-discovery.js';
import {browseSnapshot} from './browse.mjs';
import {exportJpeg,exportMetadata} from './photo-export.mjs';
import {rotatePng as defaultRotatePng} from './png-export.mjs';
import {outfitDescriptors} from './outfit.mjs';
import {exportLive as defaultExportLive} from './live-export.mjs';
const MAX_SOURCE = 16777216, MAX_PREVIEW = 524288;
const MAX_MOTION=100663296;
function contained(path, root) { const rel = relative(root, path); return rel !== '' && !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..\\') && !rel.startsWith('../'); }
export function resizePreview(bytes) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', fileURLToPath(new URL('./resize-preview.ps1', import.meta.url))],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = []; let size = 0, settled = false;
    const finish = error => { if (settled) return; settled = true; clearTimeout(timer); if (error) { child.kill(); reject(new Error('Preview conversion failed')); } else resolve(Buffer.concat(chunks)); };
    const timer = setTimeout(() => finish(true), 15000);
    child.on('error', () => finish(true)); child.stdin.on('error', () => finish(true)); child.stderr.on('data', () => {});
    child.stdout.on('data', chunk => { size += chunk.length; if (size > MAX_PREVIEW) finish(true); else chunks.push(chunk); });
    child.on('close', code => finish(code !== 0 || size < 4)); child.stdin.end(bytes);
  });
}
export async function createPreviewSource(resources, photoRoots, { resize = resizePreview, refreshResources,rotatePng=defaultRotatePng,loadIcon,exportLive=defaultExportLive } = {}) {
  if (!photoRoots.length) throw new Error('Invalid photo scope');
  const roots = await Promise.all(photoRoots.map(root => realpath(root))), identityKey = randomBytes(32);
  let snapshot = [];
  async function buildSnapshot(resources) {
   if (!Array.isArray(resources) || resources.length > 500) throw new Error('Invalid photo scope');
   const next = [];
   for (const resource of resources) {
    const canonical = await realpath(resource.sourcePath);
    if (!roots.some(root => contained(canonical, root)) || !/^[a-f0-9]{64}$/.test(resource.sha256)
      || !Number.isSafeInteger(resource.sizeBytes) || resource.sizeBytes < 4 || resource.sizeBytes > MAX_SOURCE) throw new Error('Photo outside scope');
    const date = Date.parse(resource.capturedAt || '');
    // Stable only inside this session, never an exposed resource id, path or content hash.
    const id = createHmac('sha256', identityKey).update(JSON.stringify([canonical,resource.sha256])).digest('hex').slice(0,32);
    if(next.some(record=>record.id===id))continue;
    let motion;
    if(resource.motion){
      const value=resource.motion,canonical=await realpath(value.sourcePath);
      if(!roots.some(root=>contained(canonical,root))||value.mimeType!=='video/mp4'||resource.mimeType!=='image/jpeg'||!Number.isSafeInteger(value.sizeBytes)||value.sizeBytes<16||value.sizeBytes+resource.sizeBytes>MAX_MOTION-131072||!/^[a-f0-9]{64}$/.test(value.sha256))throw new Error('Motion outside scope');
      motion={canonical,source:value.sourcePath,hash:value.sha256,size:value.sizeBytes,presentationUs:value.presentationUs};
    }
    next.push({ id, date: Number.isFinite(date) ? new Date(date).toISOString() : '',...(motion?{motion}:{}),
      canonical, source: resource.sourcePath, hash: resource.sha256, size: resource.sizeBytes,
      mime: resource.mimeType || 'image/jpeg', player: playerMetadata(resource.metadata), metadata: safeMetadata(resource.metadata),outfit:outfitDescriptors(resource.metadata,identityKey) });
   }
   return next;
  }
  snapshot = await buildSnapshot(resources);
  async function readSource(id) {
      const record = snapshot.find(x => x.id === id); if (!record) throw new Error('Unavailable');
      return {bytes:await readRecord(record),record};
  }
  async function readRecord(record,limit=MAX_SOURCE){
      if (await realpath(record.source) !== record.canonical) throw new Error('Source moved');
      const file = await open(record.canonical, 'r'); let bytes;
      try {
        const before = await file.stat(); if (!before.isFile() || before.size !== record.size || before.size > limit) throw new Error('Source changed');
        bytes = Buffer.alloc(before.size); let offset = 0;
        while (offset < bytes.length) { const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset); if (!bytesRead) throw new Error('Truncated'); offset += bytesRead; }
        const after = await file.stat();
        if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ino !== before.ino || createHash('sha256').update(bytes).digest('hex') !== record.hash) throw new Error('Source changed');
        return bytes;
      } catch (error) { bytes?.fill(0); throw error; }
      finally { await file.close(); }
  }
  return {
    get count() { return snapshot.length; },
    async refresh() {
      if (refreshResources) {
        const next = await buildSnapshot(await refreshResources());
        snapshot = next; // Failed discovery/validation never partially replaces the old snapshot.
      }
    },
    list(offset) {
      if (!Number.isInteger(offset) || offset < 0 || offset > snapshot.length) throw new Error('Offset');
      const items = snapshot.slice(offset, offset + 12).map(({ id, date,motion }) => ({ id, date,...(motion?{live:true}:{}) }));
      return { total: snapshot.length, offset, items, next: offset + items.length < snapshot.length ? offset + items.length : null };
    },
    browse(offset,query) {return browseSnapshot(snapshot,offset,query);},
    outfit(id,offset=0){
      const record=snapshot.find(x=>x.id===id);if(!record||!Number.isInteger(offset)||offset<0||offset>100)throw new Error('Outfit unavailable');
      const items=record.outfit.slice(offset,offset+6).map(({key,name,hasIcon})=>({key,name,hasIcon:hasIcon&&typeof loadIcon==='function'}));
      return {offset,total:record.outfit.length,items,next:offset+items.length<record.outfit.length?offset+items.length:null};
    },
    async icon(id,key){
      const entry=snapshot.find(x=>x.id===id)?.outfit.find(x=>x.key===key);if(!entry||!entry.hasIcon||typeof loadIcon!=='function')throw new Error('Icon unavailable');
      const value=await loadIcon(entry);if(!(value.image instanceof Uint8Array)||value.image.length<8||value.image.length>262144||value.mime!=='image/png'||!['item','category'].includes(value.source))throw new Error('Icon bounds');return value;
    },
    metadata(id) {
      const record = snapshot.find(x => x.id === id); if (!record) throw new Error('Unavailable');
      return structuredClone(record.player);
    },
    async original(id) {
      const {bytes,record}=await readSource(id);
      if (!['image/jpeg','image/png'].includes(record.mime)) {bytes.fill(0);throw new Error('Unsupported original');}
      return {image:bytes,mime:record.mime};
    },
    async export(id,options) {
      if(!options || typeof options.exif!=='boolean' || ![0,90,180,270].includes(options.rotation) || Object.keys(options).some(x=>!['exif','rotation'].includes(x)))throw new Error('Export options');
      const {bytes,record}=await readSource(id);
      try {
        if(record.motion)throw new Error('Use Live export, never save only a cover');
        if(record.mime==='image/jpeg')return {image:exportJpeg(bytes,record.metadata,options),mime:record.mime,exifApplied:options.exif,rotation:options.rotation};
        if(record.mime==='image/png' && options.rotation===0)return {image:Buffer.from(bytes),mime:record.mime,exifApplied:false,rotation:0};
        if(record.mime==='image/png')return {image:await rotatePng(bytes,options.rotation),mime:record.mime,exifApplied:false,rotation:options.rotation};
        throw new Error('Export type unsupported');
      } finally {bytes.fill(0);}
    },
    async motion(id){
      const record=snapshot.find(x=>x.id===id);if(!record?.motion)throw new Error('Live unavailable');
      const bytes=await readRecord(record.motion,MAX_MOTION);return {image:bytes,mime:'video/mp4'};
    },
    async live(id,options){
      if(!options||typeof options.exif!=='boolean'||options.rotation!==0||Object.keys(options).some(x=>!['exif','rotation'].includes(x)))throw new Error('Live rotation requires synchronized video processing');
      const {bytes,record}=await readSource(id);let video;
      try{if(!record.motion)throw new Error('Live unavailable');video=await readRecord(record.motion,MAX_MOTION);
        return await exportLive(bytes,video,{exif:options.exif,metadata:record.metadata,presentationUs:record.motion.presentationUs});
      }finally{bytes.fill(0);video?.fill(0);}
    },
    async preview(id) {
      const {bytes}=await readSource(id);
      try {
        const preview = Uint8Array.from(await resize(bytes));
        if (preview.length < 4 || preview.length > MAX_PREVIEW || preview[0] !== 255 || preview[1] !== 216 || preview.at(-2) !== 255 || preview.at(-1) !== 217) throw new Error('Invalid preview');
        return preview;
      } finally { bytes?.fill(0); }
    }
  };
}
function safeMetadata(metadata){
 const safe=exportMetadata(metadata);
 return {identity:{...(safe.version?{gameVersion:safe.version}:{})},capture:{...(safe.capturedAt?{capturedAt:safe.capturedAt}:{})},camera:safe.camera,
  dressing:{clothes:safe.clothes.map(name=>({name}))},...(safe.filter?{filter:{name:safe.filter}}:{}),...(safe.lighting?{lighting:{name:safe.lighting}}:{}),...(safe.location?{location:{name:safe.location}}:{})};
}
export async function openLocalPreviewSource(databasePath, {discover=discoverInfinityNikkiInstallation} = {}) {
  // Existing discovery and repositories, no new index/schema or game-process inspection.
  const installation = await discover({ runningExecutablePaths: [] });
  if (!installation?.photoRoots.length) throw new Error('Game photo roots unavailable');
  const { DatabaseSync } = await import('node:sqlite');
  const connection = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const source=await createIndexedPreviewSource({connection}, [...new Set([...installation.photoRoots,...(installation.motionRoots||[])])]);
    let closed=false;
    return Object.assign(source,{close(){if(!closed){closed=true;connection.close();}}});
  } catch(error) { connection.close();throw error; }
}
// EXE: use the already-open canonical database and discovered roots; no parallel scanner/index.
export async function createIndexedPreviewSource(database, photoRoots, options = {}) {
    const provider = new RemoteFileProvider(database), reads=new SyncReadRepository(database);
    async function collect() {
    const resources = []; let cursor;
    do {
      const page = provider.listPhotos(cursor);
      for (const item of page.items) {
        const resource = provider.getPhoto(item.resourceId); if (!resource) continue;
        if (resource.sizeBytes > MAX_SOURCE) continue;
        try { const canonical = await realpath(resource.sourcePath); if (photoRoots.some(root => contained(canonical, root))) {
          const raw=reads.getAsset(resource.assetId)?.metadata_json;
          let metadata; try { if(typeof raw==='string' && raw.length<=1048576) metadata=JSON.parse(raw); } catch {}
          resources.push({ ...resource, capturedAt: item.capturedAt, metadata });
        } }
        catch { /* deleted or unavailable files are not shared */ }
        if (resources.length >= 500) break;
      }
      cursor = page.nextCursor;
    } while (cursor && resources.length < 500);
    let motionCursor;
    do{
      const page=reads.listAssets({limit:60,assetType:'motion_photo',...(motionCursor?{cursorTime:motionCursor.t,cursorAssetId:motionCursor.id}:{})});
      for(const asset of page){
        if(asset.asset_state!=='ready')continue;
        const rows=reads.listResources(String(asset.asset_id)).filter(x=>x.stable_state==='stable');
        const still=rows.find(x=>x.role==='source_primary'&&x.mime_type==='image/jpeg'),motion=rows.find(x=>x.role==='source_motion'&&x.mime_type==='video/mp4');
        if(!still||!motion||Number(still.size_bytes)>MAX_SOURCE||Number(still.size_bytes)+Number(motion.size_bytes)>MAX_MOTION-131072)continue;
        try{
          for(const row of [still,motion]){const p=await realpath(String(row.source_path));if(!photoRoots.some(root=>contained(p,root)))throw new Error('Live out of scope');}
          let metadata;try{if(typeof asset.metadata_json==='string'&&asset.metadata_json.length<=1048576)metadata=JSON.parse(asset.metadata_json);}catch{}
          const map=row=>({sourcePath:String(row.source_path),mimeType:String(row.mime_type),sha256:String(row.sha256),sizeBytes:Number(row.size_bytes)});
          resources.push({...map(still),capturedAt:String(asset.captured_at??asset.discovered_at),metadata,motion:{...map(motion),...(asset.motion_presentation_timestamp_us==null?{}:{presentationUs:Number(asset.motion_presentation_timestamp_us)})}});
        }catch{/* Only complete, indexed and contained Live pairs are shared. */}
      }
      const last=page.at(-1);motionCursor=page.length===60&&last?{t:String(last.captured_at??last.discovered_at),id:String(last.asset_id)}:undefined;
    }while(motionCursor&&resources.length<1000);
    resources.sort((a,b)=>(b.capturedAt||'').localeCompare(a.capturedAt||''));
    resources.length=Math.min(resources.length,500);
    return resources;
    }
    return await createPreviewSource(await collect(), photoRoots, {...options,refreshResources:collect});
}
