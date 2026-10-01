import { open } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { RemoteBridgeService } from './RemoteBridgeService.js'

function respondJson(res: ServerResponse, status: number, body: unknown): void {
  const data = Buffer.from(JSON.stringify(body), 'utf8')
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': data.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer'
  })
  res.end(data)
}

function failure(res: ServerResponse, status: 'invalid_token' | 'expired' | 'closed' | 'not_found'): void {
  const httpStatus = status === 'invalid_token' ? 401 : status === 'not_found' ? 404 : 410
  respondJson(res, httpStatus, { error: status })
}

function parseRange(value: string | undefined, size: number): { start: number; end: number } | null | undefined {
  if (!value) return undefined
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim())
  if (!match) return null
  const from = match[1] ?? ''
  const to = match[2] ?? ''
  if (!from && !to) return null
  let start: number
  let end: number
  if (!from) {
    const suffix = Number(to)
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(from)
    end = to ? Number(to) : size - 1
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) return null
  return { start, end: Math.min(end, size - 1) }
}

export class RemoteRoutes {
  constructor(private readonly bridge: RemoteBridgeService) {}

  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const pathname = new URL(req.url ?? '/', 'http://nikkisync.local').pathname
    if (!pathname.startsWith('/remote/')) return false
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      respondJson(res, 405, { error: 'method_not_allowed' })
      return true
    }
    const listMatch = /^\/remote\/session\/([A-Za-z0-9_-]+)\/assets$/.exec(pathname)
    const fileMatch = /^\/remote\/session\/([A-Za-z0-9_-]+)\/resource\/([A-Za-z0-9_-]+)$/.exec(pathname)
    if (!listMatch && !fileMatch) {
      failure(res, 'not_found')
      return true
    }
    const sessionId = (listMatch ?? fileMatch)![1]!
    const tokenHeader = req.headers['x-nikkisync-remote-token']
    const token = typeof tokenHeader === 'string' ? tokenHeader : ''
    if (!token) {
      failure(res, 'invalid_token')
      return true
    }
    if (listMatch) {
      const result = this.bridge.listResources(sessionId, token)
      if (result.status !== 'ok') failure(res, result.status)
      else respondJson(res, 200, { resources: result.resources })
      return true
    }
    const result = this.bridge.getResource(sessionId, token, fileMatch![2]!)
    if (result.status !== 'ok') {
      failure(res, result.status)
      return true
    }
    let file
    try { file = await open(result.sourcePath, 'r') }
    catch { failure(res, 'not_found'); return true }
    let info
    try {
      info = await file.stat()
      if (!info.isFile() || info.size !== result.sizeBytes) throw new Error('Source changed')
      const hash = createHash('sha256')
      for await (const chunk of file.createReadStream({ autoClose: false, start: 0 })) hash.update(chunk)
      if (hash.digest('hex') !== result.sha256) throw new Error('Source changed')
    } catch { await file.close(); failure(res, 'not_found'); return true }
    const stillAuthorized = this.bridge.getResource(sessionId, token, fileMatch![2]!)
    if (stillAuthorized.status !== 'ok') { await file.close(); failure(res, stillAuthorized.status); return true }
    const rangeHeader = req.headers.range
    const range = parseRange(Array.isArray(rangeHeader) ? rangeHeader[0] : rangeHeader, info.size)
    if (range === null) {
      res.writeHead(416, { 'Content-Range': `bytes */${info.size}`, 'Cache-Control': 'no-store' })
      res.end()
      await file.close()
      return true
    }
    const headers: Record<string, string | number> = {
      'Content-Type': result.mimeType,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
      'Content-Length': range ? range.end - range.start + 1 : info.size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer'
    }
    if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${info.size}`
    res.writeHead(range ? 206 : 200, headers)
    if (req.method === 'HEAD') { res.end(); await file.close(); return true }
    const stream = file.createReadStream({ start: range?.start ?? 0, ...(range ? { end: range.end } : {}), autoClose: true })
    const authorizationTimer = setInterval(() => {
      const state = this.bridge.getSessionStatus(sessionId)?.state
      if (state !== 'created' && state !== 'connected') { stream.destroy(); res.destroy() }
    }, 250)
    authorizationTimer.unref()
    stream.on('close', () => clearInterval(authorizationTimer))
    stream.on('error', () => res.destroy())
    res.on('close', () => { clearInterval(authorizationTimer); stream.destroy() })
    stream.pipe(res)
    return true
  }
}

