#!/usr/bin/env node
import path from 'node:path'
import os from 'node:os'
import { DatabaseManager } from '@nikkisync/database'

const dbPath = process.argv[2] ?? path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'NikkiSync', 'nikkisync.sqlite')
const db = new DatabaseManager(dbPath)
try {
  const totals = db.connection.prepare(`
    SELECT COUNT(*) AS assets,
           SUM(CASE WHEN metadata_json IS NOT NULL THEN 1 ELSE 0 END) AS with_metadata,
           SUM(CASE WHEN metadata_json LIKE '%nativeParamToken%' THEN 1 ELSE 0 END) AS with_native_token
    FROM assets WHERE asset_state <> 'deleted'
  `).get()
  console.log(JSON.stringify({ dbPath, ...totals }, null, 2))
  const samples = db.connection.prepare(`
    SELECT asset_id, uid, metadata_json FROM assets
    WHERE metadata_json LIKE '%nativeParamToken%' AND asset_state <> 'deleted' LIMIT 3
  `).all()
  for (const row of samples) {
    const metadata = JSON.parse(String(row.metadata_json))
    const token = metadata?.raw?.nativeParamToken
    console.log(`${row.asset_id}\tuid=${row.uid ?? ''}\ttoken=${typeof token === 'string' ? token.slice(0, 8) + '…' : ''}`)
  }
} finally { db.close() }
