import { DatabaseSync } from 'node:sqlite'
import path from 'node:path'

const dbPath = process.argv[2] || path.join(process.env.LOCALAPPDATA || process.env.HOME || '.', 'NikkiSync', 'nikkisync.sqlite')
const db = new DatabaseSync(dbPath)
try {
  const rows = db.prepare("SELECT asset_id, uid, metadata_json FROM assets WHERE metadata_json IS NOT NULL AND asset_state <> 'deleted'").all()
  const payloads = []
  for (const row of rows) {
    let metadata
    try { metadata = JSON.parse(String(row.metadata_json)) } catch { continue }
    const payload = metadata?.raw?.nativeParamPayload
    const token = metadata?.raw?.nativeParamToken
    if (typeof payload !== 'string') continue
    const base64Like = /^[A-Za-z0-9+/=]+$/.test(payload) && payload.length % 4 === 0
    let decodedBytes = 0
    if (base64Like) {
      try { decodedBytes = Buffer.from(payload, 'base64').length } catch { /* ignore */ }
    }
    payloads.push({
      assetId: String(row.asset_id),
      uid: row.uid == null ? null : String(row.uid),
      length: payload.length,
      base64Like,
      decodedBytes,
      prefix: payload.slice(0, 64),
      suffix: payload.slice(-64),
      token: typeof token === 'string' ? token : null
    })
  }

  const lengths = new Map()
  for (const item of payloads) lengths.set(item.length, (lengths.get(item.length) || 0) + 1)
  console.log(JSON.stringify({
    dbPath,
    payloadCount: payloads.length,
    lengthHistogram: [...lengths.entries()].sort((a, b) => a[0] - b[0]),
    examples: payloads.slice(0, 16)
  }, null, 2))
} finally {
  db.close()
}
