import type { DatabaseManager } from './database-manager.js'

export interface AssetPageQuery {
  limit: number
  cursorTime?: string
  cursorAssetId?: string
  assetType?: string
  afterRevision?: number
  includeDeleted?: boolean
}

export class SyncReadRepository {
  constructor(private readonly database: DatabaseManager) {}

  currentRevision(): number {
    const row = this.database.connection.prepare(
      'SELECT library_revision FROM library_state WHERE id = 1'
    ).get() as { library_revision: number }
    return row.library_revision
  }

  listAssets(query: AssetPageQuery): Record<string, unknown>[] {
    const where: string[] = []
    const args: Array<string | number> = []
    if (!query.includeDeleted) where.push("asset_state <> 'deleted'")
    if (query.assetType) { where.push('asset_type = ?'); args.push(query.assetType) }
    if (query.afterRevision !== undefined) { where.push('revision > ?'); args.push(query.afterRevision) }
    if (query.cursorTime !== undefined && query.cursorAssetId !== undefined) {
      where.push('(COALESCE(captured_at, discovered_at) < ? OR (COALESCE(captured_at, discovered_at) = ? AND asset_id > ?))')
      args.push(query.cursorTime, query.cursorTime, query.cursorAssetId)
    }
    return this.database.connection.prepare(`
      SELECT * FROM assets
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY COALESCE(captured_at, discovered_at) DESC, asset_id ASC
      LIMIT ?
    `).all(...args, query.limit) as Record<string, unknown>[]
  }

  getAsset(assetId: string): Record<string, unknown> | undefined {
    return this.database.connection.prepare('SELECT * FROM assets WHERE asset_id = ?').get(assetId) as Record<string, unknown> | undefined
  }

  listResources(assetId: string): Record<string, unknown>[] {
    return this.database.connection.prepare('SELECT * FROM resources WHERE asset_id = ? ORDER BY role ASC, resource_id ASC').all(assetId) as Record<string, unknown>[]
  }

  getResource(assetId: string, resourceId: string): Record<string, unknown> | undefined {
    return this.database.connection.prepare('SELECT * FROM resources WHERE asset_id = ? AND resource_id = ?').get(assetId, resourceId) as Record<string, unknown> | undefined
  }

  listChangesAfter(revision: number, limit = 1000): Record<string, unknown>[] {
    return this.database.connection.prepare('SELECT * FROM change_journal WHERE revision > ? ORDER BY revision ASC LIMIT ?').all(revision, limit) as Record<string, unknown>[]
  }

  minimumJournalRevision(): number | undefined {
    const row = this.database.connection.prepare('SELECT MIN(revision) AS revision FROM change_journal').get() as { revision: number | null }
    return row.revision ?? undefined
  }
}
