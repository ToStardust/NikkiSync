// Actual packaged service startup/API acceptance with a PRIVATE throwaway database snapshot.
// No real DB writes, network resolver calls, QR/key logs, media writes or phone testing.
import { DatabaseSync } from 'node:sqlite';
import net from 'node:net';
import { spawn,execFile } from 'node:child_process';
import { mkdtemp,mkdir,writeFile,rm,readFile,readdir } from 'node:fs/promises';
import { join,resolve,sep,basename } from 'node:path';
import { once } from 'node:events';
import {promisify} from 'node:util';
import {availableParallelism} from 'node:os';
const execute=promisify(execFile);
async function idleMeasurement(pid,base,seconds=20,desktopPolling=false){
 let polling=false,pollErrors=0;
 const poll=desktopPolling?setInterval(async()=>{if(polling)return;polling=true;try{if(!(await fetch(base+'/api/status')).ok)pollErrors++;}catch{pollErrors++;}finally{polling=false;}},2000):undefined;
 try{
 await new Promise(r=>setTimeout(r,10000));
 const sample=async()=>{
  // Get-Process reads the target's counters directly; avoid WMI startup/provider stalls.
  const command=`$p=Get-Process -Id ${pid} -ErrorAction Stop; @{cpu=$p.TotalProcessorTime.TotalSeconds;rss=$p.WorkingSet64;commit=$p.PrivateMemorySize64} | ConvertTo-Json -Compress`;
  const {stdout}=await execute('powershell.exe',['-NoProfile','-Command',command],{windowsHide:true,timeout:30000});
  return {...JSON.parse(stdout),time:performance.now()};
 };
 const samples=[await sample()];
 for(let i=0;i<4;i++){await new Promise(r=>setTimeout(r,seconds*250));samples.push(await sample());}
 const first=samples[0],last=samples.at(-1),elapsed=(last.time-first.time)/1000;
 if(pollErrors)throw new Error('Desktop polling failed during idle acceptance');
 return {seconds:Number(elapsed.toFixed(2)),logicalProcessors:availableParallelism(),cpuMachinePercent:Number(((last.cpu-first.cpu)/elapsed/availableParallelism()*100).toFixed(3)),
  residentMiB:samples.map(s=>Number((s.rss/1048576).toFixed(1))),privateCommitMiB:samples.map(s=>Number((s.commit/1048576).toFixed(1))),workload:'idle after gallery open/renew/close; no phone; desktop page polling '+(desktopPolling?'every 2 seconds':'off')};
 }finally{clearInterval(poll);}
}
const root=resolve(import.meta.dirname,'../..'),out=join(root,'out');await mkdir(out,{recursive:true});
const release=resolve(root,process.env.NIKKISYNC_DESKTOP_RELEASE??'release/NikkiSync');
if(!release.startsWith(join(root,'release')+sep))throw new Error('Packaged acceptance requires a workspace release directory');
const entrypoints=(await readdir(release)).filter(name=>name.toLowerCase().endsWith('.exe'));
if(entrypoints.length!==1||entrypoints[0]!=='NikkiSync-PC.exe')throw new Error('Release root must expose only NikkiSync-PC.exe');
const temporary=await mkdtemp(join(out,'desktop-accept-'));
const data=join(temporary,'NikkiSync');await mkdir(data);
let child;
try{
 const source=new DatabaseSync(join(process.env.LOCALAPPDATA,'NikkiSync','nikkisync.sqlite'),{readOnly:true});
 try{source.exec("VACUUM INTO '"+join(data,'nikkisync.sqlite').replaceAll("'","''")+"'");}finally{source.close();}
 await writeFile(join(data,'metadata-resolver.json'),JSON.stringify({enabled:false}));
 await writeFile(join(data,'metadata-dictionary-remote.json'),JSON.stringify({enabled:false,provider:{type:'nikki-albums-public'}}));
 const reserve=net.createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 child=spawn(join(release,'runtime','NikkiSync-PC-service.exe'),[],{cwd:release,windowsHide:true,
  env:{...process.env,LOCALAPPDATA:temporary,NIKKISYNC_BIND:'127.0.0.1',NIKKISYNC_PORT:'0',NIKKISYNC_DESKTOP_PORT:String(port),NIKKISYNC_MDNS:'0'},stdio:['ignore','ignore','ignore']});
 let spawnError=false;child.on('error',()=>{spawnError=true;});
 const base='http://127.0.0.1:'+port;
 let status;
 for(let i=0;i<1800;i++){
  if(spawnError||child.exitCode!==null)throw new Error('Packaged service exited before desktop readiness');
  try{const r=await fetch(base+'/api/status',{signal:AbortSignal.timeout(1000)});if(r.ok){status=await r.json();break;}}catch{}
  await new Promise(r=>setTimeout(r,100));
 }
 if(!status||!status.assets)throw new Error('No scanned library in packaged service');
 const html=await(await fetch(base)).text();
 if(!html.includes('微信小程序')||!html.includes('Android App'))throw new Error('Both desktop entrances required');
 const token=/name="nikkisync-desktop-token" content="([^"]+)"/.exec(html)?.[1];if(!token)throw new Error('Missing local API token');
 const headers={'X-NikkiSync-Desktop-Token':token};
 const read=async(path,method='GET')=>{const r=await fetch(base+path,{method,headers,signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error('Integrated desktop API failed: '+r.status);return r.json();};
 const first=await read('/api/wechat/session','POST');if(!first.qrSvg?.includes('<svg')||first.photoCount<1)throw new Error('Packaged QR generation failed');
 const current=await read('/api/wechat/status');if(current.state!=='waiting'||JSON.stringify(current).includes('qrSvg'))throw new Error('Invalid nonsecret connection status');
 const brand=await(await fetch(base+'/brand.png')).arrayBuffer();if(!Buffer.from(brand).equals(await readFile(join(root,'assets/branding/momo-camera.png'))))throw new Error('Shared desktop avatar mismatch');
 await read('/api/wechat/session','DELETE');if((await read('/api/wechat/status')).state!=='closed')throw new Error('Connection was not stopped');
 const second=await read('/api/wechat/session','POST');if(second.qrSvg===first.qrSvg)throw new Error('Renewed QR must differ');
 await read('/api/wechat/session','DELETE');
 const result={actualPackagedService:true,scannedAssets:status.assets,ordinaryPhotos:first.photoCount,apkEntrancePresent:true,wechatQrCreated:true,wechatQrRenewed:true,stopVerified:true,sharedAvatarIdentical:true,realDatabaseReadOnly:true,onlineResolversDisabledForTest:true,mediaUploaded:false,phoneAcceptance:false};
 if(process.argv.includes('--measure-idle')){
  const seconds=Number(process.argv.find(x=>x.startsWith('--idle-seconds='))?.split('=')[1]??20);
  const budget=Number(process.argv.find(x=>x.startsWith('--idle-budget-mib='))?.split('=')[1]??0),desktopPolling=process.argv.includes('--desktop-polls');
  if(!Number.isInteger(seconds)||seconds<20||seconds>180||!Number.isFinite(budget)||budget<0||budget>512)throw new Error('Invalid idle measurement bounds');
  result.idle=await idleMeasurement(child.pid,base,seconds,desktopPolling);
  if(budget)result.idleBudget={residentMiB:budget,maxGrowthMiB:8,passed:Math.max(...result.idle.residentMiB)<=budget&&result.idle.residentMiB.at(-1)-result.idle.residentMiB[0]<=8};
  if(!(await fetch(base+'/api/status')).ok)throw new Error('Service unresponsive after idle measurement');
  await writeFile(join(out,'idle-'+basename(release)+(seconds===20&&!desktopPolling?'':'-'+seconds+'s'+(desktopPolling?'-ui':''))+'.json'),JSON.stringify(result,null,2));
  if(result.idleBudget?.passed===false)throw new Error('Idle resource budget exceeded; inspect saved report');
 }
 console.log(JSON.stringify(result));
}finally{
 if(child&&child.exitCode===null){const ended=once(child,'exit');child.kill();await ended;}
 const target=resolve(temporary);if(!target.startsWith(resolve(out)+sep)||!/^desktop-accept-/.test(basename(target)))throw new Error('Unsafe temporary cleanup');
 await rm(target,{recursive:true,force:true});
}
