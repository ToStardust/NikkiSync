import assert from 'node:assert/strict';
export function fixtureJpeg(app1){
 const segment=(marker,data)=>{const b=Buffer.alloc(data.length+4);b[0]=255;b[1]=marker;b.writeUInt16BE(data.length+2,2);data.copy(b,4);return b;};
 return Buffer.concat([Buffer.from([255,216]),segment(0xe2,Buffer.from('ICC_PROFILE\0original')), ...(app1?[segment(0xe1,app1)]:[]),
  segment(0xc0,Buffer.from([8,0,64,0,48,1,1,0x11,0])),segment(0xda,Buffer.from([1,1,0,0,63,0])),Buffer.from([9,8,255,0,7,255,217]),Buffer.from('private-game-tail')]);
}
// Independent TIFF reader for test/native roundtrip assertions, never used to generate EXIF.
export function tagsOf(jpeg){
 let offset=2,tiff;
 while(offset<jpeg.length){const marker=jpeg[offset+1],size=jpeg.readUInt16BE(offset+2);if(marker===0xda)break;
  if(marker===0xe1 && jpeg.subarray(offset+4,offset+10).equals(Buffer.from('Exif\0\0')))tiff=jpeg.subarray(offset+10,offset+2+size);offset+=2+size;}
 assert.ok(tiff);const le=tiff.toString('ascii',0,2)==='II',u16=p=>le?tiff.readUInt16LE(p):tiff.readUInt16BE(p),u32=p=>le?tiff.readUInt32LE(p):tiff.readUInt32BE(p);
 const values={};function ifd(p){const count=u16(p);for(let i=0;i<count;i++){const e=p+2+i*12,tag=u16(e),type=u16(e+2),count=u32(e+4),size=({2:1,3:2,4:4,5:8,7:1,10:8})[type]*count,pos=size<=4?e+8:u32(e+8);
  if(tag===0x8769){ifd(u32(e+8));continue;}values[tag]=type===2?tiff.toString('utf8',pos,pos+count-1):type===3?u16(pos):type===5?u32(pos)/u32(pos+4):type===10?(le?tiff.readInt32LE(pos):tiff.readInt32BE(pos))/u32(pos+4):type===4?u32(pos):Buffer.from(tiff.subarray(pos,pos+size));}}
 ifd(u32(4));return values;
}
