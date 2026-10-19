import assert from 'node:assert/strict'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { desktopPageScript } from '../src/desktop/DesktopPageScript.js'

test('APK export is offered only when the native desktop reports a bundled installer', () => {
  let receive!: (event: { data: unknown }) => void
  const messages: { type: string }[] = []
  const ui = mount(async () => ({ ok: false }), {
    addEventListener: (_: string, handler: typeof receive) => { receive = handler },
    postMessage: (message: { type: string }) => messages.push(message)
  })
  assert.equal(ui.element('#android-installer').hidden, true)
  receive({ data: { type: 'packageInfo', hasAndroidInstaller: true } })
  assert.equal(ui.element('#android-installer').hidden, false)
  ui.element('#android-installer').onclick!()
  assert.equal(messages.at(-1)?.type, 'saveAndroidInstaller')
  receive({ data: { type: 'packageInfo', hasAndroidInstaller: false } })
  assert.equal(ui.element('#android-installer').hidden, true)
})

function mount(fetcher: (url: string) => Promise<unknown>, bridge?: unknown) {
  let active: Element | undefined
  class Element {
    hidden = false; disabled = false; checked = false; inert = false
    textContent = ''; innerHTML = ''; dataset: Record<string, string> = {}
    attributes: Record<string, string> = {}
    onclick?: (event?: unknown) => Promise<void> | void
    onchange?: () => void
    setAttribute(name: string, value: string) { this.attributes[name] = value }
    removeAttribute(name: string) { delete this.attributes[name] }
    replaceChildren() { this.innerHTML = '' }
    querySelector(selector: string) { return element(selector) }
    focus() { active = this }
    querySelectorAll() { return [element('#close')] }
  }
  const elements = new Map<string, Element>()
  const element = (selector: string): Element => {
    if (!elements.has(selector)) elements.set(selector, new Element())
    return elements.get(selector)!
  }
  const navigation = ['connect', 'settings', 'about'].map((view) => {
    const button = element('nav-' + view); button.dataset.view = view; return button
  })
  const pages = ['connect', 'settings', 'about'].map((view) => {
    const page = element('[data-page="' + view + '"]'); page.dataset.page = view; return page
  })
  const projects = ['momo', 'nikkiGallery', 'releases', 'downloads'].map(project => {
    const link = element('project-' + project); link.dataset.project = project; return link
  })
  const events = new Map<string, (event: unknown) => void>()
  const documentState = { hidden: false }
  let poll: (() => Promise<void>) | undefined
  runInNewContext(desktopPageScript, {
    document: {
      get hidden() { return documentState.hidden },
      querySelector: element,
      querySelectorAll: (selector: string) => selector === '[data-view]' ? navigation : selector === '[data-project]' ? projects : pages,
      addEventListener: (name: string, handler: (event: unknown) => void) => events.set(name, handler),
      get activeElement() { return active }
    },
    window: { chrome: bridge ? { webview: bridge } : undefined, addEventListener() {} },
    fetch: fetcher,
    setInterval: (handler: () => Promise<void>) => { poll = handler; return 1 },
    clearInterval() {}
  })
  return { element, navigation, pages, projects, events, documentState, poll: () => poll!(), active: () => active }
}

test('About owns updates, displays the installed version, and opens only named project links', () => {
  const messages: unknown[] = []; let reply!: (event: unknown) => void
  const ui = mount(async () => ({}), {postMessage: (m: unknown) => messages.push(m), addEventListener: (_: string, handler: typeof reply) => {reply=handler}})
  ui.navigation[2]!.onclick!()
  assert.equal(ui.pages[2]!.hidden, false); assert.equal(ui.pages[0]!.hidden, true)
  assert.equal(ui.element('#desktop-title').textContent, '关于')
  reply({data: {type: 'packageInfo', version: '1.0.5', build: 2026101805, hasAndroidInstaller: true, availableUpdateVersion: '1.0.6'}})
  assert.match(ui.element('#desktop-version').textContent, /1\.0\.5/)
  assert.match(ui.element('#check-updates').textContent, /1\.0\.6/)
  assert.equal(ui.element('#about-update-dot').hidden, false)
  ui.element('#check-updates').onclick!(); assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1))), {type: 'checkUpdates'})
  let prevented=false; ui.projects[1]!.onclick!({preventDefault(){prevented=true}})
  assert.equal(prevented,true); assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1))), {type: 'openProjectLink', project: 'nikkiGallery'})
  ui.projects[3]!.onclick!({preventDefault(){}})
  assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1))), {type: 'openProjectLink', project: 'downloads'})
  reply({data: {type: 'packageInfo', version: '1.0.5', hasAndroidInstaller: false}})
  assert.equal(ui.element('#about-update-dot').hidden, true)
  assert.equal(ui.element('#check-updates').textContent, '检查更新')
})

test('browser-only About keeps repository links usable without offering an unavailable native update action', () => {
  const ui=mount(async()=>({})); assert.equal(ui.element('#check-updates').disabled,true)
  let prevented=false; ui.projects[1]!.onclick!({preventDefault(){prevented=true}})
  assert.equal(prevented,false)
})

test('hidden desktop stops status requests and refreshes immediately when restored', async () => {
  let requests = 0
  const ui = mount(async () => { requests++; return { ok: true, json: async () => ({ assets: 12, pairedDevices: 0, host: '127.0.0.1', port: 1 }) } })
  ui.documentState.hidden = true
  await ui.poll(); await ui.poll()
  assert.equal(requests, 0)
  ui.documentState.hidden = false
  ui.events.get('visibilitychange')?.({})
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(requests, 1)
  assert.equal(ui.element('#desktop-assets').textContent, '12')
})

test('closing Android pairing clears its code and ignores a late QR response', async () => {
  let finish!: (value: unknown) => void
  const ui = mount(async () => new Promise((resolve) => { finish = resolve }))
  const opening = ui.element('#renew').onclick!() as Promise<void>
  assert.equal(ui.element('#modal').hidden, false)
  assert.equal(ui.element('.app-shell').inert, true)
  ui.element('#close').onclick!()
  finish({ ok: true, json: async () => ({ qrSvg: '<svg data-private="late"/>' }) })
  await opening
  assert.equal(ui.element('#modal').hidden, true)
  assert.equal(ui.element('#modal-qr').innerHTML, '')
  assert.equal(ui.element('.app-shell').inert, false)
  assert.equal(ui.active(), ui.element('#renew'))
  assert.equal(ui.element('#renew').disabled, false)
})

test('a failed pairing request offers retry without showing a stale or invalid code', async () => {
  let requests = 0
  const ui = mount(async () => ++requests === 1
    ? { ok: false }
    : { ok: true, json: async () => ({ qrSvg: '<svg data-valid="retry"/>' }) })
  await ui.element('#renew').onclick!()
  assert.equal(ui.element('#modal-qr').innerHTML, '')
  assert.match(ui.element('#pairing-message').textContent, /重试/)
  assert.equal(ui.element('#renew').disabled, false)
  await ui.element('#pairing-retry').onclick!()
  assert.match(ui.element('#modal-qr').innerHTML, /data-valid="retry"/)
  assert.equal(ui.element('#pairing-retry').hidden, true)
})

test('desktop status preserves the library when unavailable and recovers without overlapping polls', async () => {
  let finish!: (value: unknown) => void; let requests = 0
  const ui = mount(async () => { requests++; return new Promise((resolve) => { finish = resolve }) })
  ui.element('#desktop-assets').textContent = '12'
  const first = ui.poll(); await ui.poll()
  assert.equal(requests, 1)
  finish({ ok: false }); await first
  assert.equal(ui.element('#desktop-assets').textContent, '12')
  assert.match(ui.element('#desktop-status-text').textContent, /暂不可用/)
  const next = ui.poll()
  finish({ ok: true, json: async () => ({ assets: 24, pairedDevices: 1, host: '192.168.1.9', port: 28080 }) })
  await next
  assert.equal(ui.element('#desktop-assets').textContent, '24')
  assert.equal(ui.element('#desktop-devices').textContent, '1')
  assert.equal(ui.element('#desktop-address').textContent, '192.168.1.9:28080')
  assert.equal(ui.element('#android-first-pairing').hidden, true)
  assert.equal(ui.element('#android-paired').hidden, false)
  assert.match(ui.element('#desktop-status-text').textContent, /运行中/)
})

test('settings navigation changes the active view and autostart waits for the native preference', () => {
  const messages: unknown[] = []
  let reply!: (event: unknown) => void
  const ui = mount(async () => ({}), {
    postMessage: (message: unknown) => messages.push(message),
    addEventListener: (_name: string, handler: (event: unknown) => void) => { reply = handler }
  })
  assert.equal(ui.element('#autostart').disabled, true)
  assert.deepEqual(JSON.parse(JSON.stringify(messages)), [{ type: 'getAutostart' }])
  ui.navigation[1]!.onclick!()
  assert.equal(ui.pages[0]!.hidden, true)
  assert.equal(ui.pages[1]!.hidden, false)
  assert.equal(ui.navigation[1]!.attributes['aria-current'], 'page')
  reply({ data: { type: 'autostart', enabled: true } })
  assert.equal(ui.element('#autostart').checked, true)
  assert.equal(ui.element('#autostart').disabled, false)
  ui.element('#autostart').checked = false; ui.element('#autostart').onchange!()
  assert.deepEqual(JSON.parse(JSON.stringify(messages[1])), { type: 'setAutostart', enabled: false })
})
