import { readFileSync } from 'node:fs'
import path from 'node:path'

type SqliteConnection = {
  exec(sql: string): void
  prepare(sql: string): { get(...values: unknown[]): any, all(...values: unknown[]): any[], run(...values: unknown[]): any }
  close(): void
}

type SqliteConstructor = new (filename: string) => SqliteConnection

// Bun's standalone executable deliberately implements `bun:sqlite` instead of
// Node 24's `node:sqlite`. Both APIs expose the synchronous subset we use.
const sqliteModuleName = process.versions.bun ? 'bun:sqlite' : 'node:sqlite'
const sqliteModule = await import(sqliteModuleName) as { Database?: SqliteConstructor, DatabaseSync?: SqliteConstructor }
const resolvedSqliteDatabase = sqliteModule.Database ?? sqliteModule.DatabaseSync
if (!resolvedSqliteDatabase) throw new Error(`No synchronous SQLite implementation was found in ${sqliteModuleName}`)
const SqliteDatabase: SqliteConstructor = resolvedSqliteDatabase

export class DatabaseManager {
  readonly connection: SqliteConnection

  constructor(filename = ':memory:') {
    const native = new SqliteDatabase(filename)
    if (process.versions.bun) {
      // Cache compiled SQL only, not rows. Keep the hot set bounded across scans.
      // Do not finalize on eviction: a caller may still be using that statement.
      const statements = new Map<string, ReturnType<SqliteConnection['prepare']>>()
      this.connection = {
        exec: native.exec.bind(native),
        prepare: sql => {
          let statement = statements.get(sql)
          if (statement) statements.delete(sql)
          else statement = native.prepare(sql)
          statements.set(sql, statement)
          if (statements.size > 64) statements.delete(statements.keys().next().value!)
          return statement
        },
        close: () => { statements.clear(); native.close() }
      }
    } else this.connection = native
    this.connection.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
  }

  initialize(schemaSql?: string): void {
    const migrationFile = process.versions.bun
      ? path.join(path.dirname(process.execPath), 'migrations', '0001_initial.sql')
      : new URL('../../migrations/0001_initial.sql', import.meta.url)
    const sql = schemaSql ?? readFileSync(migrationFile, 'utf8')
    this.connection.exec(sql)
  }

  transaction<T>(work: () => T): T {
    this.connection.exec('BEGIN IMMEDIATE')
    try {
      const result = work()
      this.connection.exec('COMMIT')
      return result
    } catch (error) {
      this.connection.exec('ROLLBACK')
      throw error
    }
  }

  close(): void {
    this.connection.close()
  }
}
