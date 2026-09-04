import os from 'node:os'
import path from 'node:path'
import { DatabaseManager } from '@nikkisync/database'
import { ScannerService } from '../../apps/pc-companion/dist/src/scanner/ScannerService.js'

const dbPath = process.argv[2] ?? path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'NikkiSync', 'nikkisync.sqlite')
const db = new DatabaseManager(dbPath)
db.initialize()
const scanner = new ScannerService(db, { watcher: false })
try {
  const result = await scanner.start()
  const counts = db.connection.prepare(`
    SELECT COUNT(*) AS assets,
      SUM(CASE WHEN json_extract(metadata_json, '$.raw.nativeParamToken') IS NOT NULL THEN 1 ELSE 0 END) AS with_token,
      SUM(CASE WHEN json_extract(metadata_json, '$.raw.nativeParamPayload') IS NOT NULL THEN 1 ELSE 0 END) AS with_payload
    FROM assets WHERE asset_state <> 'deleted'
  `).get()
  console.log(JSON.stringify({ dbPath, scan: {
    filesObserved: result.filesObserved,
    assetsCreated: result.assetsCreated,
    assetsUpdated: result.assetsUpdated,
    errors: result.errors.length
  }, ...counts }, null, 2))
} finally {
  await scanner.stop()
  db.close()
}
