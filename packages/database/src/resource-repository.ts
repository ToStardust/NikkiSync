import type { DatabaseManager } from './database-manager.js'
import type { CreateResourceInput } from './models.js'

export class ResourceRepository {
  constructor(private readonly database: DatabaseManager) {}

  create(input: CreateResourceInput): void {
    const now = input.createdAt ?? new Date().toISOString()
    this.database.connection.prepare(`
      INSERT INTO resources (
        resource_id, asset_id, role, file_name, source_path, path_key, mime_type,
        file_ext, size_bytes, sha256, width, height, duration_ms, modified_at,
        birth_time, stable_state, is_derived, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.resourceId,
      input.assetId,
      input.role,
      input.fileName,
      input.sourcePath,
      input.pathKey,
      input.mimeType,
      input.fileExt,
      input.sizeBytes,
      input.sha256,
      input.width ?? null,
      input.height ?? null,
      input.durationMs ?? null,
      input.modifiedAt ?? null,
      input.birthTime ?? null,
      input.stableState ?? 'stable',
      input.isDerived ? 1 : 0,
      now,
      now
    )
  }

  getById(resourceId: string): Record<string, unknown> | undefined {
    return this.database.connection.prepare('SELECT * FROM resources WHERE resource_id = ?').get(resourceId) as
      | Record<string, unknown>
      | undefined
  }

  listByAsset(assetId: string): Record<string, unknown>[] {
    return this.database.connection.prepare(
      'SELECT * FROM resources WHERE asset_id = ? ORDER BY role ASC, resource_id ASC'
    ).all(assetId) as Record<string, unknown>[]
  }

  delete(resourceId: string): void {
    this.database.connection.prepare('DELETE FROM resources WHERE resource_id = ?').run(resourceId)
  }
}
