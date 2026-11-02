import type {
  MetadataDictionaryEntry,
  MetadataDictionaryKind,
  MetadataDictionaryManifest
} from '@nikkisync/core'
import type { DatabaseManager } from './database-manager.js'

type StateRow = {
  schema_version: number
  provider: string
  provider_version: string
  game_version: string | null
  generated_at: string | null
  fetched_at: string | null
}

type EntryRow = {
  kind: MetadataDictionaryKind
  entity_id: string
  name: string | null
  category: string | null
  rarity: number | null
  thumbnail: string | null
  raw_json: string | null
}

function entryFromRow(row: EntryRow): MetadataDictionaryEntry {
  const raw = row.raw_json === null ? undefined : JSON.parse(row.raw_json) as Record<string, unknown>
  const thumbnailFallbacks = Array.isArray(raw?.thumbnailFallbacks)
    ? raw.thumbnailFallbacks.filter((value): value is string => typeof value === 'string' && value.length > 0)
    : []
  return {
    kind: row.kind,
    id: row.entity_id,
    ...(row.name === null ? {} : { name: row.name }),
    ...(row.category === null ? {} : { category: row.category }),
    ...(row.rarity === null ? {} : { rarity: row.rarity }),
    ...(row.thumbnail === null ? {} : { thumbnail: row.thumbnail }),
    ...(typeof raw?.suitId === 'string' ? { suitId: raw.suitId } : {}),
    ...(typeof raw?.suitName === 'string' ? { suitName: raw.suitName } : {}),
    ...(thumbnailFallbacks.length ? { thumbnailFallbacks } : {}),
    ...(raw === undefined ? {} : { raw })
  }
}

export class MetadataDictionaryRepository {
  constructor(private readonly database: DatabaseManager) {}

  replaceSnapshot(manifest: MetadataDictionaryManifest, fetchedAt = new Date().toISOString()): void {
    this.database.transaction(() => {
      this.database.connection.prepare('DELETE FROM metadata_dictionary_entries').run()
      const insert = this.database.connection.prepare(`
        INSERT INTO metadata_dictionary_entries
          (kind, entity_id, name, category, rarity, thumbnail, raw_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      for (const entry of manifest.entries) {
        insert.run(
          entry.kind,
          entry.id,
          entry.name ?? null,
          entry.category ?? null,
          entry.rarity ?? null,
          entry.thumbnail ?? null,
          entry.raw === undefined && entry.suitId === undefined && entry.suitName === undefined && entry.thumbnailFallbacks === undefined
            ? null
            : JSON.stringify({
                ...(entry.raw ?? {}),
                ...(entry.suitId === undefined ? {} : { suitId: entry.suitId }),
                ...(entry.suitName === undefined ? {} : { suitName: entry.suitName }),
                ...(entry.thumbnailFallbacks === undefined ? {} : { thumbnailFallbacks: entry.thumbnailFallbacks })
              })
        )
      }
      this.database.connection.prepare(`
        INSERT INTO metadata_dictionary_state
          (id, schema_version, provider, provider_version, game_version, generated_at, fetched_at)
        VALUES (1, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          schema_version = excluded.schema_version,
          provider = excluded.provider,
          provider_version = excluded.provider_version,
          game_version = excluded.game_version,
          generated_at = excluded.generated_at,
          fetched_at = excluded.fetched_at
      `).run(
        manifest.schemaVersion,
        manifest.provider,
        manifest.providerVersion,
        manifest.gameVersion ?? null,
        manifest.generatedAt ?? null,
        manifest.fetchedAt ?? fetchedAt
      )
    })
  }

  getActiveManifest(): MetadataDictionaryManifest | undefined {
    const state = this.database.connection.prepare(`
      SELECT schema_version, provider, provider_version, game_version, generated_at, fetched_at
      FROM metadata_dictionary_state WHERE id = 1
    `).get() as StateRow | undefined
    if (!state) return undefined
    const entries = this.database.connection.prepare(`
      SELECT kind, entity_id, name, category, rarity, thumbnail, raw_json
      FROM metadata_dictionary_entries
      ORDER BY kind, entity_id
    `).all() as EntryRow[]
    return {
      schemaVersion: 1,
      provider: state.provider,
      providerVersion: state.provider_version,
      ...(state.game_version === null ? {} : { gameVersion: state.game_version }),
      ...(state.generated_at === null ? {} : { generatedAt: state.generated_at }),
      ...(state.fetched_at === null ? {} : { fetchedAt: state.fetched_at }),
      entries: entries.map(entryFromRow)
    }
  }

  lookup(kind: MetadataDictionaryKind, id: string): MetadataDictionaryEntry | undefined {
    const row = this.database.connection.prepare(`
      SELECT kind, entity_id, name, category, rarity, thumbnail, raw_json
      FROM metadata_dictionary_entries WHERE kind = ? AND entity_id = ?
    `).get(kind, id) as EntryRow | undefined
    return row ? entryFromRow(row) : undefined
  }
}
