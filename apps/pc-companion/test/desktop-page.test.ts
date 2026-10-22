import assert from 'node:assert/strict'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { desktopPageScript } from '../src/desktop/DesktopPageScript.js'
import { renderDesktopPage } from '../src/desktop/DesktopPage.js'

test('first-use guide replaces the unfinished WeChat entry and exposes the three next steps', () => {
  const html=renderDesktopPage({service:'ready',host:'192.168.1.8',port:28080,assets:0,pairedDevices:0,firstRun:true},{remoteToken:'test-token',wechat:true})
  assert.match(html, /首次使用引导/)
  assert.doesNotMatch(html, /id="wechat-start"|id="wechat-modal"|微信小程序/)
  for(const id of ['open-network-settings','open-scan-settings','android-installer']) assert.match(html,new RegExp('id="'+id+'"'))
  assert.match(html, /校园网.*隔离/)
  assert.match(html, /<button[^>]+id="scan-directory-help"[^>]+aria-expanded="false"/)
  assert.match(html, /id="scan-directory-guide"[^>]+hidden/)
})

test('folder help is a keyboard-operable button which expands and collapses the instructions', () => {
  const ui=mount(async()=>({}))
  assert.equal(ui.element('#scan-directory-guide').hidden,true)
  ui.element('#scan-directory-help').onclick!()
  assert.equal(ui.element('#scan-directory-guide').hidden,false)
  assert.equal(ui.element('#scan-directory-help').attributes['aria-expanded'],'true')
  ui.element('#scan-directory-help').onclick!()
  assert.equal(ui.element('#scan-directory-guide').hidden,true)
  assert.equal(ui.element('#scan-directory-help').attributes['aria-expanded'],'false')
})

test('the home scan shortcut opens settings with folder guidance, without choosing or sharing a folder', () => {
  const messages:unknown[]=[]
  const ui=mount(async()=>({}),{postMessage:(message:unknown)=>messages.push(message),addEventListener(){}})
  ui.element('#open-scan-settings').onclick!()
  assert.equal(ui.pages[1]!.hidden,false)
  assert.equal(ui.element('#scan-directory-guide').hidden,false)
  assert.equal(ui.element('#scan-directory-help').attributes['aria-expanded'],'true')
  assert.deepEqual(JSON.parse(JSON.stringify(messages)),[{type:'getAutostart'}])
})

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
    children:Element[]=[];style={cssText:''};className='';content='local-token'
    hidden = false; disabled = false; checked = false; inert = false
    textContent = ''; innerHTML = ''; dataset: Record<string, string> = {}
    attributes: Record<string, string> = {}
    onclick?: (event?: unknown) => Promise<void> | void
    onchange?: () => void
    setAttribute(name: string, value: string) { this.attributes[name] = value }
    removeAttribute(name: string) { delete this.attributes[name] }
    replaceChildren() { this.innerHTML = '';this.children=[] }
    appendChild(child:Element){this.children.push(child)}
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
      createElement:()=>new Element(),
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

test('network authorization is a named native action with no web-supplied program or port', () => {
  const messages: unknown[]=[];let reply!:(event:unknown)=>void
  const ui=mount(async()=>({}),{postMessage:(message:unknown)=>messages.push(message),addEventListener(_:string,handler:typeof reply){reply=handler}})
  assert.equal(ui.element('#authorize-network').disabled,false)
  ui.element('#authorize-network').onclick!()
  assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1))),{type:'authorizeNetwork'})
  reply({data:{type:'networkAuthorization',busy:true,message:'waiting'}})
  assert.equal(ui.element('#authorize-network').disabled,true)
  assert.equal(ui.element('#revoke-network').disabled,true)
  reply({data:{type:'networkAuthorization',busy:false,message:'cancelled'}})
  assert.equal(ui.element('#authorize-network').disabled,false)
  assert.equal(ui.element('#network-authorization-note').textContent,'cancelled')
  ui.element('#revoke-network').onclick!()
  assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1))),{type:'revokeNetwork'})
  reply({data:{type:'networkAuthorization',busy:false,message:'already allowed',authorized:true,canRevoke:true}})
  assert.equal(ui.element('#authorize-network').disabled,true)
  assert.equal(ui.element('#authorize-network').textContent,'已添加本地网络权限')
  assert.equal(ui.element('#revoke-network').disabled,false)
  reply({data:{type:'networkAuthorization',busy:false,message:'removed',authorized:false,canRevoke:false}})
  assert.equal(ui.element('#authorize-network').disabled,false)
  assert.equal(ui.element('#revoke-network').disabled,true)
  const browser=mount(async()=>({}))
  assert.equal(browser.element('#authorize-network').disabled,true)
})

test('home guidance opens settings and an extra folder is shared only after confirmation',async()=>{
  const messages:unknown[]=[];let receive!:(event:unknown)=>void;const calls:string[]=[]
  const ui=mount(async(url)=>{calls.push(url);return {ok:true,json:async()=>url.endsWith('/inspect')?{id:'proposal',roots:[{path:'C:/Photo exports'}],images:3,videos:0,hint:'external',limited:false}:{directories:[],automaticRoots:['C:/GamePhotos'],message:''}}},{postMessage:(message:unknown)=>messages.push(message),addEventListener(_:string,handler:typeof receive){receive=handler}})
  assert.equal(ui.element('#add-scan-directory').disabled,false)
  ui.element('#open-network-settings').onclick!();assert.equal(ui.pages[1]!.hidden,false)
  ui.element('#add-scan-directory').onclick!();assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1))),{type:'chooseExtraScanDirectory'})
  receive({data:{type:'extraScanDirectorySelected',path:'C:/Photo exports'}})
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(ui.element('#scan-directory-preview').hidden,false)
  assert.equal(calls.some(url=>url.endsWith('/confirm')),false)
  await ui.element('#confirm-scan-directory').onclick!()
  assert.equal(calls.some(url=>url.endsWith('/confirm')),true)
  assert.equal(ui.element('#scan-directory-preview').hidden,true)
  assert.equal(mount(async()=>({})).element('#add-scan-directory').disabled,true)
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
