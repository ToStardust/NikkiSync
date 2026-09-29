import { ResourceRepository, SyncReadRepository, type DatabaseManager } from '@nikkisync/database'

export interface RemotePhotoResource {
  resourceId: string
  assetId: string
  fileName: string
  mimeType: string
  sizeBytes: number
}

export interface LocalRemotePhotoResource extends RemotePhotoResource {
  sourcePath: string
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
      sourcePath: String(row.source_path)
    }
  }
}

