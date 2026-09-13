import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import https from 'node:https'
import type { Duplex } from 'node:stream'
import { X509Certificate } from 'node:crypto'
import {
  AssetRepository,
  MetadataDictionaryRepository,
  SyncReadRepository,
  type DatabaseManager
} from '@nikkisync/database'
import {
  API_ROUTES,
  PROTOCOL_VERSION,
  isAssetType,
  type ApiErrorBody,
  type AssetListResponse,
  type ChangesResponse,
  type ClothingSearchResponse,
  type PairRequest,
  type ServerInfoResponse,
  type SuitSearchResponse,
  type WsEvent
} from '@nikkisync/protocol'
import type { MetadataThumbnailCache } from '../metadata/MetadataThumbnailCache.js'
import { AuthService } from './AuthService.js'
import { MdnsAdvertiser } from './MdnsAdvertiser.js'
import { PairingError, PairingService } from './PairingService.js'
import { mapAssetDetail, mapAssetSummary, mapChangeRow } from './row-mappers.js'
import { searchClothingLibrary } from './ClothingSearchIndex.js'
import { searchSuitLibrary, type SuitSearchAsset } from './SuitSearchIndex.js'
import { WebSocketHub } from './WebSocketHub.js'

export interface LocalSyncServerConfig {
  name?: string
  host?: string
  port?: number
  tls?: { key: string | Buffer; cert: string | Buffer }
  journalPollMs?: number
  mdns?: boolean
  maxJsonBodyBytes?: number
  metadataThumbnailCache?: MetadataThumbnailCache
}

export interface LocalSyncServerAddress {
  host: string
  port: number
  secure: boolean
}

interface CursorValue { t: string; id: string }

function json(res: ServerResponse, status: number, body: unknown): void {
  const data = Buffer.from(JSON.stringify(body), 'utf8')
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': data.length,
    'Cache-Control': 'no-store'
  })
  res.end(data)
}

function errorBody(code: ApiErrorBody['error']['code'], message: string): ApiErrorBody {
  return { error: { code, message } }
}

function parseInteger(value: string | null, fallback?: number): number | undefined {
  if (value === null) return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined
}

function encodeCursor(value: CursorValue): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function decodeCursor(value: string | null): CursorValue | undefined {
  if (!value) return undefined
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<CursorValue>
    if (typeof decoded.t === 'string' && typeof decoded.id === 'string') return { t: decoded.t, id: decoded.id }
  } catch { /* invalid cursor */ }
  return undefined
}

async function readBody(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += data.length
    if (total > maxBytes) throw new Error('request body too large')
    chunks.push(data)
  }
  return Buffer.concat(chunks)
}

function pemFingerprint(cert: string | Buffer): string {
  return new X509Certificate(cert).fingerprint256.replaceAll(':', '').toLowerCase()
}

function parseRange(value: string | undefined, size: number): { start: number; end: number } | undefined | null {
  if (!value) return undefined
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim())
  if (!match) return null
  const startText = match[1] ?? ''
  const endText = match[2] ?? ''
  if (!startText && !endText) return null
  let start: number
  let end: number
  if (!startText) {
    const suffix = Number(endText)
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null
    start = Math.max(0, size - suffix); end = size - 1
  } else {
    start = Number(startText)
    end = endText ? Number(endText) : size - 1
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) return null
  return { start, end: Math.min(end, size - 1) }
}

function objectOf(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

export class LocalSyncServer {
  private readonly reads: SyncReadRepository
  private readonly assets: AssetRepository
  private readonly dictionary: MetadataDictionaryRepository
  private readonly auth: AuthService
  private readonly pairing: PairingService
  private readonly sockets = new WebSocketHub()
  private readonly mdns = new MdnsAdvertiser()
  private server: http.Server | https.Server | undefined
  private pollTimer: NodeJS.Timeout | undefined
  private lastBroadcastRevision = 0
  private address: LocalSyncServerAddress | undefined
  private suitSearchSourceCache: { libraryRevision: number; items: SuitSearchAsset[] } | undefined
  private readonly suitSearchResponseCache = new Map<string, SuitSearchResponse>()
  private readonly clothingSearchResponseCache = new Map<string, ClothingSearchResponse>()
  private readonly config: Required<Pick<LocalSyncServerConfig, 'name' | 'host' | 'port' | 'journalPollMs' | 'mdns' | 'maxJsonBodyBytes'>> & Pick<LocalSyncServerConfig, 'tls' | 'metadataThumbnailCache'>

  constructor(database: DatabaseManager, config: LocalSyncServerConfig = {}) {
    this.reads = new SyncReadRepository(database)
    this.assets = new AssetRepository(database)
    this.dictionary = new MetadataDictionaryRepository(database)
    this.auth = new AuthService(database)
    this.pairing = new PairingService(database)
    this.config = {
      name: config.name ?? 'NikkiSync PC',
      host: config.host ?? '0.0.0.0',
      port: config.port ?? 0,
      journalPollMs: config.journalPollMs ?? 250,
      mdns: config.mdns ?? true,
      maxJsonBodyBytes: config.maxJsonBodyBytes ?? 1024 * 1024,
      ...(config.tls ? { tls: config.tls } : {}),
      ...(config.metadataThumbnailCache ? { metadataThumbnailCache: config.metadataThumbnailCache } : {})
    }
  }

  get serverId(): string { return this.pairing.identity.serverId }

  async start(): Promise<LocalSyncServerAddress> {
    if (this.server) return this.address!
    this.server = this.config.tls
      ? https.createServer(this.config.tls, (req, res) => { void this.handle(req, res) })
      : http.createServer((req, res) => { void this.handle(req, res) })
    this.server.on('upgrade', (req, socket) => this.handleUpgrade(req, socket))
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(this.config.port, this.config.host, () => resolve())
    })
    const value = this.server.address()
    if (!value || typeof value === 'string') throw new Error('Local sync server did not expose a TCP address')
    this.address = { host: this.config.host, port: value.port, secure: Boolean(this.config.tls) }
    this.lastBroadcastRevision = this.reads.currentRevision()
    this.pollTimer = setInterval(() => this.broadcastJournal(), this.config.journalPollMs)
    if (this.config.mdns) this.mdns.start({ serverId: this.serverId, name: this.config.name, port: value.port })
    return this.address
  }

  async stop(): Promise<void> {
    if (this.pollTimer) clearInterval(this.pollTimer)
    this.pollTimer = undefined
    this.mdns.stop(); this.sockets.close()
    const server = this.server
    this.server = undefined; this.address = undefined
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  createPairingPayload(host: string, ttlMs?: number) {
    if (!this.address) throw new Error('Server must be started before creating a pairing payload')
    if (!this.config.tls) throw new Error('TLS is required for production pairing payloads')
    return this.pairing.createQrPayload({
      host,
      port: this.address.port,
      tlsFingerprintSha256: pemFingerprint(this.config.tls.cert),
      ...(ttlMs === undefined ? {} : { ttlMs })
    })
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', 'http://nikkisync.local')
      if (req.method === 'GET' && url.pathname === API_ROUTES.serverInfo) return this.serverInfo(res)
      if (req.method === 'POST' && url.pathname === API_ROUTES.pair) return void await this.handlePair(req, res)
      const metadataMatch = /^\/v1\/assets\/([^/]+)\/metadata$/.exec(url.pathname)
      if (req.method === 'PATCH' && metadataMatch) {
        const body = await readBody(req, this.config.maxJsonBodyBytes)
        if (!this.auth.verifyRequest(req, body)) return json(res, 401, errorBody('unauthorized', 'Request signature is missing or invalid'))
        return this.updateMetadata(body, res, decodeURIComponent(metadataMatch[1]!))
      }
      if (!this.auth.verifyRequest(req)) return json(res, 401, errorBody('unauthorized', 'Request signature is missing or invalid'))
      if (req.method === 'GET' && url.pathname === API_ROUTES.assets) return this.listAssets(url, res)
      if (req.method === 'GET' && url.pathname === API_ROUTES.suitSearch) return this.searchSuits(url, res)
      if (req.method === 'GET' && url.pathname === API_ROUTES.clothingSearch) return this.searchClothing(url, res)
      if (req.method === 'GET' && url.pathname === API_ROUTES.changes) return this.listChanges(url, res)
      const clothingThumbnailMatch = /^\/v1\/assets\/([^/]+)\/clothing\/([^/]+)\/thumbnail$/.exec(url.pathname)
      if ((req.method === 'GET' || req.method === 'HEAD') && clothingThumbnailMatch) {
        return void await this.streamClothingThumbnail(
          req,
          res,
          decodeURIComponent(clothingThumbnailMatch[1]!),
          decodeURIComponent(clothingThumbnailMatch[2]!)
        )
      }
      const assetMatch = /^\/v1\/assets\/([^/]+)$/.exec(url.pathname)
      if (req.method === 'GET' && assetMatch) return this.assetDetail(decodeURIComponent(assetMatch[1]!), res)
      const resourceMatch = /^\/v1\/assets\/([^/]+)\/resources\/([^/]+)$/.exec(url.pathname)
      if ((req.method === 'GET' || req.method === 'HEAD') && resourceMatch) {
        return void await this.streamResource(req, res, decodeURIComponent(resourceMatch[1]!), decodeURIComponent(resourceMatch[2]!))
      }
      json(res, 404, errorBody('not_found', 'Route not found'))
    } catch (error) {
      json(res, 500, errorBody('internal_error', error instanceof Error ? error.message : 'Internal server error'))
    }
  }

  private serverInfo(res: ServerResponse): void {
    const body: ServerInfoResponse = {
      protocolVersion: PROTOCOL_VERSION,
      serverId: this.serverId,
      name: this.config.name,
      libraryRevision: this.reads.currentRevision(),
      capabilities: { websocketEvents: true, rangeRequests: true, metadataV1: true, motionAssets: true, suitSearch: true, clothingSearch: true }
    }
    json(res, 200, body)
  }

  private async handlePair(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req, this.config.maxJsonBodyBytes)
    let parsed: PairRequest
    try { parsed = JSON.parse(body.toString('utf8')) as PairRequest }
    catch { return json(res, 400, errorBody('bad_request', 'Pair request must be valid JSON')) }
    if (!parsed?.pairingToken || !parsed.device?.deviceId || !parsed.device?.publicKey) {
      return json(res, 400, errorBody('bad_request', 'Pair request is missing required fields'))
    }
    try { json(res, 200, this.pairing.pair(parsed, this.config.name)) }
    catch (error) {
      if (error instanceof PairingError) return json(res, error.code === 'pairing_expired' ? 410 : 401, errorBody(error.code, error.message))
      throw error
    }
  }

  private listAssets(url: URL, res: ServerResponse): void {
    const rawLimit = parseInteger(url.searchParams.get('limit'), 100)
    if (rawLimit === undefined || rawLimit < 1 || rawLimit > 500) return json(res, 400, errorBody('bad_request', 'limit must be 1..500'))
    const cursorParam = url.searchParams.get('cursor')
    const cursor = decodeCursor(cursorParam)
    if (cursorParam && !cursor) return json(res, 400, errorBody('bad_request', 'cursor is invalid'))
    const assetType = url.searchParams.get('type')
    if (assetType && !isAssetType(assetType)) return json(res, 400, errorBody('bad_request', 'type is invalid'))
    const afterRevisionParam = url.searchParams.get('afterRevision')
    const afterRevision = parseInteger(afterRevisionParam)
    if (afterRevisionParam !== null && afterRevision === undefined) return json(res, 400, errorBody('bad_request', 'afterRevision is invalid'))
    const includeDeleted = url.searchParams.get('includeDeleted') === 'true'
    const rows = this.reads.listAssets({
      limit: rawLimit + 1,
      ...(cursor ? { cursorTime: cursor.t, cursorAssetId: cursor.id } : {}),
      ...(assetType ? { assetType } : {}),
      ...(afterRevision === undefined ? {} : { afterRevision }),
      includeDeleted
    })
    const hasMore = rows.length > rawLimit
    const pageRows = rows.slice(0, rawLimit)
    const items = pageRows.map((row) => mapAssetSummary(row, this.reads.listResources(String(row.asset_id))))
    const last = pageRows.at(-1)
    const nextCursor = hasMore && last
      ? encodeCursor({ t: String(last.captured_at ?? last.discovered_at), id: String(last.asset_id) })
      : undefined
    const body: AssetListResponse = {
      items,
      ...(nextCursor ? { nextCursor } : {}),
      libraryRevision: this.reads.currentRevision()
    }
    json(res, 200, body)
  }

  private suitSearchSource(libraryRevision: number): SuitSearchAsset[] {
    if (this.suitSearchSourceCache?.libraryRevision === libraryRevision) {
      return this.suitSearchSourceCache.items
    }

    const resourcesByAsset = new Map<string, Record<string, unknown>[]>()
    for (const resource of this.reads.listSuitSearchResources()) {
      const assetId = String(resource.asset_id)
      const resources = resourcesByAsset.get(assetId) ?? []
      resources.push(resource)
      resourcesByAsset.set(assetId, resources)
    }

    const items = this.reads.listSuitSearchAssets().map((row) => {
      const assetId = String(row.asset_id)
      return {
        asset: mapAssetSummary(row, resourcesByAsset.get(assetId) ?? []),
        metadataJson: String(row.metadata_json)
      }
    })

    this.suitSearchSourceCache = { libraryRevision, items }
    this.suitSearchResponseCache.clear()
    this.clothingSearchResponseCache.clear()
    return items
  }

  private searchSuits(url: URL, res: ServerResponse): void {
    const query = (url.searchParams.get('q') ?? '').trim()
    if (!query) return json(res, 400, errorBody('bad_request', 'q is required'))
    if (query.length > 80) return json(res, 400, errorBody('bad_request', 'q is too long'))

    const libraryRevision = this.reads.currentRevision()
    const manifest = this.dictionary.getActiveManifest()
    const dictionaryKey = manifest
      ? [manifest.provider, manifest.providerVersion, manifest.fetchedAt ?? manifest.generatedAt ?? ''].join(':')
      : 'none'
    const cacheKey = [libraryRevision, dictionaryKey, query.toLocaleLowerCase()].join('\u0000')
    const cached = this.suitSearchResponseCache.get(cacheKey)
    if (cached) return json(res, 200, cached)

    const response = searchSuitLibrary(this.suitSearchSource(libraryRevision), manifest, query)
    this.suitSearchResponseCache.set(cacheKey, response)
    if (this.suitSearchResponseCache.size > 32) {
      const oldestKey = this.suitSearchResponseCache.keys().next().value
      if (oldestKey !== undefined) this.suitSearchResponseCache.delete(oldestKey)
    }
    json(res, 200, response)
  }

  private searchClothing(url: URL, res: ServerResponse): void {
    const query = (url.searchParams.get('q') ?? '').trim()
    if (!query) return json(res, 400, errorBody('bad_request', 'q is required'))
    if (query.length > 80) return json(res, 400, errorBody('bad_request', 'q is too long'))

    const libraryRevision = this.reads.currentRevision()
    const manifest = this.dictionary.getActiveManifest()
    const dictionaryKey = manifest
      ? [manifest.provider, manifest.providerVersion, manifest.fetchedAt ?? manifest.generatedAt ?? ''].join(':')
      : 'none'
    const cacheKey = [libraryRevision, dictionaryKey, query.toLocaleLowerCase()].join('\u0000')
    const cached = this.clothingSearchResponseCache.get(cacheKey)
    if (cached) return json(res, 200, cached)

    const response = searchClothingLibrary(this.suitSearchSource(libraryRevision), manifest, query)
    this.clothingSearchResponseCache.set(cacheKey, response)
    if (this.clothingSearchResponseCache.size > 32) {
      const oldestKey = this.clothingSearchResponseCache.keys().next().value
      if (oldestKey !== undefined) this.clothingSearchResponseCache.delete(oldestKey)
    }
    json(res, 200, response)
  }

  private assetDetail(assetId: string, res: ServerResponse): void {
    const row = this.reads.getAsset(assetId)
    if (!row) return json(res, 404, errorBody('not_found', 'Asset not found'))
    json(res, 200, mapAssetDetail(row, this.reads.listResources(assetId)))
  }

  private updateMetadata(body: Buffer, res: ServerResponse, assetId: string): void {
    if (!this.reads.getAsset(assetId)) return json(res, 404, errorBody('not_found', 'Asset not found'))
    let parsed: unknown
    try { parsed = JSON.parse(body.toString('utf8')) }
    catch { return json(res, 400, errorBody('bad_request', 'Metadata patch must be valid JSON')) }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return json(res, 400, errorBody('bad_request', 'Metadata patch must be a JSON object'))
    }
    const allowed = new Set(['capture', 'camera', 'filter', 'lighting', 'photography', 'nikki', 'dressing', 'interactions', 'location'])
    const patch: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!allowed.has(key)) return json(res, 400, errorBody('bad_request', `Metadata field is read-only or unsupported: ${key}`))
      patch[key] = value
    }
    const revision = this.assets.updateMetadata(assetId, patch)
    const row = this.reads.getAsset(assetId)!
    json(res, 200, { ...mapAssetDetail(row, this.reads.listResources(assetId)), revision })
  }

  private listChanges(url: URL, res: ServerResponse): void {
    const after = parseInteger(url.searchParams.get('after'))
    if (after === undefined) return json(res, 400, errorBody('bad_request', 'after revision is required'))
    const current = this.reads.currentRevision()
    const minimum = this.reads.minimumJournalRevision()
    const fullResyncRequired = minimum !== undefined && after < minimum - 1
    const changes = fullResyncRequired ? [] : this.reads.listChangesAfter(after).map(mapChangeRow)
    const body: ChangesResponse = { changes, libraryRevision: current, fullResyncRequired }
    json(res, 200, body)
  }

  private clothingThumbnailSource(assetId: string, clothingId: string): { sourceUrls: string[]; versionKey: string } | undefined {
    const row = this.reads.getAsset(assetId)
    if (!row?.metadata_json) return undefined
    try {
      const metadata = objectOf(JSON.parse(String(row.metadata_json)))
      const dressing = objectOf(metadata?.dressing)
      const clothes = Array.isArray(dressing?.clothes) ? dressing.clothes : []
      const clothing = clothes
        .map(objectOf)
        .find((item) => item && String(item.id ?? '') === clothingId)
      if (!clothing) return undefined

      const sourceUrls: string[] = []
      const addSource = (value: unknown) => {
        if (typeof value !== 'string' || !/^https:\/\//i.test(value) || sourceUrls.includes(value)) return
        sourceUrls.push(value)
      }
      addSource(clothing.thumbnail)
      if (Array.isArray(clothing.thumbnailFallbacks)) {
        for (const fallback of clothing.thumbnailFallbacks) addSource(fallback)
      }
      if (sourceUrls.length === 0) return undefined

      const dictionary = objectOf(objectOf(metadata?.raw)?.dictionary)
      const versionKey = typeof dictionary?.providerVersion === 'string' ? dictionary.providerVersion : ''
      return { sourceUrls, versionKey }
    } catch {
      return undefined
    }
  }

  private async streamClothingThumbnail(req: IncomingMessage, res: ServerResponse, assetId: string, clothingId: string): Promise<void> {
    const cache = this.config.metadataThumbnailCache
    const source = this.clothingThumbnailSource(assetId, clothingId)
    if (!cache || !source) return json(res, 404, errorBody('resource_not_ready', 'Clothing thumbnail is unavailable'))

    let thumbnail
    let sourceIndex = -1
    const failures: string[] = []
    for (let index = 0; index < source.sourceUrls.length; index++) {
      try {
        thumbnail = await cache.get(source.sourceUrls[index]!, source.versionKey)
        sourceIndex = index
        break
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error))
      }
    }
    if (!thumbnail) {
      console.warn(`[NikkiSync] clothing thumbnail unavailable for ${clothingId}: ${failures.join(' | ')}`)
      return json(res, 503, errorBody('resource_not_ready', 'Clothing thumbnail sources are temporarily unavailable'))
    }
    res.writeHead(200, {
      'Content-Type': thumbnail.mimeType,
      'Content-Length': thumbnail.sizeBytes,
      'ETag': `"sha256:${thumbnail.sha256}"`,
      'X-NikkiSync-SHA256': thumbnail.sha256,
      'X-NikkiSync-Thumbnail-Source': sourceIndex === 0 ? 'primary' : 'fallback',
      'Cache-Control': 'private, max-age=86400'
    })
    if (req.method === 'HEAD') return void res.end()
    createReadStream(thumbnail.path).pipe(res)
  }

  private async streamResource(req: IncomingMessage, res: ServerResponse, assetId: string, resourceId: string): Promise<void> {
    const row = this.reads.getResource(assetId, resourceId)
    if (!row || String(row.stable_state) !== 'stable') return json(res, 404, errorBody('resource_not_ready', 'Resource not found or not ready'))
    const sourcePath = String(row.source_path)
    let info
    try { info = await stat(sourcePath) }
    catch { return json(res, 404, errorBody('resource_not_ready', 'Source file is unavailable')) }
    const size = info.size
    const range = parseRange(Array.isArray(req.headers.range) ? req.headers.range[0] : req.headers.range, size)
    if (range === null) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' }); res.end(); return
    }
    const headers: Record<string, string | number> = {
      'Content-Type': String(row.mime_type),
      'Accept-Ranges': 'bytes',
      'ETag': `"sha256:${String(row.sha256)}"`,
      'X-NikkiSync-SHA256': String(row.sha256),
      'Cache-Control': 'private, max-age=31536000, immutable',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(String(row.file_name))}`
    }
    if (range) {
      headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`
      headers['Content-Length'] = range.end - range.start + 1
      res.writeHead(206, headers)
      if (req.method === 'HEAD') return void res.end()
      createReadStream(sourcePath, { start: range.start, end: range.end }).pipe(res)
      return
    }
    headers['Content-Length'] = size
    res.writeHead(200, headers)
    if (req.method === 'HEAD') return void res.end()
    createReadStream(sourcePath).pipe(res)
  }

  private handleUpgrade(req: IncomingMessage, socket: Duplex): void {
    const url = new URL(req.url ?? '/', 'http://nikkisync.local')
    if (url.pathname !== API_ROUTES.websocket || !this.auth.verifyRequest(req)) { socket.destroy(); return }
    if (!this.sockets.upgrade(req, socket)) { socket.destroy(); return }
    const hello: WsEvent = {
      event: 'server.hello',
      protocolVersion: PROTOCOL_VERSION,
      serverId: this.serverId,
      libraryRevision: this.reads.currentRevision(),
      occurredAt: new Date().toISOString()
    }
    this.sockets.send(socket, hello)
  }

  private broadcastJournal(): void {
    const changes = this.reads.listChangesAfter(this.lastBroadcastRevision)
    for (const row of changes) {
      const event: WsEvent = {
        event: String(row.event_type) as 'asset.created' | 'asset.updated' | 'asset.deleted',
        revision: Number(row.revision),
        assetId: String(row.asset_id),
        occurredAt: String(row.occurred_at)
      }
      this.sockets.broadcast(event)
      this.lastBroadcastRevision = Number(row.revision)
    }
  }
}
