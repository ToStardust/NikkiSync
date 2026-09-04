#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'

const [root, token] = process.argv.slice(2)
if (!root || !token) throw new Error('usage: node token-locate.mjs <root> <base64-token>')
const needles = [Buffer.from(token, 'ascii'), Buffer.from(token, 'base64')]

async function contains(file, needle) {
  const handle = await fs.open(file, 'r')
  try {
    const chunkSize = 1024 * 1024
    let position = 0
    let carry = Buffer.alloc(0)
    while (true) {
      const chunk = Buffer.alloc(chunkSize)
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position)
      if (!bytesRead) return false
      const data = Buffer.concat([carry, chunk.subarray(0, bytesRead)])
      if (data.indexOf(needle) >= 0) return true
      carry = data.subarray(Math.max(0, data.length - needle.length + 1))
      position += bytesRead
    }
  } finally { await handle.close() }
}

const stack = [root]
let files = 0
while (stack.length) {
  const dir = stack.pop()
  let entries
  try { entries = await fs.readdir(dir, { withFileTypes: true }) } catch { continue }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) stack.push(full)
    else if (entry.isFile()) {
      files++
      let info
      try { info = await fs.stat(full) } catch { continue }
      if (info.size > 512 * 1024 * 1024) continue
      for (let i = 0; i < needles.length; i++) {
        try {
          if (await contains(full, needles[i])) console.log(`${i === 0 ? 'ascii' : 'binary'}\t${full}`)
        } catch { /* unreadable file */ }
      }
    }
  }
}
console.log(`files_scanned=${files}`)
