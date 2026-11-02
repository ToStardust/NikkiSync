import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

// Exercise the real Windows toolchain, not a fake file containing tag strings.
test('PC synthetic candidate preserves cover encoding and video/audio packets; metadata is a real timed track', async () => {
  const { prepareFixtures, boxes } = await import('./prepare.mjs');
  const out = await mkdtemp(join(resolve('out'), 'live-fixture-test-'));
  const result = await prepareFixtures(out);
  const still = await readFile(join(out, 'paired.jpg'));
  const baseStill = await readFile(join(out, 'baseline.jpg'));
  const mov = await readFile(join(out, 'paired.mov'));
  const baseMov = await readFile(join(out, 'baseline.mov'));
  const maker = still.indexOf(Buffer.from('Apple iOS\0\0\x01MM', 'binary'));
  assert.ok(maker > 0);
  assert.equal(still.readUInt16BE(maker + 14), 1);
  assert.equal(still.readUInt16BE(maker + 16), 0x0011);
  assert.equal(still.readUInt32BE(maker + 24), 32);
  assert.equal(still.toString('ascii', maker + 32, maker + 68), result.identifier);
  // An APP1 insertion is all that changes: original entropy / other segments remain exact.
  const endApp1 = 4 + still.readUInt16BE(4);
  assert.ok(Buffer.concat([still.subarray(0, 2), still.subarray(endApp1)]).equals(baseStill));
  const originalMedia = boxes(baseMov).filter(x => x.type === 'mdat').map(x => baseMov.subarray(x.start, x.end));
  assert.ok(originalMedia.every(x => mov.includes(x)));
  const moov = boxes(mov).find(x => x.type === 'moov');
  const children = boxes(mov, moov.start + 8, moov.end);
  assert.equal(children.filter(x => x.type === 'meta').length, 1, 'movie-level Apple identifier');
  assert.equal(children.filter(x => x.type === 'trak').length, 3, 'video + audio + mebx');
  assert.ok(mov.includes(Buffer.from('com.apple.quicktime.still-image-time')));
  assert.ok(mov.includes(Buffer.from('com.apple.metadata.datatype.int8')));
  const probe = file => {
    const p = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', join(out, file)], { encoding: 'utf8', windowsHide: true });
    assert.equal(p.status, 0, p.stderr); return JSON.parse(p.stdout);
  };
  const facts = probe('paired.mov');
  assert.equal(facts.streams.find(x => x.codec_type === 'video').nb_read_frames, '48');
  assert.equal(facts.streams.find(x => x.codec_type === 'video').codec_name, 'h264');
  assert.equal(facts.streams.find(x => x.codec_type === 'audio').codec_name, 'aac');
  const meta = facts.streams.find(x => x.codec_tag_string === 'mebx');
  assert.ok(meta); assert.equal(meta.nb_frames, '3');
  assert.equal(Number(facts.format.duration), 2);
  assert.equal(facts.format.tags['com.apple.quicktime.content.identifier'], result.identifier);
  const packets = file => {
    const p = spawnSync('ffprobe', ['-v', 'error', '-show_packets', '-show_data_hash', 'sha256', '-of', 'json', join(out, file)], { encoding: 'utf8', windowsHide: true });
    assert.equal(p.status, 0, p.stderr); return JSON.parse(p.stdout).packets;
  };
  const before = packets('baseline.mov'), after = packets('paired.mov');
  for (const type of ['video', 'audio']) {
    const select = list => list.filter(x => x.codec_type === type).map(x => [x.pts_time, x.duration_time, x.data_hash]);
    assert.deepEqual(select(after), select(before));
  }
  const timed = after.filter(x => x.codec_type === 'data');
  assert.equal(timed.length, 3);
  assert.equal(Number(timed[1].pts_time), 1);
  assert.equal(Number(timed[1].size), 9);
  const motion = await readFile(join(out, 'motion.jpg'));
  const mp4 = await readFile(join(out, 'baseline.mp4'));
  assert.ok(motion.subarray(-mp4.length).equals(mp4));
  assert.ok(motion.includes(Buffer.from('GCamera:MotionPhoto="1"')));
  assert.ok(motion.includes(Buffer.from('Item:Length="' + mp4.length + '"')));
  const archive = await readFile(join(out, 'paired.livp'));
  assert.equal(archive.readUInt32LE(0), 0x04034b50);
  assert.ok(archive.includes(still)); assert.ok(archive.includes(mov));
  assert.equal(result.applePhotosAcceptance, 'unverified');
  assert.equal(result.wechatIosAcceptance, 'unverified');
  assert.notEqual(result.identifier, (await import('./prepare.mjs')).IDENTIFIER, 'fresh non-personal identity per generated probe');
});

test('probe packager rejects malformed/truncated boxes and faststart input instead of corrupting media offsets', async () => {
  const { boxes, addTimedMetadata } = await import('./prepare.mjs');
  assert.throws(() => boxes(Buffer.from([0, 0, 0, 255, 109, 100, 97, 116])));
  assert.throws(() => boxes(Buffer.alloc(7)));
  assert.throws(() => addTimedMetadata(Buffer.alloc(50), 'not-a-uuid'));
  const atom = (name, size = 8) => { const b = Buffer.alloc(size); b.writeUInt32BE(size); b.write(name, 4); return b; };
  assert.throws(() => addTimedMetadata(Buffer.concat([atom('ftyp'), atom('moov'), atom('mdat')]), '2F296544-A201-4C71-8925-F3D12B70EB01'));
});
