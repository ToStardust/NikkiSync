import type { MetadataDictionaryManifest } from '@nikkisync/core'

export interface MetadataDictionaryFetchState {
  contentVersion?: string
  etag?: string
  lastModified?: string
}

export type MetadataDictionaryFetchResult =
  | { status: 'not-modified', etag?: string, lastModified?: string }
  | { status: 'updated', manifest: MetadataDictionaryManifest, etag?: string, lastModified?: string }

export interface MetadataDictionaryProvider {
  readonly id: string
  fetch(state?: MetadataDictionaryFetchState): Promise<MetadataDictionaryFetchResult>
}
