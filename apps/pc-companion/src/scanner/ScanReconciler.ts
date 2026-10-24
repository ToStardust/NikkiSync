import { createHash } from 'node:crypto'
import path from 'node:path'
import { AssetRepository } from '@nikkisync/database'
import { AssetResolver, type AssetResolverCandidate, type ResourceRole } from '@nikkisync/core'
import type { DiscoveredResource, AssetSnapshot, ScanResult } from './types.js'
import { ScanIndexFailure } from './ScanIndexFailure.js'

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

  async reconcile(resources: DiscoveredResource[], roots: string[], onAssetProcessed?: () => void): Promise<Pick<ScanResult, 'assetsCreated' | 'assetsUpdated' | 'assetsDeleted' | 'journalRevisions' | 'pendingPaths'>> {
    let operation: 'build-snapshots' | 'write-asset' | 'mark-missing' = 'build-snapshots'
    let processedAssets=0
    try {
    const now = new Date().toISOString(); const snapshots = this.buildSnapshots(resources, now)
    let created = 0; let updated = 0; let superseded = 0; const revisions: number[] = []
    const activeAssetIds=new Set(snapshots.map(snapshot=>snapshot.assetId))
    operation='write-asset'
    for (const snapshot of snapshots) {
      const result = this.assets.reconcile(snapshot,{activeAssetIds,completedRoots:roots})
      if (result.kind === 'created') created += 1
      if (result.kind === 'updated') updated += 1
      for(const change of result.supersededChanges??[]){revisions.push(change.revision);superseded++}
      if (result.revision !== undefined) revisions.push(result.revision)
      processedAssets++
      onAssetProcessed?.()
    }
    operation='mark-missing'
    const deleted = this.assets.markMissingByRoots(snapshots.map((snapshot) => snapshot.assetId), roots)
    revisions.push(...deleted.map((item) => item.revision))
    return { assetsCreated: created, assetsUpdated: updated, assetsDeleted: deleted.length+superseded, journalRevisions: revisions, pendingPaths: this.pending(resources,snapshots) }
    } catch(error) { throw new ScanIndexFailure(error,operation,processedAssets,resources.length) }
  }

  private pending(resources: DiscoveredResource[],snapshots:AssetSnapshot[]): string[] {
    const paired=new Set(snapshots.flatMap(snapshot=>snapshot.resources.filter(resource=>resource.role==='source_primary').map(resource=>resource.pathKey)))
    return resources.filter(item=>item.kind==='motion_cover'&&!paired.has(item.pathKey)).map(item=>item.absolutePath)
  }

  private buildSnapshots(resources: DiscoveredResource[], now: string): AssetSnapshot[] {
    const groups=new Map<string,DiscoveredResource[]>()
    for(const resource of resources){const key=resource.extraNamespace??'';const list=groups.get(key)??[];list.push(resource);groups.set(key,list)}
    return [...groups].flatMap(([namespace,items])=>this.buildGroupSnapshots(items,now,namespace))
  }

  private buildGroupSnapshots(resources:DiscoveredResource[],now:string,namespace:string):AssetSnapshot[]{
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
      const uid = first.uid; const assetId = idFor(`infinity_nikki|photo|${namespace?namespace+'|':''}${key}`)
      snapshots.push(this.snapshot(assetId, 'photo', uid, group, now))
    }
    const covers = resources.filter((item) => item.kind === 'motion_cover')
    const videos = resources.filter((item) => item.kind === 'motion_video')
    // A shared date/numeric token is a heuristic, not a source association. A
    // native LIVE requires one exact-stem cover/video in the same UID+folder.
    const keyFor=(item:DiscoveredResource)=>JSON.stringify([item.uid??'',path.dirname(item.absolutePath).toLowerCase(),item.normalizedStem])
    const groupByKey=(items:DiscoveredResource[])=>{
      const result=new Map<string,Map<string,DiscoveredResource>>()
      for(const item of items){const key=keyFor(item);const group=result.get(key)??new Map<string,DiscoveredResource>();group.set(item.pathKey,item);result.set(key,group)}
      return result
    }
    const coverGroups=groupByKey(covers),videoGroups=groupByKey(videos)
    for (const cover of covers) {
      const keyForCover=keyFor(cover),group=videoGroups.get(keyForCover)
      if(coverGroups.get(keyForCover)?.size!==1||group?.size!==1)continue
      const video=group.values().next().value!
      const match=this.resolver.scoreCandidate(
        {resourceId:cover.pathKey,fileName:cover.fileName,sourcePath:cover.absolutePath,role:'source_primary',...(cover.uid?{uid:cover.uid}:{})},
        {resourceId:video.pathKey,fileName:video.fileName,sourcePath:video.absolutePath,role:'source_motion',...(video.uid?{uid:video.uid}:{})})
      const key = `${cover.uid ?? ''}|${cover.normalizedStem}`; const assetId = idFor(`infinity_nikki|motion_photo|${namespace?namespace+'|':''}${key}`)
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
