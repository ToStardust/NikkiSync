import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
export function rotatePng(bytes,rotation,script=fileURLToPath(new URL('./rotate-png.ps1',import.meta.url))){
 if(!(bytes instanceof Uint8Array)||bytes.length>16777216||![90,180,270].includes(rotation))throw new Error('PNG export options');
 const header=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 if(header.length<33||!header.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||header.readUInt32BE(8)!==13||header.toString('ascii',12,16)!=='IHDR')throw new Error('PNG header');
 if(header[24]>8)throw new Error('High bit-depth PNG requires a lossless high bit-depth encoder');
 const width=header.readUInt32BE(16),height=header.readUInt32BE(20);if(!width||!height||width*height>40000000)throw new Error('PNG dimension limit');
 return new Promise((resolve,reject)=>{const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',script,'-Rotation',String(rotation)],{windowsHide:true,stdio:['pipe','pipe','pipe']});const chunks=[];let size=0,settled=false;
  const finish=error=>{if(settled)return;settled=true;clearTimeout(timer);if(error){child.kill();for(const c of chunks)c.fill(0);reject(new Error('PNG rotation unavailable'));}else resolve(Buffer.concat(chunks));};
  const timer=setTimeout(()=>finish(true),20000);child.on('error',()=>finish(true));child.stdin.on('error',()=>finish(true));child.stderr.on('data',()=>{});
  child.stdout.on('data',b=>{size+=b.length;if(size>16777216)finish(true);else chunks.push(b);});child.on('close',code=>finish(code!==0||size<8));child.stdin.end(bytes);
 });
}
