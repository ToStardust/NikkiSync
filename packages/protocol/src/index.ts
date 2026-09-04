/**
 * NikkiSync Protocol Contract v1
 *
 * Rules:
 * - PC is the source of truth for remote assets.
 * - An Asset is a photographic work; Resources are physical/derived files.
 * - WebSocket carries events only. Media bytes are transferred over HTTP.
 * - Original source resources are immutable.
 * - All protocol timestamps are ISO-8601 UTC strings.
 * - All byte sizes are integers. Motion presentation timestamps use microseconds.
 */

import {
  ASSET_TYPES,
  RESOURCE_ROLES,
  type AssetId,
  type AssetState,
  type AssetType,
  type IsoDateTime,
  type NikkiAsset,
  type ResourceId,
  type ResourceRole,
  type Revision
} from '@nikkisync/core'

export {
  ASSET_STATES,
  ASSET_TYPES,
  METADATA_SCHEMA_VERSION,
  RESOURCE_ROLES,
  type AssetId,
  type AssetResolverCandidate,
  type AssetState,
  type AssetType,
  type InfinityPhotoMetadata,
  type IsoDateTime,
  type MediaResource,
  type MetadataSchemaVersion,
  type MotionAssetInfo,
  type NikkiAsset,
  type ResourceId,
  type ResourceRole,
  type Revision,
  type TemplatePhotoContext
} from '@nikkisync/core'

export const PROTOCOL_VERSION = 1 as const

export type ProtocolVersion = typeof PROTOCOL_VERSION
export type DeviceId = string
export type ServerId = string
export type GameVersionSource = 'explicit' | 'inferred' | 'unknown'

export interface AssetSummary {
  assetId: AssetId
  type: AssetType
  state: AssetState
  capturedAt?: IsoDateTime
  uid?: string
  revision: Revision
  width?: number
  height?: number
  hasMotion: boolean
  hasMetadata: boolean
  gameVersion?: string
  gameVersionSource: GameVersionSource
  thumbnailResourceId?: ResourceId
  previewResourceId?: ResourceId
}

export interface CursorPage<T> {
  items: T[]
  nextCursor?: string
  libraryRevision: Revision
}

export interface ServerInfoResponse {
  protocolVersion: ProtocolVersion
  serverId: ServerId
  name: string
  libraryRevision: Revision
  capabilities: {
    websocketEvents: true
    rangeRequests: true
    metadataV1: true
    motionAssets: true
  }
}

export interface AssetListQuery {
  cursor?: string
  limit?: number
  type?: AssetType
  afterRevision?: Revision
  includeDeleted?: boolean
}

export interface AssetListResponse extends CursorPage<AssetSummary> {}
export interface AssetDetailResponse { asset: NikkiAsset }

export const CHANGE_TYPES = ['asset.created', 'asset.updated', 'asset.deleted'] as const
export type ChangeType = (typeof CHANGE_TYPES)[number]

export interface ChangeRecord {
  revision: Revision
  type: ChangeType
  assetId: AssetId
  occurredAt: IsoDateTime
}

export interface ChangesResponse {
  changes: ChangeRecord[]
  libraryRevision: Revision
  /** If true, the requested revision is older than retained journal history; client must full-resync. */
  fullResyncRequired: boolean
}

export type WsEvent =
  | {
      event: 'asset.created' | 'asset.updated' | 'asset.deleted'
      revision: Revision
      assetId: AssetId
      occurredAt: IsoDateTime
    }
  | {
      event: 'library.rescan.started'
      revision: Revision
      occurredAt: IsoDateTime
    }
  | {
      event: 'library.rescan.completed'
      revision: Revision
      occurredAt: IsoDateTime
      changedAssets: number
    }
  | {
      event: 'server.hello'
      protocolVersion: ProtocolVersion
      serverId: ServerId
      libraryRevision: Revision
      occurredAt: IsoDateTime
    }

export interface PairingQrPayload {
  scheme: 'nikki-sync'
  action: 'pair'
  serverId: ServerId
  host: string
  port: number
  pairingToken: string
  protocolVersion: ProtocolVersion
  expiresAt: IsoDateTime
  /** SHA-256 fingerprint of the PC Companion self-signed TLS certificate. */
  tlsFingerprintSha256: string
}

export interface PairRequest {
  pairingToken: string
  device: {
    deviceId: DeviceId
    deviceName: string
    platform: 'ios' | 'android'
    publicKey: string
    appVersion: string
  }
}

export interface PairResponse {
  serverId: ServerId
  serverName: string
  serverPublicKey: string
  deviceCredential: string
  protocolVersion: ProtocolVersion
}

export interface AuthHeaders {
  'X-NikkiSync-Device-Id': DeviceId
  'X-NikkiSync-Timestamp': string
  'X-NikkiSync-Nonce': string
  'X-NikkiSync-Signature': string
}

export const API_ROUTES = {
  serverInfo: '/v1/server',
  pair: '/v1/pair',
  assets: '/v1/assets',
  asset: (assetId: AssetId) => `/v1/assets/${encodeURIComponent(assetId)}`,
  metadata: (assetId: AssetId) => `/v1/assets/${encodeURIComponent(assetId)}/metadata`,
  resource: (assetId: AssetId, resourceId: ResourceId) =>
    `/v1/assets/${encodeURIComponent(assetId)}/resources/${encodeURIComponent(resourceId)}`,
  changes: '/v1/changes',
  websocket: '/ws/v1'
} as const

export const API_ERROR_CODES = [
  'bad_request',
  'unauthorized',
  'pairing_expired',
  'pairing_invalid',
  'not_found',
  'revision_too_old',
  'protocol_mismatch',
  'resource_not_ready',
  'internal_error'
] as const
export type ApiErrorCode = (typeof API_ERROR_CODES)[number]

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode
    message: string
    requestId?: string
  }
}

export function isProtocolVersionSupported(value: unknown): value is ProtocolVersion {
  return value === PROTOCOL_VERSION
}

export function isAssetType(value: unknown): value is AssetType {
  return typeof value === 'string' && (ASSET_TYPES as readonly string[]).includes(value)
}

export function isResourceRole(value: unknown): value is ResourceRole {
  return typeof value === 'string' && (RESOURCE_ROLES as readonly string[]).includes(value)
}

export function buildAssetsRoute(query: AssetListQuery = {}): string {
  const params = new URLSearchParams()
  if (query.cursor !== undefined) params.set('cursor', query.cursor)
  if (query.limit !== undefined) params.set('limit', String(query.limit))
  if (query.type !== undefined) params.set('type', query.type)
  if (query.afterRevision !== undefined) params.set('afterRevision', String(query.afterRevision))
  if (query.includeDeleted !== undefined) params.set('includeDeleted', String(query.includeDeleted))
  const suffix = params.toString()
  return suffix ? `${API_ROUTES.assets}?${suffix}` : API_ROUTES.assets
}

export function buildChangesRoute(after: Revision): string {
  return `${API_ROUTES.changes}?after=${encodeURIComponent(String(after))}`
}

export function buildPairingUri(payload: PairingQrPayload): string {
  const expiresEpochSeconds = Math.floor(Date.parse(payload.expiresAt) / 1000)
  return `NS1|${payload.serverId}|${payload.host}|${payload.port}|${payload.pairingToken}|${expiresEpochSeconds}|${payload.tlsFingerprintSha256}`
}
