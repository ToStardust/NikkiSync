#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'

const root = process.argv[2]
if (!root) throw new Error('usage: node tail-debug.mjs <GamePlayPhotos>')

async function walk(dir) {
  const out = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...await walk(full))
    else if (entry.isFile() && /\.(jpe?g)$/i.test(entry.name) && full.toLowerCase().includes('nikkiphotos_highquality')) out.push(full)
  }
  return out
}

const files = (await walk(root)).slice(0, 24)
for (const file of files) {
  const data = await fs.readFile(file)
  let last = -1
  for (let i = 0; i < data.length - 1; i++) if (data[i] === 0xff && data[i + 1] === 0xd9) last = i + 2
  const tail = last >= 0 ? data.subarray(last) : Buffer.alloc(0)
  const ascii = [...tail].map(b => b >= 32 && b <= 126 ? String.fromCharCode(b) : '.').join('')
  console.log(`${path.basename(file)}\t${tail.length}\t${tail.toString('hex')}\t${ascii}`)
}
