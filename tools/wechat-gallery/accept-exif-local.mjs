// Genuine old/2.9 indexed GamePlayPhotos, read-only, all media travel only through local pipes/loopback.
import {DatabaseSync} from 'node:sqlite';import {join} from 'node:path';import {spawn} from 'node:child_process';import {createHash,randomBytes} from 'node:crypto';import net from 'node:net';
import {createIndexedPreviewSource,createGalleryServer,clientApi} from '../../apps/pc-companion/dist/src/wechat/GalleryRuntime.mjs';
import {discoverInfinityNikkiInstallation} from '../../apps/pc-companion/dist/src/game-directory-discovery.js';
import {tagsOf} from './jpeg-fixture.mjs';
function native(bytes,rotation=0){return new Promise((resolve,reject)=>{const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',join(import.meta.dirname,'native-exif-probe.ps1'),'-AdditionalRotation',String(rotation)],{windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',error='',done=false;
 const timer=setTimeout(()=>{child.kill();reject(new Error('Native probe timeout'));},30000);child.on('error',reject);child.stdin.on('error',reject);child.stdout.on('data',b=>out+=b.toString());child.stderr.on('data',b=>error+=b.toString());child.on('close',code=>{clearTimeout(timer);if(code!==0)return reject(new Error('Native decoder rejected export'));try{resolve(JSON.parse(out))}catch{reject(new Error('Native result invalid'))}});child.stdin.end(bytes);});}
const connection=new DatabaseSync(join(process.env.LOCALAPPDATA,'NikkiSync','nikkisync.sqlite'),{readOnly:true});let channel,stop;
try{
 const installation=await discoverInfinityNikkiInstallation({runningExecutablePaths:[]});if(!installation)throw new Error('Installation unavailable');
 const source=await createIndexedPreviewSource({connection},installation.photoRoots),list=source.browse(0,{});let all=list.items;
 for(let offset=list.next;offset!==null;){const page=source.browse(offset,{});all.push(...page.items);offset=page.next;}
 const gameDigests=new Set(connection.prepare("SELECT sha256 FROM resources WHERE lower(source_path) LIKE '%gameplayphotos%' AND stable_state='stable'").all().map(x=>x.sha256));
 async function choose(old){for(const x of all){if(!x.version||(old?x.version==='2.9':x.version!=='2.9')||!source.metadata(x.id).rows.some(r=>r.label==='光圈'))continue;
   const data=await source.original(x.id),matches=gameDigests.has(createHash('sha256').update(data.image).digest('hex'));data.image.fill(0);if(matches)return x;}}
 const chosen=[await choose(true),await choose(false)];if(chosen.some(x=>!x))throw new Error('Both GamePlayPhotos sample generations required');
 const config={type:'NikkiSyncLocalGalleryDownload',version:1,host:'192.168.1.2',port:32001,key:randomBytes(32).toString('hex'),sessionId:randomBytes(16).toString('hex'),expiresAt:new Date(Date.now()+600000).toISOString()};
 const service=createGalleryServer(config,source);stop=service.stop;await new Promise(r=>service.server.listen(0,'127.0.0.1',r));const events={};let socket;
 channel=await new Promise((r,j)=>{const c=clientApi('gallery-channel').connectGallery({getRandomValues:o=>o.success({randomValues:Uint8Array.from(randomBytes(64)).buffer}),createTCPSocket:()=>({onConnect:f=>events.connect=f,onMessage:f=>events.message=f,onError:f=>events.error=f,onClose:f=>events.close=f,
  connect(){socket=net.connect(service.server.address().port,'127.0.0.1');socket.on('connect',()=>events.connect());socket.on('data',b=>events.message({message:Uint8Array.from(b).buffer}));socket.on('error',()=>events.error());socket.on('close',()=>events.close());},write:b=>socket.write(Buffer.from(b)),close:()=>socket?.destroy()})},config,{ready:()=>r(c),failed:()=>j(new Error('Loopback connection unavailable'))});});
 const results=[];
 for(let index=0;index<chosen.length;index++){
  const item=chosen[index],original=await source.original(item.id),originalHash=createHash('sha256').update(original.image).digest('hex');let verified=0;
  for(const rotation of [0,90,180,270]){
   const response=await new Promise(r=>channel.export(item.id,{exif:true,rotation},r));if(response.status!=='ok'||!response.exported||response.original||!response.exifApplied)throw new Error('Export transfer failed');
   const image=Buffer.from(response.image),tags=tagsOf(image),actual=await native(image),expected=await native(original.image,rotation);
   if(actual.make!=='Momo Camera'||actual.model!=='Infinity Nikki'||actual.fNumber!==tags[0x829d]||actual.focalLength!==tags[0x920a]||actual.width!==expected.width||actual.height!==expected.height||actual.displayedPixelFingerprint!==expected.displayedPixelFingerprint)throw new Error('Native metadata/pixel orientation mismatch');
   const scan=original.image.indexOf(Buffer.from([255,218])),outScan=image.indexOf(Buffer.from([255,218]));if(scan<0||outScan<0||!image.subarray(outScan).equals(Buffer.from(original.image).subarray(scan)))throw new Error('JPEG coded pixels/tail changed');
   response.image.fill(0);image.fill(0);verified++;
  }
  const reread=await source.original(item.id);if(createHash('sha256').update(reread.image).digest('hex')!==originalHash)throw new Error('Source changed');reread.image.fill(0);original.image.fill(0);
  const queried=await new Promise(r=>channel.browse(0,{version:item.version},r));if(queried.status!=='ok'||!queried.items.every(x=>x.version===item.version))throw new Error('Version filter mismatch');
  results.push({sample:index===0?'old':'2.9',version:item.version,versionSource:item.versionSource,gamePlayPhotosSourceVerified:true,fourDirectionsVerified:verified===4,windowsNativeExifReadable:true,sourceUnchanged:true,jpegScanAndTailByteIdentical:true,loopbackExportVerified:true});
 }
 console.log(JSON.stringify({ordinaryPhotos:source.count,results,sourceDatabaseReadOnly:true,gameFilesWritten:false,mediaUploaded:false,wechatAlbumAcceptance:false,phoneAcceptance:false}));
}finally{channel?.close();await stop?.();connection.close();}
