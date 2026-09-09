#!/usr/bin/env node
import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('usage: node metadata-tail-structure.mjs <photo> [<photo> ...]')
  process.exit(2)
}

const TAIL_BYTES = 64 * 1024

function digest(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function isStandardBase64Byte(byte) {
  return (byte >= 0x41 && byte <= 0x5a)
    || (byte >= 0x61 && byte <= 0x7a)
    || (byte >= 0x30 && byte <= 0x39)
    || byte === 0x2b || byte === 0x2f || byte === 0x3d
}

function isBase64UrlByte(byte) {
  return (byte >= 0x41 && byte <= 0x5a)
    || (byte >= 0x61 && byte <= 0x7a)
    || (byte >= 0x30 && byte <= 0x39)
    || byte === 0x2d || byte === 0x5f || byte === 0x3d
}

function isPrintable(byte) {
  return byte >= 0x20 && byte <= 0x7e
}

function alphabetClass(bytes) {
  if (bytes.length > 0 && bytes.every(isStandardBase64Byte)) return 'standard-base64'
  if (bytes.length > 0 && bytes.every(isBase64UrlByte)) return 'base64url'
  if (bytes.length > 0 && bytes.every(isPrintable)) return 'printable-other'
  return 'binary'
}

function decodedByteLength(bytes) {
  const text = bytes.toString('ascii')
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text) || text.length % 4 !== 0) return undefined
  try { return Buffer.from(text, 'base64').length } catch { return undefined }
}

function asciiRuns(bytes) {
  const runs = []
  let start = -1
  for (let i = 0; i <= bytes.length; i += 1) {
    const printable = i < bytes.length && isPrintable(bytes[i])
    if (printable && start < 0) start = i
    if ((!printable || i === bytes.length) && start >= 0) {
      const run = bytes.subarray(start, i)
      if (run.length >= 8) {
        const paddingCount = run.toString('ascii').match(/=+$/)?.[0].length ?? 0
        runs.push({
          relativeOffsetFromEof: start - bytes.length,
          runLength: run.length,
          alphabetClass: alphabetClass(run),
          paddingCount,
          decodedByteLength: decodedByteLength(run),
          sha256: digest(run)
        })
      }
      start = -1
    }
  }
  return runs
}

async function readTail(filePath) {
  const handle = await fs.open(filePath, 'r')
  try {
    const size = (await handle.stat()).size
    const length = Math.min(size, TAIL_BYTES)
    const tail = Buffer.alloc(length)
    const result = await handle.read(tail, 0, length, size - length)
    return { size, tail: tail.subarray(0, result.bytesRead) }
  } finally {
    await handle.close()
  }
}

for (const input of files) {
  const filePath = path.resolve(input)
  const { size, tail } = await readTail(filePath)
  const eoi = []
  for (let i = 0; i + 1 < tail.length; i += 1) {
    if (tail[i] === 0xff && tail[i + 1] === 0xd9) eoi.push(i)
  }
  const finalEoi = eoi.at(-1)
  const previousEoi = eoi.at(-2)
  const afterFinal = finalEoi === undefined ? Buffer.alloc(0) : tail.subarray(finalEoi + 2)
  const betweenFinalTwo = previousEoi === undefined || finalEoi === undefined
    ? Buffer.alloc(0)
    : tail.subarray(previousEoi + 2, finalEoi)
  console.log(JSON.stringify({
    basename: path.basename(filePath),
    sizeBytes: size,
    tailBytesInspected: tail.length,
    ffd9: {
      count: eoi.length,
      relativeOffsetsFromEof: eoi.map((offset) => offset - tail.length)
    },
    bytesAfterFinalFfd9: {
      length: afterFinal.length,
      alphabetClass: alphabetClass(afterFinal),
      sha256: digest(afterFinal)
    },
    bytesBetweenFinalTwoFfd9: {
      length: betweenFinalTwo.length,
      alphabetClass: alphabetClass(betweenFinalTwo),
      sha256: digest(betweenFinalTwo)
    },
    asciiRuns: asciiRuns(tail)
  }, null, 2))
}
