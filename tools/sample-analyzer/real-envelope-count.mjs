import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.argv[2]
if (!root) throw new Error('usage: node real-envelope-count.mjs <GamePlayPhotos>')

const files = []
async function walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) await walk(full)
    else if (/NikkiPhotos_HighQuality/i.test(full) && /\.jpe?g$/i.test(entry.name)) files.push(full)
  }
}
await walk(root)

let withToken = 0, withPayload = 0, invalidPayload = 0
const lengths = []
for (const file of files) {
  const bytes = await readFile(file)
  if (bytes.length < 46 || bytes[bytes.length - 46] !== 0xff || bytes[bytes.length - 45] !== 0xd9) continue
  const token = bytes.subarray(bytes.length - 44).toString('ascii')
  if (!/^[A-Za-z0-9+/]{43}=$/.test(token)) continue
  withToken++
  const delimiter = bytes.length - 46
  let previous = -1
  for (let i = delimiter - 2; i >= Math.max(0, delimiter - 2 * 1024 * 1024); i--) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) { previous = i; break }
  }
  if (previous < 0) continue
  const payload = bytes.subarray(previous + 2, delimiter).toString('ascii')
  if (!payload || !/^[\x20-\x7e]+$/.test(payload)) continue
  withPayload++
  lengths.push(payload.length)
  if (payload.startsWith('Invaild Params')) invalidPayload++
}
lengths.sort((a, b) => a - b)
console.log(JSON.stringify({
  highQualityFiles: files.length,
  withToken,
  withPayload,
  invalidPayload,
  payloadLength: lengths.length ? {
    min: lengths[0],
    median: lengths[Math.floor(lengths.length / 2)],
    max: lengths.at(-1)
  } : null
}, null, 2))
