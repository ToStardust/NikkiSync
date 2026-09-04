import type { AssetState, AssetType, ResourceRole } from '@nikkisync/core'

export interface CreateAssetInput {
  assetId: string
  assetType: AssetType
  assetState?: AssetState
  uid?: string
  capturedAt?: string
  discoveredAt: string
  metadataSchemaVersion?: number
  metadata?: unknown
  motionPresentationTimestampUs?: number
  motionResolverMethod?: 'embedded_id' | 'filename' | 'timestamp' | 'heuristic' | 'manual'
  motionResolverConfidence?: number
  createdAt?: string
}

export interface AssetReconcileInput extends CreateAssetInput {
  resources: CreateResourceInput[]
  candidates?: ResolverCandidateInput[]
}

export interface AssetReconcileResult {
  kind: 'created' | 'updated' | 'unchanged'
  revision?: number
}

export interface CreateResourceInput {
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
  stableState?: 'discovered' | 'writing' | 'stable' | 'missing'
  isDerived?: boolean
  createdAt?: string
}

export interface ResolverCandidateInput {
  stillResourceId: string
  motionResourceId: string
  score: number
  confidence: number
  reasons: string[]
  status?: 'pending' | 'accepted' | 'rejected'
}

export interface PairDeviceInput {
  deviceId: string
  deviceName: string
  platform: 'ios' | 'android'
  publicKey: string
  credentialHash: string
  appVersion?: string
  pairedAt?: string
}
