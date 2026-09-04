#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'

const [rootArg] = process.argv.slice(2)
if (!rootArg) throw new Error('usage: node ascii-run-debug.mjs <GamePlayPhotos root>')

async function walk(dir, out = []) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name)
    if (entry.isDirectory()) await walk(file, out)
    else if (/NikkiPhotos_HighQuality/i.test(file) && /\.jpe?g$/i.test(file)) out.push(file)
  }
  return out
}

function runs(buffer) {
  const result = []
  let start = -1
  for (let i = 0; i <= buffer.length; i++) {
    const printable = i < buffer.length && buffer[i] >= 0x20 && buffer[i] <= 0x7e
    if (printable && start < 0) start = i
    if ((!printable || i === buffer.length) && start >= 0) {
      if (i - start >= 32) {
        const text = buffer.subarray(start, i).toString('ascii')
        const base64Chars = [...text].filter((ch) => /[A-Za-z0-9+/=]/.test(ch)).length
        result.push({ offset: start, length: i - start, base64Ratio: base64Chars / text.length, text })
      }
      start = -1
    }
  }
  return result.sort((a, b) => b.length - a.length)
}

const files = (await walk(path.resolve(rootArg))).slice(0, 8)
for (const file of files) {
  const buffer = await fs.readFile(file)
  console.log(`\n${path.basename(file)} size=${buffer.length}`)
  for (const run of runs(buffer).slice(0, 12)) {
    console.log(`offset=${run.offset} len=${run.length} b64=${run.base64Ratio.toFixed(3)} text=${JSON.stringify(run.text.slice(0, 140))}`)
  }
}
