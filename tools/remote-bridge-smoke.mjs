import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createReadStream, readFileSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import https from 'node:https'
import os from 'node:os'
import { AssetRepository, DatabaseManager } from '@nikkisync/database'
import { LocalSyncServer } from '../apps/pc-companion/dist/src/server/LocalSyncServer.js'
import { LocalTlsIdentityService } from '../apps/pc-companion/dist/src/server/LocalTlsIdentityService.js'
import { RemoteBridgeService } from '../apps/pc-companion/dist/src/remote/RemoteBridgeService.js'
import { createDesktopControlServer } from '../apps/pc-companion/dist/src/desktop/DesktopControlServer.js'
import { qrSvg } from '../apps/pc-companion/dist/src/qr.js'

// Existing DB and media are read-only. All sessions/TLS fixtures use an in-memory DB.
// Both listeners bind loopback; this script never exposes media to the LAN/public Internet.
const args = process.argv.slice(2)
const databasePath = args[args.indexOf('--database') + 1]
if (!args.includes('--database') || !databasePath) throw new Error('Usage: node tools/remote-bridge-smoke.mjs --database <existing SQLite path> [--serve] [--schema <SQL path>]')
const sqliteModule = await import(process.versions.bun ? 'bun:sqlite' : 'node:sqlite')
const original = process.versions.bun ? new sqliteModule.Database(databasePath, { readonly: true }) : new sqliteModule.DatabaseSync(databasePath, { readOnly: true })
let rows
try {
  rows = original.prepare(`SELECT r.*, a.captured_at, a.discovered_at FROM resources r JOIN assets a ON r.asset_id = a.asset_id
    WHERE a.asset_type = 'photo' AND a.asset_state = 'ready' AND r.stable_state = 'stable'
      AND r.mime_type IN ('image/jpeg', 'image/png') AND r.role IN ('source_high_quality', 'source_primary')
    ORDER BY COALESCE(a.captured_at, a.discovered_at) DESC, CASE WHEN r.role = 'source_high_quality' THEN 0 ELSE 1 END LIMIT 100`).all()
} finally { original.close() }
const schema = args.includes('--schema') ? args[args.indexOf('--schema') + 1] : new URL('../packages/database/migrations/0001_initial.sql', import.meta.url)
const db = new DatabaseManager(':memory:'); db.initialize(readFileSync(schema, 'utf8'))
const assets = new AssetRepository(db)
const seen = new Set()
for (const row of rows) {
  if (seen.has(row.asset_id) || seen.size >= 12) continue
  try { if ((await stat(row.source_path)).size !== Number(row.size_bytes)) continue } catch { continue }
  assets.reconcile({
    assetId: row.asset_id, assetType: 'photo', assetState: 'ready', discoveredAt: row.discovered_at,
    ...(row.captured_at ? { capturedAt: row.captured_at } : {}),
    resources: [{ resourceId: row.resource_id, assetId: row.asset_id, role: row.role, fileName: row.file_name, sourcePath: row.source_path,
      pathKey: row.path_key, mimeType: row.mime_type, fileExt: row.file_ext, sizeBytes: Number(row.size_bytes), sha256: row.sha256,
      stableState: 'stable', isDerived: false }]
  })
  seen.add(row.asset_id)
}
assert.ok(seen.size, 'No available managed still photos')
let clockOffset = 0
const bridge = new RemoteBridgeService(db, { now: () => Date.now() + clockOffset })
const tls = new LocalTlsIdentityService(db).getOrCreate()
const sync = new LocalSyncServer(db, { host: '127.0.0.1', mdns: false, tls: { key: tls.keyPem, cert: tls.certPem }, remoteBridge: bridge })
const address = await sync.start()
const lanHost = Object.values(os.networkInterfaces()).flatMap((entries) => entries ?? []).find((entry) => entry.family === 'IPv4' && /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(entry.address))?.address ?? '192.168.1.8'
let lastPayload
const desktop = createDesktopControlServer({
  getStatus: () => ({ service: 'ready', host: lanHost, port: address.port, assets: seen.size, pairedDevices: 1, firstRun: false }),
  createPairingUri: () => 'nikki-sync://fixture',
  qrSvg: async (payload) => { lastPayload = payload; return qrSvg(payload) },
  remoteBridge: {
    listPhotos: (cursor) => bridge.listSelectablePhotos(cursor), createSession: (ids) => sync.createRemoteSession(lanHost, ids),
    closeSession: (id) => bridge.closeSession(id), getSessionStatus: (id) => bridge.getSessionStatus(id), getPreview: (id) => bridge.getLocalPreview(id)
  }
})
await new Promise((resolve) => desktop.listen(0, '127.0.0.1', resolve))
const desktopUrl = `http://127.0.0.1:${desktop.address().port}`
const page = await (await fetch(desktopUrl)).text()
const desktopToken = /name="nikkisync-desktop-token" content="([^"]+)"/.exec(page)?.[1]
assert.ok(desktopToken)
const controlHeaders = { 'X-NikkiSync-Desktop-Token': desktopToken, 'Content-Type': 'application/json' }
const photos = await (await fetch(`${desktopUrl}/api/remote/photos`, { headers: controlHeaders })).json()
const photo = photos.items[0]
const created = await fetch(`${desktopUrl}/api/remote/session`, { method: 'POST', headers: controlHeaders, body: JSON.stringify({ resourceIds: [photo.resourceId] }) })
assert.equal(created.status, 200)
assert.match((await created.json()).qrSvg, /^<svg /)
const payload = JSON.parse(lastPayload)
async function request(method, route, token = payload.token, range) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: '127.0.0.1', port: address.port, servername: 'nikkisync.local', ca: tls.certPem, method, path: route,
      headers: { ...(token ? { 'X-NikkiSync-Remote-Token': token } : {}), ...(range ? { Range: range } : {}) } }, (res) => {
      const chunks = []; res.on('data', (chunk) => chunks.push(chunk)); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes: Buffer.concat(chunks) }))
    }); req.on('error', reject); req.end()
  })
}
const fileRoute = `/remote/session/${payload.sessionId}/resource/${photo.resourceId}`
assert.equal((await request('GET', fileRoute, '')).status, 401)
const downloaded = await request('GET', fileRoute)
assert.equal(downloaded.status, 200)
const source = bridge.getLocalPreview(photo.resourceId)
const sourceHash = createHash('sha256')
for await (const chunk of createReadStream(source.sourcePath)) sourceHash.update(chunk)
assert.equal(createHash('sha256').update(downloaded.bytes).digest('hex'), sourceHash.digest('hex'))
const partial = await request('GET', fileRoute, payload.token, 'bytes=0-63')
assert.equal(partial.status, 206); assert.deepEqual(partial.bytes, downloaded.bytes.subarray(0, 64))
const head = await request('HEAD', fileRoute)
assert.equal(head.status, 200); assert.equal(Number(head.headers['content-length']), downloaded.bytes.length)
assert.equal((await fetch(`${desktopUrl}/api/remote/session/${payload.sessionId}`, { method: 'DELETE', headers: controlHeaders })).status, 200)
assert.equal((await request('GET', fileRoute)).status, 410)
const expiring = sync.createRemoteSession(lanHost, [photo.resourceId]); clockOffset += 600_001
assert.equal((await request('GET', `/remote/session/${expiring.sessionId}/resource/${photo.resourceId}`, expiring.token)).status, 410)
clockOffset = 0
console.log(JSON.stringify({ result: 'PASS', managedPhotos: seen.size, testedBytes: downloaded.bytes.length, checks: ['desktop-selection', 'QR', 'token', 'trusted-TLS', 'full-file-SHA256', 'Range', 'HEAD', 'close', 'expiry'], loopbackOnly: true, ...(args.includes('--serve') ? { desktopUrl } : {}) }))
async function stop() { await new Promise((resolve) => desktop.close(resolve)); await sync.stop(); db.close() }
if (args.includes('--serve')) {
  process.once('SIGINT', () => { void stop().then(() => process.exit(0)) })
  process.once('SIGTERM', () => { void stop().then(() => process.exit(0)) })
} else await stop()
