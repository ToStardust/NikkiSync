// Production derivative, source JPEG/MP4 buffers stay read-only. No game paths enter subprocesses.
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {liveJpeg} from './photo-export.mjs';
const MAX=100663296;
const u32=n=>{const b=Buffer.alloc(4);b.writeUInt32BE(n);return b;},u16=n=>{const b=Buffer.alloc(2);b.writeUInt16BE(n);return b;},str=s=>Buffer.from(s),zero=n=>Buffer.alloc(n);
const atom=(type,...data)=>{const payload=Buffer.concat(data);return Buffer.concat([u32(8+payload.length),typeof type==='number'?u32(type):str(type),payload]);};
const full=(type,...data)=>atom(type,zero(4),...data);
function boxes(bytes,start=0,end=bytes.length){const result=[];while(start<end){if(end-start<8||result.length>1024)throw new Error('Live atom bounds');const size=bytes.readUInt32BE(start);if(size<8||size>end-start)throw new Error('Live atom size');result.push({type:bytes.toString('latin1',start+4,start+8),start,end:start+size});start+=size;}return result;}
const only=(a,t)=>{const b=a.filter(x=>x.type===t);if(b.length!==1)throw new Error('Live movie layout');return b[0];};
const handler=t=>full('hdlr',zero(4),str(t),zero(12),str('NikkiSync Live\0'));
function timedMovie(mov,id,ptsUs){
 const moov=only(boxes(mov),'moov');if(moov.end!==mov.length)throw new Error('Live requires moov-last');
 const children=boxes(mov,moov.start+8,moov.end),tracks=children.filter(x=>x.type==='trak');if(!tracks.length||tracks.length>2||children.some(x=>x.type==='meta'))throw new Error('Unsupported Live tracks');
 const mvhd=only(children,'mvhd'),header=Buffer.from(mov.subarray(mvhd.start,mvhd.end));if(header[8]!==0)throw new Error('Live movie time header');
 const scale=header.readUInt32BE(20),duration=header.readUInt32BE(24),ticks=Math.round(duration/scale*1000000);
 if(!scale||!Number.isInteger(ptsUs)||ptsUs<0||ptsUs>=ticks||ticks>60000000)throw new Error('Live cover timestamp');
 const ids=tracks.map(t=>{const h=only(boxes(mov,t.start+8,t.end),'tkhd');if(mov[h.start+8]!==0)throw new Error('Live track time');return mov.readUInt32BE(h.start+20);});
 const nextId=Math.max(...ids)+1;header.writeUInt32BE(nextId+1,header.length-4);
 const original=only(boxes(mov,tracks[0].start+8,tracks[0].end),'tkhd'),tkhd=Buffer.from(mov.subarray(original.start,original.end));if(tkhd.length!==92)throw new Error('Live track header');
 tkhd.writeUInt32BE(3,8);tkhd.writeUInt32BE(nextId,20);tkhd.writeUInt32BE(duration,28);tkhd.writeUInt16BE(0,44);tkhd.writeUInt32BE(0,84);tkhd.writeUInt32BE(0,88);
 const samples=[];if(ptsUs)samples.push({bytes:atom(0),duration:ptsUs});samples.push({bytes:atom(1,Buffer.from([0])),duration:1});if(ticks-ptsUs-1)samples.push({bytes:atom(0),duration:ticks-ptsUs-1});
 const key=atom(1,atom('keyd',str('mdta'),str('com.apple.quicktime.still-image-time')),atom('dtyp',u32(1),str('com.apple.metadata.datatype.int8')));
 const mebx=atom('mebx',zero(6),u16(1),atom('keys',key));
 const stbl=atom('stbl',full('stsd',u32(1),mebx),full('stts',u32(samples.length),...samples.flatMap(s=>[u32(1),u32(s.duration)])),
  full('stsc',u32(1),u32(1),u32(samples.length),u32(1)),full('stsz',u32(0),u32(samples.length),...samples.map(s=>u32(s.bytes.length))),full('stco',u32(1),u32(moov.start+8)));
 const minf=atom('minf',full('nmhd'),atom('dinf',full('dref',u32(1),atom('url ',u32(1)))),stbl);
 const track=atom('trak',tkhd,atom('mdia',full('mdhd',zero(8),u32(1000000),u32(ticks),u16(0x55c4),u16(0)),handler('mdta'),minf));
 const meta=atom('meta',handler('mdta'),full('keys',u32(1),atom('mdta',str('com.apple.quicktime.content.identifier'))),atom('ilst',atom(1,atom('data',u32(1),zero(4),str(id)))));
 return Buffer.concat([mov.subarray(0,moov.start),atom('mdat',...samples.map(s=>s.bytes)),atom('moov',...children.map(x=>x.type==='mvhd'?header:mov.subarray(x.start,x.end)),track,meta)]);
}
function crc32(bytes){let crc=0xffffffff;for(const v of bytes){crc^=v;for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return(crc^0xffffffff)>>>0;}
function archive(still,mov){const local=[],central=[];let offset=0;for(const [name,data] of [['photo.jpg',still],['photo.mov',mov]]){
 const file=str(name),crc=crc32(data),h=Buffer.alloc(30),c=Buffer.alloc(46);h.writeUInt32LE(0x04034b50);h.writeUInt16LE(20,4);h.writeUInt16LE(0x21,12);h.writeUInt32LE(crc,14);h.writeUInt32LE(data.length,18);h.writeUInt32LE(data.length,22);h.writeUInt16LE(file.length,26);
 c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(0x21,14);c.writeUInt32LE(crc,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(data.length,24);c.writeUInt16LE(file.length,28);c.writeUInt32LE(offset,42);
 local.push(h,file,data);central.push(c,file);offset+=h.length+file.length+data.length;}const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(2,8);end.writeUInt16LE(2,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,directory,end]);}
function run(tool,args,limit=4*1024*1024){return new Promise((resolve,reject)=>{
 const child=spawn(tool,args,{windowsHide:true,stdio:['ignore','pipe','pipe']}),chunks=[];let length=0,ended=false,failed=false;
 const finish=error=>{if(ended)return;ended=true;clearTimeout(timer);if(error){for(const c of chunks)c.fill(0);reject(new Error('Live 媒体工具不可用或输入不支持'));}else resolve(Buffer.concat(chunks));};
 const timer=setTimeout(()=>{failed=true;child.kill();},60000);child.on('error',()=>finish(true));child.stderr.on('data',()=>{});child.stdout.on('data',c=>{length+=c.length;if(length>limit){failed=true;child.kill();c.fill(0);}else if(!failed)chunks.push(c);});child.on('close',code=>finish(failed||code!==0));
});}
const rotation=stream=>stream.side_data_list?.find(x=>x.side_data_type==='Display Matrix')?.rotation||0;
async function verifyRemux(before,path,ffprobe){
 const after=JSON.parse((await run(ffprobe,['-v','error','-show_streams','-show_packets','-show_data_hash','sha256','-of','json',path])).toString());
 for(const a of before.streams){const b=after.streams.find(x=>x.codec_type===a.codec_type);if(!b)throw new Error('Live stream missing');
  for(const k of ['codec_name','width','height','color_space','color_transfer','color_primaries','sample_rate','channels'])if(a[k]!==b[k])throw new Error('Live stream changed');
  if(rotation(a)!==rotation(b))throw new Error('Live display orientation changed');
  const x=before.packets.filter(p=>p.stream_index===a.index),y=after.packets.filter(p=>p.stream_index===b.index);if(x.length!==y.length)throw new Error('Live packet count changed');
  for(let n=0;n<x.length;n++){if(x[n].data_hash!==y[n].data_hash)throw new Error('Live packet bytes changed');for(const k of ['pts_time','dts_time','duration_time'])if(Math.abs(Number(x[n][k]||0)-Number(y[n][k]||0))>0.000001)throw new Error('Live timing changed');}
 }
}
const filter='scale=64:64:force_original_aspect_ratio=decrease,pad=64:64:(ow-iw)/2:(oh-ih)/2,format=rgb24';
async function matchCover(jpeg,mp4,frames,ffmpeg){
 const cover=await run(ffmpeg,['-v','error','-nostdin','-i',jpeg,'-frames:v','1','-vf',filter,'-f','rawvideo','-'],12288);
 const decoded=await run(ffmpeg,['-v','error','-nostdin','-i',mp4,'-map','0:v:0','-vf',filter,'-fps_mode','passthrough','-f','rawvideo','-'],12288*3600);
 try{if(cover.length!==12288||decoded.length!==frames.length*12288)throw new Error('Live cover decode');let best=Infinity,index=-1;
  for(let n=0;n<frames.length;n++){let sum=0;for(let p=0;p<12288;p++){const d=cover[p]-decoded[n*12288+p];sum+=d*d;}const error=sum/12288/65025;if(error<best){best=error;index=n;}}
  if(best>0.025||index<0)throw new Error('无法可靠匹配 Live 封面');return Math.round(Number(frames[index].best_effort_timestamp_time)*1000000);
 }finally{cover.fill(0);decoded.fill(0);}
}
export async function exportLive(jpeg,video,{presentationUs,metadata,exif=true,ffmpeg='ffmpeg',ffprobe='ffprobe'}={}){
 if(!(jpeg instanceof Uint8Array)||!(video instanceof Uint8Array)||jpeg.length+video.length>MAX-131072)throw new Error('Live exceeds transfer limit');
 const dir=await mkdtemp(join(tmpdir(),'nikkisync-live-'));let mov,still;
 try{const jpg=join(dir,'source.jpg'),mp4=join(dir,'source.mp4'),output=join(dir,'paired.mov');await writeFile(jpg,jpeg,{flag:'wx'});await writeFile(mp4,video,{flag:'wx'});
  const facts=JSON.parse((await run(ffprobe,['-v','error','-show_streams','-show_frames','-select_streams','v:0','-of','json',mp4])).toString());
  const stream=facts.streams?.[0],frames=facts.frames;
  if(!stream||!['h264','hevc'].includes(stream.codec_name)||!frames?.length||frames.length>3600||Number(stream.duration)>60||frames.some(x=>!Number.isFinite(Number(x.best_effort_timestamp_time))))throw new Error('Unsupported Live video');
  const before=JSON.parse((await run(ffprobe,['-v','error','-show_streams','-show_packets','-show_data_hash','sha256','-of','json',mp4])).toString()),all=before.streams;
  if(all.filter(x=>x.codec_type==='video').length!==1||all.filter(x=>x.codec_type==='audio').length>1||all.some(x=>!['video','audio'].includes(x.codec_type)))throw new Error('Unsupported Live tracks');
  const times=frames.map(x=>Math.round(Number(x.best_effort_timestamp_time)*1000000));
  const pts=presentationUs===undefined?await matchCover(jpg,mp4,frames,ffmpeg):presentationUs;
  if(!Number.isSafeInteger(pts)||pts<0||!times.some(x=>Math.abs(x-pts)<=1000))throw new Error('Live cover PTS unavailable');
  const angle=rotation(all.find(x=>x.codec_type==='video'));if(!Number.isInteger(angle)||angle%90!==0)throw new Error('Unsupported Live display matrix');
  await run(ffmpeg,['-v','error','-nostdin','-n','-i',mp4,'-map','0:v:0','-map','0:a:0?','-c','copy','-map_metadata','-1','-metadata:s:v:0','rotate='+angle,'-f','mov',output]);
  await verifyRemux(before,output,ffprobe);
  const id=randomUUID().toUpperCase();still=liveJpeg(jpeg,metadata,exif,id);mov=timedMovie(await readFile(output),id,pts);
  const image=archive(still,mov);if(image.length>MAX){image.fill(0);throw new Error('Live exceeds transfer limit');}
  return {image,mime:'application/x-livp',identifier:id,presentationUs:pts};
 }finally{still?.fill(0);mov?.fill(0);await rm(dir,{recursive:true,force:true});}
}
