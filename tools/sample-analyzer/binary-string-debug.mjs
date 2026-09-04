import { readFile } from 'node:fs/promises'

const file = process.argv[2]
if (!file) throw new Error('usage: node binary-string-debug.mjs <binary>')

const bytes = await readFile(file)
const strings = new Set()

function collectAscii() {
  let start = -1
  for (let i = 0; i <= bytes.length; i++) {
    const value = i < bytes.length ? bytes[i] : 0
    const printable = value >= 0x20 && value <= 0x7e
    if (printable && start < 0) start = i
    if (!printable && start >= 0) {
      if (i - start >= 4) strings.add(bytes.subarray(start, i).toString('ascii'))
      start = -1
    }
  }
}

function collectUtf16Le() {
  for (let parity = 0; parity < 2; parity++) {
    let chars = []
    for (let i = parity; i + 1 < bytes.length; i += 2) {
      const code = bytes[i] | (bytes[i + 1] << 8)
      if (code >= 0x20 && code <= 0x7e) {
        chars.push(String.fromCharCode(code))
      } else {
        if (chars.length >= 4) strings.add(chars.join(''))
        chars = []
      }
    }
    if (chars.length >= 4) strings.add(chars.join(''))
  }
}

collectAscii()
collectUtf16Le()

const patterns = [/https?:\/\//i, /nuan5/i, /photo/i, /params?/i, /metadata/i, /uid/i, /md5/i, /filter/i, /light/i, /pose/i, /diy/i, /decode/i, /extract/i, /api/i]
const matched = [...strings].filter((value) => patterns.some((pattern) => pattern.test(value)))
  .sort((a, b) => a.localeCompare(b))

console.log(JSON.stringify({ file, size: bytes.length, matched }, null, 2))
