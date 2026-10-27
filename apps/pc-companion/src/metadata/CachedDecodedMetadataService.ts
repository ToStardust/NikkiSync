import { mergePhotoMetadataGaps, normalizeNuan5Photo, normalizeNikkiGalleryPhoto, type InfinityPhotoMetadata } from '@nikkisync/core'
import { AssetRepository, type DatabaseManager } from '@nikkisync/database'
import type { PhotoMetadataDictionaryEnricher } from './MetadataResolverService.js'

const VERSION = 'decoded-fields-v1'

/** Upgrade cached results locally; never re-upload a photo or borrow metadata from another asset. */
export class CachedDecodedMetadataService {
  private readonly assets: AssetRepository
  constructor(database: DatabaseManager, private readonly dictionary?: PhotoMetadataDictionaryEnricher) {
    this.assets = new AssetRepository(database)
  }
  runOnce(): number {
    let updated = 0
    for (const row of this.assets.list()) {
      if (!row.metadata_json || row.asset_state === 'deleted') continue
      let metadata: InfinityPhotoMetadata
      try { metadata = JSON.parse(String(row.metadata_json)) } catch { continue }
      if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) continue
      const raw = metadata.raw
      if (!raw || raw.decodedFieldsVersion === VERSION || (!raw.nuan5 && !raw.nikkiGalleryDecoded)) continue
      const online = raw.nuan5 ? normalizeNuan5Photo(raw.nuan5) : {}
      const local = raw.nikkiGalleryDecoded ? normalizeNikkiGalleryPhoto(raw.nikkiGalleryDecoded) : {}
      if (![...Object.keys(online), ...Object.keys(local)].some(key => key !== 'raw')) continue
      let completed = mergePhotoMetadataGaps(metadata, online)
      completed = mergePhotoMetadataGaps(completed, local)
      completed = (this.dictionary?.enrichMetadata(completed) ?? completed) as InfinityPhotoMetadata
      this.assets.updateMetadata(String(row.asset_id), { ...completed, raw: { ...completed.raw, decodedFieldsVersion: VERSION } })
      updated++
    }
    return updated
  }
}
