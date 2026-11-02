import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'
import os from 'node:os'

const dbPath = process.argv[2] ?? path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'NikkiSync', 'nikkisync.sqlite')
const db = new DatabaseSync(dbPath, { readOnly: true })

const rows = db.prepare(`
  SELECT a.asset_id, a.uid, a.metadata_json, r.source_path
  FROM assets a
  LEFT JOIN resources r ON r.asset_id = a.asset_id AND r.role = 'source_high_quality'
  WHERE a.asset_state <> 'deleted' AND a.metadata_json IS NOT NULL
`).all()

const hash = (algorithm, ...parts) => {
  const h = createHash(algorithm)
  for (const part of parts) h.update(part)
  return h.digest()
}

const counters = new Map()
const bump = (name) => counters.set(name, (counters.get(name) ?? 0) + 1)
let tested = 0
const examples = []

for (const row of rows) {
  let metadata
  try { metadata = JSON.parse(String(row.metadata_json)) } catch { continue }
  const payload = metadata?.raw?.nativeParamPayload
  const tokenText = metadata?.raw?.nativeParamToken
  if (typeof payload !== 'string' || typeof tokenText !== 'string') continue
  const token = Buffer.from(tokenText, 'base64')
  if (token.length !== 32) continue
  tested++

  const uid = Buffer.from(String(row.uid ?? ''), 'utf8')
  const ascii = Buffer.from(payload, 'ascii')
  const decoded = Buffer.from(payload, 'base64')
  const md5Ascii = hash('md5', ascii)
  const md5Decoded = hash('md5', decoded)
  const candidates = new Map([
    ['sha256(payload-ascii)', hash('sha256', ascii)],
    ['sha256(payload-decoded)', hash('sha256', decoded)],
    ['sha256(uid+payload-ascii)', hash('sha256', uid, ascii)],
    ['sha256(payload-ascii+uid)', hash('sha256', ascii, uid)],
    ['sha256(uid+payload-decoded)', hash('sha256', uid, decoded)],
    ['sha256(payload-decoded+uid)', hash('sha256', decoded, uid)],
    ['md5(ascii)||md5(decoded)', Buffer.concat([md5Ascii, md5Decoded])],
    ['md5(decoded)||md5(ascii)', Buffer.concat([md5Decoded, md5Ascii])],
    ['sha256(uid+md5-ascii-hex)', hash('sha256', uid, Buffer.from(md5Ascii.toString('hex'), 'ascii'))],
    ['sha256(uid+md5-decoded-hex)', hash('sha256', uid, Buffer.from(md5Decoded.toString('hex'), 'ascii'))],
    ['sha256(md5-ascii-hex+uid)', hash('sha256', Buffer.from(md5Ascii.toString('hex'), 'ascii'), uid)],
    ['sha256(md5-decoded-hex+uid)', hash('sha256', Buffer.from(md5Decoded.toString('hex'), 'ascii'), uid)]
  ])

  if (row.source_path) {
    try {
      const file = await readFile(String(row.source_path))
      if (file.length >= 44) {
        const withoutToken = file.subarray(0, file.length - 44)
        const withoutFinalEoiAndToken = file.length >= 46 ? file.subarray(0, file.length - 46) : withoutToken
        candidates.set('sha256(jpeg-without-token)', hash('sha256', withoutToken))
        candidates.set('sha256(jpeg-before-final-eoi)', hash('sha256', withoutFinalEoiAndToken))
      }
    } catch { /* source can be temporarily unavailable */ }
  }

  const matched = []
  for (const [name, candidate] of candidates) {
    if (candidate.equals(token)) { bump(name); matched.push(name) }
  }

  if (token.subarray(0, 16).equals(md5Ascii)) bump('token.first16=md5(ascii)')
  if (token.subarray(16).equals(md5Ascii)) bump('token.last16=md5(ascii)')
  if (token.subarray(0, 16).equals(md5Decoded)) bump('token.first16=md5(decoded)')
  if (token.subarray(16).equals(md5Decoded)) bump('token.last16=md5(decoded)')

  if (examples.length < 8) examples.push({
    assetId: String(row.asset_id), uid: String(row.uid ?? ''), payloadChars: payload.length,
    decodedBytes: decoded.length, tokenHex: token.toString('hex'), md5Ascii: md5Ascii.toString('hex'),
    md5Decoded: md5Decoded.toString('hex'), matched
  })
}

console.log(JSON.stringify({ tested, exactMatches: Object.fromEntries(counters), examples }, null, 2))
db.close()
