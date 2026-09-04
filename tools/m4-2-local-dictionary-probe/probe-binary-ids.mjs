import fs from 'node:fs'
import path from 'node:path'

function filesUnder(root) {
  const allowed = new Set(['.pak', '.ucas', '.utoc'])
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && allowed.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(root, entry.name))
}

function findPattern(filePath, pattern, chunkSize = 8 * 1024 * 1024) {
  const fd = fs.openSync(filePath, 'r')
  const overlap = Math.max(0, pattern.length - 1)
  let offset = 0
  let tail = Buffer.alloc(0)
  const chunk = Buffer.allocUnsafe(chunkSize)
  try {
    while (true) {
      const bytesRead = fs.readSync(fd, chunk, 0, chunk.length, null)
      if (!bytesRead) return undefined
      const data = Buffer.concat([tail, chunk.subarray(0, bytesRead)])
      const found = data.indexOf(pattern)
      if (found >= 0) return offset - tail.length + found
      tail = overlap ? data.subarray(Math.max(0, data.length - overlap)) : Buffer.alloc(0)
      offset += bytesRead
    }
  } finally {
    fs.closeSync(fd)
  }
}

function contextAt(filePath, offset, radius = 48) {
  const fd = fs.openSync(filePath, 'r')
  const start = Math.max(0, offset - radius)
  const buffer = Buffer.alloc(radius * 2 + 4)
  try {
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, start)
    const data = buffer.subarray(0, bytesRead)
    const ascii = [...data]
      .map((byte) => byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.')
      .join('')
    return { start, hex: data.toString('hex'), ascii }
  } finally {
    fs.closeSync(fd)
  }
}

const [, , rootArg, ...idArgs] = process.argv
if (!rootArg || !idArgs.length) {
  console.error('usage: node probe-binary-ids.mjs <X6Game/Content/Paks> <entity-id> [...]')
  process.exit(2)
}

const root = path.resolve(rootArg)
const files = filesUnder(root)
if (!files.length) throw new Error(`no .pak/.ucas/.utoc files found under ${root}`)

for (const idArg of idArgs) {
  const entityId = Number(idArg)
  if (!Number.isSafeInteger(entityId) || entityId < 0 || entityId > 0xffffffff) {
    throw new Error(`invalid uint32 entity ID: ${idArg}`)
  }
  const little = Buffer.allocUnsafe(4); little.writeUInt32LE(entityId)
  const big = Buffer.allocUnsafe(4); big.writeUInt32BE(entityId)
  const patterns = new Map([
    ['ascii', Buffer.from(String(entityId), 'ascii')],
    ['u32le', little],
    ['u32be', big]
  ])
  const matches = []
  for (const filePath of files) {
    for (const [encoding, pattern] of patterns) {
      const offset = findPattern(filePath, pattern)
      if (offset !== undefined) matches.push({ encoding, filePath, offset })
    }
  }
  if (!matches.length) {
    console.log(`${entityId}: no raw match`)
    continue
  }
  console.log(`${entityId}:`)
  for (const match of matches) {
    console.log(`  ${match.encoding.padEnd(5)} ${path.basename(match.filePath)} @ 0x${match.offset.toString(16)}`)
    const context = contextAt(match.filePath, match.offset)
    console.log(`        context@0x${context.start.toString(16)} hex=${context.hex}`)
    console.log(`        ascii=${context.ascii}`)
  }
}
