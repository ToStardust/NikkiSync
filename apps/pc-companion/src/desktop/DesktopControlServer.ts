import http from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { DesktopStatus } from './DesktopStatusService.js'
import type { LocalRemotePhotoResource, RemoteSelectionPage } from '../remote/RemoteFileProvider.js'
import type { CreatedRemoteSession, RemoteSessionStatus } from '../remote/RemoteSessionStore.js'
import { remotePanelCss, remotePanelHtml, remotePanelScript } from './RemoteBridgePanel.js'

export interface DesktopControlServerConfig {
  getStatus(): DesktopStatus
  createPairingUri(): string
  qrSvg(uri: string): Promise<string>
  remoteBridge?: {
    listPhotos(cursor?: string): RemoteSelectionPage
    createSession(resourceIds: string[]): CreatedRemoteSession
    closeSession(sessionId: string): void
    getSessionStatus(sessionId: string): RemoteSessionStatus | undefined
    getPreview(resourceId: string): LocalRemotePhotoResource | undefined
  }
}

function html(status: DesktopStatus, qrSvg?: string, remoteToken?: string): string {
  const pairing = qrSvg
    ? `<section class="pairing-card"><h2>首次配对</h2><p>请使用手机 NikkiSync 扫描二维码。</p><div class="qr">${qrSvg}</div></section>`
    : '<section class="paired-card"><h2>已连接</h2><p>手机已配对。需要添加新设备时可生成新的二维码。</p></section>'
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NikkiSync PC</title>${remoteToken ? `<meta name="nikkisync-desktop-token" content="${remoteToken}">` : ''}<style>
:root{color-scheme:dark}body{margin:0;background:#17131f;color:#f8f3ff;font:15px system-ui,"Microsoft YaHei",sans-serif}.app{padding:24px;min-width:440px}.header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #42384e;padding-bottom:18px}.header h1{font-size:24px;margin:0}.chip{background:#243f34;color:#a6f3c8;border-radius:99px;padding:7px 11px;font-size:13px}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:20px 0}.stat{background:#272033;border:1px solid #44374f;border-radius:12px;padding:13px}.stat b{display:block;font-size:20px;margin-top:5px}.pairing-card,.paired-card{background:#211b2a;border:1px solid #493b57;border-radius:16px;padding:20px;text-align:center}.pairing-card h2,.paired-card h2{margin:0 0 8px}.qr{display:flex;justify-content:center;margin-top:16px}.qr svg{width:260px;height:260px;background:#fff;border-radius:12px;padding:10px}.actions{display:flex;justify-content:center;margin:20px 0}.primary{border:0;border-radius:10px;background:#dfadff;color:#25162e;padding:11px 18px;font-weight:700;cursor:pointer}.setting{display:flex;gap:9px;align-items:center;color:#cabed6;border-top:1px solid #42384e;padding-top:16px}.modal[hidden]{display:none}.modal{position:fixed;inset:0;background:#0009;display:grid;place-items:center}.dialog{background:#282033;border:1px solid #5b456d;border-radius:16px;padding:22px;text-align:center}.dialog .qr{margin:12px 0}.secondary{border:1px solid #715885;border-radius:8px;background:transparent;color:#f5edff;padding:8px 15px;cursor:pointer}</style>
${remoteToken ? `<style>${remotePanelCss}</style>` : ''}<main class="app"><header class="header"><h1>NikkiSync PC</h1><span class="chip">同步服务运行中</span></header><section class="stats"><div class="stat">局域网地址<b>${status.host}:${status.port}</b></div><div class="stat">已扫描照片<b>${status.assets}</b></div><div class="stat">已配对设备<b>${status.pairedDevices}</b></div></section>${pairing}<div class="actions"><button id="renew" class="primary">生成新二维码</button></div>${remoteToken ? remotePanelHtml : ''}<label class="setting"><input id="autostart" type="checkbox">开机时自动启动 NikkiSync</label></main><div id="modal" class="modal" hidden><div class="dialog"><h2>扫描二维码</h2><div id="modal-qr" class="qr"></div><button id="close" class="secondary">关闭</button></div></div>
<script>const bridge=window.chrome?.webview;const autostart=document.querySelector('#autostart');bridge?.postMessage({type:'getAutostart'});bridge?.addEventListener('message',e=>{if(e.data?.type==='autostart')autostart.checked=!!e.data.enabled});autostart.onchange=()=>bridge?.postMessage({type:'setAutostart',enabled:autostart.checked});const modal=document.querySelector('#modal'),modalQr=document.querySelector('#modal-qr');document.querySelector('#renew').onclick=async()=>{const r=await fetch('/api/pairing',{method:'POST'});const data=await r.json();modalQr.innerHTML=data.qrSvg;modal.hidden=false};document.querySelector('#close').onclick=()=>{modal.hidden=true};</script></html>`
  .replace('</html>', `${remoteToken ? `<script>${remotePanelScript}</script>` : ''}</html>`)
}

export function createDesktopControlServer(config: DesktopControlServerConfig): http.Server {
  const desktopToken = randomBytes(32).toString('base64url')
  let activeSessionId: string | undefined
  const json = (response: http.ServerResponse, status: number, value: unknown) => {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    response.end(JSON.stringify(value))
  }
  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
    const remote = config.remoteBridge
    if (remote) {
      const host = request.headers.host
      const localHosts = [`127.0.0.1:${request.socket.localPort}`, `localhost:${request.socket.localPort}`]
      if (!host || !localHosts.includes(host)) { json(response, 403, { error: 'forbidden' }); return }
    }
    if (remote && requestUrl.pathname.startsWith('/api/remote/')) {
      const token = request.headers['x-nikkisync-desktop-token']
      const origin = request.headers.origin
      if (typeof token !== 'string' || Buffer.byteLength(token) !== Buffer.byteLength(desktopToken)
        || !timingSafeEqual(Buffer.from(token), Buffer.from(desktopToken))
        || (origin && origin !== `http://${request.headers.host}`)
        || request.headers['sec-fetch-site'] === 'cross-site') {
        json(response, 403, { error: 'forbidden' }); return
      }
      try {
        if (request.method === 'GET' && requestUrl.pathname === '/api/remote/photos') {
          json(response, 200, remote.listPhotos(requestUrl.searchParams.get('cursor') ?? undefined)); return
        }
        if (request.method === 'POST' && requestUrl.pathname === '/api/remote/session') {
          if (!request.headers['content-type']?.startsWith('application/json')) { json(response, 400, { error: 'bad_request' }); return }
          const chunks: Buffer[] = []; let size = 0
          for await (const chunk of request) {
            const data = Buffer.from(chunk); size += data.length
            if (size > 16_384) { json(response, 413, { error: 'too_large' }); return }
            chunks.push(data)
          }
          let ids: unknown
          try { ids = (JSON.parse(Buffer.concat(chunks).toString('utf8')) as { resourceIds?: unknown }).resourceIds }
          catch { json(response, 400, { error: 'bad_request' }); return }
          if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100 || !ids.every((id) => typeof id === 'string' && id.length <= 200)) {
            json(response, 400, { error: 'bad_selection' }); return
          }
          let session: CreatedRemoteSession
          try { session = remote.createSession(ids as string[]) }
          catch { json(response, 400, { error: 'bad_selection' }); return }
          let svg: string
          try { svg = await config.qrSvg(session.qrPayload) }
          catch { remote.closeSession(session.sessionId); throw new Error('QR rendering failed') }
          if (activeSessionId) remote.closeSession(activeSessionId)
          activeSessionId = session.sessionId
          json(response, 200, { sessionId: session.sessionId, expiresAt: session.expiresAt, state: session.state, selectedCount: ids.length, qrSvg: svg }); return
        }
        const sessionMatch = /^\/api\/remote\/session\/([A-Za-z0-9_-]+)$/.exec(requestUrl.pathname)
        if (sessionMatch && (request.method === 'GET' || request.method === 'DELETE')) {
          const id = sessionMatch[1]!
          const state = remote.getSessionStatus(id)
          if (!state) { json(response, 404, { error: 'not_found' }); return }
          if (request.method === 'DELETE') remote.closeSession(id)
          json(response, 200, remote.getSessionStatus(id)); return
        }
        const previewMatch = /^\/api\/remote\/preview\/([A-Za-z0-9_-]+)$/.exec(requestUrl.pathname)
        if (request.method === 'GET' && previewMatch) {
          const file = remote.getPreview(previewMatch[1]!)
          if (!file) { json(response, 404, { error: 'not_found' }); return }
          let info
          try { info = await stat(file.sourcePath) } catch { json(response, 404, { error: 'not_found' }); return }
          if (!info.isFile() || info.size !== file.sizeBytes) { json(response, 404, { error: 'not_found' }); return }
          response.writeHead(200, { 'content-type': file.mimeType, 'content-length': info.size, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
          const stream = createReadStream(file.sourcePath)
          stream.on('error', () => response.destroy()); response.on('close', () => stream.destroy()); stream.pipe(response); return
        }
        json(response, 404, { error: 'not_found' }); return
      } catch { if (!response.headersSent) json(response, 500, { error: 'unavailable' }); else response.destroy(); return }
    }
    const status = config.getStatus()
    if (requestUrl.pathname === '/api/status' && request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(status)); return
    }
    if (requestUrl.pathname === '/api/pairing' && request.method === 'POST') {
      const qrSvg = await config.qrSvg(config.createPairingUri())
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify({ ...status, qrSvg })); return
    }
    if (requestUrl.pathname === '/' && request.method === 'GET') {
      const qrSvg = status.firstRun ? await config.qrSvg(config.createPairingUri()) : undefined
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY' }); response.end(html(status, qrSvg, remote ? desktopToken : undefined)); return
    }
    response.writeHead(404); response.end()
  })
  server.on('close', () => { if (activeSessionId) config.remoteBridge?.closeSession(activeSessionId) })
  return server
}
