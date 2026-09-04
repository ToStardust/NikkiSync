import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

const schema = readFileSync(new URL('../migrations/0001_initial.sql', import.meta.url), 'utf8')
const database = new DatabaseSync(':memory:')
database.exec(schema)

const required = new Set([
  'assets', 'resources', 'resolver_candidates', 'change_journal', 'paired_devices',
  'device_sync_state', 'pairing_sessions', 'library_state', 'schema_migrations', 'app_settings'
])
const rows = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
const existing = new Set(rows.map((row) => row.name))
const missing = [...required].filter((name) => !existing.has(name))
if (missing.length > 0) throw new Error(`missing tables: ${missing.join(', ')}`)

const foreignKeys = database.prepare('PRAGMA foreign_key_check').all()
if (foreignKeys.length > 0) throw new Error(`foreign_key_check failed: ${JSON.stringify(foreignKeys)}`)
const quickCheck = database.prepare('PRAGMA quick_check').get()
if (quickCheck?.quick_check !== 'ok') throw new Error(`quick_check failed: ${JSON.stringify(quickCheck)}`)

console.log('schema OK')
console.log(`tables: ${[...existing].sort().join(', ')}`)
console.log('foreign_key_check: ok')
console.log('quick_check: ok')
database.close()
