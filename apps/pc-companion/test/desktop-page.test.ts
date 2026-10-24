import assert from 'node:assert/strict'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import { desktopPageScript } from '../src/desktop/DesktopPageScript.js'
import { renderDesktopPage } from '../src/desktop/DesktopPage.js'
test('pending indicator opens its own gallery page while settings stays separate', async () => {
  const ui=mount(async()=>({}),undefined,[{id:'pending1',state:'pending',online:true,message:'等待电脑确认',count:1,files:[{name:'photo.jpeg',folder:'HighQuality',size:1000}]}])
  await new Promise(resolve=>setImmediate(resolve))
  assert.equal(ui.element('#open-organizer').disabled,false)
  assert.match(ui.element('#open-organizer').textContent,/1 张/)
  assert.equal(ui.element('#organizer-list').children[0]?.className,'organizer-tile')
  ui.element('#open-organizer').onclick!()
  assert.equal(ui.pages[3]!.hidden,false)
  assert.equal(ui.pages[1]!.hidden,true)
  const html=renderDesktopPage({service:'ready',host:'192.168.1.8',port:28080,assets:2,pairedDevices:1,firstRun:false})
  assert.match(html,/data-view="settings"[\s\S]*data-view="organizer"[\s\S]*data-view="about"/)
  assert.match(html,/class="organizer-grid"/)
})

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

function mount(fetcher: (url: string,options?:{body?:string}) => Promise<unknown>, bridge?: unknown, organizerItems:unknown[] = [], confirmResult=true,previewFetcher?:()=>Promise<unknown>) {
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
    append(...children:Element[]){this.children.push(...children)}
    click(){void this.onclick?.()}
    isConnected=true
    remove(){this.isConnected=false}
    querySelector(selector: string) { return element(selector) }
    focus() { active = this }
    querySelectorAll() { return [element('#close')] }
  }
  const elements = new Map<string, Element>()
  const element = (selector: string): Element => {
    if(selector==='[data-view="organizer"]')selector='nav-organizer';
    if (!elements.has(selector)) elements.set(selector, new Element())
    return elements.get(selector)!
  }
  const navigation = ['connect', 'settings', 'about', 'organizer'].map((view) => {
    const button = element('nav-' + view); button.dataset.view = view; return button
  })
  const pages = ['connect', 'settings', 'about', 'organizer'].map((view) => {
    const page = element('[data-page="' + view + '"]'); page.dataset.page = view; return page
  })
  const projects = ['momo', 'nikkiGallery', 'releases', 'downloads'].map(project => {
    const link = element('project-' + project); link.dataset.project = project; return link
  })
  const events = new Map<string, (event: unknown) => void>()
  const documentState = { hidden: false }
  const polls:(()=>Promise<void>)[]=[],prompts:string[]=[]
  const revoked:string[]=[];let blobs=0
  let poll: (() => Promise<void>) | undefined
  runInNewContext(desktopPageScript, {
    document: {
      get hidden() { return documentState.hidden },
      querySelector: element,
      createElement:()=>new Element(),
      querySelectorAll: (selector: string) => selector === '[data-view]' ? navigation : selector === '[data-project]' ? projects : selector === '[data-diagnostics-status]' ? [element('diagnostic-home-note'),element('diagnostic-modal-note')] : pages,
      addEventListener: (name: string, handler: (event: unknown) => void) => events.set(name, handler),
      get activeElement() { return active }
    },
    window: { chrome: bridge ? { webview: bridge } : undefined, addEventListener() {} },
    fetch: (url:string,options?:{body?:string}) => url==='/api/organizer'?Promise.resolve({ok:true,json:async()=>({items:organizerItems})}):url.startsWith('/api/organizer/preview?')?(previewFetcher?previewFetcher():Promise.resolve({ok:false})):fetcher(url,options),
    URL:{createObjectURL:()=>{blobs++;return 'blob:fixture-'+blobs},revokeObjectURL:(url:string)=>revoked.push(url)},
    confirm:(prompt:string)=>{prompts.push(prompt);return confirmResult},
    setInterval: (handler: () => Promise<void>) => { polls.push(handler);poll = handler; return polls.length },
    clearInterval() {}
  })
  return { element, navigation, pages, projects, events, documentState, prompts, revoked,organizerPoll:()=>polls[0]!(), setOrganizerItems:(items:unknown[])=>{organizerItems=items},poll: () => poll!(), active: () => active }
}

const organizerItem=(id:string,state='pending',online=true)=>({id,state,online,message:'等待电脑确认',count:2,files:[{name:id+'.jpeg',folder:'Photos',size:1048576},{name:id+'.mp4',folder:'Videos',size:5242880}]})
const descendants=(node:{textContent:string;className:string;children:any[]}):any[]=>[node,...node.children.flatMap(descendants)]

test('disconnected deletion records explain the phone requirement and completed records leave no gallery placeholders',async()=>{
 const ui=mount(async()=>({}),undefined,[organizerItem('offline','pending',false),organizerItem('confirmed','confirming',false),organizerItem('deleted','recycled'),organizerItem('cancelled','cancelled'),organizerItem('rejected','rejected'),{...organizerItem('failed','failed'),message:'部分处理，请检查回收站'}])
 await new Promise(resolve=>setImmediate(resolve))
 const cards=ui.element('#organizer-list').children;assert.equal(cards.length,2)
 const first=descendants(cards[0]!),second=descendants(cards[1]!)
 assert.equal(first.find(node=>node.className==='organizer-state').textContent,'等待手机连接')
 assert.equal(second.find(node=>node.className==='organizer-state').textContent,'等待手机重新连接')
 assert.ok(first.some(node=>node.textContent.includes('连接当前电脑后再确认')))
 assert.ok(first.some(node=>node.disabled&&node.textContent==='请先连接手机'))
 assert.equal(ui.element('#organizer-approve-all').disabled,true)
 assert.match(ui.element('#organizer-availability').textContent,/打开手机 App.*连接当前电脑/)
 assert.equal(ui.element('#organizer-results').hidden,false)
 assert.ok(descendants(ui.element('#organizer-results')).some(node=>node.textContent.includes('部分处理')))
 ui.setOrganizerItems([organizerItem('offline','pending',true)]);await ui.organizerPoll()
 assert.equal(descendants(ui.element('#organizer-list')).find(node=>node.className==='organizer-state').textContent,'待电脑确认')
 assert.equal(ui.element('#organizer-approve-all').disabled,false)
 const html=renderDesktopPage({service:'ready',host:'127.0.0.1',port:28080,assets:0,pairedDevices:1,firstRun:false})
 assert.match(html,/手机标记 → 电脑确认 → 手机在线核对后移入回收站/)
})

test('bulk confirmation snapshots only online pending records, prevents duplicate clicks, and removes completed tiles',async()=>{
 const calls:{url:string;body:unknown}[]=[];let finish!:(response:unknown)=>void
 const original=[organizerItem('online'),organizerItem('offline','pending',false),organizerItem('confirmed','confirming'),organizerItem('deleted','recycled')]
 const ui=mount(async(url,options)=>{calls.push({url,body:JSON.parse(options?.body||'null')});return new Promise(resolve=>{finish=resolve})},undefined,original)
 await new Promise(resolve=>setImmediate(resolve))
 assert.match(ui.element('#organizer-approve-all').textContent,/1 张/)
 const action=ui.element('#organizer-approve-all').onclick!();assert.equal(ui.element('#organizer-approve-all').disabled,true)
 await ui.element('#organizer-approve-all').onclick!();assert.equal(calls.length,1)
 assert.deepEqual(calls,[{url:'/api/organizer/approve-many',body:{ids:['online']}}])
 assert.equal(ui.prompts.length,1);assert.match(ui.prompts[0]!,/1 张.*2 个关联文件（6.0 MB）/);assert.match(ui.prompts[0]!,/Windows 回收站恢复/)
 // A newly arrived intention is displayed afterwards, never added to the approved snapshot.
 const next=[organizerItem('online','recycled'),organizerItem('new-arrival')];ui.setOrganizerItems(next)
 finish({ok:true,json:async()=>({items:next,approved:1,skipped:0})});await action
 const cards=ui.element('#organizer-list').children;assert.equal(cards.length,1)
 assert.ok(descendants(cards[0]!).some(node=>node.textContent==='new-arrival.jpeg'))
 assert.match(ui.element('#open-organizer').textContent,/1 张/);assert.equal(ui.element('#organizer-approve-all').disabled,false)
})

test('cancelling the bulk confirmation sends no approval request',async()=>{
 let calls=0;const ui=mount(async()=>{calls++;return {}},undefined,[organizerItem('online')],false)
 await new Promise(resolve=>setImmediate(resolve));await ui.element('#organizer-approve-all').onclick!()
 assert.equal(ui.prompts.length,1);assert.equal(calls,0);assert.equal(ui.element('#organizer-approve-all').disabled,false)
})

test('working states show progress instead of falsely asking users to reconnect or approve again',async()=>{
 const ui=mount(async()=>({}),undefined,['preparing','queued','checking','executing'].map(state=>organizerItem(state,state,false)))
 await new Promise(resolve=>setImmediate(resolve));const nodes=descendants(ui.element('#organizer-list'))
 assert.equal(ui.element('#organizer-list').children.length,4);assert.match(ui.element('#organizer-availability').textContent,/正在核对 1 张.*全部核对完成/)
 assert.equal(ui.element('#organizer-approve-all').disabled,true)
 const labels=nodes.filter(node=>node.className==='organizer-state').map(node=>node.textContent)
 assert.deepEqual(labels,['正在核对关联文件','已核对 · 排队处理中','正在核对关联文件','正在移入回收站'])
 assert.equal(nodes.some(node=>node.textContent==='等待手机重新连接'),false)
 const executing=descendants(ui.element('#organizer-list').children[3]!);assert.ok(executing.find(node=>node.textContent==='取消删除').disabled)
 ui.setOrganizerItems(['queued','checking','executing'].map(state=>organizerItem(state,state,false)));await ui.organizerPoll();assert.match(ui.element('#organizer-availability').textContent,/正在处理 3 张.*无需重复点击/)
})

test('bulk waits until the entire displayed batch has finished preparing, preventing partial early approvals',async()=>{
 let calls=0;const ui=mount(async()=>{calls++;return {}},undefined,[organizerItem('ready'),organizerItem('preparing','preparing')])
 await new Promise(resolve=>setImmediate(resolve));assert.equal(ui.element('#organizer-approve-all').disabled,true);await ui.element('#organizer-approve-all').onclick!();assert.equal(calls,0)
 ui.setOrganizerItems([organizerItem('ready'),organizerItem('preparing')]);await ui.organizerPoll();assert.equal(ui.element('#organizer-approve-all').disabled,false);assert.match(ui.element('#organizer-approve-all').textContent,/2 张/)
})

test('progress refreshes reuse an authenticated preview and release it after the record completes',async()=>{
 let reads=0;const ui=mount(async()=>({}),undefined,[organizerItem('same')],true,async()=>{reads++;return {ok:true,blob:async()=>({})}})
 await new Promise(resolve=>setImmediate(resolve));assert.equal(reads,1)
 for(const state of ['confirming','queued','checking','executing']){ui.setOrganizerItems([organizerItem('same',state)]);await ui.organizerPoll();await new Promise(resolve=>setImmediate(resolve))}
 assert.equal(reads,1);assert.equal(ui.revoked.length,0)
 ui.setOrganizerItems([organizerItem('same','recycled')]);await ui.organizerPoll();assert.deepEqual(ui.revoked,['blob:fixture-1'])
})

test('About owns updates, displays the installed version, and opens only named project links', () => {
  const messages: unknown[] = []; let reply!: (event: unknown) => void
  const ui = mount(async () => ({}), {postMessage: (m: unknown) => messages.push(m), addEventListener: (_: string, handler: typeof reply) => {reply=handler}})
  ui.navigation[2]!.onclick!()
  assert.equal(ui.pages[2]!.hidden, false); assert.equal(ui.pages[0]!.hidden, true)
  assert.equal(ui.element('#desktop-title').textContent, '关于')
  reply({data: {type: 'packageInfo', version: '1.0.5', build: 2026101805, hasAndroidInstaller: true, availableUpdateVersion: '1.0.6',availableUpdateBuild:2026101901}})
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

test('update badge compares builds and explains same-version revisions',()=>{
  let reply!:(event:unknown)=>void
  const ui=mount(async()=>({}),{postMessage(){},addEventListener(_:string,handler:typeof reply){reply=handler}})
  reply({data:{type:'packageInfo',version:'1.0.15',build:2026102204,availableUpdateVersion:'1.0.15',availableUpdateBuild:2026102204}})
  assert.equal(ui.element('#about-update-dot').hidden,true)
  reply({data:{type:'packageInfo',version:'1.0.15',build:2026102203,availableUpdateVersion:'1.0.15',availableUpdateBuild:2026102204}})
  assert.equal(ui.element('#about-update-dot').hidden,false)
  assert.match(ui.element('#desktop-update-note').textContent,/修订.*2026102203.*2026102204/)
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

test('QR diagnostic export sends one fixed action and shares progress across both entries',()=>{
  const messages:unknown[]=[];let reply!:(event:unknown)=>void
  const ui=mount(async()=>({}),{postMessage:(message:unknown)=>messages.push(message),addEventListener(_:string,handler:typeof reply){reply=handler}})
  for(const id of ['#export-connection-diagnostics','#pairing-export-diagnostics'])assert.equal(ui.element(id).disabled,false)
  ui.element('#pairing-export-diagnostics').onclick!()
  assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1))),{type:'exportConnectionDiagnostics'})
  const count=messages.length;ui.element('#export-connection-diagnostics').onclick!();assert.equal(messages.length,count)
  reply({data:{type:'connectionDiagnostics',busy:true,message:'collecting'}})
  assert.equal(ui.element('#export-connection-diagnostics').disabled,true)
  assert.equal(ui.element('diagnostic-home-note').textContent,'collecting');assert.equal(ui.element('diagnostic-modal-note').textContent,'collecting')
  reply({data:{type:'connectionDiagnostics',busy:false,message:'saved'}})
  assert.equal(ui.element('#pairing-export-diagnostics').disabled,false)
  assert.equal(ui.element('diagnostic-modal-note').textContent,'saved')
  assert.equal(mount(async()=>({})).element('#export-connection-diagnostics').disabled,true)
})

test('conflict inspection, repair and restore send fixed actions and respect native policy/busy state',()=>{
  const messages:unknown[]=[];let reply!:(event:unknown)=>void
  const ui=mount(async()=>({}),{postMessage:(value:unknown)=>messages.push(value),addEventListener(_:string,handler:typeof reply){reply=handler}})
  for(const [id,type] of [['#check-network-conflicts','checkNetworkConflicts'],['#repair-network-conflicts','repairNetworkConflicts'],['#restore-network-conflicts','restoreNetworkConflicts']]){
    ui.element(id!).onclick!();assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1))),{type})
  }
  reply({data:{type:'networkConflicts',busy:true,message:'checking'}})
  for(const id of ['#check-network-conflicts','#repair-network-conflicts','#restore-network-conflicts'])assert.equal(ui.element(id).disabled,true)
  reply({data:{type:'networkConflicts',busy:false,canRepair:false,message:'policy restricted'}})
  assert.equal(ui.element('#repair-network-conflicts').disabled,true);assert.equal(ui.element('#check-network-conflicts').disabled,false)
  assert.equal(ui.element('#network-conflict-note').textContent,'policy restricted')
  reply({data:{type:'networkConflicts',busy:false,canRepair:true,message:'found 1'}})
  assert.equal(ui.element('#repair-network-conflicts').disabled,false)
  assert.equal(mount(async()=>({})).element('#repair-network-conflicts').disabled,true)
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
