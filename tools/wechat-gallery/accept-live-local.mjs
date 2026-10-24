// Real indexed source acceptance: private media remains local, DB/game files read-only.
import {DatabaseSync} from 'node:sqlite';
import {randomBytes,createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import net from 'node:net';
import {createIndexedPreviewSource,createGalleryServer,clientApi} from '../../apps/pc-companion/dist/src/wechat/GalleryRuntime.mjs';
import {discoverInfinityNikkiInstallation} from '../../apps/pc-companion/dist/src/game-directory-discovery.js';
const connection=new DatabaseSync(join(process.env.LOCALAPPDATA,'NikkiSync','nikkisync.sqlite'),{readOnly:true});let channel,stop;
try{
 const installation=await discoverInfinityNikkiInstallation({runningExecutablePaths:[]});
 const source=await createIndexedPreviewSource({connection},[...new Set([...installation.photoRoots,...installation.motionRoots])]);
 const live=[];for(let offset=0;offset<source.count;offset+=12)live.push(...source.list(offset).items.filter(x=>x.live));
 if(!live.length)throw new Error('No complete Live source');let largest,largestBytes=0;
 for(const item of live){const value=await source.motion(item.id);if(value.image.length>largestBytes){largest=item;largestBytes=value.image.length;}value.image.fill(0);}
 const exported=await source.live(largest.id,{exif:true,rotation:0}),digest=createHash('sha256').update(exported.image).digest('hex');
 const config={type:'NikkiSyncLocalGalleryLive',version:1,host:'192.168.1.2',port:32001,key:randomBytes(32).toString('hex'),sessionId:randomBytes(16).toString('hex'),expiresAt:new Date(Date.now()+600000).toISOString()};
 const listener=createGalleryServer(config,{...source,live:async(id)=>{if(id!==largest.id)throw new Error('Unexpected acceptance item');return {...exported,image:Buffer.from(exported.image)};}});stop=listener.stop;const server=listener.server;await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const events={};let socket;
 channel=await new Promise((ready,failed)=>{const c=clientApi('gallery-channel').connectGallery({getRandomValues:o=>o.success({randomValues:Uint8Array.from(randomBytes(64)).buffer}),createTCPSocket:()=>({onConnect:f=>events.connect=f,onMessage:f=>events.message=f,onError:f=>events.error=f,onClose:f=>events.close=f,connect(){socket=net.connect(server.address().port,'127.0.0.1');socket.on('connect',()=>events.connect());socket.on('data',b=>events.message({message:Uint8Array.from(b).buffer}));socket.on('close',()=>events.close());socket.on('error',()=>events.error());},write:p=>socket.write(Buffer.from(p)),close:()=>socket?.destroy()})},config,{ready:()=>ready(c),failed:()=>failed(new Error('Live loopback connection failed'))});});config.key='';
 const actual=await new Promise(r=>channel.live(largest.id,{exif:true,rotation:0},r));if(actual.status!=='ok'||actual.live!==true||actual.sha256!==digest||!Buffer.from(actual.image).equals(Buffer.from(exported.image)))throw new Error('Real Live integrity mismatch');
 const output=resolve('out/live-integration-2026-10-05');await mkdir(output,{recursive:true});await writeFile(join(output,'NikkiSync-Real-Live.livp'),actual.image,{flag:'w'});
 const bytes=actual.image.length;actual.image.fill(0);exported.image.fill(0);
 console.log(JSON.stringify({indexedPhotos:source.count,indexedLivePairs:live.length,largestOriginalVideoBytes:largestBytes,verifiedLivpBytes:bytes,sha256:digest,fullVideoAudioPacketsVerifiedByExporter:true,actualNoiseLoopback:true,databaseReadOnly:true,gameFilesWritten:false,mediaUploaded:false,phoneAcceptance:false}));
}finally{channel?.close();await stop?.();connection.close();}
