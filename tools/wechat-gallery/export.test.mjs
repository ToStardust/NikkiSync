import test from 'node:test';
import assert from 'node:assert/strict';
import {fixtureJpeg,tagsOf} from './jpeg-fixture.mjs';
const load=()=>import('./photo-export.mjs');
test('legacy camera nickname requests migrate to stable ASCII without changing compressed pixels',async()=>{
 const {exportJpeg}=await load(),source=fixtureJpeg(),name='晚星的大喵相机';
 const output=exportJpeg(source,{camera:{focalLength:35}}, {cameraName:name});
 assert.ok(!output.includes(Buffer.from(name,'utf8')));
 const tags=tagsOf(output);assert.equal(tags[0x110],'MomoCamera,Infinity Nikki');
 assert.equal(tags[0x9c9c],undefined);assert.equal(tags[0x9286],undefined);
 assert.deepEqual(output.subarray(output.indexOf(Buffer.from([255,218]))),source.subarray(source.indexOf(Buffer.from([255,218]))));
 for(const cameraName of ['', ' x', 'x\0y','x\u0085y','暖'.repeat(100),3])assert.throws(()=>exportJpeg(source,{}, {cameraName}));
 assert.throws(()=>exportJpeg(source,{}, {cameraName:name,exif:false}));
 assert.equal(tagsOf(exportJpeg(source,{}))[0x110],'MomoCamera,Infinity Nikki');
});
test('JPEG export embeds native camera tags without recompressing or modifying the input',async()=>{
 const {exportJpeg}=await load(),source=fixtureJpeg(),before=Buffer.from(source);
 const output=exportJpeg(source,{camera:{focalLength:35.1,apertureSection:1.2,exposure:0.16},identity:{uid:'SECRET'},raw:{nativeParamToken:'SECRET'}},{exif:true,rotation:0});
 assert.deepEqual(source,before);assert.notDeepEqual(output,source);assert.ok(output.subarray(output.indexOf(Buffer.from([255,218]))).equals(source.subarray(source.indexOf(Buffer.from([255,218])))));
 const tags=tagsOf(output);assert.equal(tags[0x10f],'MomoCamera');assert.equal(tags[0x110],'MomoCamera,Infinity Nikki');assert.equal(tags[0x829d],1.2);assert.equal(tags[0x920a],35.1);
 assert.equal(tags[0x829a],undefined);assert.equal(tags[0x8827],undefined);assert.equal(tags[0x9204],undefined,'unverified game exposure is not EV');
 assert.doesNotMatch(output.subarray(0,output.indexOf(Buffer.from([255,218]))).toString(),/SECRET/);
});
test('four export directions compose existing EXIF orientation exactly once and keep scan bytes unchanged',async()=>{
 const {exportJpeg}=await load(),source=fixtureJpeg();const expected=[1,6,3,8];
 for(let n=0;n<4;n++)assert.equal(tagsOf(exportJpeg(source,{}, {exif:true,rotation:n*90}))[0x112],expected[n]);
 const rotated=exportJpeg(source,{}, {exif:false,rotation:90});assert.equal(tagsOf(exportJpeg(rotated,{}, {exif:false,rotation:90}))[0x112],3);
 assert.deepEqual(exportJpeg(source,{}, {exif:false,rotation:0}),source);
});
test('unknown game units, missing parameters and invalid values do not invent standard camera tags',async()=>{
 const {exportJpeg}=await load();const out=exportJpeg(fixtureJpeg(),{camera:{focalLength:NaN,apertureSection:-1,exposure:0.5,contrast:31,saturation:-0.55},filter:{name:'柔光'}},{exif:true,rotation:0});
 const tags=tagsOf(out);assert.equal(tags[0x829d],undefined);assert.equal(tags[0x920a],undefined);assert.equal(tags[0xa409],undefined);assert.equal(tags[0xa40a],undefined);
 assert.match(tags[0x10e],/Infinity Nikki/);
});
test('export rejects unsupported rotation, malformed JPEG/EXIF and oversized input',async()=>{
 const {exportJpeg}=await load();for(const rotation of [1,-90,360,'90',null])assert.throws(()=>exportJpeg(fixtureJpeg(),{}, {exif:true,rotation}));
 for(const bytes of [Buffer.from([255,216,255]),Buffer.alloc(16777217),fixtureJpeg(Buffer.from('Exif\0\0broken'))])assert.throws(()=>exportJpeg(bytes,{}, {exif:true,rotation:0}));
});
test('existing big-endian EXIF, ICC and opaque metadata are preserved when known tags change',async()=>{
 const {exportJpeg}=await load();const tiff=Buffer.alloc(40);tiff.write('MM');tiff.writeUInt16BE(42,2);tiff.writeUInt32BE(8,4);tiff.writeUInt16BE(2,8);
 tiff.writeUInt16BE(0x112,10);tiff.writeUInt16BE(3,12);tiff.writeUInt32BE(1,14);tiff.writeUInt16BE(2,18);
 tiff.writeUInt16BE(0xc001,22);tiff.writeUInt16BE(4,24);tiff.writeUInt32BE(1,26);tiff.writeUInt32BE(123456,30);
 const input=fixtureJpeg(Buffer.concat([Buffer.from('Exif\0\0'),tiff]));const out=exportJpeg(input,{}, {exif:true,rotation:90});
 assert.equal(tagsOf(out)[0x112],7);assert.equal(tagsOf(out)[0xc001],123456);assert.ok(out.includes(Buffer.from('ICC_PROFILE\0original')));
 assert.equal(out.toString().split('Exif\0\0').length,2,'one Exif APP1 only');
 const named=tagsOf(exportJpeg(input,{}, {cameraName:'晚星的大喵相机'}));
 assert.equal(named[0x110],'MomoCamera,Infinity Nikki');
 assert.equal(named[0x9c9c],undefined);assert.equal(named[0x9286],undefined);
});
test('privacy-safe metadata normalizer keeps game outfit IDs but excludes raw payload and player UID',async()=>{
 const {exportMetadata}=await load();const m=exportMetadata({identity:{uid:'SECRET',gameVersion:'2.9'},capture:{capturedAt:'2026-09-05T03:02:01.000Z'},camera:{focalLength:50,apertureSection:16},dressing:{clothes:[{id:'item-123',name:'星光裙'}]},raw:{secret:'SECRET'}});
 assert.equal(m.dressing.clothes[0].id,'item-123');
 assert.equal(m.camera.focalLength,50);assert.equal(m.camera.apertureSection,16);assert.doesNotMatch(JSON.stringify(m),/SECRET|raw|uid/);
});
