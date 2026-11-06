import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
export const MAX_MOTION = 96 * 1024 * 1024;
const filters = new Map([[90, 'transpose=clock'], [180, 'hflip,vflip'], [270, 'transpose=cclock']]);

export async function rotateMotionVideo(bytes, rotation, ffmpeg) {
  const filter = filters.get(rotation);
  if (!filter || !ffmpeg || !(bytes instanceof Uint8Array) || bytes.length > MAX_MOTION) {
    throw new Error('Invalid motion rotation input');
  }
  const dir = await mkdtemp(join(tmpdir(), 'nikkisync-motion-'));
  const source = join(dir, 'source.mp4');
  const output = join(dir, 'rotated.mp4');
  try {
    await writeFile(source, bytes, { flag: 'wx' });
    // FFmpeg applies the source display transform first, then the user's relative rotation.
    await run(ffmpeg, [
      '-v', 'error', '-nostdin', '-xerror', '-n', '-max_pixels', '40000000', '-i', source,
      '-map', '0:V:0', '-map', '0:a?', '-vf', filter,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
      '-fps_mode', 'passthrough', '-c:a', 'copy', '-movflags', '+faststart',
      '-fs', String(MAX_MOTION + 4 * 1024 * 1024), output,
    ], { windowsHide: true, timeout: 120000, maxBuffer: 64 * 1024 });
    const { size } = await stat(output);
    if (size < 16 || size > MAX_MOTION) throw new Error('Rotated video exceeds transfer bounds');
    return await readFile(output);
  } finally {
    await Promise.allSettled([unlink(source), unlink(output)]);
    await rmdir(dir);
  }
}
