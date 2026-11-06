import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { createPreviewSource } from './source.mjs';

const run = promisify(execFile);
const fileHash = bytes => createHash('sha256').update(bytes).digest('hex');
const probe = async path => JSON.parse((await run('ffprobe', [
  '-v', 'error', '-show_streams', '-show_packets', '-show_data_hash', 'sha256', '-of', 'json', path,
])).stdout);
const audioPackets = result => {
  const audio = result.streams.find(stream => stream.codec_type === 'audio');
  assert.equal(audio?.codec_name, 'aac');
  return result.packets.filter(packet => packet.stream_index === audio.index)
    .map(({ pts, dts, duration, data_hash }) => [pts, dts, duration, data_hash]);
};

test('motion save rotates actual pixels in all four directions and retains frames, duration and audio packets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'momo-motion-fixture-'));
  const files = [];
  const file = name => { const path = join(dir, name); files.push(path); return path; };
  try {
    const input = file('input.mp4');
    await run('ffmpeg', [
      '-v', 'error', '-f', 'lavfi', '-i', 'color=red:size=96x64:rate=8:duration=1',
      '-f', 'lavfi', '-i', 'sine=frequency=500:duration=1',
      '-vf', 'drawbox=x=48:y=0:w=48:h=32:c=lime:t=fill,drawbox=x=0:y=32:w=48:h=32:c=blue:t=fill,drawbox=x=48:y=32:w=48:h=32:c=white:t=fill',
      '-c:v', 'libx264', '-c:a', 'aac', '-y', input,
    ]);
    const cover = file('cover.jpg');
    await writeFile(cover, Uint8Array.from([255, 216, 255, 217]));
    const resource = async (sourcePath, mimeType) => {
      const bytes = await readFile(sourcePath);
      return { sourcePath, mimeType, sizeBytes: bytes.length, sha256: fileHash(bytes) };
    };
    const original = await readFile(input);
    const source = await createPreviewSource([{
      ...await resource(cover, 'image/jpeg'), motion: await resource(input, 'video/mp4'),
    }], [dir], { motionFfmpeg: process.env.NIKKISYNC_TEST_MOTION_FFMPEG || 'ffmpeg' });
    const id = source.list(0).items[0].id;
    const before = await probe(input);
    const colors = { red: [255, 0, 0], green: [0, 255, 0], blue: [0, 0, 255], white: [255, 255, 255] };
    const assertVideo = async (path, width, height, order) => {
      const after = await probe(path);
      const video = after.streams.find(stream => stream.codec_type === 'video');
      assert.deepEqual([video.width, video.height], [width, height]);
      assert.equal(video.nb_frames, '8');
      assert.equal(video.duration, '1.000000');
      assert.ok(!video.side_data_list?.some(x => x.side_data_type === 'Display Matrix' && x.rotation));
      assert.deepEqual(audioPackets(after), audioPackets(before));
      const { stdout } = await run('ffmpeg', ['-v', 'error', '-noautorotate', '-i', path, '-frames:v', '1',
        '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'], { encoding: 'buffer' });
      const samples = [[width/4, height/4], [width*3/4, height/4], [width/4, height*3/4], [width*3/4, height*3/4]];
      samples.forEach(([x,y], index) => {
        const color = [...stdout.subarray((y*width+x)*3, (y*width+x)*3+3)];
        assert.ok(color.every((value, i) => Math.abs(value - colors[order[index]][i]) < 16), color.join(','));
      });
    };
    const outputs = new Map();
    for (const [angle, width, height, order] of [
      [0, 96, 64, ['red', 'green', 'blue', 'white']],
      [90, 64, 96, ['blue', 'red', 'white', 'green']],
      [180, 96, 64, ['white', 'blue', 'green', 'red']],
      [270, 64, 96, ['green', 'white', 'red', 'blue']],
    ]) {
      const { image } = await source.motion(id, angle);
      if (angle === 0) assert.deepEqual(image, original);
      outputs.set(angle, image);
      const output = file(`angle-${angle}.mp4`);
      await writeFile(output, image);
      await assertVideo(output, width, height, order);
    }
    const tagged = file('tagged.mp4');
    await run('ffmpeg', ['-v', 'error', '-display_rotation', '-90', '-i', input, '-c', 'copy', '-y', tagged]);
    const taggedSource = await createPreviewSource([{
      ...await resource(cover, 'image/jpeg'), motion: await resource(tagged, 'video/mp4'),
    }], [dir], { motionFfmpeg: process.env.NIKKISYNC_TEST_MOTION_FFMPEG || 'ffmpeg' });
    const composed = file('composed.mp4');
    await writeFile(composed, (await taggedSource.motion(taggedSource.list(0).items[0].id, 90)).image);
    await assertVideo(composed, 96, 64, ['white', 'blue', 'green', 'red']);
    assert.deepEqual(await readFile(input), original);

    let page;
    runInNewContext(await readFile(new URL('../../apps/wechat-mini-program/miniprogram/pages/local-gallery/index.js', import.meta.url), 'utf8'), {
      Page: definition => { page = definition; }, require: () => ({}),
      wx: { showActionSheet: options => options.success({ tapIndex: 1 }) },
    });
    page.setData = patch => Object.assign(page.data, patch);
    Object.assign(page, { _alive: true, _active: true, _liveEpoch: 0, _connectionEpoch: 1 });
    Object.assign(page.data, { viewerOpen: true, viewerLive: true, viewerRotation: 90, selectedId: id, connected: true, downloadEnabled: true });
    let saved;
    page._liveCache = {
      put(value, kind, done) {
        assert.equal(kind, 'motion');
        assert.deepEqual(value.image, outputs.get(90));
        done('/cache/rotated.mp4');
      },
      saveVideo(path, done) { saved = path; done({ status: 'saved' }); },
    };
    page._channel = {
      motionRotationSupported: done => done(false),
      motion: () => assert.fail('legacy PC should not get a rotation request'),
    };
    page.saveViewed();
    assert.equal(saved, undefined);
    assert.match(page.data.saveMessage, /更新电脑端/);
    page._channel = {
      motionRotationSupported: done => done(true),
      motion(photoId, done, _progress, rotation) {
        assert.equal(photoId, id);
        assert.equal(rotation, 90);
        done({ status: 'ok', image: outputs.get(rotation) });
      },
    };
    page.saveViewed();
    assert.equal(saved, '/cache/rotated.mp4');
    assert.equal(page.data.saving, false);
  } finally {
    await Promise.allSettled(files.map(path => unlink(path)));
    await rmdir(dir);
  }
});
