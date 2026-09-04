import { createHash } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

const dbPath = process.argv[2] ?? 'C:\\Users\\Stardust\\NikkiSync\\nikkisync.sqlite'
const db = new DatabaseSync(dbPath, { readOnly: true })
const rows = db.prepare(`
  SELECT asset_id, uid, metadata_json
  FROM assets
  WHERE asset_state <> 'deleted' AND metadata_json IS NOT NULL
`).all()

const samples = []
for (const row of rows) {
  let metadata
  try { metadata = JSON.parse(String(row.metadata_json)) } catch { continue }
  const payload = metadata?.raw?.nativeParamPayload
  if (typeof payload !== 'string' || payload.length < 1024) continue
  const decoded = Buffer.from(payload, 'base64')
  samples.push({
    assetId: String(row.asset_id), uid: String(row.uid ?? ''), payload, decoded,
    md5Ascii: createHash('md5').update(payload, 'ascii').digest('hex'),
    md5Decoded: createHash('md5').update(decoded).digest('hex')
  })
}

function commonPrefix(a, b) {
  const max = Math.min(a.length, b.length)
  let i = 0
  while (i < max && a[i] === b[i]) i++
  return i
}

const blockFrequency = new Map()
for (const sample of samples) {
  for (let offset = 0; offset + 16 <= Math.min(sample.decoded.length, 256); offset += 16) {
    const key = `${offset}:${sample.decoded.subarray(offset, offset + 16).toString('hex')}`
    blockFrequency.set(key, (blockFrequency.get(key) ?? 0) + 1)
  }
}

const first = samples[0]
const comparisons = samples.slice(1, 16).map((sample) => ({
  assetId: sample.assetId,
  uid: sample.uid,
  decodedBytes: sample.decoded.length,
  mod16: sample.decoded.length % 16,
  commonPrefixBytes: first ? commonPrefix(first.decoded, sample.decoded) : 0,
  first64Hex: sample.decoded.subarray(0, 64).toString('hex'),
  md5Ascii: sample.md5Ascii,
  md5Decoded: sample.md5Decoded
}))

const frequentBlocks = [...blockFrequency.entries()]
  .filter(([, count]) => count >= 3)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 30)
  .map(([key, count]) => ({ offset: Number(key.split(':')[0]), hex: key.slice(key.indexOf(':') + 1), count }))

const lengths = samples.map((sample) => sample.decoded.length)
console.log(JSON.stringify({
  sampleCount: samples.length,
  allDecodedBlockAligned: samples.every((sample) => sample.decoded.length % 16 === 0),
  minDecodedBytes: Math.min(...lengths),
  maxDecodedBytes: Math.max(...lengths),
  first: first ? {
    assetId: first.assetId,
    uid: first.uid,
    decodedBytes: first.decoded.length,
    mod16: first.decoded.length % 16,
    first128Hex: first.decoded.subarray(0, 128).toString('hex'),
    last64Hex: first.decoded.subarray(-64).toString('hex'),
    md5Ascii: first.md5Ascii,
    md5Decoded: first.md5Decoded
  } : null,
  comparisons,
  frequentBlocks
}, null, 2))

db.close()
