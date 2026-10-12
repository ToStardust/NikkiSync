// Embeddable integration acceptance; no source-tree reads, real database/media stay read-only.
import net from 'node:net';
import {randomBytes,createHash} from 'node:crypto';
import {join,resolve} from 'node:path';
import {createIndexedPreviewSource,createGalleryServer,clientApi} from '../../apps/pc-companion/dist/src/wechat/GalleryRuntime.mjs';
import {WeChatGalleryService,resizeForWeChat} from '../../apps/pc-companion/dist/src/wechat/WeChatGalleryService.js';
import {discoverInfinityNikkiInstallation} from '../../apps/pc-companion/dist/src/game-directory-discovery.js';
const sqlite=await import(process.versions.bun?'bun:sqlite':'node:sqlite');
const Database=sqlite.Database??sqlite.DatabaseSync;
const connection=new Database(join(process.env.LOCALAPPDATA,'NikkiSync/nikkisync.sqlite'),process.versions.bun?{readonly:true}:{readOnly:true});
let channel,service;
try{
 const installation=await discoverInfinityNikkiInstallation({runningExecutablePaths:[]});
 // Source acceptance must not depend on an obsolete release folder being installed.
 const script=resolve(import.meta.dirname,'resize-preview.ps1');
 const source=await createIndexedPreviewSource({connection},installation.photoRoots,{resize:bytes=>resizeForWeChat(bytes,script)});
 let config,server;
 service=new WeChatGalleryService({host:'192.168.1.2',snapshot:async()=>source,qrSvg:async payload=>{config=JSON.parse(payload);return '<svg/>';},
  reservePort:async()=>{const reserve=net.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));return port;},
  listen:async(payload,snapshot,events)=>{const listening=createGalleryServer(payload,snapshot,{events});server=listening.server;await new Promise(r=>server.listen(payload.port,'127.0.0.1',r));return {port:payload.port,stop:listening.stop};}});
 await service.start();
 let maxNetworkChunk=0,recovered;
 await new Promise((done,reject)=>{
  channel=clientApi('gallery-channel').connectGallery({getRandomValues:o=>o.success({randomValues:Uint8Array.from(randomBytes(64)).buffer}),createTCPSocket:()=>{const events={};let socket;return {
   onConnect:f=>events.connect=f,onMessage:f=>events.message=f,onError:f=>events.error=f,onClose:f=>events.close=f,
   connect:()=>{socket=net.connect(server.address().port,'127.0.0.1');socket.on('connect',()=>events.connect());socket.on('data',x=>{maxNetworkChunk=Math.max(maxNetworkChunk,x.length);events.message({message:Uint8Array.from(x).buffer});});socket.on('error',()=>events.error());socket.on('close',()=>events.close());},write:x=>socket.write(Buffer.from(x)),close:()=>socket?.destroy()};}},config,{ready:()=>{if(recovered)recovered();else done();},failed:()=>reject(new Error('Integrated connection failed'))});
 });config=null;
 const list=await new Promise(r=>channel.list(0,r));if(list.status!=='ok')throw new Error('List unavailable');
 const fresh=await new Promise(r=>channel.refresh(r));
 if(fresh.status!=='ok'||fresh.total!==list.total||JSON.stringify(fresh.items)!==JSON.stringify(list.items)||service.status().photoCount!==fresh.total)throw new Error('Same-session refresh mismatch');
 let verified=0,bytes=0,previews=0,parameters=0;
 for(const item of list.items.slice(0,3)){
  const preview=await new Promise(r=>channel.preview(item.id,r));if(preview.status!=='ok'||preview.original)throw new Error('Preview unavailable');previews++;preview.image.fill(0);
  const expected=await source.original(item.id),actual=await new Promise(r=>channel.original(item.id,r));
  if(actual.status!=='ok'||!actual.original||!Buffer.from(actual.image).equals(Buffer.from(expected.image))||actual.sha256!==createHash('sha256').update(expected.image).digest('hex'))throw new Error('Original mismatch: '+JSON.stringify({status:actual.status,original:actual.original,received:actual.image?.length,expected:expected.image.length,maxNetworkChunk,equal:actual.image?Buffer.from(actual.image).equals(Buffer.from(expected.image)):false}));
  verified++;bytes+=actual.image.length;actual.image.fill(0);expected.image.fill(0);
  const info=await new Promise(r=>channel.metadata(item.id,r));if(info.status!=='ok'||JSON.stringify(info.rows)!==JSON.stringify(source.metadata(item.id).rows))throw new Error('Metadata mismatch');if(info.rows.length)parameters++;
 }
 if(service.status().state!=='connected'||service.status().originalsSent!==verified)throw new Error('Desktop transfer counter mismatch');
 if(!channel.suspend())throw new Error('Recovery unavailable');
 await new Promise(r=>setTimeout(r,50));if(service.status().state!=='disconnected')throw new Error('Desktop did not enter suspended status');
 await new Promise((r,j)=>{const timeout=setTimeout(()=>j(new Error('Recovery timed out')),5000);recovered=()=>{clearTimeout(timeout);r();};channel.resume();});
 const afterRecovery=await new Promise(r=>channel.list(0,r));if(afterRecovery.status!=='ok'||JSON.stringify(afterRecovery.items)!==JSON.stringify(list.items)||service.status().state!=='connected'||service.status().originalsSent!==verified)throw new Error('Recovery changed logical session');
 channel.close();await service.stop();
 if(service.status().state!=='closed'||server.listening)throw new Error('Listener not closed');
 console.log(JSON.stringify({runtime:process.versions.bun?'Bun':'Node',ordinaryPhotos:source.count,sameSessionRefreshVerified:true,sameSessionRecoveryVerified:true,stableIdsAfterRefresh:true,verifiedPreviews:previews,verifiedOriginals:verified,originalBytes:bytes,parameterPhotos:parameters,transferCounterVerified:true,stopVerified:true,loopbackOnly:true,sourceDatabaseReadOnly:true,originalFilesWritten:false,mediaUploaded:false,phoneAcceptance:false}));
}finally{channel?.close();await service?.stop();connection.close();}
