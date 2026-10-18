// Lossless JPEG metadata derivative. Never decode/recompress, write source files or invoke a resolver.
import versions from '../../apps/mobile/app/src/main/assets/game-version-names.json' with {type:'json'};
import {inferInfinityNikkiGameVersion} from '../../apps/pc-companion/dist/src/server/GameVersionCalendar.js';
const englishNames=new Map(versions.map(x=>[x.version,x.name]));
export function setRemoteGameVersionNames(names) {
 for(const [version,name] of Object.entries(names??{}).slice(0,256))
  if(/^\d{1,3}\.\d{1,3}$/.test(version)&&typeof name==='string'&&/^[A-Za-z0-9][A-Za-z0-9 '\-:,]{0,119}$/.test(name))
   if(!versions.some(x=>x.version===version))englishNames.set(version,name);
}
export function gameVersionEnglishName(version) {
 return englishNames.get(String(version??'').replace(/^v/i,''));
}
const MAX=16777216,EXIF=Buffer.from('Exif\0\0');
const CAMERA=['focalLength','apertureSection','exposure','brightness','contrast','saturation','vibrance','highlights','shadows','vignetteIntensity','bloomIntensity','bloomThreshold','rotation','zoom','cameraYaw','cameraPitch'];
const clean=value=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,120):'';
export function exportMetadata(metadata){
 const camera={};for(const key of CAMERA){const v=metadata?.camera?.[key];if(typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=100000)camera[key]=v;}
 if(typeof metadata?.camera?.portraitMode==='boolean')camera.portraitMode=metadata.camera.portraitMode;
 const result={camera};const version=clean(metadata?.identity?.gameVersion)||inferInfinityNikkiGameVersion(metadata?.capture?.capturedAt);
 if(/^\d{1,3}(\.\d{1,3}){1,2}$/.test(version))result.version=version;
 const versionName=gameVersionEnglishName(version);if(versionName)result.versionName=versionName;
 const date=metadata?.capture?.capturedAt;if(typeof date==='string'&&/^\d{4}-\d\d-\d\dT/.test(date)&&Number.isFinite(Date.parse(date)))result.capturedAt=new Date(date).toISOString();
 for(const key of ['filter','lighting','location']){const name=clean(metadata?.[key]?.name);if(name)result[key]=name;}
 result.clothes=(Array.isArray(metadata?.dressing?.clothes)?metadata.dressing.clothes:[]).slice(0,100).map(x=>clean(x?.name)).filter(Boolean);
 const item=x=>{const out={};for(const key of ['id','name','category','suitId','suitName','strength','poseId','actionId']){const v=x?.[key];if(typeof v==='number'&&Number.isFinite(v))out[key]=v;else if(typeof v==='string')out[key]=clean(v);}return out;};
 result.dressing={...item(metadata?.dressing),clothes:(Array.isArray(metadata?.dressing?.clothes)?metadata.dressing.clothes:[]).slice(0,100).map(item),eureka:(Array.isArray(metadata?.dressing?.eureka)?metadata.dressing.eureka:[]).slice(0,20).map(item)};
 for(const key of ['pose','action','filter','lighting'])if(metadata?.[key])result[key+'Parameters']=item(metadata[key]);
 return result;
}
function layout(input){
 if(!(input instanceof Uint8Array)||input.length<4||input.length>MAX)throw new Error('JPEG export size');
 const bytes=Buffer.from(input.buffer,input.byteOffset,input.byteLength);if(bytes[0]!==255||bytes[1]!==216)throw new Error('JPEG required');
 const segments=[];let offset=2,sos=-1;
 while(offset<bytes.length){
  const start=offset;if(bytes[offset++]!==255)throw new Error('JPEG marker');while(bytes[offset]===255)offset++;
  const marker=bytes[offset++];if(!marker||marker===0xd8||marker===0xd9||marker===1||marker>=0xd0&&marker<=0xd7)throw new Error('JPEG header');
  if(offset+2>bytes.length)throw new Error('JPEG truncated');const length=bytes.readUInt16BE(offset);if(length<2||offset+length>bytes.length)throw new Error('JPEG length');
  if(marker===0xda){sos=start;break;}segments.push({start,end:offset+length,marker,data:bytes.subarray(offset+2,offset+length)});offset+=length;
 }
 if(sos<0||bytes.indexOf(Buffer.from([255,217]),sos)<0)throw new Error('JPEG scan missing');return {bytes,segments,sos};
}
function tiffReader(tiff){
 if(tiff.length<8||!['II','MM'].includes(tiff.toString('ascii',0,2)))throw new Error('Invalid Exif');
 const le=tiff[0]===73,u16=p=>{if(p<0||p+2>tiff.length)throw new Error('Exif offset');return le?tiff.readUInt16LE(p):tiff.readUInt16BE(p);},u32=p=>{if(p<0||p+4>tiff.length)throw new Error('Exif offset');return le?tiff.readUInt32LE(p):tiff.readUInt32BE(p);};
 if(u16(2)!==42)throw new Error('Exif magic');
 function ifd(p){if(p<8)throw new Error('Exif IFD');const count=u16(p);if(count>1024||p+2+count*12+4>tiff.length)throw new Error('Exif count');const entries=new Map();
  for(let n=0;n<count;n++){const e=p+2+n*12,tag=u16(e),type=u16(e+2),number=u32(e+4),width=({1:1,2:1,3:2,4:4,5:8,6:1,7:1,8:2,9:4,10:8,11:4,12:8,13:4})[type];
   if(!width||number>65535)throw new Error('Exif type');const size=number*width;if(size>4&&u32(e+8)+size>tiff.length)throw new Error('Exif value');if(entries.has(tag))throw new Error('Duplicate Exif tag');entries.set(tag,Buffer.from(tiff.subarray(e,e+12)));}
  return {entries,next:u32(p+2+count*12)};
 }
 const root=ifd(u32(4)),exifEntry=root.entries.get(0x8769),exif=exifEntry?ifd(le?exifEntry.readUInt32LE(8):exifEntry.readUInt32BE(8)):{entries:new Map(),next:0};
 const orientationEntry=root.entries.get(0x112);let orientation=1;if(orientationEntry){const type=le?orientationEntry.readUInt16LE(2):orientationEntry.readUInt16BE(2),count=le?orientationEntry.readUInt32LE(4):orientationEntry.readUInt32BE(4);if(type!==3||count!==1)throw new Error('Exif orientation');orientation=le?orientationEntry.readUInt16LE(8):orientationEntry.readUInt16BE(8);if(orientation<1||orientation>8)throw new Error('Exif orientation');}
 return {le,root,exif,orientation};
}
export function exportJpeg(input,metadata,{exif=true,rotation=0,contentIdentifier,cameraName}={}){
 if(typeof exif!=='boolean'||![0,90,180,270].includes(rotation))throw new Error('Export options');
 if(cameraName!==undefined&&(!exif||typeof cameraName!=='string'||!cameraName.trim()||cameraName!==cameraName.trim()||Buffer.byteLength(cameraName,'utf8')>256||/[\u0000-\u001f\u007f-\u009f]/u.test(cameraName)))throw new Error('Camera name');
 if(contentIdentifier!==undefined&&!/^[A-F0-9]{8}(-[A-F0-9]{4}){3}-[A-F0-9]{12}$/.test(contentIdentifier))throw new Error('Live identity');
 const {bytes,segments}=layout(input);if(!exif&&!rotation&&!contentIdentifier)return Buffer.from(bytes);
 const existing=segments.filter(x=>x.marker===0xe1&&x.data.subarray(0,6).equals(EXIF));if(existing.length>1)throw new Error('Multiple Exif blocks');
 const original=existing[0]?.data.subarray(6)??Buffer.from([73,73,42,0,8,0,0,0,0,0,0,0,0,0]);
 const state=tiffReader(original),chunks=[Buffer.from(original)];let position=original.length;
 const put=(buffer)=>{if(position%2){chunks.push(Buffer.alloc(1));position++;}const offset=position;chunks.push(buffer);position+=buffer.length;return offset;};
 const u16=(b,v,p)=>state.le?b.writeUInt16LE(v,p):b.writeUInt16BE(v,p),u32=(b,v,p)=>state.le?b.writeUInt32LE(v,p):b.writeUInt32BE(v,p);
 function tag(entries,id,type,data,count){const entry=Buffer.alloc(12);u16(entry,id,0);u16(entry,type,2);u32(entry,count,4);if(data.length<=4)data.copy(entry,8);else u32(entry,put(data),8);entries.set(id,entry);}
 function short(entries,id,value){const b=Buffer.alloc(2);u16(b,value,0);tag(entries,id,3,b,1);}
 function ascii(entries,id,value){const b=Buffer.from(value+'\0','ascii');tag(entries,id,2,b,b.length);}
 function rational(entries,id,value){if(!(value>0&&value<=10000))return;const numerator=Math.round(value*10000),b=Buffer.alloc(8);u32(b,numerator,0);u32(b,10000,4);tag(entries,id,5,b,1);}
 function writeIfd(value){const entries=Array.from(value.entries).sort((a,b)=>a[0]-b[0]).map(x=>x[1]),b=Buffer.alloc(2+entries.length*12+4);u16(b,entries.length,0);entries.forEach((e,n)=>e.copy(b,2+n*12));u32(b,value.next,2+entries.length*12);return put(b);}
 let orientation=state.orientation;const clockwise={1:6,6:3,3:8,8:1,2:7,7:4,4:5,5:2};for(let n=0;n<rotation/90;n++)orientation=clockwise[orientation];short(state.root.entries,0x112,orientation);
 if(exif){
  const normalized=exportMetadata(metadata),camera=normalized.camera;
  ascii(state.root.entries,0x10f,'MomoCamera');
  ascii(state.root.entries,0x110,'MomoCamera,Infinity Nikki');
  state.root.entries.delete(0x9c9c);state.exif.entries.delete(0x9286);
  state.exif.entries.delete(0xa433);
  if(normalized.versionName)ascii(state.exif.entries,0xa433,normalized.versionName);
  ascii(state.root.entries,0x131,'MomoCamera');
  // Virtual camera f-number and focal setting, not hardware optics or inferred 35mm equivalence.
  rational(state.exif.entries,0x829d,camera.apertureSection);rational(state.exif.entries,0x920a,camera.focalLength);
  const description='Infinity Nikki virtual photography; game parameters: '+JSON.stringify(normalized).replace(/[^\x20-\x7e]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
  if(description.length>24000)throw new Error('Export metadata too large');
  ascii(state.root.entries,0x10e,description);
  if(normalized.capturedAt){const time=normalized.capturedAt.slice(0,19).replace(/-/g,':').replace('T',' ');ascii(state.exif.entries,0x9003,time);ascii(state.exif.entries,0x9011,'+00:00');}
 }
 if(contentIdentifier){
  // MakerNote offsets are relative to its Apple header, independently of the parent TIFF byte order.
  const note=Buffer.alloc(69);Buffer.from('Apple iOS\0\0\x01MM','binary').copy(note);note.writeUInt16BE(1,14);
  note.writeUInt16BE(0x0011,16);note.writeUInt16BE(2,18);note.writeUInt32BE(37,20);note.writeUInt32BE(32,24);
  Buffer.from(contentIdentifier+'\0','ascii').copy(note,32);tag(state.exif.entries,0x927c,7,note,note.length);
 }
 if(state.exif.entries.size){const offset=writeIfd(state.exif),b=Buffer.alloc(4);u32(b,offset,0);tag(state.root.entries,0x8769,4,b,1);}
 const root=writeIfd(state.root),tiff=Buffer.concat(chunks);u32(tiff,root,4);
 if(tiff.length+8>65535)throw new Error('Exif segment too large');const app1=Buffer.alloc(tiff.length+10);app1[0]=255;app1[1]=0xe1;app1.writeUInt16BE(tiff.length+8,2);EXIF.copy(app1,4);tiff.copy(app1,10);
 // Existing TIFF offsets remain valid: untouched original TIFF data stays at the same relative offsets.
 const pieces=[bytes.subarray(0,2),app1];let previous=2;for(const old of existing){pieces.push(bytes.subarray(previous,old.start));previous=old.end;}pieces.push(bytes.subarray(previous));
 const output=Buffer.concat(pieces);if(output.length>MAX){output.fill(0);throw new Error('Export size limit');}return output;
}
export function liveJpeg(input,metadata,exif,contentIdentifier){
 const {bytes,sos}=layout(input),end=bytes.indexOf(Buffer.from([255,217]),sos);
 // Game parameter trailers are not image data and must not enter a shared Live package.
 return exportJpeg(bytes.subarray(0,end+2),metadata,{exif,rotation:0,contentIdentifier});
}
