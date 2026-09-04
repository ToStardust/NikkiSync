import type { DatabaseManager } from './database-manager.js'

export class ChangeJournalRepository {
  constructor(private readonly database: DatabaseManager) {}

  currentRevision(): number {
    const row = this.database.connection.prepare(
      'SELECT library_revision FROM library_state WHERE id = 1'
    ).get() as { library_revision: number }
    return row.library_revision
  }

  record(
    eventType: 'asset.created' | 'asset.updated' | 'asset.deleted',
    assetId: string,
    payload?: unknown,
    occurredAt = new Date().toISOString()
  ): number {
    const revision = this.currentRevision() + 1
    this.database.connection.prepare(
      'INSERT INTO change_journal (revision, event_type, asset_id, occurred_at, payload_json) VALUES (?, ?, ?, ?, ?)'
    ).run(revision, eventType, assetId, occurredAt, payload === undefined ? null : JSON.stringify(payload))
    this.database.connection.prepare(
      'UPDATE library_state SET library_revision = ?, updated_at = ? WHERE id = 1'
    ).run(revision, occurredAt)
    return revision
  }

  listAfter(revision: number): Record<string, unknown>[] {
    return this.database.connection.prepare(
      'SELECT * FROM change_journal WHERE revision > ? ORDER BY revision ASC'
    ).all(revision) as Record<string, unknown>[]
  }
}
