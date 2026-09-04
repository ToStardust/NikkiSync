// @ts-nocheck -- legacy implementation below is no longer used for production QR output.
import QRCode from 'qrcode'
/*
const VERSION = 15
const SIZE = 17 + VERSION * 4
const DATA_CODEWORDS = 523
const ECC_PER_BLOCK = 22
const BLOCK_DATA_LENGTHS = [87, 87, 87, 87, 87, 88]
const ALIGNMENT = [6, 26, 48, 70]

function appendBits(target: number[], value: number, length: number): void {
  for (let i = length - 1; i >= 0; i--) target.push((value >>> i) & 1)
}

function makeDataCodewords(text: string): number[] {
  const bytes = [...Buffer.from(text, 'utf8')]
  if (bytes.length > 520) throw new Error('pairing payload is too large for local QR encoder')
  const bits: number[] = []
  appendBits(bits, 0b0100, 4)
  appendBits(bits, bytes.length, 16)
  for (const byte of bytes) appendBits(bits, byte, 8)
  const capacityBits = DATA_CODEWORDS * 8
  for (let i = 0; i < 4 && bits.length < capacityBits; i++) bits.push(0)
  while (bits.length % 8) bits.push(0)
  const result: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0
    for (let j = 0; j < 8; j++) value = (value << 1) | bits[i + j]
    result.push(value)
  }
  for (let pad = 0; result.length < DATA_CODEWORDS; pad++) result.push(pad % 2 === 0 ? 0xec : 0x11)
  return result
}

const EXP = new Array<number>(512).fill(0)
const LOG = new Array<number>(256).fill(0)
let gf = 1
for (let i = 0; i < 255; i++) {
  EXP[i] = gf; LOG[gf] = i
  gf <<= 1
  if (gf & 0x100) gf ^= 0x11d
}
for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]

function mul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]
}

function generator(degree: number): number[] {
  let poly = [1]
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0)
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j]
      next[j + 1] ^= mul(poly[j], EXP[i])
    }
    poly = next
  }
  return poly
}

const RS_GENERATOR = generator(ECC_PER_BLOCK)

function eccFor(block: number[]): number[] {
  const remainder = new Array<number>(ECC_PER_BLOCK).fill(0)
  for (const byte of block) {
    const factor = byte ^ remainder[0]
    remainder.shift(); remainder.push(0)
    for (let i = 0; i < ECC_PER_BLOCK; i++) remainder[i] ^= mul(RS_GENERATOR[i + 1], factor)
  }
  return remainder
}

function finalBits(text: string): number[] {
  const data = makeDataCodewords(text)
  const blocks: number[][] = []
  const ecc: number[][] = []
  let offset = 0
  for (const length of BLOCK_DATA_LENGTHS) {
    const block = data.slice(offset, offset + length); offset += length
    blocks.push(block); ecc.push(eccFor(block))
  }
  const codewords: number[] = []
  const maxData = Math.max(...BLOCK_DATA_LENGTHS)
  for (let i = 0; i < maxData; i++) for (const block of blocks) if (i < block.length) codewords.push(block[i])
  for (let i = 0; i < ECC_PER_BLOCK; i++) for (const block of ecc) codewords.push(block[i])
  const bits: number[] = []
  for (const byte of codewords) appendBits(bits, byte, 8)
  bits.push(0, 0, 0)
  return bits
}

function makeMatrix(text: string): boolean[][] {
  const modules = Array.from({ length: SIZE }, () => new Array<boolean>(SIZE).fill(false))
  const reserved = Array.from({ length: SIZE }, () => new Array<boolean>(SIZE).fill(false))
  const set = (x: number, y: number, dark: boolean) => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return
    modules[y][x] = dark; reserved[y][x] = true
  }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy))
      set(cx + dx, cy + dy, dist !== 2 && dist !== 4)
    }
  }
  finder(3, 3); finder(SIZE - 4, 3); finder(3, SIZE - 4)
  for (let i = 8; i < SIZE - 8; i++) {
    if (!reserved[6][i]) set(i, 6, i % 2 === 0)
    if (!reserved[i][6]) set(6, i, i % 2 === 0)
  }
  for (const cy of ALIGNMENT) for (const cx of ALIGNMENT) {
    if (reserved[cy][cx]) continue
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy))
      set(cx + dx, cy + dy, dist !== 1)
    }
  }

  const format = 0b111011111000100
  for (let i = 0; i <= 5; i++) set(8, i, ((format >>> i) & 1) !== 0)
  set(8, 7, ((format >>> 6) & 1) !== 0)
  set(8, 8, ((format >>> 7) & 1) !== 0)
  set(7, 8, ((format >>> 8) & 1) !== 0)
  for (let i = 9; i < 15; i++) set(14 - i, 8, ((format >>> i) & 1) !== 0)
  for (let i = 0; i < 8; i++) set(SIZE - 1 - i, 8, ((format >>> i) & 1) !== 0)
  for (let i = 8; i < 15; i++) set(8, SIZE - 15 + i, ((format >>> i) & 1) !== 0)
  set(8, SIZE - 8, true)

  const versionInfo = 0b001111100100101000
  for (let i = 0; i < 18; i++) {
    const dark = ((versionInfo >>> i) & 1) !== 0
    const a = SIZE - 11 + (i % 3), b = Math.floor(i / 3)
    set(a, b, dark); set(b, a, dark)
  }

  const bits = finalBits(text)
  let bit = 0
  let upward = true
  for (let right = SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right--
    for (let vert = 0; vert < SIZE; vert++) {
      const y = upward ? SIZE - 1 - vert : vert
      for (let dx = 0; dx < 2; dx++) {
        const x = right - dx
        if (reserved[y][x]) continue
        const raw = bit < bits.length ? bits[bit++] : 0
        modules[y][x] = Boolean(raw ^ ((((x + y) & 1) === 0) ? 1 : 0))
      }
    }
    upward = !upward
  }
  if (bit !== bits.length) throw new Error(`QR placement mismatch: ${bit}/${bits.length}`)
  return modules
}

export function legacyQrSvg(text: string, scale = 4, quiet = 4): string {
  const matrix = makeMatrix(text)
  const full = SIZE + quiet * 2
  const paths: string[] = []
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    if (matrix[y][x]) paths.push(`M${x + quiet},${y + quiet}h1v1h-1z`)
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${full} ${full}" width="${full * scale}" height="${full * scale}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/><path d="${paths.join('')}" fill="black"/></svg>`
}
*/

export async function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, { type: 'svg', errorCorrectionLevel: 'M', margin: 4, width: 512 })
}
