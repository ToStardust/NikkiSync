import type { InfinityNikkiInstallation } from '../game-directory-discovery.js'
import type { ResourceRole } from '@nikkisync/core'
import type { ResolverCandidateInput } from '@nikkisync/database'
import type { AssetReconcileResult, DatabaseManager } from '@nikkisync/database'

export type ScannerStatus = 'stopped' | 'discovering' | 'scanning' | 'reconciling' | 'watching' | 'running' | 'error'
export type DiscoveredResourceKind = 'high_quality' | 'low_quality' | 'motion_cover' | 'motion_video' | 'unknown_image' | 'binary_companion' | 'ignored'

export interface DiscoveredResource {
  absolutePath: string
  pathKey: string
  uid?: string
  kind: DiscoveredResourceKind
  fileName: string
  normalizedStem: string
  sizeBytes: number
  mtimeMs: number
  birthtimeMs?: number
  width?: number
  height?: number
  durationMs?: number
  sha256?: string
  mimeType: string
  fileExt: string
  /** Opaque 32-byte Infinity Nikki parameter token encoded as 44-char Base64 after the final JPEG EOI. */
  nativeParamToken?: string
  /** Opaque printable parameter payload stored between the main JPEG EOI and the metadata delimiter EOI. PC-only resolver input. */
  nativeParamPayload?: string
  /** NUAN5-compatible MD5 of the legacy JPEG prefix or the final [V2]N bytes before the delimiter EOI. */
  nativeParamNuan5Md5?: string
}

export interface StabilityConfig {
  pollIntervalMs: number
  stableChecks: number
  maxWaitMs: number
  /** Existing files older than this threshold are considered stable after one successful stat/open. */
  assumeStableIfOlderMs: number
}

export interface ScannerConfig {
  cachedInstallRoot?: string
  startingPaths?: string[]
  runningExecutablePaths?: string[]
  stability?: Partial<StabilityConfig>
  watcher?: boolean
  debounceMs?: number
  motionAssemblyGraceMs?: number
}

export interface ScanResult {
  scanId: string
  roots: string[]
  filesObserved: number
  resourcesAccepted: number
  resourcesIgnored: number
  assetsCreated: number
  assetsUpdated: number
  assetsDeleted: number
  journalRevisions: number[]
  pendingPaths: string[]
  errors: string[]
}

export interface ScannerMetrics {
  status: ScannerStatus
  lastScan?: ScanResult
  installation?: InfinityNikkiInstallation
}

export interface ScannerDependencies {
  database: DatabaseManager
}

export interface AssetSnapshot {
  assetId: string
  assetType: 'photo' | 'motion_photo'
  uid?: string
  discoveredAt: string
  metadataSchemaVersion?: number
  metadata?: unknown
  motionResolverMethod?: 'filename' | 'timestamp' | 'heuristic'
  motionResolverConfidence?: number
  candidates?: ResolverCandidateInput[]
  resources: Array<{
    resourceId: string
    assetId: string
    role: ResourceRole
    fileName: string
    sourcePath: string
    pathKey: string
    mimeType: string
    fileExt: string
    sizeBytes: number
    sha256: string
    width?: number
    height?: number
    durationMs?: number
    modifiedAt?: string
    birthTime?: string
    stableState: 'stable'
    isDerived: false
  }>
}

export type ReconcileMutation = AssetReconcileResult
