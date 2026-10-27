import {AppSettingsRepository,ChangeJournalRepository,SyncReadRepository,sourceScopePredicate,type DatabaseManager} from '@nikkisync/database'
import {toPathKey} from '@nikkisync/core'
import type {ExtraScanRoot} from '../scanner/types.js'
import {createHash} from 'node:crypto'

const KEY='sync_account_selection'
interface Stored {uids:string[]|null;revision:number}
const SPINNING='source:spinning_momo'
const validKey=(uid:unknown):uid is string=>typeof uid==='string'&&(/^(?:\d{1,32})?$/.test(uid)||uid===SPINNING)
export const isSpinningMomoDirectory=(root:ExtraScanRoot)=>root.mode==='images'&&(root.source==='spinning_momo'||root.source===undefined&&/(?:^|[/\\])(?:SpinningMomo|旋转吧大喵)(?:[/\\]|$)/i.test(root.path))
/** Sharing scope only: never edits media, scanner roots, metadata or deletion history. */
export class AccountSyncSettings {
  private readonly settings:AppSettingsRepository
  private readonly reads:SyncReadRepository
  private sourceFingerprint:string|undefined
  constructor(private readonly database:DatabaseManager,private readonly directories:()=>readonly ExtraScanRoot[]=()=>[]){this.settings=new AppSettingsRepository(database);this.reads=new SyncReadRepository(database);try{this.sourceFingerprint=this.settings.get<string>(KEY+'_sources')}catch{this.sourceFingerprint=undefined}}
  sourceGroups(){
    const roots=this.directories().filter(isSpinningMomoDirectory).slice(0,16),prefixes=[...new Set(roots.map(root=>toPathKey(root.path)))].sort()
    const fingerprint=createHash('sha256').update(JSON.stringify(prefixes)).digest('hex')
    if(fingerprint!==this.sourceFingerprint){this.database.transaction(()=>{
      const uids=this.selection();if(uids!==undefined){const revision=new ChangeJournalRepository(this.database).record('asset.updated','__sync_account_scope__',{scope:true});this.settings.set(KEY,{uids,revision})}
      this.settings.set(KEY+'_sources',fingerprint)
    });this.sourceFingerprint=fingerprint}
    return roots.length?[{key:SPINNING,pathPrefixes:prefixes}]:[]
  }
  selection():string[]|undefined {try{const value=this.settings.get<Stored>(KEY);if(value===undefined||value?.uids===null)return undefined;return Array.isArray(value?.uids)&&value.uids.length<=200&&value.uids.every(validKey)?value.uids:[]}catch{return []}}
  revision():number{try{const value=this.settings.get<Stored>(KEY)?.revision;return typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?value:0}catch{return 0}}
  setSelection(value:unknown):void{
    if(value!==null&&(!Array.isArray(value)||value.length>200||!value.every(validKey)))throw new Error('invalid_accounts')
    const uids=value===null?null:[...new Set(value as string[])].sort()
    if(JSON.stringify(this.selection()??null)===JSON.stringify(uids))return
    this.database.transaction(()=>{
      const revision=new ChangeJournalRepository(this.database).record('asset.updated','__sync_account_scope__',{scope:true})
      this.settings.set(KEY,{uids,revision})
    })
  }
  sourceDirectoriesChanged():void{this.sourceGroups()}
  state(){
    const selection=this.selection()
    const sources=this.sourceGroups(),source=sourceScopePredicate(sources.flatMap(group=>group.pathPrefixes))
    const groups=this.database.connection.prepare(`SELECT COALESCE(uid,'') uid,COUNT(*) count FROM assets WHERE asset_state<>'deleted' AND NOT (${source.sql}) GROUP BY COALESCE(uid,'') ORDER BY COALESCE(uid,'')='' ASC,uid ASC`).all(...source.args) as {uid:string;count:number}[]
    const accounts=groups.map(row=>({...row,label:row.uid?'UID '+row.uid:'未识别 UID 的照片',selected:selection===undefined||selection.includes(row.uid),
      samples:(this.database.connection.prepare(`SELECT asset_id FROM assets WHERE asset_state<>'deleted' AND COALESCE(uid,'')=? AND NOT (${source.sql}) ORDER BY COALESCE(captured_at,discovered_at) DESC,asset_id LIMIT 3`).all(row.uid,...source.args) as {asset_id:string}[]).map(item=>item.asset_id)}))
    if(sources.length){const count=this.database.connection.prepare(`SELECT COUNT(*) count FROM assets WHERE asset_state<>'deleted' AND ${source.sql}`).get(...source.args) as {count:number};const samples=this.database.connection.prepare(`SELECT asset_id FROM assets WHERE asset_state<>'deleted' AND ${source.sql} ORDER BY COALESCE(captured_at,discovered_at) DESC,asset_id LIMIT 3`).all(...source.args) as {asset_id:string}[];accounts.push({uid:SPINNING,label:'旋转吧大喵',count:count.count,selected:selection===undefined||selection.includes(SPINNING),samples:samples.map(row=>row.asset_id)})}
    return {all:selection===undefined,accounts}
  }
  preview(assetId:string){
    if(!this.reads.getAsset(assetId))return undefined
    return this.reads.listResources(assetId).filter(r=>String(r.mime_type).startsWith('image/')).sort((a,b)=>{
      const rank=(r:Record<string,unknown>)=>['derived_thumbnail','source_low_quality','derived_preview','source_primary','source_high_quality'].indexOf(String(r.role))
      return (rank(a)<0?99:rank(a))-(rank(b)<0?99:rank(b))
    })[0]
  }
}
