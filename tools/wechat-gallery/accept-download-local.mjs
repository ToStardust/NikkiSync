// Real indexed media stays on loopback; never prints source paths, bytes, UID or keys.
import net from 'node:net';
import {randomBytes,createHash} from 'node:crypto';
import {join} from 'node:path';
import {openLocalPreviewSource} from './source.mjs';
import {createGalleryServer} from './server.mjs';
import {clientApi} from '../wechat-crypto-spike/client-api.mjs';
const source=await openLocalPreviewSource(join(process.env.LOCALAPPDATA,'NikkiSync','nikkisync.sqlite'));
const config={type:'NikkiSyncLocalGalleryDownload',version:1,host:'192.168.1.2',port:12345,
  sessionId:randomBytes(16).toString('hex'),key:randomBytes(32).toString('hex'),expiresAt:new Date(Date.now()+600000).toISOString()};
const {server,stop}=createGalleryServer(config,source);await new Promise(r=>server.listen(0,'127.0.0.1',r));
let channel;
try{
  const events={};let socket;
  await new Promise((resolve,reject)=>{
    channel=clientApi('gallery-channel').connectGallery({getRandomValues:o=>o.success({randomValues:Uint8Array.from(randomBytes(64)).buffer}),
      createTCPSocket:()=>({onConnect:f=>events.connect=f,onMessage:f=>events.message=f,onError:f=>events.error=f,onClose:f=>events.close=f,
        connect:()=>{socket=net.connect(server.address().port,'127.0.0.1');socket.on('connect',()=>events.connect());socket.on('data',x=>events.message({message:Uint8Array.from(x).buffer}));socket.on('error',()=>events.error());socket.on('close',()=>events.close());},
        write:data=>socket.write(Buffer.from(data)),close:()=>socket?.destroy()})},config,{ready:resolve,failed:()=>reject(new Error('Loopback connection failed'))});
  });
  const list=await new Promise(r=>channel.list(0,r));if(list.status!=='ok')throw new Error('List failed');
  let verified=0,totalBytes=0,withMetadata=0,missingMetadata=0,cameraPhotos=0,clothingPhotos=0;
  for(const item of list.items.slice(0,3)){
    const expected=await source.original(item.id);
    const original=await new Promise(r=>channel.original(item.id,r));
    if(original.status!=='ok' || !original.original || !Buffer.from(original.image).equals(expected.image)
      || original.sha256!==createHash('sha256').update(expected.image).digest('hex'))throw new Error('Byte identity failed');
    verified++;totalBytes+=original.image.length;original.image.fill(0);expected.image.fill(0);
    const metadata=await new Promise(r=>channel.metadata(item.id,r));if(metadata.status!=='ok')throw new Error('Metadata response failed');
    const expectedMetadata=source.metadata(item.id);
    if(JSON.stringify(metadata.rows)!==JSON.stringify(expectedMetadata.rows) || metadata.availability!==expectedMetadata.availability)throw new Error('Metadata identity failed');
    if(metadata.rows.some(x=>['焦距','光圈','曝光'].includes(x.label)))cameraPhotos++;
    if(metadata.rows.some(x=>x.label==='服装'))clothingPhotos++;
    if(metadata.rows.length)withMetadata++;else missingMetadata++;
  }
  console.log(JSON.stringify({indexedPhotos:source.count,realOriginalsVerified:verified,originalBytes:totalBytes,byteIdenticalIncludingTrailer:true,
    metadataPhotosWithRows:withMetadata,metadataPhotosMissing:missingMetadata,cameraPhotos,clothingPhotos,databaseReadOnly:true,originalFilesWritten:false,
    loopbackOnly:true,cloudMediaUploaded:false,phoneZoomOrAlbumAcceptance:false}));
}finally{channel?.close();await stop();}
