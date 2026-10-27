import net from 'node:net';
import { randomBytes, createHash } from 'node:crypto';
import { networkInterfaces } from 'node:os';
import { mkdir, mkdtemp, readFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import QRCode from 'qrcode';
import { clientApi } from '../wechat-crypto-spike/client-api.mjs';
import { prepareFixtures } from './prepare.mjs';
const api = clientApi('live-probe'), wire = clientApi(), gallery = clientApi('gallery-channel'), { createDownloadPeer } = clientApi('noise-vendor');

export function createLiveProbeServer(config, files) {
  const checked = api.parseLiveQr(JSON.stringify(config)), key = Buffer.from(checked.key,'hex'); checked.key = null;
  const owned = new Map(api.NAMES.map(name => {
    const bytes=files.get(name);if(!(bytes instanceof Uint8Array))throw Error('Missing synthetic fixture');return [name,Buffer.from(bytes)];
  }));
  const manifest = api.NAMES.map(name => ({name,size:owned.get(name).length,sha256:createHash('sha256').update(owned.get(name)).digest('hex')}));
  api.manifestFiles({kind:'fixtures',version:1,files:manifest});
  const expires = Date.parse(checked.expiresAt), sockets = new Set(); let claimed=false,closed=false,attempts=0,stopPromise;
  const server=net.createServer(socket=>{
    socket.on('error',()=>{});
    if(closed||claimed||sockets.size||Date.now()>=expires||attempts++>=32){socket.destroy();return;}
    sockets.add(socket);let peer,stage=0,total=0;
    const send = async bytes => {
      if(closed||socket.destroyed||Date.now()>=expires)throw Error('Closed');
      const framed=wire.frame(bytes);if((total+=framed.length)>api.MAX_TRANSFER)throw Error('Limit');
      if(!socket.write(framed))await new Promise((resolve,reject)=>{const drain=()=>{clean();resolve();},ended=()=>{clean();reject(Error('Closed'));},clean=()=>{socket.off('drain',drain);socket.off('close',ended);};socket.once('drain',drain);socket.once('close',ended);});
    };
    const transfer=async()=>{
      try{
        await send(peer.encrypt(gallery.encode({kind:'fixtures',version:1,files:manifest})));
        for(const name of api.NAMES){const bytes=owned.get(name);for(let pos=0;pos<bytes.length;pos+=4096)await send(peer.encrypt(bytes.subarray(pos,pos+4096)));
          await send(peer.encrypt(gallery.encode({kind:'file-end',name})));}
        socket.end();
      }catch{socket.destroy();}
    };
    const decoder=wire.createDecoder(bytes=>{
      if(closed||Date.now()>=expires)throw Error('Expired');
      if(stage===0){peer=createDownloadPeer(false,key,wire.prologue(checked),randomBytes(64));peer.receiveHandshake(bytes);stage=1;void send(peer.sendHandshake()).catch(()=>socket.destroy());}
      else if(stage===1){const plain=peer.decrypt(bytes);let matches;try{matches=Buffer.from(plain).equals(Buffer.from('NS-LIVE-PROBE/1'));}finally{plain.fill(0);}
        if(!matches)throw Error('Unexpected request');claimed=true;key.fill(0);stage=2;void transfer();}
      else throw Error('No extra commands');
    });
    socket.setTimeout(Math.max(1,Math.min(30000,expires-Date.now())),()=>socket.destroy());
    socket.on('data',bytes=>{try{decoder.feed(Uint8Array.from(bytes));}catch{socket.destroy();}});
    socket.on('close',()=>{sockets.delete(socket);decoder.close();peer?.close();});
  });
  const stop=()=>{
    if(stopPromise)return stopPromise;closed=true;key.fill(0);for(const socket of sockets)socket.destroy();
    for(const bytes of owned.values())bytes.fill(0);
    stopPromise=new Promise(r=>server.close(()=>r()));return stopPromise;
  };
  return {server,stop};
}
async function main(){
  if(process.argv.length!==2)throw Error('Synthetic-only: no photo paths or custom input accepted');
  const wifi=Object.entries(networkInterfaces()).flatMap(([name,list])=>/WLAN|Wi-Fi|Wireless/i.test(name)?list||[]:[])
    .filter(x=>x.family==='IPv4'&&!x.internal&&/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(x.address));
  if(wifi.length!==1)throw Error('Require exactly one private Wi-Fi IPv4');
  await mkdir(resolve('out'),{recursive:true});const directory=await mkdtemp(join(resolve('out'),'wechat-live-probe-'));
  const manifest=await prepareFixtures(directory);
  const files=new Map(await Promise.all(api.NAMES.map(async name=>[name,await readFile(join(directory,name))])));
  const host=wifi[0].address,reserve=net.createServer();await new Promise((r,j)=>{reserve.once('error',j);reserve.listen(0,host,r);});
  const port=reserve.address().port;await new Promise(r=>reserve.close(r));
  const expiry=Date.now()+600000;
  let config={type:'NikkiSyncLiveImportProbe',version:1,host,port,sessionId:randomBytes(16).toString('hex'),key:randomBytes(32).toString('hex'),expiresAt:new Date(expiry).toISOString()};
  const {server,stop}=createLiveProbeServer(config,files);
  for(const bytes of files.values())bytes.fill(0);
  await new Promise((r,j)=>{server.once('error',j);server.listen(port,host,r);});
  const qrFile=join(directory,'private-live-probe-qr.png');let stopping=false;
  const shutdown=async()=>{if(stopping)return;stopping=true;await stop();await unlink(qrFile).catch(()=>{});};
  try{
    await QRCode.toFile(qrFile,JSON.stringify(config),{width:720,margin:2});config=null;
    console.log(JSON.stringify({qrFile,manifestFile:join(directory,'manifest.json'),expiresAt:new Date(expiry).toISOString(),syntheticOnly:true,
      privateQr:true,totalBytes:Object.values(manifest.files).reduce((n,x)=>n+x.size,0),iosAcceptance:'unverified'}));
    const timer=setTimeout(()=>void shutdown(),600000);timer.unref();
    process.once('SIGINT',()=>{clearTimeout(timer);void shutdown();});process.once('SIGTERM',()=>{clearTimeout(timer);void shutdown();});
  }catch{await shutdown();throw Error('Cannot start synthetic Live probe');}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)await main();
