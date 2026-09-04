import { DatabaseManager } from '@nikkisync/database'
import { PROTOCOL_VERSION } from '@nikkisync/protocol'

export * from './game-directory-discovery.js'
export * from './runtime.js'
export * from './scanner/index.js'
export * from './server/index.js'

/** Shared PC Companion context. Scanner and local transport share the same SQLite source of truth. */
export interface PcCompanionContext {
  database: DatabaseManager
  protocolVersion: typeof PROTOCOL_VERSION
}

export function createPcCompanionContext(databaseFile = ':memory:'): PcCompanionContext {
  const database = new DatabaseManager(databaseFile)
  database.initialize()
  return { database, protocolVersion: PROTOCOL_VERSION }
}
