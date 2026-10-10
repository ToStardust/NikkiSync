import http from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { DesktopStatus } from './DesktopStatusService.js'
import type { LocalRemotePhotoResource, RemoteSelectionPage } from '../remote/RemoteFileProvider.js'
import type { CreatedRemoteSession, RemoteSessionStatus } from '../remote/RemoteSessionStore.js'
import { renderDesktopPage } from './DesktopPage.js'
import type { WeChatGalleryStatus } from '../wechat/WeChatGalleryService.js'

export interface DesktopControlServerConfig {
  getStatus(): DesktopStatus
  createPairingUri(): string
  qrSvg(uri: string): Promise<string>
  brandImage?: Buffer
  wechatGallery?: {
    start(): Promise<WeChatGalleryStatus & {qrSvg:string}>
    stop(): Promise<void>
    status(): WeChatGalleryStatus
  }
  remoteBridge?: {
    listPhotos(cursor?: string): RemoteSelectionPage
    createSession(resourceIds: string[]): CreatedRemoteSession
    closeSession(sessionId: string): void
    getSessionStatus(sessionId: string): RemoteSessionStatus | undefined
    getPreview(resourceId: string): LocalRemotePhotoResource | undefined
  }
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
    if (remote || config.wechatGallery) {
      const host = request.headers.host
      const localHosts = [`127.0.0.1:${request.socket.localPort}`, `localhost:${request.socket.localPort}`]
      if (!host || !localHosts.includes(host)) { json(response, 403, { error: 'forbidden' }); return }
    }
    if ((remote && requestUrl.pathname.startsWith('/api/remote/')) || (config.wechatGallery && requestUrl.pathname.startsWith('/api/wechat/'))) {
      const token = request.headers['x-nikkisync-desktop-token']
      const origin = request.headers.origin
      if (typeof token !== 'string' || Buffer.byteLength(token) !== Buffer.byteLength(desktopToken)
        || !timingSafeEqual(Buffer.from(token), Buffer.from(desktopToken))
        || (origin && origin !== `http://${request.headers.host}`)
        || request.headers['sec-fetch-site'] === 'cross-site') {
        json(response, 403, { error: 'forbidden' }); return
      }
      try {
        if(config.wechatGallery && requestUrl.pathname.startsWith('/api/wechat/')) {
          const wechat=config.wechatGallery
          if(request.method==='GET' && requestUrl.pathname==='/api/wechat/status'){json(response,200,wechat.status());return}
          if(request.method==='POST' && requestUrl.pathname==='/api/wechat/session'){
            const session=await wechat.start();
            if(response.destroyed){await wechat.stop();return}
            json(response,200,session);return
          }
          if(request.method==='DELETE' && requestUrl.pathname==='/api/wechat/session'){await wechat.stop();json(response,200,wechat.status());return}
          json(response,404,{error:'not_found'});return
        }
        if(!remote){json(response,404,{error:'not_found'});return}
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
    if(requestUrl.pathname==='/brand.png' && request.method==='GET' && config.brandImage){
      response.writeHead(200,{'content-type':'image/png','cache-control':'no-store','x-content-type-options':'nosniff'});response.end(config.brandImage);return
    }
    if (requestUrl.pathname === '/api/status' && request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(status)); return
    }
    if (requestUrl.pathname === '/api/pairing' && request.method === 'POST') {
      const qrSvg = await config.qrSvg(config.createPairingUri())
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify({ ...status, qrSvg })); return
    }
    if (requestUrl.pathname === '/' && request.method === 'GET') {
      const qrSvg = status.firstRun ? await config.qrSvg(config.createPairingUri()) : undefined
      const page = renderDesktopPage(status, { ...(qrSvg ? { qrSvg } : {}), ...(remote || config.wechatGallery ? { remoteToken: desktopToken } : {}), wechat: Boolean(config.wechatGallery), branded: Boolean(config.brandImage) })
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY' }); response.end(page); return
    }
    response.writeHead(404); response.end()
  })
  server.on('close', () => { if (activeSessionId) config.remoteBridge?.closeSession(activeSessionId);void config.wechatGallery?.stop() })
  return server
}
