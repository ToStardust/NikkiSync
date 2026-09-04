import type {
  AssetDetailResponse,
  AssetSummary,
  ChangeRecord,
  InfinityPhotoMetadata,
  MediaResource,
  NikkiAsset
} from '@nikkisync/protocol'

export type GameVersionResolver = (timestamp: string | undefined) => string | undefined

function optionalString(value: unknown): string | undefined {
  return value === null || value === undefined || value === '' ? undefined : String(value)
}

function optionalNumber(value: unknown): number | undefined {
  return value === null || value === undefined ? undefined : Number(value)
}

function publicMetadata(value: InfinityPhotoMetadata | undefined): InfinityPhotoMetadata | undefined {
  if (!value) return undefined
  const raw = value.raw && typeof value.raw === 'object'
    ? { ...(value.raw as Record<string, unknown>) }
    : undefined
  if (raw) {
    // The full game-native payload can be tens of KB and is only required by the PC resolver.
    // Never send it over the LAN API; clients only need canonical decoded metadata and status.
    delete raw.nativeParamPayload
    delete raw.nativeParamNuan5Md5
  }
  return raw ? { ...value, raw } as InfinityPhotoMetadata : value
}

function parseMetadata(value: unknown): InfinityPhotoMetadata | undefined {
  return optionalString(value)
    ? JSON.parse(String(value)) as InfinityPhotoMetadata
    : undefined
}

function preferredSourceRow(resourceRows: Record<string, unknown>[]): Record<string, unknown> | undefined {
  for (const role of ['source_high_quality', 'source_primary', 'source_low_quality']) {
    const row = resourceRows.find((candidate) => String(candidate.role) === role)
    if (row) return row
  }
  return undefined
}

function gameVersionInferenceTimestamp(
  row: Record<string, unknown>,
  resourceRows: Record<string, unknown>[],
  metadata: InfinityPhotoMetadata | undefined
): string | undefined {
  const canonicalCapture = optionalString(metadata?.capture?.capturedAt) ?? optionalString(row.captured_at)
  if (canonicalCapture) return canonicalCapture
  const source = preferredSourceRow(resourceRows)
  if (!source) return undefined
  return optionalString(source.birth_time) ?? optionalString(source.modified_at)
}

export function mapResourceRow(row: Record<string, unknown>): MediaResource {
  return {
    resourceId: String(row.resource_id),
    role: String(row.role) as MediaResource['role'],
    fileName: String(row.file_name),
    mimeType: String(row.mime_type),
    fileExt: String(row.file_ext),
    sizeBytes: Number(row.size_bytes),
    sha256: String(row.sha256),
    ...(optionalNumber(row.width) === undefined ? {} : { width: Number(row.width) }),
    ...(optionalNumber(row.height) === undefined ? {} : { height: Number(row.height) }),
    ...(optionalNumber(row.duration_ms) === undefined ? {} : { durationMs: Number(row.duration_ms) }),
    ...(optionalString(row.modified_at) ? { modifiedAt: String(row.modified_at) } : {})
  }
}

export function mapAssetRow(row: Record<string, unknown>, resourceRows: Record<string, unknown>[]): NikkiAsset {
  const resources = resourceRows.map(mapResourceRow)
  const still = resources.find((resource) => resource.role === 'source_primary' || resource.role === 'source_high_quality')
  const motion = resources.find((resource) => resource.role === 'source_motion')
  const metadata = publicMetadata(parseMetadata(row.metadata_json))
  return {
    schemaVersion: 1,
    assetId: String(row.asset_id),
    type: String(row.asset_type) as NikkiAsset['type'],
    state: String(row.asset_state) as NikkiAsset['state'],
    source: {
      game: 'infinity_nikki',
      ...(optionalString(row.uid) ? { uid: String(row.uid) } : {}),
      discoveredAt: String(row.discovered_at),
      ...(optionalString(row.captured_at) ? { capturedAt: String(row.captured_at) } : {})
    },
    resources,
    ...(still && motion ? {
      motion: {
        stillResourceId: still.resourceId,
        motionResourceId: motion.resourceId,
        ...(optionalNumber(row.motion_presentation_timestamp_us) === undefined
          ? {}
          : { presentationTimestampUs: Number(row.motion_presentation_timestamp_us) }),
        ...(optionalString(row.motion_resolver_method) ? {
          resolver: {
            method: String(row.motion_resolver_method) as 'embedded_id' | 'filename' | 'timestamp' | 'heuristic' | 'manual',
            confidence: Number(row.motion_resolver_confidence ?? 0)
          }
        } : {})
      }
    } : {}),
    ...(metadata ? { metadata } : {}),
    revision: Number(row.revision),
    ...(optionalString(row.deleted_at) ? { deletedAt: String(row.deleted_at) } : {})
  }
}

export function mapAssetDetail(row: Record<string, unknown>, resourceRows: Record<string, unknown>[]): AssetDetailResponse {
  return { asset: mapAssetRow(row, resourceRows) }
}

export function mapAssetSummary(
  row: Record<string, unknown>,
  resourceRows: Record<string, unknown>[],
  resolveGameVersion?: GameVersionResolver
): AssetSummary {
  const resources = resourceRows.map(mapResourceRow)
  const metadata = parseMetadata(row.metadata_json)
  const explicitGameVersion = optionalString(metadata?.identity?.gameVersion)
  const canonicalCapturedAt = optionalString(metadata?.capture?.capturedAt) ?? optionalString(row.captured_at)
  const inferenceTimestamp = gameVersionInferenceTimestamp(row, resourceRows, metadata)
  const inferredGameVersion = explicitGameVersion || !resolveGameVersion || !inferenceTimestamp
    ? undefined
    : resolveGameVersion(inferenceTimestamp)
  const visual = resources.find((resource) => resource.role === 'source_high_quality')
    ?? resources.find((resource) => resource.role === 'source_primary')
    ?? resources[0]
  const bestPreview = resources.find((resource) => resource.role === 'derived_preview')
    ?? resources.find((resource) => resource.role === 'source_low_quality')
    ?? resources.find((resource) => resource.role === 'source_primary')
    ?? resources.find((resource) => resource.role === 'source_high_quality')
  return {
    assetId: String(row.asset_id),
    type: String(row.asset_type) as AssetSummary['type'],
    state: String(row.asset_state) as AssetSummary['state'],
    ...(canonicalCapturedAt ? { capturedAt: canonicalCapturedAt } : {}),
    ...(optionalString(row.uid) ? { uid: String(row.uid) } : {}),
    revision: Number(row.revision),
    ...(visual?.width === undefined ? {} : { width: visual.width }),
    ...(visual?.height === undefined ? {} : { height: visual.height }),
    hasMotion: resources.some((resource) => resource.role === 'source_motion'),
    hasMetadata: Boolean(row.metadata_json),
    ...(explicitGameVersion
      ? { gameVersion: explicitGameVersion, gameVersionSource: 'explicit' as const }
      : inferredGameVersion
        ? { gameVersion: inferredGameVersion, gameVersionSource: 'inferred' as const }
        : { gameVersionSource: 'unknown' as const }),
    ...(resources.find((resource) => resource.role === 'derived_thumbnail')?.resourceId
      ? { thumbnailResourceId: resources.find((resource) => resource.role === 'derived_thumbnail')!.resourceId }
      : {}),
    ...(bestPreview?.resourceId ? { previewResourceId: bestPreview.resourceId } : {})
  }
}

export function mapChangeRow(row: Record<string, unknown>): ChangeRecord {
  return {
    revision: Number(row.revision),
    type: String(row.event_type) as ChangeRecord['type'],
    assetId: String(row.asset_id),
    occurredAt: String(row.occurred_at)
  }
}
