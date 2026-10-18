import test from 'node:test';
import assert from 'node:assert/strict';
import {fixtureJpeg,tagsOf} from './jpeg-fixture.mjs';
import {exportJpeg} from './photo-export.mjs';
test('fixed ASCII camera and photo-version LensMake retain parameters without nickname leakage',()=>{
 const input=fixtureJpeg();
 const out=exportJpeg(input,{identity:{gameVersion:'2.9',uid:'PRIVATE'},camera:{focalLength:35},dressing:{clothes:[{name:'裙子'}]}},{cameraName:'昵称的大喵相机'});
 const tags=tagsOf(out);
 assert.equal(tags[0x110],'MomoCamera,Infinity Nikki');
 assert.equal(tags[0xa433],'Bloom Beneath Bright Skies');
 assert.ok(!out.includes(Buffer.from('昵称')));
 assert.deepEqual(out.subarray(out.indexOf(Buffer.from([255,218]))),input.subarray(input.indexOf(Buffer.from([255,218]))));
 assert.match(tags[0x10e],/clothes/);
 assert.ok(!out.includes(Buffer.from('PRIVATE')));
});
test('capture date fallback uses photo version and unknown versions never borrow current title',()=>{
 assert.equal(tagsOf(exportJpeg(fixtureJpeg(),{capture:{capturedAt:'2026-09-28T03:00:00Z'}}))[0xa433],'The Feather of Justice');
 assert.equal(tagsOf(exportJpeg(fixtureJpeg(),{identity:{gameVersion:'9.9'}}))[0xa433],undefined);
});
