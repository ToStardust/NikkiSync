import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const filePath = process.argv[2]
if (!filePath) throw new Error('usage: node photo-envelope-debug.mjs <jpeg>')
const bytes = await readFile(filePath)
const delimiter = bytes.length - 46
let previousEoi = -1
for (let i = delimiter - 2; i >= 0; i--) {
  if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) { previousEoi = i; break }
}
if (previousEoi < 0) throw new Error('previous EOI not found')
const payload = bytes.subarray(previousEoi + 2, delimiter).toString('ascii')
const decoded = Buffer.from(payload, 'base64')
const token = bytes.subarray(bytes.length - 44).toString('ascii')
const tokenBytes = Buffer.from(token, 'base64')
const hash = (algorithm, value) => createHash(algorithm).update(value).digest('hex')
const printable = [...decoded].filter((value) => value >= 32 && value <= 126).length / Math.max(1, decoded.length)
console.log(JSON.stringify({
  fileBytes: bytes.length,
  payloadChars: payload.length,
  payloadBase64: /^[A-Za-z0-9+/=]+$/.test(payload),
  decodedBytes: decoded.length,
  token,
  tokenHex: tokenBytes.toString('hex'),
  payloadMd5: hash('md5', Buffer.from(payload, 'ascii')),
  decodedMd5: hash('md5', decoded),
  payloadSha256: hash('sha256', Buffer.from(payload, 'ascii')),
  decodedSha256: hash('sha256', decoded),
  tokenEqualsPayloadSha256: tokenBytes.equals(createHash('sha256').update(Buffer.from(payload, 'ascii')).digest()),
  tokenEqualsDecodedSha256: tokenBytes.equals(createHash('sha256').update(decoded).digest()),
  decodedPrefixHex: decoded.subarray(0, 32).toString('hex'),
  decodedPrintableRatio: printable
}, null, 2))
