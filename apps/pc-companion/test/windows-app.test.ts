import assert from 'node:assert/strict'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { DatabaseManager } from '@nikkisync/database'
import { DesktopStatusService } from '../src/desktop/DesktopStatusService.js'
import { createDesktopControlServer } from '../src/desktop/DesktopControlServer.js'
import { remotePanelScript } from '../src/desktop/RemoteBridgePanel.js'

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
