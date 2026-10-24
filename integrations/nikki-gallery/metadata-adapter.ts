import { normalizeNikkiGalleryPhoto, mergePhotoMetadataGaps, enrichPhotoMetadataWithDictionary,
  type InfinityPhotoMetadata, type MetadataDictionaryManifest } from '../../packages/core/src/index.js'

/** Call with the local decoder result for this exact photo, not editor_metadata. */
export function toNikkiSyncMetadata(input: {
  decoded: unknown
  uid?: string
  capturedAt?: string
  existing?: InfinityPhotoMetadata
  dictionary?: MetadataDictionaryManifest
}): InfinityPhotoMetadata | undefined {
  const normalized = normalizeNikkiGalleryPhoto(input.decoded)
  if (!Object.keys(normalized).length) return input.existing
  const base = input.existing ?? { schemaVersion: 1 as const, identity: { ...(input.uid ? { uid: input.uid } : {}) },
    capture: { ...(input.capturedAt ? { capturedAt: input.capturedAt } : {}) }, camera: {} }
  const completed = mergePhotoMetadataGaps(base, normalized)
  return input.dictionary ? enrichPhotoMetadataWithDictionary(completed, input.dictionary) : completed
}
