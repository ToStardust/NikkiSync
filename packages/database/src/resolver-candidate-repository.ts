import type { DatabaseManager } from './database-manager.js'
import type { ResolverCandidateInput } from './models.js'

export class ResolverCandidateRepository {
  constructor(private readonly database: DatabaseManager) {}

  upsert(input: ResolverCandidateInput, now = new Date().toISOString()): void {
    this.database.connection.prepare(`
      INSERT INTO resolver_candidates (
        still_resource_id, motion_resource_id, score, confidence, reasons_json, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(still_resource_id, motion_resource_id) DO UPDATE SET
        score = excluded.score,
        confidence = excluded.confidence,
        reasons_json = excluded.reasons_json,
        status = excluded.status,
        updated_at = excluded.updated_at
    `).run(
      input.stillResourceId,
      input.motionResourceId,
      input.score,
      input.confidence,
      JSON.stringify(input.reasons),
      input.status ?? 'pending',
      now,
      now
    )
  }

  listForStill(stillResourceId: string): Record<string, unknown>[] {
    return this.database.connection.prepare(
      'SELECT * FROM resolver_candidates WHERE still_resource_id = ? ORDER BY score DESC, motion_resource_id ASC'
    ).all(stillResourceId) as Record<string, unknown>[]
  }

  updateStatus(candidateId: number, status: 'pending' | 'accepted' | 'rejected'): void {
    this.database.connection.prepare(
      'UPDATE resolver_candidates SET status = ?, updated_at = ? WHERE candidate_id = ?'
    ).run(status, new Date().toISOString(), candidateId)
  }
}
