import type {DatabaseManager} from '@nikkisync/database'
/** Metadata can be large; version refreshes must not hydrate the whole catalogue. */
export function* versionAssetPages(database:DatabaseManager):Generator<Record<string,unknown>>{
  let after=''
  while(true){
    const rows=database.connection.prepare("SELECT asset_id,asset_state,captured_at,metadata_json FROM assets WHERE asset_state<>'deleted' AND asset_id>? ORDER BY asset_id LIMIT 500").all(after) as Record<string,unknown>[]
    if(!rows.length)return
    for(const row of rows)yield row
    after=String(rows[rows.length-1]!.asset_id)
    if(rows.length<500)return
  }
}
