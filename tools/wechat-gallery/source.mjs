import { randomBytes, createHash, createHmac } from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import { relative, isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SyncReadRepository } from '../../packages/database/dist/src/sync-read-repository.js';
import { boundedPlayerMetadata, displayedPose, playerMetadata } from './metadata.mjs';
import { RemoteFileProvider } from '../../apps/pc-companion/dist/src/remote/RemoteFileProvider.js';
import { discoverInfinityNikkiInstallation } from '../../apps/pc-companion/dist/src/game-directory-discovery.js';
import {browseSnapshot, MAX_GALLERY_ITEMS} from './browse.mjs';
import {exportJpeg,exportMetadata} from './photo-export.mjs';
import {rotatePng as defaultRotatePng} from './png-export.mjs';
import {outfitDescriptors} from './outfit.mjs';
import {exportLive as defaultExportLive} from './live-export.mjs';
import { MAX_MOTION, rotateMotionVideo } from './motion-rotation.mjs';
import {mediaFingerprint} from '../../apps/pc-companion/dist/src/server/MediaFingerprint.js';
const MAX_SOURCE = 16777216, MAX_PREVIEW = 524288;
function contained(path, root) { const rel = relative(root, path); return rel !== '' && !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..\\') && !rel.startsWith('../'); }
export function resizePreview(bytes) {
  return new Promise((resolve, reject) => {
    // Fixed local helper only; this option does not modify CurrentUser or LocalMachine policy.
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('./resize-preview.ps1', import.meta.url))],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = []; let size = 0, settled = false;
    const finish = error => { if (settled) return; settled = true; clearTimeout(timer); if (error) { child.kill(); reject(new Error('Preview conversion failed')); } else resolve(Buffer.concat(chunks)); };
    const timer = setTimeout(() => finish(true), 15000);
    child.on('error', () => finish(true)); child.stdin.on('error', () => finish(true)); child.stderr.on('data', () => {});
    child.stdout.on('data', chunk => { size += chunk.length; if (size > MAX_PREVIEW) finish(true); else chunks.push(chunk); });
    child.on('close', code => finish(code !== 0 || size < 4)); child.stdin.end(bytes);
  });
}
export async function createPreviewSource(resources, photoRoots, { resize = resizePreview, refreshResources, readCurrentAsset,rotatePng=defaultRotatePng,loadIcon,localClothingIcons,convertLocalWebp,exportLive=defaultExportLive, motionFfmpeg,cacheSecret } = {}) {
  if (!photoRoots.length) throw new Error('Invalid photo scope');
  const roots = await Promise.all(photoRoots.map(root => realpath(root))), identityKey = randomBytes(32);
  let snapshot = [];
  const iconsAvailable = !!localClothingIcons || typeof loadIcon === 'function';
  const cacheKey = (domain, value) => createHmac('sha256',cacheSecret).update(domain).update(JSON.stringify(value)).digest('hex');
  function present(metadata, capturedAt) {
    const share = playerMetadata(metadata, true);
    const effects = [];
    for (const [kind, label, entry] of [['pose', '动作', displayedPose(metadata)],
      ['lighting', '光照', metadata?.lighting], ['filter', '滤镜', metadata?.filter]]) {
      const id = entry?.id;
      if (typeof id !== 'string' && typeof id !== 'number') continue;
      const digest = localClothingIcons?.effectSha256For(kind, String(id));
      if (digest) {
        const key = createHmac('sha256', identityKey).update(JSON.stringify(['effect', kind, id, digest])).digest('hex').slice(0,32);
        effects.push({ kind, id: String(id), key });
        if (!share.rows.some(row => row.label === label)) share.rows.push({ label, value: '已使用' });
      }
    }
    return {
      player: boundedPlayerMetadata(share), share, effects,
      outfit: outfitDescriptors(metadata, identityKey, localClothingIcons),
      metadata: safeMetadata({...metadata,capture:{...metadata?.capture,capturedAt:capturedAt??metadata?.capture?.capturedAt}})
    };
  }
  function currentPresentation(record) {
    if (!readCurrentAsset || !record.deletionTarget || record.video) return record.presentation;
    const asset = readCurrentAsset(record.deletionTarget);
    if (!asset) throw new Error('Unavailable');
    const revision = Number(asset.revision);
    if (revision !== record.metadataRevision) {
      record.presentation = present(parseIndexedMetadata(asset.metadata_json), record.capturedAt);
      record.metadataRevision = revision;
    }
    return record.presentation;
  }
  async function buildSnapshot(resources) {
   if (!Array.isArray(resources) || resources.length > MAX_GALLERY_ITEMS) throw new Error('Invalid photo scope');
   const next = [], ids = new Set();
   for (const resource of resources) {
    const video=resource.mimeType==='video/mp4';
    const canonical = await realpath(resource.sourcePath);
    if (!roots.some(root => contained(canonical, root)) || !/^[a-f0-9]{64}$/.test(resource.sha256)
      || !Number.isSafeInteger(resource.sizeBytes) || resource.sizeBytes < 4 || resource.sizeBytes > (video?MAX_MOTION:MAX_SOURCE)) throw new Error('Photo outside scope');
    const date = Date.parse(resource.capturedAt || '');
    // Stable only inside this session, never an exposed resource id, path or content hash.
    const id = createHmac('sha256', identityKey).update(JSON.stringify([canonical,resource.sha256])).digest('hex').slice(0,32);
    if(ids.has(id))continue;
    ids.add(id);
    let motion;
    if(resource.motion){
      const value=resource.motion,canonical=await realpath(value.sourcePath);
      if(!roots.some(root=>contained(canonical,root))||value.mimeType!=='video/mp4'||resource.mimeType!=='image/jpeg'||!Number.isSafeInteger(value.sizeBytes)||value.sizeBytes<16||value.sizeBytes+resource.sizeBytes>MAX_MOTION-131072||!/^[a-f0-9]{64}$/.test(value.sha256))throw new Error('Motion outside scope');
      motion={canonical,source:value.sourcePath,hash:value.sha256,size:value.sizeBytes,presentationUs:value.presentationUs};
    }
    const presentation = present(resource.metadata, resource.capturedAt);
    const previewKey = cacheSecret && cacheKey('preview-v1',[canonical,resource.sha256]);
    next.push({ id, previewKey, date: Number.isFinite(date) ? new Date(date).toISOString() : '',...(motion?{motion}:{}),...(video?{video:true}:{}),
      canonical, source: resource.sourcePath, hash: resource.sha256, size: resource.sizeBytes, deletionTarget:resource.deletionTarget,sortAt:resource.sortAt||resource.capturedAt||'',orderKey:resource.orderKey||id,
      mime: resource.mimeType || 'image/jpeg', metadata: presentation.metadata, presentation,
      metadataRevision: resource.deletionTarget?.revision, capturedAt: resource.capturedAt });
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
    ...(cacheSecret ? {
      previewCacheKeys(ids) {
        return ids.map(id => {
          const record = snapshot.find(item=>item.id===id);
          if (!record) throw Error('Unavailable');
          return record.previewKey;
        });
      },
      cachedDetails(id, knownVersion) {
        const record = snapshot.find(item=>item.id===id);
        if (!record) throw Error('Unavailable');
        const {player,outfit}=currentPresentation(record);
        const items=outfit.map(({key,name,hasIcon,cacheKey})=>({key,name,hasIcon:hasIcon&&iconsAvailable,cacheKey}));
        const version=cacheKey('details-v1',[record.previewKey,player,items.map(({name,hasIcon,cacheKey})=>[name,hasIcon,cacheKey])]);
        return version===knownVersion ? {version,unchanged:true} : {version,...player,items};
      }
    } : {}),
    galleryItemLimit: MAX_GALLERY_ITEMS,
    deletionTarget(id){const record=snapshot.find(x=>x.id===id);if(!record?.deletionTarget)throw Error('Deletion unavailable');return {...record.deletionTarget};},
    async refresh() {
      if (refreshResources) {
        const next = await buildSnapshot(await refreshResources());
        snapshot = next; // Failed discovery/validation never partially replaces the old snapshot.
      }
    },
    list(offset, limit = MAX_GALLERY_ITEMS) {
      const total = Math.min(snapshot.length, limit);
      if (!Number.isInteger(offset) || offset < 0 || offset > total) throw new Error('Offset');
      const items = snapshot.slice(offset, Math.min(offset + 12, total)).map(({ id, date,motion,video }) => ({ id, date,...(motion?{live:true}:{}),...(video?{video:true}:{}) }));
      return { total, offset, items, next: offset + items.length < total ? offset + items.length : null };
    },
    browse(offset,query,limit = MAX_GALLERY_ITEMS) {
      const visible = snapshot.length <= limit ? snapshot : snapshot.slice(0,limit);
      return browseSnapshot(visible,offset,query);
    },
    outfit(id,offset=0,cacheKeys=false){
      const record=snapshot.find(x=>x.id===id);if(!record||!Number.isInteger(offset)||offset<0||offset>100)throw new Error('Outfit unavailable');
      const {outfit}=currentPresentation(record);
      const items=outfit.slice(offset,offset+6).map(({key,name,hasIcon,cacheKey})=>({key,name,hasIcon:hasIcon&&iconsAvailable,...(cacheKeys&&hasIcon?{cacheKey}:{})}));
      return {offset,total:outfit.length,items,next:offset+items.length<outfit.length?offset+items.length:null};
    },
    async icon(id,key){
      const record=snapshot.find(x=>x.id===id);
      const presentation=record&&currentPresentation(record);
      const entry=presentation?.outfit.find(x=>x.key===key&&x.hasIcon);
      const effect=presentation?.effects.find(x=>x.key===key);
      if(!(entry||effect)||!iconsAvailable)throw new Error('Icon unavailable');
      if(localClothingIcons){
        const icon=effect ? await localClothingIcons.readEffect(effect.kind,effect.id)
          : await localClothingIcons.read(entry.localClothingId);
        if(!icon)throw new Error('Icon unavailable');
        const image=icon.mime==='image/webp'?await convertLocalWebp?.(icon.image):icon.image;
        if(!(image instanceof Uint8Array)||image.length<8||image.length>262144||
          ![137,80,78,71,13,10,26,10].every((byte,index)=>image[index]===byte))throw new Error('Icon conversion unavailable');
        return {image,mime:'image/png',source:icon.source};
      }
      const value=await loadIcon(entry);if(!(value.image instanceof Uint8Array)||value.image.length<8||value.image.length>262144||value.mime!=='image/png'||!['item','category'].includes(value.source))throw new Error('Icon bounds');return value;
    },
    metadata(id) {
      const record = snapshot.find(x => x.id === id); if (!record) throw new Error('Unavailable');
      return structuredClone(currentPresentation(record).player);
    },
    shareDetails(id, includeFilter = false) {
      const record = snapshot.find(x => x.id === id); if (!record) throw new Error('Unavailable');
      const { share, effects } = currentPresentation(record);
      return { ...structuredClone(share), effectIcons: Object.fromEntries(effects
        .filter(effect => includeFilter || effect.kind !== 'filter').map(effect => [effect.kind, effect.key])) };
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
        if(record.mime==='image/jpeg')return {image:exportJpeg(bytes,record.metadata,options),mime:record.mime,exifApplied:options.exif,rotation:options.rotation};
        if(record.mime==='image/png' && options.rotation===0)return {image:Buffer.from(bytes),mime:record.mime,exifApplied:false,rotation:0};
        if(record.mime==='image/png')return {image:await rotatePng(bytes,options.rotation),mime:record.mime,exifApplied:false,rotation:options.rotation};
        throw new Error('Export type unsupported');
      } finally {bytes.fill(0);}
    },
    motionRotation: Boolean(motionFfmpeg),
    async motion(id, rotation = 0) {
      const record=snapshot.find(x=>x.id===id);if(!record?.motion&&!record?.video)throw new Error('Video unavailable');
      if (rotation !== 0 && !motionFfmpeg) throw new Error('Video rotation unavailable');
      const bytes = await readRecord(record.motion || record, MAX_MOTION);
      if (rotation === 0) return { image: bytes, mime: 'video/mp4' };
      try {
        return { image: await rotateMotionVideo(bytes, rotation, motionFfmpeg), mime: 'video/mp4' };
      } finally {
        bytes.fill(0);
      }
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
 const explicit=metadata?.identity?.gameVersion;
 return {identity:{...(typeof explicit==='string'&&/^\d{1,3}(\.\d{1,3}){1,2}$/.test(explicit.trim())?{gameVersion:explicit.trim()}:{})},capture:{...(safe.capturedAt?{capturedAt:safe.capturedAt}:{})},camera:safe.camera,
  dressing:safe.dressing,...(safe.poseParameters?{pose:safe.poseParameters}:{}),...(safe.actionParameters?{action:safe.actionParameters}:{}),...(safe.filter?{filter:{...safe.filterParameters,name:safe.filter}}:{}),...(safe.lighting?{lighting:{...safe.lightingParameters,name:safe.lighting}}:{}),...(safe.location?{location:{name:safe.location}}:{})};
}
function parseIndexedMetadata(raw) {
  try {
    if (typeof raw !== 'string' || raw.length > 1048576) return undefined;
    const metadata = JSON.parse(raw);
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
    // A gallery only needs presentation data. Avoid retaining a library of raw encoded envelopes.
    const version = metadata.raw?.dictionary?.providerVersion;
    delete metadata.raw;
    if (typeof version === 'string') metadata.raw = {dictionary:{providerVersion:version.slice(0,256)}};
    return metadata;
  } catch { /* Invalid indexed metadata has no presentation. */ }
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
export async function createIndexedPreviewSource(database, photoRoots, {
  reads = new SyncReadRepository(database), exportCopies, ...options
} = {}) {
    const provider = new RemoteFileProvider(database, reads);
    function readCurrentAsset(target) {
      const asset = reads.getAsset(target.assetId);
      // Keep the selected account and this session's original media identity authoritative.
      if (asset?.asset_state !== 'ready' || !target.mediaFingerprint
          || mediaFingerprint(reads.listResources(target.assetId)) !== target.mediaFingerprint) return undefined;
      return asset;
    }
    async function collect() {
    const resources = []; let cursor;
    // Older index rows may still expose a copy that the scanner identified as an exact export.
    const copies = exportCopies?.();
    do {
      const page = provider.listPhotos(cursor);
      for (const item of page.items) {
        const resource = provider.getPhoto(item.resourceId); if (!resource) continue;
        if (resource.sizeBytes > MAX_SOURCE) continue;
        if (copies?.get(resource.sourcePath) === resource.sha256) continue;
        try { const canonical = await realpath(resource.sourcePath); if (photoRoots.some(root => contained(canonical, root))) {
          const asset=reads.getAsset(resource.assetId);
          const metadata=parseIndexedMetadata(asset?.metadata_json);
          resources.push({ ...resource, capturedAt: String(asset.captured_at??''),sortAt:String(asset.captured_at??asset.discovered_at),orderKey:String(asset.asset_id), metadata,deletionTarget:{assetId:resource.assetId,revision:Number(asset.revision),mediaFingerprint:mediaFingerprint(reads.listResources(resource.assetId))} });
        } }
        catch { /* deleted or unavailable files are not shared */ }
        if (resources.length >= MAX_GALLERY_ITEMS) break;
      }
      cursor = page.nextCursor;
    } while (cursor && resources.length < MAX_GALLERY_ITEMS);
    const photoCount=resources.length;
    let motionCursor;
    do{
      const page=reads.listAssets({limit:60,assetType:'motion_photo',...(motionCursor?{cursorTime:motionCursor.t,cursorAssetId:motionCursor.id}:{})});
      for(const asset of page){
        if(asset.asset_state!=='ready')continue;
        const all=reads.listResources(String(asset.asset_id)),rows=all.filter(x=>x.stable_state==='stable');
        const still=rows.find(x=>x.role==='source_primary'&&x.mime_type==='image/jpeg'),motion=rows.find(x=>x.role==='source_motion'&&x.mime_type==='video/mp4');
        if(!still||!motion||Number(still.size_bytes)>MAX_SOURCE||Number(still.size_bytes)+Number(motion.size_bytes)>MAX_MOTION-131072)continue;
        try{
          for(const row of [still,motion]){const p=await realpath(String(row.source_path));if(!photoRoots.some(root=>contained(p,root)))throw new Error('Live out of scope');}
          const metadata=parseIndexedMetadata(asset.metadata_json);
          const map=row=>({sourcePath:String(row.source_path),mimeType:String(row.mime_type),sha256:String(row.sha256),sizeBytes:Number(row.size_bytes)});
          resources.push({...map(still),deletionTarget:{assetId:String(asset.asset_id),revision:Number(asset.revision),mediaFingerprint:mediaFingerprint(all)},capturedAt:String(asset.captured_at??''),sortAt:String(asset.captured_at??asset.discovered_at),orderKey:String(asset.asset_id),metadata,motion:{...map(motion),...(asset.motion_presentation_timestamp_us==null?{}:{presentationUs:Number(asset.motion_presentation_timestamp_us)})}});
          if(resources.length-photoCount>=MAX_GALLERY_ITEMS)break;
        }catch{/* Only complete, indexed and contained Live pairs are shared. */}
      }
      const last=page.at(-1);motionCursor=page.length===60&&last?{t:String(last.captured_at??last.discovered_at),id:String(last.asset_id)}:undefined;
    }while(motionCursor&&resources.length-photoCount<MAX_GALLERY_ITEMS);
    const stillAndMotionCount=resources.length;
    let videoCursor;
    do{
      const page=reads.listAssets({limit:60,assetType:'video',...(videoCursor?{cursorTime:videoCursor.t,cursorAssetId:videoCursor.id}:{})});
      for(const asset of page){
        if(asset.asset_state!=='ready')continue;
        const video=reads.listResources(String(asset.asset_id)).find(row=>row.stable_state==='stable'&&row.role==='source_motion'&&row.mime_type==='video/mp4');
        if(!video||Number(video.size_bytes)<16||Number(video.size_bytes)>MAX_MOTION)continue;
        try{const canonical=await realpath(String(video.source_path));if(!photoRoots.some(root=>contained(canonical,root)))continue;
          resources.push({sourcePath:String(video.source_path),sha256:String(video.sha256),sizeBytes:Number(video.size_bytes),mimeType:'video/mp4',deletionTarget:{assetId:String(asset.asset_id),revision:Number(asset.revision),mediaFingerprint:mediaFingerprint(reads.listResources(String(asset.asset_id)))},capturedAt:String(asset.captured_at??''),sortAt:String(asset.captured_at??asset.discovered_at),orderKey:String(asset.asset_id)});
          if(resources.length-stillAndMotionCount>=MAX_GALLERY_ITEMS)break;
        }catch{/* Unavailable sources are not shared. */}
      }
      const last=page.at(-1);videoCursor=page.length===60&&last?{t:String(last.captured_at??last.discovered_at),id:String(last.asset_id)}:undefined;
    }while(videoCursor&&resources.length-stillAndMotionCount<MAX_GALLERY_ITEMS);
    resources.sort((a,b)=>(b.capturedAt||'').localeCompare(a.capturedAt||'')||(b.orderKey||'').localeCompare(a.orderKey||''));
    resources.length=Math.min(resources.length,MAX_GALLERY_ITEMS);
    return resources;
    }
    // The scanner and metadata resolver write through this same PC database connection.
    const changes = database.connection.prepare('SELECT total_changes() AS revision');
    let snapshotRevision = changes.get().revision;
    const source = await createPreviewSource(await collect(), photoRoots, {...options,refreshResources:collect,readCurrentAsset});
    return Object.assign(source, {
      async refreshIfIndexChanged() {
        const revision = changes.get().revision;
        if (revision === snapshotRevision) return false;
        await source.refresh();
        snapshotRevision = revision;
        return true;
      }
    });
}
