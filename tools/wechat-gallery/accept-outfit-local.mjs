// Read-only real index and existing public icon cache; no source photos copied or external requests.
import {DatabaseSync} from 'node:sqlite';
import {readdir,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes,createHash} from 'node:crypto';
import net from 'node:net';
import {createIndexedPreviewSource,createGalleryServer,clientApi} from '../../apps/pc-companion/dist/src/wechat/GalleryRuntime.mjs';
import {WeChatIconProvider,resizeWeChatIcon} from '../../apps/pc-companion/dist/src/wechat/WeChatIconProvider.js';
import {discoverInfinityNikkiInstallation} from '../../apps/pc-companion/dist/src/game-directory-discovery.js';
const data=join(process.env.LOCALAPPDATA,'NikkiSync'),cacheDir=join(data,'metadata-thumbnails'),records=new Map();
for(const name of await readdir(cacheDir)){
 if(!/^[a-f0-9]{64}\.json$/.test(name))continue;
 try{const record=JSON.parse(await readFile(join(cacheDir,name),'utf8'));if(typeof record.sourceUrl==='string'&&typeof record.versionKey==='string')records.set(record.versionKey+'\n'+record.sourceUrl,{path:join(cacheDir,name.slice(0,-5)+'.img'),mimeType:record.mimeType,sizeBytes:record.sizeBytes,sha256:record.sha256});}catch{}
}
let reads=0,resizes=0;
const readonlyCache={get:async(url,versionKey)=>{const value=records.get(versionKey+'\n'+url);if(!value)throw new Error('Not already cached');reads++;return value;}};
const provider=new WeChatIconProvider(readonlyCache,bytes=>{resizes++;return resizeWeChatIcon(bytes,join(import.meta.dirname,'resize-icon.ps1'));});
const connection=new DatabaseSync(join(data,'nikkisync.sqlite'),{readOnly:true});let channel,stop;
try{
 const installation=await discoverInfinityNikkiInstallation({runningExecutablePaths:[]});if(!installation)throw new Error('Game roots unavailable');
 const source=await createIndexedPreviewSource({connection},installation.photoRoots,{loadIcon:descriptor=>provider.get(descriptor)});let photos=[],offset=0;
 do{const page=source.browse(offset,{});photos.push(...page.items);offset=page.next;}while(offset!==null);
 const chosen=[];
 for(const old of [true,false]){
  for(const photo of photos){if(!photo.version||(old?photo.version==='2.9':photo.version!=='2.9'))continue;
   let found;for(let n=0;n<100&&!found;){const outfit=source.outfit(photo.id,n);for(const item of outfit.items){if(!item.hasIcon||item.name==='名称待解析')continue;try{const icon=await source.icon(photo.id,item.key);icon.image.fill(0);found={photo,item};break;}catch{}}if(outfit.next===null)break;n=outfit.next;}
   if(found){chosen.push(found);break;}
  }
 }
 if(chosen.length!==2)throw new Error('Both old and 2.9 named outfit samples with existing public icons required');
 const config={type:'NikkiSyncLocalGalleryDownload',version:1,host:'192.168.1.2',port:32001,key:randomBytes(32).toString('hex'),sessionId:randomBytes(16).toString('hex'),expiresAt:new Date(Date.now()+600000).toISOString()};
 const service=createGalleryServer(config,source);stop=service.stop;await new Promise(r=>service.server.listen(0,'127.0.0.1',r));const events={};let socket;
 channel=await new Promise((r,j)=>{const c=clientApi('gallery-channel').connectGallery({getRandomValues:o=>o.success({randomValues:Uint8Array.from(randomBytes(64)).buffer}),createTCPSocket:()=>({onConnect:f=>events.connect=f,onMessage:f=>events.message=f,onError:f=>events.error=f,onClose:f=>events.close=f,
 connect(){socket=net.connect(service.server.address().port,'127.0.0.1');socket.on('connect',()=>events.connect());socket.on('data',b=>events.message({message:Uint8Array.from(b).buffer}));socket.on('error',()=>events.error());socket.on('close',()=>events.close());},write:b=>socket.write(Buffer.from(b)),close:()=>socket?.destroy()})},config,{ready:()=>r(c),failed:()=>j(new Error('Local encrypted channel unavailable'))});});
 const beforeReads=reads,beforeResizes=resizes,results=[];
 for(const {photo,item} of chosen){
  const page=await new Promise(r=>channel.outfit(photo.id,0,r));if(page.status!=='ok'||/https|sourcePath|thumbnail|uid|raw/.test(JSON.stringify(page)))throw new Error('Unsafe outfit manifest');
  for(let n=0;n<2;n++){const icon=await new Promise(r=>channel.icon(photo.id,item.key,r));if(icon.status!=='ok'||!icon.icon||icon.original||icon.mime!=='image/png'||createHash('sha256').update(icon.image).digest('hex')!==icon.sha256)throw new Error('Icon transfer mismatch');
   const bytes=Buffer.from(icon.image);if(bytes.readUInt32BE(16)>192||bytes.readUInt32BE(20)>192||bytes[25]!==6)throw new Error('Native RGBA icon resize mismatch');icon.image.fill(0);bytes.fill(0);}
  results.push({version:photo.version,versionSource:photo.versionSource,namedOutfit:true,verifiedIconTransfer:true,rgba192pxNativeResize:true,repeatedIconReused:true});
 }
 if(reads!==beforeReads||resizes!==beforeResizes)throw new Error('Repeated icons unnecessarily read or converted');
 console.log(JSON.stringify({ordinaryPhotos:source.count,existingPublicIcons:records.size,results,externalRequests:0,privateMediaUploaded:false,gameFilesWritten:false,databaseReadOnly:true,realCacheReadOnly:true,phoneAcceptance:false}));
}finally{channel?.close();await stop?.();connection.close();}
