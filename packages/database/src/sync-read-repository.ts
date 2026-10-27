import type { DatabaseManager } from './database-manager.js'

export interface AssetPageQuery {
  limit: number
  cursorTime?: string
  cursorAssetId?: string
  assetType?: string
  afterRevision?: number
  includeDeleted?: boolean
}

export interface SyncSourceScope {key:string;pathPrefixes:readonly string[]}
/** Prefixes are normalized path keys, and all values remain bound parameters. */
export function sourceScopePredicate(prefixes:readonly string[]):{sql:string;args:(string|number)[]}{
  if(!prefixes.length)return {sql:'0=1',args:[]}
  const args:(string|number)[]=[]
  const paths=prefixes.map(root=>{const prefix=root.replace(/\/+$/,'')+'/';args.push(root,prefix.length,prefix);return '(scope_resource.path_key=? OR substr(scope_resource.path_key,1,?)=?)'})
  return {sql:`EXISTS(SELECT 1 FROM resources scope_resource WHERE scope_resource.asset_id=assets.asset_id AND (${paths.join(' OR ')}))`,args}
}

export class SyncReadRepository {
  constructor(private readonly database: DatabaseManager,private readonly allowedUids?:()=>readonly string[]|undefined,private readonly sourceGroups?:()=>readonly SyncSourceScope[]) {}

  private scope():{sql:string;args:(string|number)[]}{
    const uids=this.allowedUids?.()
    if(uids===undefined)return {sql:'1=1',args:[]}
    const groups=this.sourceGroups?.()??[],normal=uids.filter(uid=>!uid.startsWith('source:'))
    const clauses:string[]=[],args:(string|number)[]=[]
    if(normal.length){const other=sourceScopePredicate(groups.flatMap(group=>[...group.pathPrefixes]));clauses.push(`(COALESCE(uid,'') IN (${normal.map(()=>'?').join(',')}) AND NOT (${other.sql}))`);args.push(...normal,...other.args)}
    for(const group of groups)if(uids.includes(group.key)){const match=sourceScopePredicate(group.pathPrefixes);clauses.push(`(${match.sql})`);args.push(...match.args)}
    return {sql:clauses.length?'('+clauses.join(' OR ')+')':'0=1',args}
  }

  currentRevision(): number {
    const row = this.database.connection.prepare(
      'SELECT library_revision FROM library_state WHERE id = 1'
    ).get() as { library_revision: number }
    return row.library_revision
  }

  listAssets(query: AssetPageQuery): Record<string, unknown>[] {
    const where: string[] = []
    const args: Array<string | number> = []
    const scope=this.scope();where.push(scope.sql);args.push(...scope.args)
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

  listSuitSearchAssets(): Record<string, unknown>[] {
    const scope=this.scope()
    return this.database.connection.prepare(`
      SELECT * FROM assets
      WHERE asset_state <> 'deleted' AND metadata_json IS NOT NULL AND ${scope.sql}
      ORDER BY COALESCE(captured_at, discovered_at) DESC, asset_id ASC
    `).all(...scope.args) as Record<string, unknown>[]
  }

  listSuitSearchResources(): Record<string, unknown>[] {
    const scope=this.scope()
    return this.database.connection.prepare(`
      SELECT resources.* FROM resources JOIN assets ON assets.asset_id=resources.asset_id
      WHERE ${scope.sql}
      ORDER BY resources.asset_id ASC, resources.role ASC, resources.resource_id ASC
    `).all(...scope.args) as Record<string, unknown>[]
  }

  getAsset(assetId: string): Record<string, unknown> | undefined {
    const scope=this.scope()
    return this.database.connection.prepare(`SELECT * FROM assets WHERE asset_id = ? AND ${scope.sql}`).get(assetId,...scope.args) as Record<string, unknown> | undefined
  }

  listResources(assetId: string): Record<string, unknown>[] {
    if(this.allowedUids&&!this.getAsset(assetId))return []
    return this.database.connection.prepare('SELECT * FROM resources WHERE asset_id = ? ORDER BY role ASC, resource_id ASC').all(assetId) as Record<string, unknown>[]
  }

  getResource(assetId: string, resourceId: string): Record<string, unknown> | undefined {
    if(this.allowedUids&&!this.getAsset(assetId))return undefined
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
