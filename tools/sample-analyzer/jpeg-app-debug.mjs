#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'

const root = process.argv[2]
if (!root) throw new Error('usage: node jpeg-app-debug.mjs <GamePlayPhotos>')

async function findHighQuality(dir, limit = 6) {
  const result = []
  const stack = [dir]
  while (stack.length && result.length < limit) {
    const current = stack.pop()
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (/\.jpe?g$/i.test(entry.name) && full.toLowerCase().includes('nikkiphotos_highquality')) result.push(full)
      if (result.length >= limit) break
    }
  }
  return result
}

function asciiPreview(bytes) {
  return [...bytes.subarray(0, 140)].map((b) => b >= 32 && b <= 126 ? String.fromCharCode(b) : '.').join('')
}

for (const file of await findHighQuality(root)) {
  const data = await fs.readFile(file)
  console.log(`\n${path.basename(file)} (${data.length})`)
  let p = 2
  while (p + 4 < data.length && data[p] === 0xff) {
    const marker = data[p + 1]
    p += 2
    if (marker === 0xda || marker === 0xd9) break
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue
    const length = data.readUInt16BE(p)
    p += 2
    if (length < 2 || p + length - 2 > data.length) break
    const payload = data.subarray(p, p + length - 2)
    if ((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe) {
      console.log(`APP/COM marker=0x${marker.toString(16)} len=${payload.length} ${asciiPreview(payload)}`)
    }
    p += length - 2
  }
}
