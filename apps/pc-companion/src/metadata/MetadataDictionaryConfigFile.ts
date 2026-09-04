import { readFileSync } from 'node:fs'
import type { MetadataDictionaryManifest } from '@nikkisync/core'
import { parseMetadataDictionaryManifest } from './MetadataDictionaryService.js'

/** Optional PC-local dictionary. Missing or invalid files leave dictionary enrichment disabled. */
export function loadMetadataDictionaryFile(filePath: string): MetadataDictionaryManifest | undefined {
  try {
    return parseMetadataDictionaryManifest(JSON.parse(readFileSync(filePath, 'utf8')) as unknown)
  } catch {
    return undefined
  }
}
