import assert from 'node:assert/strict'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { AssetRepository, DatabaseManager } from '@nikkisync/database'
import { DesktopStatusService } from '../src/desktop/DesktopStatusService.js'
import { createDesktopControlServer } from '../src/desktop/DesktopControlServer.js'
import { remotePanelScript } from '../src/desktop/RemoteBridgePanel.js'
import { startupFailureRecord } from '../src/desktop/StartupFailure.js'
import { ScanReconciler } from '../src/scanner/ScanReconciler.js'

test('database startup failures keep SQLite result categories and discard arbitrary error text', () => {
  for (const [native, number, category] of [
    ['SQLITE_BUSY',5,'busy'],['SQLITE_LOCKED',6,'locked'],['SQLITE_READONLY',8,'read-only'],
    ['SQLITE_IOERR',10,'io'],['SQLITE_CORRUPT',11,'corrupt'],['SQLITE_FULL',13,'full'],
    ['SQLITE_CANTOPEN',14,'cannot-open'],['SQLITE_CONSTRAINT_UNIQUE',2067,'constraint'],['SQLITE_NOTADB',26,'not-database']
  ] as const) {
    const error=Object.assign(new Error('private-photo-path token=secret'),{code:native,errno:number})
    const report=startupFailureRecord(error,'scanner-and-lan')
    assert.equal(report.code,'DATABASE_ERROR')
    assert.equal(report.database?.category,category)
    assert.equal(report.database?.resultCode,number&255)
    assert.equal(report.database?.extendedCode,number)
    assert.ok(!JSON.stringify(report).includes('private-photo-path'))
    assert.ok(!JSON.stringify(report).includes('secret'))
  }
  const error=Object.assign(new Error('UNIQUE constraint failed: resources.path_key private-path'),{code:'ERR_SQLITE_ERROR',errcode:2067})
  assert.equal(startupFailureRecord(error,'scanner-and-lan').database?.constraint,'resource-path-unique')
  const suspicious=Object.assign(new Error('SQLITE_CONSTRAINT private-secret'),{code:'SQLITE_PRIVATE_SECRET',errno:Infinity})
  const safe=startupFailureRecord(suspicious,'scanner-and-lan')
  assert.ok(!JSON.stringify(safe).includes('PRIVATE_SECRET'))
  assert.equal(safe.database?.category,'constraint')
  assert.equal(safe.database?.extendedCode,undefined)
})

test('actual SQLite index failures retain the operation and counters without photo identities', async () => {
  const db=new DatabaseManager(':memory:')
  try {
    db.initialize(readFileSync(path.resolve('packages/database/migrations/0001_initial.sql'),'utf8'))
    db.connection.exec("CREATE TRIGGER fixture_abort BEFORE INSERT ON resources BEGIN SELECT RAISE(ABORT,'private-index-fixture'); END;")
    const reconciler=new ScanReconciler(new AssetRepository(db))
    let failure:unknown
    try {
      await reconciler.reconcile([{absolutePath:path.resolve('synthetic-private/10001/NikkiPhotos_HighQuality/one.jpeg'),pathKey:'synthetic-private/one.jpeg',uid:'10001',kind:'high_quality',fileName:'one.jpeg',normalizedStem:'one',sizeBytes:10,mtimeMs:Date.now()-10000,sha256:'a'.repeat(64),mimeType:'image/jpeg',fileExt:'.jpeg'}],[])
    } catch(error) {failure=error}
    assert.ok(failure)
    const report=startupFailureRecord(failure,'scanner-and-lan')
    assert.equal(report.code,'DATABASE_ERROR')
    assert.equal(report.database?.category,'constraint')
    assert.deepEqual(report.index,{operation:'write-asset',processedAssets:0,observedResources:1})
    assert.ok(!JSON.stringify(report).includes('private'))
    assert.ok(!JSON.stringify(report).includes('one.jpeg'))
    assert.equal(db.connection.prepare('SELECT COUNT(*) AS count FROM assets').get()?.count,0,'failed transaction rolls back; no repair/reset is performed')
  } finally {db.close()}
})

test('startup report identifies common failures without logging source, paths or secrets', () => {
  const privateText = ' C:\\Users\\PrivateUser\\photo.jpg token=private-token https://private.example uid=123456789'
  for (const [message, expected] of [
    ['Infinity Nikki installation was not found', 'GAME_NOT_FOUND'],
    ['未找到局域网 IPv4 地址', 'NO_LAN'],
    ['listen EADDRINUSE', 'PORT_IN_USE'],
    ['SQLITE_CORRUPT', 'DATABASE_ERROR'],
    ['unknown error', 'SERVICE_EXIT']
  ]) {
    const report = startupFailureRecord(new Error(message + privateText), 'scanner-and-lan')
    assert.equal(report.code, expected)
    const text = JSON.stringify(report)
    for (const secret of ['PrivateUser', 'private-token', 'private.example', '123456789']) assert.ok(!text.includes(secret))
    assert.equal(report.phase, 'scanner-and-lan')
  }
})

test('closing the remote panel during its first status request cannot restart polling', async () => {
  class Element {
    content = 'desktop-token'; hidden = false; disabled = false; checked = false
    textContent = ''; innerHTML = ''; children: Element[] = []; dataset = {}
    onclick?: () => Promise<void>; onchange?: () => void
    append(...items: Element[]) { this.children.push(...items) }
    replaceChildren() { this.children = [] }
    setAttribute() {}; focus() {}
  }
  const elements = new Map<string, Element>()
  const element = (selector: string) => {
    if (!elements.has(selector)) elements.set(selector, new Element())
    return elements.get(selector)!
  }
  let finishStatus: ((value: unknown) => void) | undefined
  let deleted = false; let intervals = 0
  runInNewContext(remotePanelScript, {
    document: { querySelector: element, createElement: () => new Element(), addEventListener() {} },
    window: { addEventListener() {} }, AbortController, URL,
    IntersectionObserver: class { observe() {}; disconnect() {} },
    setInterval: () => { intervals++; return 1 }, clearInterval() {},
    fetch: async (url: string, options: { method?: string } = {}) => {
      let value: unknown
      if (url.endsWith('/photos')) value = { items: [{ resourceId: 'photo-1', fileName: 'photo.jpg' }] }
      else if (options.method === 'POST') value = { sessionId: 'session-1', expiresAt: new Date(Date.now() + 600_000).toISOString(), qrSvg: '<svg></svg>' }
      else if (options.method === 'DELETE') { deleted = true; value = {} }
      else return new Promise((resolve) => { finishStatus = (body) => resolve({ ok: true, json: async () => body }) })
      return { ok: true, json: async () => value }
    }
  })
  await element('#remote-open').onclick!()
  const input = element('#remote-grid').children[0]!.children[1]!
  input.checked = true; input.onchange!()
  const creating = element('#remote-create').onclick!()
  // Drain the create/json microtasks until the initial status fetch is pending.
  for (let attempt = 0; !finishStatus && attempt < 20; attempt++) await Promise.resolve()
  assert.ok(finishStatus)
  await element('#remote-close').onclick!()
  finishStatus({ state: 'created' })
  await creating
  assert.equal(deleted, true)
  assert.equal(element('#remote-modal').hidden, true)
  assert.equal(intervals, 0, 'a closed panel must not restart its polling interval')
})

test('desktop remote controls require a local page token, select resources, report state and close sessions', async () => {
  let closed = false
  const server = createDesktopControlServer({
    getStatus: () => ({ service: 'ready', host: '192.168.1.8', port: 28080, assets: 12, pairedDevices: 1, firstRun: false }),
    createPairingUri: () => 'nikki-sync://pairing-token',
    qrSvg: async () => '<svg data-test="remote-qr"></svg>',
    remoteBridge: {
      listPhotos: () => ({ items: [{ resourceId: 'photo-1', assetId: 'asset-1', fileName: 'photo.jpg', mimeType: 'image/jpeg', sizeBytes: 12 }] }),
      createSession: (ids) => {
        assert.deepEqual(ids, ['photo-1'])
        return { sessionId: 'session-1', token: 'private-token', expiresAt: '2026-10-01T00:10:00.000Z', state: 'created', qrPayload: 'test-payload' }
      },
      closeSession: () => { closed = true },
      getSessionStatus: () => ({ sessionId: 'session-1', expiresAt: '2026-10-01T00:10:00.000Z', state: closed ? 'closed' : 'created', selectedCount: 1 }),
      getPreview: () => undefined
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
  try {
    const html = await (await fetch(base)).text()
    assert.match(html, /微信下载照片/)
    const token = /name="nikkisync-desktop-token" content="([^"]+)"/.exec(html)?.[1]
    assert.ok(token)
    const headers = { 'X-NikkiSync-Desktop-Token': token, 'Content-Type': 'application/json' }
    assert.equal((await fetch(`${base}/api/remote/photos`)).status, 403)
    assert.equal((await fetch(`${base}/api/remote/photos`, { headers: { 'X-NikkiSync-Desktop-Token': 'é'.repeat(token.length) }, signal: AbortSignal.timeout(2000) })).status, 403)
    assert.equal((await fetch(`${base}/api/remote/photos`, { headers: { ...headers, Origin: 'https://evil.example' } })).status, 403)
    assert.equal((await fetch(`${base}/api/remote/photos`, { headers })).status, 200)
    const created = await fetch(`${base}/api/remote/session`, { method: 'POST', headers, body: JSON.stringify({ resourceIds: ['photo-1'] }) })
    assert.equal(created.status, 200)
    assert.equal((await created.json() as { qrSvg: string }).qrSvg, '<svg data-test="remote-qr"></svg>')
    const state = await (await fetch(`${base}/api/remote/session/session-1`, { headers })).json() as Record<string, unknown>
    assert.equal(state.state, 'created')
    assert.equal('token' in state, false)
    assert.equal((await fetch(`${base}/api/remote/session/session-1`, { method: 'DELETE', headers })).status, 200)
    assert.equal(closed, true)
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())) }
})

test('desktop status counts current assets without loading library rows or large parameters', () => {
  const database = new DatabaseManager(':memory:'); database.initialize()
  const assets = new AssetRepository(database), service = new DesktopStatusService(database)
  service['assets'].list = () => { throw new Error('Status must not hydrate the library') }
  const input = { host: '192.168.1.8', port: 28080 }
  try {
    assets.create({ assetId: 'large', assetType: 'photo', discoveredAt: '2026-10-05T00:00:00.000Z', metadata: { raw: { nativeParamPayload: 'A'.repeat(256 * 1024) } } })
    assert.equal(service.getStatus(input).assets, 1)
    assets.create({ assetId: 'deleted', assetType: 'photo', assetState: 'deleted', discoveredAt: '2026-10-05T00:00:00.000Z' })
    assert.equal(service.getStatus(input).assets, 1, 'removed sources must not remain in the visible library count')
    assets.hardDelete('large')
    assert.equal(service.getStatus(input).assets, 0, 'counts read current ready rows instead of stale cached results')
    assert.equal(service.getStatus({ ...input, assets: 0 }).assets, 0)
  } finally { database.close() }
})

test('desktop status marks an empty device list as first run', () => {
  const database = new DatabaseManager(':memory:')
  database.initialize()
  const status = new DesktopStatusService(database).getStatus({ host: '192.168.1.8', port: 28080, assets: 12 })
  assert.deepEqual(status, {
    service: 'ready', host: '192.168.1.8', port: 28080, assets: 12, pairedDevices: 0, firstRun: true
  })
  database.close()
})

test('desktop control page shows pairing automatically only on first run', async () => {
  const createServer = (firstRun: boolean) => createDesktopControlServer({
    getStatus: () => ({ service: 'ready', host: '192.168.1.8', port: 28080, assets: 12, pairedDevices: firstRun ? 0 : 1, firstRun }),
    createPairingUri: () => 'nikki-sync://pairing-token',
    qrSvg: async () => '<svg data-test="qr"></svg>'
  })
  const firstRunServer = createServer(true)
  const pairedServer = createServer(false)
  await Promise.all([
    new Promise<void>((resolve) => firstRunServer.listen(0, '127.0.0.1', resolve)),
    new Promise<void>((resolve) => pairedServer.listen(0, '127.0.0.1', resolve))
  ])
  try {
    const firstPort = (firstRunServer.address() as { port: number }).port
    const pairedPort = (pairedServer.address() as { port: number }).port
    const firstHtml = await (await fetch(`http://127.0.0.1:${firstPort}/`)).text()
    const pairedHtml = await (await fetch(`http://127.0.0.1:${pairedPort}/`)).text()
    assert.match(firstHtml, /data-test="qr"/)
    assert.match(firstHtml, /首次配对/)
    assert.doesNotMatch(pairedHtml, /data-test="qr"/)
    assert.match(pairedHtml, /生成新二维码/)
    const renewed = await fetch(`http://127.0.0.1:${pairedPort}/api/pairing`, { method: 'POST' })
    assert.equal(renewed.status, 200)
    assert.equal((await renewed.json() as { qrSvg: string }).qrSvg, '<svg data-test="qr"></svg>')
  } finally {
    await Promise.all([
      new Promise<void>((resolve) => firstRunServer.close(() => resolve())),
      new Promise<void>((resolve) => pairedServer.close(() => resolve()))
    ])
  }
})
