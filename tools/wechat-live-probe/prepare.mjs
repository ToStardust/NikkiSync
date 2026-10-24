// Isolated, synthetic-only format experiment. No game/database/user-file input.
// Independent writer based on Apple's QTFF specification and ExifTool's Apple
// MakerNote field description. Structure checks are NOT Apple/WeChat acceptance.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';

export const IDENTIFIER = '2F296544-A201-4C71-8925-F3D12B70EB01'; // Non-personal synthetic fixture only.
const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const str = s => Buffer.from(s, 'utf8');
const zeros = n => Buffer.alloc(n);
export const atom = (type, ...data) => {
  const payload = Buffer.concat(data), name = typeof type === 'number' ? u32(type) : str(type);
  if (name.length !== 4) throw new Error('Invalid atom type');
  return Buffer.concat([u32(8 + payload.length), name, payload]);
};
const full = (type, ...data) => atom(type, zeros(4), ...data);
export function boxes(bytes, start = 0, end = bytes.length) {
  if (!Buffer.isBuffer(bytes) || start < 0 || end > bytes.length || end < start) throw new Error('Invalid bounds');
  const result = [];
  while (start < end) {
    if (end - start < 8 || result.length > 1024) throw new Error('Truncated atom');
    const size = bytes.readUInt32BE(start);
    // This fixed tiny-fixture writer does not support 64-bit sizes or EOF boxes.
    if (size < 8 || size > end - start) throw new Error('Unsupported atom size');
    result.push({ type: bytes.toString('latin1', start + 4, start + 8), start, end: start + size }); start += size;
  }
  return result;
}
const only = (list, type) => { const b = list.filter(x => x.type === type); if (b.length !== 1) throw new Error('Unexpected layout'); return b[0]; };
const handler = type => full('hdlr', zeros(4), str(type), zeros(12), str('NikkiSync synthetic probe\0'));
const contentKey = 'com.apple.quicktime.content.identifier';
const stillKey = 'com.apple.quicktime.still-image-time';

export function addAppleIdentifier(jpeg, id = IDENTIFIER) {
  if (!/^[A-F0-9]{8}(-[A-F0-9]{4}){3}-[A-F0-9]{12}$/.test(id)
    || jpeg.length < 4 || jpeg.readUInt16BE(0) !== 0xffd8 || jpeg.readUInt16BE(jpeg.length - 2) !== 0xffd9)
    throw new Error('Only the generated plain JPEG is supported');
  const note = Buffer.concat([Buffer.from('Apple iOS\0\0\x01MM', 'binary'), u16(1), u16(0x0011), u16(2), u32(37), u32(32), zeros(4), str(id + '\0')]);
  const tiff = Buffer.concat([str('MM'), u16(42), u32(8), u16(1), u16(0x8769), u16(4), u32(1), u32(26), zeros(4),
    u16(1), u16(0x927c), u16(7), u32(note.length), u32(44), zeros(4), note]);
  const payload = Buffer.concat([str('Exif\0\0'), tiff]);
  return Buffer.concat([jpeg.subarray(0, 2), Buffer.from([255, 225]), u16(payload.length + 2), payload, jpeg.subarray(2)]);
}

export function addTimedMetadata(mov, id = IDENTIFIER) {
  if (!/^[A-F0-9]{8}(-[A-F0-9]{4}){3}-[A-F0-9]{12}$/.test(id)) throw new Error('Invalid fixture identity');
  const top = boxes(mov), moov = only(top, 'moov');
  if (moov.end !== mov.length || !top.some(x => x.type === 'mdat' && x.end <= moov.start))
    throw new Error('Require moov-last synthetic input; never invalidate existing chunk offsets');
  const children = boxes(mov, moov.start + 8, moov.end), tracks = children.filter(x => x.type === 'trak');
  if (tracks.length !== 2 || children.some(x => x.type === 'meta')) throw new Error('Expected synthetic video/audio only');
  const mvhd = only(children, 'mvhd'), movieHeader = Buffer.from(mov.subarray(mvhd.start, mvhd.end));
  if (movieHeader[8] !== 0) throw new Error('Unsupported time header');
  const movieScale = movieHeader.readUInt32BE(20), movieDuration = movieHeader.readUInt32BE(24);
  if (!movieScale || movieDuration !== 2 * movieScale) throw new Error('Only the two-second fixture is supported');
  const ids = tracks.map(track => {
    const h = only(boxes(mov, track.start + 8, track.end), 'tkhd');
    if (mov[h.start + 8] !== 0) throw new Error('Unsupported track header'); return mov.readUInt32BE(h.start + 20);
  });
  const trackId = Math.max(...ids) + 1;
  movieHeader.writeUInt32BE(trackId + 1, movieHeader.length - 4);
  const originalHeader = only(boxes(mov, tracks[0].start + 8, tracks[0].end), 'tkhd');
  const tkhd = Buffer.from(mov.subarray(originalHeader.start, originalHeader.end));
  if (tkhd.length !== 92) throw new Error('Unsupported header layout');
  tkhd.writeUInt32BE(3, 8); tkhd.writeUInt32BE(trackId, 20); tkhd.writeUInt32BE(movieDuration, 28);
  tkhd.writeUInt16BE(0, 44); tkhd.writeUInt32BE(0, 84); tkhd.writeUInt32BE(0, 88);
  // NULL before/after the single keyframe sample; keyframe PTS = 24/24 = 1 s.
  const sample = Buffer.concat([atom(0), atom(1, Buffer.from([0])), atom(0)]);
  const sampleOffset = moov.start + 8;
  const key = atom(1, atom('keyd', str('mdta'), str(stillKey)), atom('dtyp', u32(1), str('com.apple.metadata.datatype.int8')));
  const mebx = atom('mebx', zeros(6), u16(1), atom('keys', key));
  const stbl = atom('stbl', full('stsd', u32(1), mebx), full('stts', u32(3), u32(1), u32(24), u32(1), u32(1), u32(1), u32(23)),
    full('stsc', u32(1), u32(1), u32(3), u32(1)), full('stsz', u32(0), u32(3), u32(8), u32(9), u32(8)), full('stco', u32(1), u32(sampleOffset)));
  const url = atom('url ', u32(1)); // Self-contained resource; no external file references.
  const minf = atom('minf', full('nmhd'), atom('dinf', full('dref', u32(1), url)), stbl);
  const mdhd = full('mdhd', zeros(8), u32(24), u32(48), u16(0x55c4), u16(0));
  const metadataTrack = atom('trak', tkhd, atom('mdia', mdhd, handler('mdta'), minf));
  const metadata = atom('meta', handler('mdta'), full('keys', u32(1), atom('mdta', str(contentKey))),
    atom('ilst', atom(1, atom('data', u32(1), zeros(4), str(id)))));
  const newMoov = atom('moov', ...children.map(x => x.type === 'mvhd' ? movieHeader : mov.subarray(x.start, x.end)), metadataTrack, metadata);
  // Original media offsets/payload do not move. Only moov (after all original media) is rebuilt.
  return Buffer.concat([mov.subarray(0, moov.start), atom('mdat', sample), newMoov]);
}

export function motionJpeg(jpeg, mp4) {
  const xmp = str('http://ns.adobe.com/xap/1.0/\0' + '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description'
    + ' xmlns:GCamera="http://ns.google.com/photos/1.0/camera/" xmlns:Container="http://ns.google.com/photos/1.0/container/" xmlns:Item="http://ns.google.com/photos/1.0/container/item/"'
    + ' GCamera:MotionPhoto="1" GCamera:MotionPhotoVersion="1" GCamera:MotionPhotoPresentationTimestampUs="1000000"'
    + ' GCamera:MicroVideo="1" GCamera:MicroVideoVersion="1" GCamera:MicroVideoOffset="' + mp4.length + '" GCamera:MicroVideoPresentationTimestampUs="1000000">'
    + '<Container:Directory><rdf:Seq><rdf:li rdf:parseType="Resource"><Container:Item Item:Mime="image/jpeg" Item:Semantic="Primary" Item:Length="0"/></rdf:li>'
    + '<rdf:li rdf:parseType="Resource"><Container:Item Item:Mime="video/mp4" Item:Semantic="MotionPhoto" Item:Length="' + mp4.length + '"/></rdf:li></rdf:Seq></Container:Directory>'
    + '</rdf:Description></rdf:RDF></x:xmpmeta>');
  return Buffer.concat([jpeg.subarray(0, 2), Buffer.from([255, 225]), u16(xmp.length + 2), xmp, jpeg.subarray(2), mp4]);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const v of bytes) { crc ^= v; for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
// LIVP is merely a common two-file ZIP interchange candidate, NOT an Apple import API.
function archivePair(still, mov) {
  const local = [], central = []; let offset = 0;
  for (const [name, data] of [['probe.jpg', still], ['probe.mov', mov]]) {
    const filename = str(name), crc = crc32(data), header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x21, 12);
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26);
    const index = Buffer.alloc(46); index.writeUInt32LE(0x02014b50); index.writeUInt16LE(20, 4); index.writeUInt16LE(20, 6); index.writeUInt16LE(0x21, 14);
    index.writeUInt32LE(crc, 16); index.writeUInt32LE(data.length, 20); index.writeUInt32LE(data.length, 24); index.writeUInt16LE(filename.length, 28); index.writeUInt32LE(offset, 42);
    local.push(header, filename, data); central.push(index, filename); offset += header.length + filename.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(2, 8); end.writeUInt16LE(2, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
function ffmpeg(args) {
  const run = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', ...args], { encoding: 'utf8', windowsHide: true, timeout: 30000, maxBuffer: 1048576 });
  if (run.status !== 0) throw new Error('Existing FFmpeg could not generate synthetic fixture: ' + (run.error?.code || run.stderr));
}
export async function prepareFixtures(directory) {
  await mkdir(directory, { recursive: true });
  // Not gameplay. testsrc2 visibly moves; sound is a two-second synthetic tone.
  ffmpeg(['-n', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '23', '-c:a', 'aac', '-b:a', '32k', '-t', '2', join(directory, 'baseline.mp4')]);
  ffmpeg(['-n', '-i', join(directory, 'baseline.mp4'), '-ss', '1', '-frames:v', '1', '-q:v', '2', join(directory, 'baseline.jpg')]);
  ffmpeg(['-n', '-i', join(directory, 'baseline.mp4'), '-map', '0:v:0', '-map', '0:a:0', '-c', 'copy', '-map_metadata', '-1', '-f', 'mov', join(directory, 'baseline.mov')]);
  const baseJpeg = await readFile(join(directory, 'baseline.jpg')), baseMov = await readFile(join(directory, 'baseline.mov')), mp4 = await readFile(join(directory, 'baseline.mp4'));
  const identifier = randomUUID().toUpperCase();
  const still = addAppleIdentifier(baseJpeg, identifier), mov = addTimedMetadata(baseMov, identifier);
  const files = { 'baseline.jpg': baseJpeg, 'paired.jpg': still, 'paired.mov': mov, 'motion.jpg': motionJpeg(baseJpeg, mp4), 'paired.livp': archivePair(still, mov) };
  const manifest = { version: 1, syntheticOnly: true, identifier, width: 320, height: 180, frames: 48, duration: 2, keyframeSeconds: 1,
    applePhotosAcceptance: 'unverified', wechatIosAcceptance: 'unverified', files: {} };
  for (const [name, bytes] of Object.entries(files)) {
    if (bytes.length > 524288) throw new Error('Probe fixture too large');
    if (name !== 'baseline.jpg') await writeFile(join(directory, name), bytes, { flag: 'wx' });
    manifest.files[name] = { size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
  return manifest;
}
