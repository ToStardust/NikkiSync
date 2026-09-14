import type { AssetState } from '@nikkisync/core'
import { ChangeJournalRepository } from './change-journal-repository.js'
import type { DatabaseManager } from './database-manager.js'
import type { AssetReconcileInput, AssetReconcileResult, CreateAssetInput } from './models.js'

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function mergeMetadata(base: unknown, incoming: unknown): unknown {
  if (!isObject(base)) return incoming
  if (!isObject(incoming)) return incoming === undefined ? base : incoming
  const result: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(incoming)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
    result[key] = isObject(value) && isObject(result[key]) ? mergeMetadata(result[key], value) : value
  }
  return result
}

export class AssetRepository {
  private readonly journal: ChangeJournalRepository

  constructor(private readonly database: DatabaseManager) {
    this.journal = new ChangeJournalRepository(database)
  }

  create(input: CreateAssetInput): number {
    return this.database.transaction(() => {
      const now = input.createdAt ?? new Date().toISOString()
      const revision = this.journal.record('asset.created', input.assetId)
      this.database.connection.prepare(`
        INSERT INTO assets (
          asset_id, asset_type, asset_state, game, uid, captured_at, discovered_at,
          metadata_schema_version, metadata_json, motion_presentation_timestamp_us,
          motion_resolver_method, motion_resolver_confidence, revision,
          created_at, updated_at
        ) VALUES (?, ?, ?, 'infinity_nikki', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.assetId,
        input.assetType,
        input.assetState ?? 'resolving',
        input.uid ?? null,
        input.capturedAt ?? null,
        input.discoveredAt,
        input.metadataSchemaVersion ?? null,
        input.metadata === undefined ? null : JSON.stringify(input.metadata),
        input.motionPresentationTimestampUs ?? null,
        input.motionResolverMethod ?? null,
        input.motionResolverConfidence ?? null,
        revision,
        now,
        now
      )
      return revision
    })
  }

  /** Idempotently reconcile an asset and all currently observed source resources. */
  reconcile(input: AssetReconcileInput): AssetReconcileResult {
    return this.database.transaction(() => {
      const now = input.createdAt ?? new Date().toISOString()
      const existing = this.getById(input.assetId)
      const existingResources = this.database.connection.prepare(
        'SELECT * FROM resources WHERE asset_id = ? ORDER BY resource_id'
      ).all(input.assetId) as Array<Record<string, unknown>>
      const resourceById = new Map(existingResources.map((row) => [String(row.resource_id), row]))
      const expectedIds = new Set(input.resources.map((resource) => resource.resourceId))
      const existingMetadata = existing?.metadata_json ? JSON.parse(String(existing.metadata_json)) : undefined
      const mergedMetadata = input.metadata === undefined ? existingMetadata : mergeMetadata(existingMetadata, input.metadata)
      const mergedMetadataJson = mergedMetadata === undefined ? null : JSON.stringify(mergedMetadata)
      const metadataSchemaVersion = input.metadataSchemaVersion ??
        (existing?.metadata_schema_version === null || existing?.metadata_schema_version === undefined
          ? undefined : Number(existing.metadata_schema_version))
      const capturedAt = input.capturedAt ??
        (existing?.captured_at === null || existing?.captured_at === undefined ? undefined : String(existing.captured_at))
      const metadataChanged = String(existing?.metadata_json ?? '') !== String(mergedMetadataJson ?? '') ||
        Number(existing?.metadata_schema_version ?? 0) !== Number(metadataSchemaVersion ?? 0)
      const assetChanged = !existing ||
        String(existing.asset_type) !== input.assetType ||
        String(existing.uid ?? '') !== String(input.uid ?? '') ||
        String(existing.captured_at ?? '') !== String(capturedAt ?? '') ||
        String(existing.asset_state) === 'deleted' || metadataChanged
      const resourcesChanged = input.resources.some((resource) => {
        const row = resourceById.get(resource.resourceId)
        if (!row) return true
        return Number(row.size_bytes) !== resource.sizeBytes ||
          String(row.sha256 ?? '') !== resource.sha256 ||
          String(row.modified_at ?? '') !== String(resource.modifiedAt ?? '') ||
          String(row.stable_state) !== (resource.stableState ?? 'stable') ||
          String(row.path_key) !== resource.pathKey
      }) || existingResources.some((row) => !expectedIds.has(String(row.resource_id)) && String(row.stable_state) !== 'missing')

      if (existing && !assetChanged && !resourcesChanged) return { kind: 'unchanged' }

      const event = existing ? 'asset.updated' : 'asset.created'
      const revision = this.journal.record(event, input.assetId, {
        resourceCount: input.resources.length,
        assetType: input.assetType
      }, now)
      if (!existing) {
        this.database.connection.prepare(`
          INSERT INTO assets (
            asset_id, asset_type, asset_state, game, uid, captured_at, discovered_at,
            metadata_schema_version, metadata_json, motion_presentation_timestamp_us,
            motion_resolver_method, motion_resolver_confidence, revision,
            created_at, updated_at
          ) VALUES (?, ?, ?, 'infinity_nikki', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          input.assetId, input.assetType, input.assetState ?? 'ready', input.uid ?? null,
          capturedAt ?? null, input.discoveredAt, metadataSchemaVersion ?? null,
          mergedMetadataJson,
          input.motionPresentationTimestampUs ?? null, input.motionResolverMethod ?? null,
          input.motionResolverConfidence ?? null, revision, now, now
        )
      } else {
        this.database.connection.prepare(`
          UPDATE assets SET asset_type = ?, asset_state = ?, uid = ?, captured_at = ?,
            discovered_at = ?, metadata_schema_version = ?, metadata_json = ?,
            motion_presentation_timestamp_us = ?, motion_resolver_method = ?,
            motion_resolver_confidence = ?, deleted_at = NULL, revision = ?, updated_at = ?
          WHERE asset_id = ?
        `).run(
          input.assetType, input.assetState ?? 'ready', input.uid ?? null, capturedAt ?? null,
          input.discoveredAt, metadataSchemaVersion ?? null,
          mergedMetadataJson,
          input.motionPresentationTimestampUs ?? null, input.motionResolverMethod ?? null,
          input.motionResolverConfidence ?? null, revision, now, input.assetId
        )
      }

      const upsert = this.database.connection.prepare(`
        INSERT INTO resources (
          resource_id, asset_id, role, file_name, source_path, path_key, mime_type, file_ext,
          size_bytes, sha256, width, height, duration_ms, modified_at, birth_time,
          stable_state, is_derived, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(resource_id) DO UPDATE SET
          role=excluded.role, file_name=excluded.file_name, source_path=excluded.source_path,
          path_key=excluded.path_key, mime_type=excluded.mime_type, file_ext=excluded.file_ext,
          size_bytes=excluded.size_bytes, sha256=excluded.sha256, width=excluded.width,
          height=excluded.height, duration_ms=excluded.duration_ms, modified_at=excluded.modified_at,
          birth_time=excluded.birth_time, stable_state=excluded.stable_state,
          is_derived=excluded.is_derived, updated_at=excluded.updated_at
      `)
      for (const resource of input.resources) {
        upsert.run(
          resource.resourceId, resource.assetId, resource.role, resource.fileName, resource.sourcePath,
          resource.pathKey, resource.mimeType, resource.fileExt, resource.sizeBytes, resource.sha256,
          resource.width ?? null, resource.height ?? null, resource.durationMs ?? null,
          resource.modifiedAt ?? null, resource.birthTime ?? null, resource.stableState ?? 'stable',
          resource.isDerived ? 1 : 0, resource.createdAt ?? now, now
        )
      }
      if (input.candidates) {
        const candidateUpsert = this.database.connection.prepare(`
          INSERT INTO resolver_candidates (
            still_resource_id, motion_resource_id, score, confidence, reasons_json, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(still_resource_id, motion_resource_id) DO UPDATE SET
            score=excluded.score, confidence=excluded.confidence, reasons_json=excluded.reasons_json,
            status=excluded.status, updated_at=excluded.updated_at
        `)
        for (const candidate of input.candidates) {
          candidateUpsert.run(candidate.stillResourceId, candidate.motionResourceId, candidate.score, candidate.confidence,
            JSON.stringify(candidate.reasons), candidate.status ?? 'pending', now, now)
        }
      }
      this.database.connection.prepare(
        `UPDATE resources SET stable_state = 'missing', updated_at = ? WHERE asset_id = ? AND resource_id NOT IN (${input.resources.length ? input.resources.map(() => '?').join(',') : "''"})`
      ).run(now, input.assetId, ...input.resources.map((resource) => resource.resourceId))
      return { kind: existing ? 'updated' : 'created', revision }
    })
  }

  /** Mark assets whose source paths belong to the scan roots but were not observed. */
  markMissingByRoots(observedAssetIds: Iterable<string>, roots: string[]): Array<{ assetId: string; revision: number }> {
    const observed = new Set(observedAssetIds)
    return this.database.transaction(() => {
      const rows = this.database.connection.prepare(
        `SELECT DISTINCT a.asset_id FROM assets a JOIN resources r ON r.asset_id = a.asset_id
         WHERE a.asset_state <> 'deleted' AND (${roots.map(() => 'r.path_key LIKE ?').join(' OR ') || '0'})`
      ).all(...roots.map((root) => `${root.replaceAll('\\', '/').toLowerCase().replace(/%/g, '%%')}%`)) as Array<Record<string, unknown>>
      const result: Array<{ assetId: string; revision: number }> = []
      for (const row of rows) {
        const assetId = String(row.asset_id)
        if (observed.has(assetId)) continue
        const revision = this.journal.record('asset.deleted', assetId, { reason: 'source_missing' })
        this.database.connection.prepare("UPDATE assets SET asset_state='deleted', deleted_at=?, revision=?, updated_at=? WHERE asset_id=?")
          .run(new Date().toISOString(), revision, new Date().toISOString(), assetId)
        this.database.connection.prepare("UPDATE resources SET stable_state='missing', updated_at=? WHERE asset_id=?")
          .run(new Date().toISOString(), assetId)
        result.push({ assetId, revision })
      }
      return result
    })
  }

  getById(assetId: string): Record<string, unknown> | undefined {
    return this.database.connection.prepare('SELECT * FROM assets WHERE asset_id = ?').get(assetId) as
      | Record<string, unknown>
      | undefined
  }

  list(): Record<string, unknown>[] {
    return this.database.connection.prepare(
      'SELECT * FROM assets ORDER BY captured_at DESC, asset_id ASC'
    ).all() as Record<string, unknown>[]
  }

  updateState(assetId: string, state: AssetState, updatedAt = new Date().toISOString()): number {
    return this.database.transaction(() => {
      if (!this.getById(assetId)) throw new Error(`Asset not found: ${assetId}`)
      const revision = this.journal.record('asset.updated', assetId, { state }, updatedAt)
      this.database.connection.prepare(
        'UPDATE assets SET asset_state = ?, revision = ?, updated_at = ? WHERE asset_id = ?'
      ).run(state, revision, updatedAt, assetId)
      return revision
    })
  }

  /** Merge user-editable canonical metadata without mutating any source media file. */
  updateMetadata(assetId: string, patch: unknown, updatedAt = new Date().toISOString()): number {
    return this.database.transaction(() => {
      const existing = this.getById(assetId)
      if (!existing) throw new Error(`Asset not found: ${assetId}`)
      const current = existing.metadata_json ? JSON.parse(String(existing.metadata_json)) : undefined
      const merged = mergeMetadata(current, patch)
      const revision = this.journal.record('asset.updated', assetId, { metadata: true }, updatedAt)
      this.database.connection.prepare(
        'UPDATE assets SET metadata_schema_version = ?, metadata_json = ?, revision = ?, updated_at = ? WHERE asset_id = ?'
      ).run(1, JSON.stringify(merged ?? {}), revision, updatedAt, assetId)
      return revision
    })
  }

  /** Assets that contain a native Infinity Nikki token. Resolver service decides whether cached enrichment is current. */
  listMetadataResolutionCandidates(limit = 50): Array<Record<string, unknown>> {
    return this.database.connection.prepare(`
      SELECT * FROM assets
      WHERE asset_state <> 'deleted'
        AND uid IS NOT NULL
        AND metadata_json IS NOT NULL
        AND json_extract(metadata_json, '$.raw.nativeParamToken') IS NOT NULL
      ORDER BY discovered_at ASC, asset_id ASC
      LIMIT ?
    `).all(limit) as Array<Record<string, unknown>>
  }

  softDelete(assetId: string, deletedAt = new Date().toISOString()): number {
    return this.database.transaction(() => {
      if (!this.getById(assetId)) throw new Error(`Asset not found: ${assetId}`)
      const revision = this.journal.record('asset.deleted', assetId, undefined, deletedAt)
      this.database.connection.prepare(
        "UPDATE assets SET asset_state = 'deleted', deleted_at = ?, revision = ?, updated_at = ? WHERE asset_id = ?"
      ).run(deletedAt, revision, deletedAt, assetId)
      return revision
    })
  }

  /** Maintenance-only physical deletion; normal sync deletion must use softDelete(). */
  hardDelete(assetId: string): void {
    this.database.connection.prepare('DELETE FROM assets WHERE asset_id = ?').run(assetId)
  }
}
