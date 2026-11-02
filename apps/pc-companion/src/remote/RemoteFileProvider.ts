import { ResourceRepository, SyncReadRepository, type DatabaseManager } from '@nikkisync/database'

export interface RemotePhotoResource {
  resourceId: string
  assetId: string
  fileName: string
  mimeType: string
  sizeBytes: number
  capturedAt?: string
  previewResourceId?: string
}

export interface RemoteSelectionPage { items: RemotePhotoResource[]; nextCursor?: string }

export interface LocalRemotePhotoResource extends RemotePhotoResource {
  sourcePath: string
  sha256: string
}

export class RemoteFileProvider {
  private readonly resources: ResourceRepository
  private readonly reads: SyncReadRepository

  constructor(database: DatabaseManager) {
    this.resources = new ResourceRepository(database)
    this.reads = new SyncReadRepository(database)
  }

  getPhoto(resourceId: string): LocalRemotePhotoResource | undefined {
    const row = this.resources.getById(resourceId)
    if (!row || row.stable_state !== 'stable') return undefined
    if (row.role !== 'source_primary' && row.role !== 'source_high_quality') return undefined
    if (row.mime_type !== 'image/jpeg' && row.mime_type !== 'image/png') return undefined
    const assetId = String(row.asset_id)
    const asset = this.reads.getAsset(assetId)
    if (!asset || asset.asset_type !== 'photo' || asset.asset_state !== 'ready') return undefined
    return {
      resourceId: String(row.resource_id),
      assetId,
      fileName: String(row.file_name),
      mimeType: String(row.mime_type),
      sizeBytes: Number(row.size_bytes),
      sourcePath: String(row.source_path),
      sha256: String(row.sha256)
    }
  }

  listPhotos(cursor?: string): RemoteSelectionPage {
    let after: { t: string; id: string } | undefined
    if (cursor) {
      try {
        const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>
        if (cursor.length > 1024 || typeof value.t !== 'string' || typeof value.id !== 'string') throw new Error()
        after = { t: value.t, id: value.id }
      } catch { throw new Error('Invalid photo cursor') }
    }
    const rows = this.reads.listAssets({ limit: 61, assetType: 'photo', ...(after ? { cursorTime: after.t, cursorAssetId: after.id } : {}) })
    const page = rows.slice(0, 60)
    const items = page.flatMap((asset) => {
      const resources = this.reads.listResources(String(asset.asset_id))
        .map((row) => this.getPhoto(String(row.resource_id)))
        .filter((resource): resource is LocalRemotePhotoResource => Boolean(resource))
      const preferred = resources.find((resource) => this.resources.getById(resource.resourceId)?.role === 'source_high_quality') ?? resources[0]
      if (!preferred) return []
      const { sourcePath: _sourcePath, sha256: _sha256, ...photo } = preferred
      return [{ ...photo, capturedAt: String(asset.captured_at ?? asset.discovered_at), previewResourceId: resources[0]!.resourceId }]
    })
    const last = page.at(-1)
    return { items, ...(rows.length > 60 && last ? {
      nextCursor: Buffer.from(JSON.stringify({ t: String(last.captured_at ?? last.discovered_at), id: String(last.asset_id) })).toString('base64url')
    } : {}) }
  }
}
