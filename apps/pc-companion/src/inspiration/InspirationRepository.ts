import { createHash } from 'node:crypto'
import type { DatabaseManager } from '@nikkisync/database'

export interface InspirationImage { id:string; sha256:string; mimeType:string; bytes:number; addedAt:number }
export interface InspirationEntry {
  id:string; title:string; notes:string; tags:string[]; categories:string[]; status:string; createdAt:number; deletedAt:number
  code:{id:string;rawCode:string;type:string;sourceText:string;sourceUrl:string|null;parsedState:string;snapshotJson:string|null;resolverVersion:string|null;dictionaryVersion:string|null;resolvedAt:number}
  images:InspirationImage[]
}
export interface VersionedInspiration { revision:number; entry:InspirationEntry }
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
const SHA=/^[a-f0-9]{64}$/
const MAX_IMAGE=15*1024*1024
function object(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))throw Error('invalid_entry');return v as Record<string,unknown>}
function text(v:unknown,max:number):string{if(typeof v!=='string'||v.length>max)throw Error('invalid_entry');return v}
function nullable(v:unknown,max:number):string|null{return v==null?null:text(v,max)}
function integer(v:unknown):number{if(!Number.isSafeInteger(v)||Number(v)<0)throw Error('invalid_entry');return Number(v)}
function names(v:unknown):string[]{if(!Array.isArray(v)||v.length>30)throw Error('invalid_entry');return v.map(x=>text(x,60))}
function uuid(v:unknown):string{const s=text(v,36);if(!UUID.test(s))throw Error('invalid_entry');return s}
function imageMime(mime:string,data:Uint8Array):boolean{
  const b=Buffer.from(data)
  if(mime==='image/jpeg')return b.length>=3&&b[0]===0xff&&b[1]===0xd8&&b[2]===0xff
  if(mime==='image/png')return b.length>=8&&b.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
  if(mime==='image/webp')return b.length>=12&&b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WEBP'
  if(mime==='image/heic'||mime==='image/heif')return b.length>=12&&b.subarray(4,8).toString()==='ftyp'&&/^(heic|heix|hevc|hevx|mif1|msf1)$/.test(b.subarray(8,12).toString())
  return false
}

/** Per-entry optimistic revisions prevent offline writers from overwriting each other. */
export class InspirationRepository {
  constructor(private readonly db:DatabaseManager){
    db.connection.exec(`CREATE TABLE IF NOT EXISTS inspiration_sync_clock (id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL);
      INSERT OR IGNORE INTO inspiration_sync_clock(id,revision) VALUES(1,0);
      CREATE TABLE IF NOT EXISTS inspiration_sync_entries(id TEXT PRIMARY KEY,revision INTEGER NOT NULL,entry_json TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS inspiration_sync_images(sha256 TEXT PRIMARY KEY,mime_type TEXT NOT NULL,bytes BLOB NOT NULL,size_bytes INTEGER NOT NULL);`)
  }
  putImage(hash:string,mime:string,bytes:Uint8Array):void{
    if(!SHA.test(hash)||bytes.byteLength<1||bytes.byteLength>MAX_IMAGE)throw Error('invalid_image')
    if(createHash('sha256').update(bytes).digest('hex')!==hash)throw Error('image_hash')
    if(!imageMime(mime,bytes))throw Error('invalid_image')
    this.db.connection.prepare('INSERT OR IGNORE INTO inspiration_sync_images(sha256,mime_type,bytes,size_bytes) VALUES(?,?,?,?)').run(hash,mime,Buffer.from(bytes),bytes.byteLength)
    const existing=this.image(hash);if(!existing||existing.mimeType!==mime)throw Error('image_type')
  }
  image(hash:string):{mimeType:string;bytes:Buffer}|undefined{
    if(!SHA.test(hash))return undefined
    const row=this.db.connection.prepare('SELECT mime_type,bytes FROM inspiration_sync_images WHERE sha256=?').get(hash) as {mime_type:string;bytes:Uint8Array}|undefined
    return row?{mimeType:row.mime_type,bytes:Buffer.from(row.bytes)}:undefined
  }
  imageInfo(hash:string):{mimeType:string;size:number}|undefined{
    if(!SHA.test(hash))return undefined
    const row=this.db.connection.prepare('SELECT mime_type,size_bytes FROM inspiration_sync_images WHERE sha256=?').get(hash) as {mime_type:string;size_bytes:number}|undefined
    return row?{mimeType:row.mime_type,size:Number(row.size_bytes)}:undefined
  }
  get(id:string):VersionedInspiration|undefined{
    if(!UUID.test(id))return undefined
    const row=this.db.connection.prepare('SELECT revision,entry_json FROM inspiration_sync_entries WHERE id=?').get(id) as {revision:number;entry_json:string}|undefined
    return row?{revision:Number(row.revision),entry:JSON.parse(row.entry_json) as InspirationEntry}:undefined
  }
  list(after:string,limit:number):{items:VersionedInspiration[];nextCursor:string|null}{
    if(after&&!UUID.test(after))throw Error('invalid_cursor')
    if(!Number.isSafeInteger(limit)||limit<1||limit>100)throw Error('invalid_limit')
    const rows=this.db.connection.prepare('SELECT revision,entry_json,id FROM inspiration_sync_entries WHERE id>? ORDER BY id LIMIT ?').all(after,limit+1) as {revision:number;entry_json:string;id:string}[]
    const items=rows.slice(0,limit).map(row=>({revision:Number(row.revision),entry:JSON.parse(row.entry_json) as InspirationEntry}))
    return {items,nextCursor:rows.length>limit?rows[limit-1]!.id:null}
  }
  save(value:unknown,baseRevision:number):VersionedInspiration{
    const entry=this.validate(value);integer(baseRevision)
    const encoded=JSON.stringify(entry);if(Buffer.byteLength(encoded)>512*1024)throw Error('invalid_entry')
    return this.db.transaction(()=>{
      const previous=this.get(entry.id)
      if(previous&&JSON.stringify(previous.entry)===encoded)return previous
      if((previous?.revision??0)!==baseRevision)throw Error('conflict')
      for(const image of entry.images){const row=this.db.connection.prepare('SELECT size_bytes,mime_type FROM inspiration_sync_images WHERE sha256=?').get(image.sha256) as {size_bytes:number;mime_type:string}|undefined
        if(!row||Number(row.size_bytes)!==image.bytes||row.mime_type!==image.mimeType)throw Error('missing_image')}
      this.db.connection.prepare('UPDATE inspiration_sync_clock SET revision=revision+1 WHERE id=1').run()
      const clock=this.db.connection.prepare('SELECT revision FROM inspiration_sync_clock WHERE id=1').get() as {revision:number}
      this.db.connection.prepare('INSERT INTO inspiration_sync_entries(id,revision,entry_json) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,entry_json=excluded.entry_json').run(entry.id,clock.revision,encoded)
      return {revision:Number(clock.revision),entry}
    })
  }
  private validate(value:unknown):InspirationEntry{
    const v=object(value),c=object(v.code)
    const status=text(v.status,20),type=text(c.type,20),parsedState=text(c.parsedState,20)
    if(!['self','want','tried','reproduced','archived'].includes(status)||!['unknown','outfit','dye'].includes(type)||!['pending','success','failed','unsupported'].includes(parsedState))throw Error('invalid_entry')
    if(!Array.isArray(v.images)||v.images.length>64)throw Error('invalid_entry')
    const ids=new Set<string>();const images=v.images.map(item=>{const i=object(item),id=uuid(i.id),sha256=text(i.sha256,64),mimeType=text(i.mimeType,80),bytes=integer(i.bytes),addedAt=integer(i.addedAt)
      if(ids.has(id)||!SHA.test(sha256)||bytes<1||bytes>MAX_IMAGE)throw Error('invalid_entry');ids.add(id);return {id,sha256,mimeType,bytes,addedAt}})
    images.sort((a,b)=>a.addedAt-b.addedAt||a.id.localeCompare(b.id))
    const deletedAt=integer(v.deletedAt)
    const sourceUrl=nullable(c.sourceUrl,2000);if(sourceUrl&&!/^https?:\/\//i.test(sourceUrl))throw Error('invalid_entry')
    return {id:uuid(v.id),title:text(v.title,200),notes:text(v.notes,20000),tags:names(v.tags),categories:names(v.categories),status,createdAt:integer(v.createdAt),deletedAt,
      code:{id:uuid(c.id),rawCode:text(c.rawCode,20000),type,sourceText:text(c.sourceText,20000),sourceUrl,parsedState,snapshotJson:nullable(c.snapshotJson,262144),resolverVersion:nullable(c.resolverVersion,200),dictionaryVersion:nullable(c.dictionaryVersion,200),resolvedAt:integer(c.resolvedAt)},images:deletedAt?[]:images}
  }
}
