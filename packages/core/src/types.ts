export const METADATA_SCHEMA_VERSION = 1 as const

export type MetadataSchemaVersion = typeof METADATA_SCHEMA_VERSION
export type IsoDateTime = string
export type AssetId = string
export type ResourceId = string
export type Revision = number

export const ASSET_TYPES = ['photo', 'motion_photo', 'video', 'unknown'] as const
export type AssetType = (typeof ASSET_TYPES)[number]

export const RESOURCE_ROLES = [
  'source_primary',
  'source_high_quality',
  'source_low_quality',
  'source_motion',
  'derived_thumbnail',
  'derived_preview'
] as const
export type ResourceRole = (typeof RESOURCE_ROLES)[number]

export const ASSET_STATES = ['ready', 'resolving', 'missing', 'deleted'] as const
export type AssetState = (typeof ASSET_STATES)[number]

export interface MediaResource {
  resourceId: ResourceId
  role: ResourceRole
  fileName: string
  mimeType: string
  fileExt: string
  sizeBytes: number
  sha256: string
  width?: number
  height?: number
  durationMs?: number
  modifiedAt?: IsoDateTime
  /** Present only for PC-internal/debug responses; never required by mobile clients. */
  sourcePathHint?: string
}

export interface MotionAssetInfo {
  stillResourceId: ResourceId
  motionResourceId: ResourceId
  /** Frame in the motion track corresponding to the displayed still. -1 means unknown/unset. */
  presentationTimestampUs?: number
  sourceCodec?: string
  sourceContainer?: string
  resolver?: {
    method: 'embedded_id' | 'filename' | 'timestamp' | 'heuristic' | 'manual'
    confidence: number
  }
}

export interface InfinityPhotoMetadata {
  schemaVersion: MetadataSchemaVersion
  identity: {
    uid?: string
    gameVersion?: string
    gameVersionEnglishName?: string
    sourceAssetId?: string
  }
  capture: {
    capturedAt?: IsoDateTime
  }
  camera: {
    focalLength?: number
    apertureSection?: number
    exposure?: number
    brightness?: number
    contrast?: number
    saturation?: number
    vibrance?: number
    highlights?: number
    shadows?: number
    vignetteIntensity?: number
    bloomIntensity?: number
    bloomThreshold?: number
    portraitMode?: boolean
    rotation?: number
    zoom?: number
    cameraYaw?: number
    cameraPitch?: number
    cameraLoc?: Record<string, unknown>
  }
  pose?: { id?: string; name?: string; strength?: number }
  filter?: {
    id?: string
    name?: string
    strength?: number
  }
  lighting?: {
    id?: string
    name?: string
    strength?: number
  }
  photography?: Record<string, unknown>
  nikki?: Record<string, unknown>
  dressing?: {
    clothes?: unknown[]
    eureka?: unknown[]
    [key: string]: unknown
  }
  interactions?: unknown[]
  location?: {
    id?: string
    name?: string
    [key: string]: unknown
  }
  /** Lossless escape hatch for unnormalized game fields. */
  raw?: {
    socialPhoto?: unknown
    cameraParams?: unknown
    [key: string]: unknown
  }
}

export interface NikkiAsset {
  schemaVersion: 1
  assetId: AssetId
  type: AssetType
  state: AssetState
  source: {
    game: 'infinity_nikki'
    uid?: string
    discoveredAt: IsoDateTime
    capturedAt?: IsoDateTime
  }
  resources: MediaResource[]
  motion?: MotionAssetInfo
  metadata?: InfinityPhotoMetadata
  revision: Revision
  deletedAt?: IsoDateTime
}

export interface TemplatePhotoContext {
  imageUri: string
  metadata?: InfinityPhotoMetadata
  asset: {
    id: AssetId
    type: AssetType
    width?: number
    height?: number
    hasMotion: boolean
  }
}

export interface AssetResolverCandidate {
  stillResourceId: ResourceId
  motionResourceId: ResourceId
  score: number
  confidence: number
  method: 'embedded_id' | 'filename' | 'timestamp' | 'heuristic' | 'manual'
  reasons: string[]
}
