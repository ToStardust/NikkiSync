import { createHash } from 'node:crypto'
import path from 'node:path'
import { AssetRepository } from '@nikkisync/database'
import { AssetResolver, type AssetResolverCandidate, type ResourceRole } from '@nikkisync/core'
import type { DiscoveredResource, AssetSnapshot, ScanResult } from './types.js'

function idFor(value: string): string { return `asset_${createHash('sha256').update(value).digest('hex').slice(0, 32)}` }
function resourceIdFor(assetId: string, role: string, pathKey: string): string {
  return `resource_${createHash('sha256').update(`${assetId}|${role}|${pathKey}`).digest('hex').slice(0, 32)}`
}

function capturedAtFor(group: DiscoveredResource[]): string | undefined {
  const preferredKinds: DiscoveredResource['kind'][] = ['high_quality', 'motion_cover', 'low_quality']
  for (const kind of preferredKinds) {
    const source = group.find((item) => item.kind === kind)
    if (!source || !Number.isFinite(source.mtimeMs) || source.mtimeMs <= 0) continue
    return new Date(source.mtimeMs).toISOString()
  }
  return undefined
}

export class ScanReconciler {
  private readonly resolver = new AssetResolver()
  constructor(private readonly assets: AssetRepository, private readonly motionGraceMs = 2000) {}

  async reconcile(resources: DiscoveredResource[], roots: string[]): Promise<Pick<ScanResult, 'assetsCreated' | 'assetsUpdated' | 'assetsDeleted' | 'journalRevisions' | 'pendingPaths'>> {
    const now = new Date().toISOString(); const snapshots = this.buildSnapshots(resources, now)
    let created = 0; let updated = 0; const revisions: number[] = []
    for (const snapshot of snapshots) {
      const result = this.assets.reconcile(snapshot)
      if (result.kind === 'created') created += 1
      if (result.kind === 'updated') updated += 1
      if (result.revision !== undefined) revisions.push(result.revision)
    }
    const deleted = this.assets.markMissingByRoots(snapshots.map((snapshot) => snapshot.assetId), roots)
    revisions.push(...deleted.map((item) => item.revision))
    return { assetsCreated: created, assetsUpdated: updated, assetsDeleted: deleted.length, journalRevisions: revisions, pendingPaths: this.pending(resources) }
  }

  private pending(resources: DiscoveredResource[]): string[] {
    const videos = new Set(resources.filter((item) => item.kind === 'motion_video').map((item) => `${item.uid ?? ''}|${item.normalizedStem}`))
    return resources.filter((item) => item.kind === 'motion_cover' && !videos.has(`${item.uid ?? ''}|${item.normalizedStem}`)).map((item) => item.absolutePath)
  }

  private buildSnapshots(resources: DiscoveredResource[], now: string): AssetSnapshot[] {
    const hq = resources.filter((item) => item.kind === 'high_quality')
    const lq = resources.filter((item) => item.kind === 'low_quality')
    const snapshots: AssetSnapshot[] = []
    const photoById = new Map([...hq, ...lq].map((item) => [item.pathKey, item]))
    const resolvedPhotos = this.resolver.resolvePhotoResources([...hq, ...lq].map((item) => ({
      resourceId: item.pathKey, fileName: item.fileName, sourcePath: item.absolutePath,
      role: item.kind === 'high_quality' ? 'source_high_quality' as const : 'source_low_quality' as const,
      ...(item.uid ? { uid: item.uid } : {}), modifiedAt: new Date(item.mtimeMs).toISOString()
    })))
    for (const resolved of resolvedPhotos) {
      const group = resolved.resources.map((item) => photoById.get(String(item.resourceId))).filter((item): item is DiscoveredResource => Boolean(item))
      const key = `${resolved.uid ?? ''}|${resolved.stem}`
      if (!group.some((item) => item.kind === 'high_quality')) continue
      const first = group[0]; if (!first) continue
      const uid = first.uid; const assetId = idFor(`infinity_nikki|photo|${key}`)
      snapshots.push(this.snapshot(assetId, 'photo', uid, group, now))
    }
    const covers = resources.filter((item) => item.kind === 'motion_cover')
    const videos = resources.filter((item) => item.kind === 'motion_video')
    const motionCandidates = this.resolver.resolveMotionCandidates(
      covers.map((item) => ({ resourceId: item.pathKey, fileName: item.fileName, sourcePath: item.absolutePath, role: 'source_primary' as const, ...(item.uid ? { uid: item.uid } : {}) })),
      videos.map((item) => ({ resourceId: item.pathKey, fileName: item.fileName, sourcePath: item.absolutePath, role: 'source_motion' as const, ...(item.uid ? { uid: item.uid } : {}) }))
    )
    for (const cover of covers) {
      const match = motionCandidates.find((candidate) => candidate.stillResourceId === cover.pathKey)
      const video = match ? videos.find((candidate) => candidate.pathKey === match.motionResourceId) : undefined
      if (!video) continue
      const key = `${cover.uid ?? ''}|${cover.normalizedStem}`; const assetId = idFor(`infinity_nikki|motion_photo|${key}`)
      snapshots.push(this.snapshot(assetId, 'motion_photo', cover.uid, [cover, video], now, true, match))
    }
    return snapshots
  }

  private snapshot(assetId: string, assetType: 'photo' | 'motion_photo', uid: string | undefined, group: DiscoveredResource[], now: string, motion = false, motionMatch?: AssetResolverCandidate): AssetSnapshot {
    const resources = group.map((item) => {
      const role: ResourceRole = item.kind === 'high_quality' ? 'source_high_quality' : item.kind === 'low_quality' ? 'source_low_quality' : item.kind === 'motion_video' ? 'source_motion' : 'source_primary'
      return {
        resourceId: resourceIdFor(assetId, role, item.pathKey), assetId, role, fileName: item.fileName,
        sourcePath: item.absolutePath, pathKey: item.pathKey, mimeType: item.mimeType, fileExt: item.fileExt,
        sizeBytes: item.sizeBytes, sha256: item.sha256 ?? '',
        ...(item.width === undefined ? {} : { width: item.width }),
        ...(item.height === undefined ? {} : { height: item.height }),
        ...(item.durationMs === undefined ? {} : { durationMs: item.durationMs }),
        modifiedAt: new Date(item.mtimeMs).toISOString(),
        ...(item.birthtimeMs === undefined ? {} : { birthTime: new Date(item.birthtimeMs).toISOString() }),
        stableState: 'stable' as const, isDerived: false as const
      }
    })
    const still = resources.find((resource) => resource.role === 'source_primary')
    const moving = resources.find((resource) => resource.role === 'source_motion')
    const candidates = motionMatch && still && moving ? [{
      stillResourceId: still.resourceId, motionResourceId: moving.resourceId, score: motionMatch.score,
      confidence: motionMatch.confidence, reasons: motionMatch.reasons, status: 'accepted' as const
    }] : undefined
    const embeddedToken = group.find((item) => item.nativeParamToken)?.nativeParamToken
    const embeddedPayload = group.find((item) => item.nativeParamPayload)?.nativeParamPayload
    const embeddedNuan5Md5 = group.find((item) => item.nativeParamNuan5Md5)?.nativeParamNuan5Md5
    const metadata = embeddedToken || embeddedPayload || embeddedNuan5Md5 || uid ? {
      schemaVersion: 1,
      identity: { ...(uid ? { uid } : {}), sourceAssetId: assetId },
      capture: {},
      camera: {},
      raw: {
        ...(embeddedToken ? { nativeParamToken: embeddedToken } : {}),
        ...(embeddedPayload ? { nativeParamPayload: embeddedPayload } : {}),
        ...(embeddedNuan5Md5 ? { nativeParamNuan5Md5: embeddedNuan5Md5 } : {})
      }
    } : undefined
    const capturedAt = capturedAtFor(group)
    return { assetId, assetType, ...(uid ? { uid } : {}), ...(capturedAt ? { capturedAt } : {}), discoveredAt: now,
      ...(metadata ? { metadataSchemaVersion: 1, metadata } : {}),
      ...(motion ? { motionResolverMethod: 'filename' as const, motionResolverConfidence: 1 } : {}), resources, ...(candidates ? { candidates } : {}) }
  }
}
