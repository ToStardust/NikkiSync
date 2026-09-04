import type { DatabaseManager } from './database-manager.js'

export class AppSettingsRepository {
  constructor(private readonly database: DatabaseManager) {}

  get<T>(key: string): T | undefined {
    const row = this.database.connection.prepare(
      'SELECT value_json FROM app_settings WHERE key = ?'
    ).get(key) as { value_json: string } | undefined
    if (!row) return undefined
    return JSON.parse(row.value_json) as T
  }

  set(key: string, value: unknown, updatedAt = new Date().toISOString()): void {
    this.database.connection.prepare(`
      INSERT INTO app_settings (key, value_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `).run(key, JSON.stringify(value), updatedAt)
  }
}
