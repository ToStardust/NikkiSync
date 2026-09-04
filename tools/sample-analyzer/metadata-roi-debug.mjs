#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const [rootArg] = process.argv.slice(2)
if (!rootArg) throw new Error('usage: node metadata-roi-debug.mjs <GamePlayPhotos root>')

async function walk(dir, out = []) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) await walk(file, out)
    else if (/NikkiPhotos_HighQuality/i.test(file) && /\.jpe?g$/i.test(file)) out.push(file)
  }
  return out
}

function base64Runs(buffer) {
  const result = []
  let start = -1
  const isB64 = (c) => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) ||
    (c >= 0x30 && c <= 0x39) || c === 0x2b || c === 0x2f || c === 0x3d
  for (let i = 0; i <= buffer.length; i++) {
    const ok = i < buffer.length && isB64(buffer[i])
    if (ok && start < 0) start = i
    if ((!ok || i === buffer.length) && start >= 0) {
      if (i - start >= 40 && (i - start) % 4 === 0) result.push({ start, end: i, text: buffer.subarray(start, i).toString('ascii') })
      start = -1
    }
  }
  return result.sort((a, b) => b.text.length - a.text.length)
}

function hash(name, data) { return crypto.createHash(name).update(data).digest() }
function hex(data) { return Buffer.from(data).toString('hex') }

for (const file of (await walk(path.resolve(rootArg))).slice(0, 12)) {
  const bytes = await fs.readFile(file)
  const runs = base64Runs(bytes)
  const roi = runs.find((x) => x.text.length > 1000)
  const tail = [...runs].reverse().find((x) => x.text.length === 44 && x.end === bytes.length)
  if (!roi || !tail) continue
  const roiAscii = Buffer.from(roi.text, 'ascii')
  const decoded = Buffer.from(roi.text, 'base64')
  const token = Buffer.from(tail.text, 'base64')
  const candidates = {
    md5_ascii: hash('md5', roiAscii),
    md5_decoded: hash('md5', decoded),
    sha256_ascii: hash('sha256', roiAscii),
    sha256_decoded: hash('sha256', decoded),
  }
  const tokenMatches = Object.entries(candidates).filter(([, value]) => value.equals(token)).map(([name]) => name)
  const printable = [...decoded].filter((b) => b >= 0x20 && b <= 0x7e).length / decoded.length
  console.log(`\n${path.basename(file)}`)
  console.log(`roi=${roi.start}..${roi.end} ascii=${roi.text.length} decoded=${decoded.length}`)
  console.log(`roi_prefix_ascii=${roi.text.slice(0,64)}`)
  console.log(`before_roi_hex=${hex(bytes.subarray(Math.max(0, roi.start - 32), roi.start))}`)
  console.log(`after_roi_hex=${hex(bytes.subarray(roi.end, Math.min(bytes.length, roi.end + 64)))}`)
  console.log(`after_roi_ascii=${JSON.stringify(bytes.subarray(roi.end, Math.min(bytes.length, roi.end + 64)).toString('latin1'))}`)
  console.log(`decoded_prefix_hex=${hex(decoded.subarray(0,48))}`)
  console.log(`decoded_printable_ratio=${printable.toFixed(4)}`)
  console.log(`tail_token=${tail.text} token_hex=${hex(token)}`)
  console.log(`matches=${tokenMatches.join(',') || 'none'}`)
  console.log(`sha256_decoded=${hex(candidates.sha256_decoded)}`)
}
