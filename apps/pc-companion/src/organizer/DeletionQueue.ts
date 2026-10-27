import {createHash,randomUUID} from 'node:crypto'
import {createReadStream} from 'node:fs'
import {lstat,realpath,readdir} from 'node:fs/promises'
import path from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {SyncReadRepository,type DatabaseManager} from '@nikkisync/database'
import {jpegImageLength} from '../scanner/JpegImageBoundary.js'
import {mediaFingerprint} from '../server/MediaFingerprint.js'
import {recycleMany as nativeRecycleMany} from './NativeMediaOperations.js'

export type FilePlan={path:string;sha256:string;size:number}
type Plan={files:FilePlan[];revision:number;mediaFingerprint?:string;batchVerification?:boolean}
export type FileResult={path:string;recycled:boolean;reason?:string}
export interface DeletionQueueOptions {
  exportsFor?:(source:string)=>FilePlan[]
  recycleMany?:(files:FilePlan[])=>Promise<FileResult[]>
  preview?:(file:FilePlan)=>Promise<Uint8Array>
}
type Work={kind:'prepare'|'execute';approval?:string}
type CatalogEntry={path:string;size:number;imageHash:string}
type Batch={catalog?:Promise<CatalogEntry[]>;recycled:Map<string,FilePlan>}
export type DeleteIntent={id:string;assetId:string;revision:number;cancel?:boolean;approval?:string;mediaFingerprint?:string;batchVerification?:boolean;resultAck?:boolean}
type Row={id:string;device:string;asset_id:string;state:string;plan:string;message:string;lease:number;approval:string;dismissed:number}
const within=(file:string,root:string)=>{const rel=path.relative(root,file);return rel!==''&&!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel)}
async function hash(file:string,end?:number):Promise<string>{const digest=createHash('sha256');for await(const bytes of createReadStream(file,end===undefined?{}:{end:end-1}))digest.update(bytes);return digest.digest('hex')}

/** Phone submits intent only. Execution is exposed exclusively by the authenticated loopback desktop API. */
export class DeletionQueue {
  private reads:SyncReadRepository
  private serial:Promise<unknown>=Promise.resolve()
  private needsRescan=false
  private jobs=new Map<string,Work>()
  private inFlight=new Set<string>()
  private worker:Promise<void>|undefined
  private closing=false
  private previews=new Map<string,{promise:Promise<Uint8Array>;bytes?:Uint8Array}>()
  private previewBytes=0
  private metrics={catalogPasses:0,catalogImages:0,prepared:0,recycled:0,failedBatches:0}
  constructor(private db:DatabaseManager,private roots:()=>string[],private rescan:()=>Promise<unknown>,
    private recycle:(file:FilePlan)=>Promise<void>=recycleFile,private clock=()=>Date.now(),private batchFiles:(work:()=>Promise<void>)=>Promise<void>=work=>work(),private options:DeletionQueueOptions={}){
    this.reads=new SyncReadRepository(db)
    db.connection.exec(`CREATE TABLE IF NOT EXISTS organizer_deletions(id TEXT PRIMARY KEY,device TEXT NOT NULL,asset_id TEXT NOT NULL,state TEXT NOT NULL,plan TEXT NOT NULL,message TEXT NOT NULL,lease INTEGER NOT NULL,approval TEXT NOT NULL DEFAULT '')`)
    if(!db.connection.prepare('PRAGMA table_info(organizer_deletions)').all().some(row=>row.name==='approval'))db.connection.exec("ALTER TABLE organizer_deletions ADD COLUMN approval TEXT NOT NULL DEFAULT ''")
    if(!db.connection.prepare('PRAGMA table_info(organizer_deletions)').all().some(row=>row.name==='dismissed'))db.connection.exec('ALTER TABLE organizer_deletions ADD COLUMN dismissed INTEGER NOT NULL DEFAULT 0')
    // A process interruption may have recycled a subset. Never replay an uncertain deletion automatically.
    db.connection.prepare("UPDATE organizer_deletions SET state='failed',message='上次处理被中断，请检查回收站后重新选择',lease=0 WHERE state='executing'").run()
    db.connection.prepare("UPDATE organizer_deletions SET state='pending',approval='',message='电脑重启，请重新确认',lease=0 WHERE state IN ('confirming','queued','checking')").run()
    db.connection.prepare("UPDATE organizer_deletions SET lease=0 WHERE state='preparing'").run()
  }
  private lock<T>(work:()=>Promise<T>):Promise<T>{const next=this.serial.then(work);this.serial=next.catch(()=>{});return next}
  activity(){return {...this.metrics,queued:this.jobs.size,active:this.inFlight.size}}
  async idle(){while(this.worker)await this.worker}
  async stop(){this.closing=true;this.jobs.clear();await this.serial;await this.idle();this.previews.clear();this.previewBytes=0}
  private row(id:string){return this.db.connection.prepare('SELECT * FROM organizer_deletions WHERE id=?').get(id) as Row|undefined}
  private enqueue(id:string,work:Work){
    if(this.closing||this.jobs.has(id)||(work.kind==='prepare'&&this.inFlight.has(id)))return
    this.jobs.set(id,work)
    this.wake()
  }
  private wake(){
    if(this.closing||this.worker||!this.jobs.size)return
    this.worker=new Promise<void>(resolve=>setImmediate(resolve)).then(()=>this.drain()).catch(()=>{
      this.metrics.failedBatches++
      for(const id of this.inFlight)try{const row=this.row(id);if(row&&['preparing','checking','executing'].includes(row.state))this.finish(id,'failed','处理被中断，请检查回收站；不会自动重试删除')}catch{}
    }).finally(()=>{this.inFlight.clear();this.worker=undefined;this.wake()})
  }
  private async drain(){
    await this.batchFiles(async()=>{
    while(this.jobs.size&&!this.closing){
      const work=[...this.jobs];this.jobs.clear();for(const [id] of work)this.inFlight.add(id)
      // One exact-image catalogue for the whole pass, rather than a complete album read for every photo.
      const batch:Batch={recycled:new Map()}
      const completedGroups=new Set<string>()
      for(const [id,job] of work){
        if(this.closing)break
        try{
          const row=this.row(id);if(!row)continue
          if(job.kind==='prepare'&&row.state==='preparing'){
            try{
              const requested=JSON.parse(row.plan) as Plan
              const plan=await this.plan(row.asset_id,requested.revision,batch,requested)
              if(!this.closing&&this.row(id)?.state==='preparing'){
                this.db.connection.prepare("UPDATE organizer_deletions SET plan=?,state='pending',message='等待电脑确认' WHERE id=?").run(JSON.stringify(plan),id);this.metrics.prepared++
              }
            }catch{if(!this.closing&&this.row(id)?.state==='preparing')this.finish(id,'changed','照片或扫描范围已变化，请重新同步后选择')}
          }else if(job.kind==='execute'&&row.state==='queued'&&row.approval===job.approval){
            if(row.approval.startsWith('authorized:')){
              if(!completedGroups.has(row.approval)){
                completedGroups.add(row.approval)
                const group=work.filter(([,next])=>next.kind==='execute'&&next.approval===row.approval).map(([key])=>this.row(key)).filter((item):item is Row=>!!item&&item.state==='queued'&&item.approval===row.approval)
                await this.executeGroup(group)
              }
            }else await this.execute(row,batch)
          }
        }finally{this.inFlight.delete(id)}
      }
      if(this.needsRescan&&!this.jobs.size){this.needsRescan=false;await this.rescan().catch(()=>{})}
    }
    })
  }
  async preview(id:string){
    const row=this.db.connection.prepare('SELECT plan FROM organizer_deletions WHERE id=?').get(id) as {plan:string}|undefined
    if(!row)return undefined
    const plan=JSON.parse(row.plan) as Plan
    const file=[...plan.files].sort((a,b)=>a.size-b.size).find(item=>/\.(jpe?g|png|webp)$/i.test(item.path)&&item.size<=256*1024*1024)
    if(!file)return undefined
    if(!this.options.preview){try{await this.checkFile(file);return file.size<=32*1024*1024?file:undefined}catch{return undefined}}
    const key=createHash('sha256').update(JSON.stringify(file)).digest('hex')
    let entry=this.previews.get(key)
    if(entry){this.previews.delete(key);this.previews.set(key,entry)}
    else{
      const pending={promise:Promise.resolve(new Uint8Array())} as {promise:Promise<Uint8Array>;bytes?:Uint8Array}
      pending.promise=(async()=>{
        await this.checkFile(file);const bytes=await this.options.preview!(file)
        if(bytes.byteLength<4||bytes.byteLength>2*1024*1024||bytes[0]!==255||bytes[1]!==216)throw new Error('preview')
        if(this.previews.get(key)===pending){pending.bytes=bytes;this.previewBytes+=bytes.byteLength;while(this.previews.size>96||this.previewBytes>32*1024*1024){const oldest=this.previews.keys().next().value!;const previous=this.previews.get(oldest);this.previews.delete(oldest);this.previewBytes-=previous?.bytes?.byteLength??0}}
        return bytes
      })().catch(error=>{if(this.previews.get(key)===pending)this.previews.delete(key);throw error})
      entry=pending;this.previews.set(key,pending)
    }
    try{return {bytes:await entry.promise,mimeType:'image/jpeg' as const}}catch{return undefined}
  }
  list(device?:string,requested?:Set<string>){
    const active="state IN ('preparing','pending','confirming','queued','checking','executing')"
    const rows=device?(requested?this.db.connection.prepare(`SELECT * FROM organizer_deletions WHERE device=? AND (${active}${requested.size?' OR id IN ('+[...requested].map(()=>'?').join(',')+')':''})`).all(device,...requested):this.db.connection.prepare('SELECT * FROM organizer_deletions WHERE device=?').all(device)):
      this.db.connection.prepare(`SELECT * FROM organizer_deletions WHERE dismissed=0 AND (${active} OR id IN (SELECT id FROM organizer_deletions WHERE dismissed=0 ORDER BY rowid DESC LIMIT 50))`).all()
    return rows.map(raw=>{
    const row=raw as Row;const plan=JSON.parse(row.plan) as Plan
    return {id:row.id,assetId:row.asset_id,state:row.state,message:row.message,online:row.lease>this.clock()-45_000,resultAcknowledged:!!row.dismissed,batchVerified:row.approval.startsWith('authorized:'),batchVerification:!!plan.batchVerification,previewVersion:plan.mediaFingerprint??createHash('sha256').update(JSON.stringify(plan.files)).digest('hex'),...(device&&row.state==='confirming'?{approval:row.approval}:{}),
      files:plan.files.map(file=>({name:path.basename(file.path),size:file.size,...(!device?{folder:path.basename(path.dirname(file.path))}:{})})),count:plan.files.length}
  })}
  async sync(device:string,intents:DeleteIntent[]){return this.lock(async()=>{
    if(this.closing)throw new Error('stopping')
    if(!Array.isArray(intents)||intents.length>500)throw new Error('invalid_intents')
    const seen=new Set<string>(),received=this.clock(),existing=new Map<string,Row>()
    for(const item of intents){
      if(!item||typeof item.id!=='string'||!/^[a-zA-Z0-9-]{16,64}$/.test(item.id)||typeof item.assetId!=='string'||!/^asset_[a-zA-Z0-9_-]+$/.test(item.assetId)||!Number.isSafeInteger(item.revision)||item.revision<0||typeof(item.cancel??false)!=='boolean'||seen.has(item.id))throw new Error('invalid_intents')
      if(item.mediaFingerprint!==undefined&&!/^[a-f0-9]{64}$/.test(item.mediaFingerprint)||item.batchVerification!==undefined&&typeof item.batchVerification!=='boolean'||item.resultAck!==undefined&&typeof item.resultAck!=='boolean')throw new Error('invalid_intents')
      seen.add(item.id);const row=this.row(item.id)
      if(row){if(row.device!==device||row.asset_id!==item.assetId)throw new Error('invalid_intents');existing.set(item.id,row)}
    }
    // Apply all cancellations before scheduling any filesystem work; long hashing/native calls never hold this lock.
    for(const item of intents)if(item.cancel){const row=existing.get(item.id);if(row&&['preparing','pending','confirming','queued','checking'].includes(row.state)){this.finish(item.id,'cancelled','手机已取消');this.jobs.delete(item.id)}}
    const approvals=new Set<string>()
    for(const item of intents){
      const row=existing.get(item.id)
      if(row){
        if(item.resultAck&&['changed','failed','recycled','cancelled','rejected'].includes(row.state))this.db.connection.prepare('UPDATE organizer_deletions SET dismissed=1 WHERE id=?').run(item.id)
        if(!item.cancel&&!row.approval.startsWith('authorized:')&&['confirming','queued','checking'].includes(row.state)&&row.lease<received-60_000){
          this.db.connection.prepare("UPDATE organizer_deletions SET state='pending',approval='',message='手机连接已中断，请重新确认' WHERE id=?").run(item.id);this.jobs.delete(item.id)
        }else if(!item.cancel&&row.state==='confirming'&&item.approval===row.approval&&row.approval){
          if(row.approval.startsWith('batch:'))approvals.add(row.approval)
          else{this.finish(item.id,'queued','手机已核对，正在排队处理');this.enqueue(item.id,{kind:'execute',approval:row.approval})}
        }else if(!item.cancel&&row.state==='preparing')this.enqueue(item.id,{kind:'prepare'})
        continue
      }
      if(item.resultAck)continue
      const count=this.db.connection.prepare("SELECT count(*) AS n FROM organizer_deletions WHERE device=? AND state IN ('preparing','pending','confirming','queued','checking','executing')").get(device) as {n:number}
      if(count.n>=500)throw new Error('queue_full')
      const files=item.cancel?[]:this.reads.listResources(item.assetId).filter(resource=>/^source_/.test(String(resource.role))&&/\.(jpe?g|png|webp|mp4)$/i.test(String(resource.source_path))).map(resource=>({path:String(resource.source_path),sha256:String(resource.sha256),size:Number(resource.size_bytes)}))
      this.db.connection.prepare('INSERT INTO organizer_deletions(id,device,asset_id,state,plan,message,lease) VALUES(?,?,?,?,?,?,?)').run(item.id,device,item.assetId,item.cancel?'cancelled':'preparing',JSON.stringify({files,revision:item.revision,...(item.mediaFingerprint?{mediaFingerprint:item.mediaFingerprint}:{}),...(item.batchVerification?{batchVerification:true}:{})}),item.cancel?'手机已取消':'正在核对关联文件',received)
      if(!item.cancel)this.enqueue(item.id,{kind:'prepare'})
    }
    const submitted=new Map(intents.map(item=>[item.id,item]))
    for(const approval of approvals){
      const group=this.db.connection.prepare("SELECT * FROM organizer_deletions WHERE device=? AND state='confirming' AND approval=?").all(device,approval) as Row[]
      if(!group.length||!group.every(row=>{const item=submitted.get(row.id);return item&&!item.cancel&&item.approval===approval&&row.lease>=received-60_000}))continue
      const authorized='authorized:'+approval.slice(6)
      for(const row of group){this.db.connection.prepare("UPDATE organizer_deletions SET state='queued',approval=?,message='整批已由手机核对，自动处理，无需逐张保持连接' WHERE id=? AND state='confirming'").run(authorized,row.id);this.enqueue(row.id,{kind:'execute',approval:authorized})}
    }
    // A signed request is a heartbeat for this device's whole batch, including jobs already being checked.
    this.db.connection.prepare("UPDATE organizer_deletions SET lease=? WHERE device=? AND state IN ('preparing','pending','confirming','queued','checking','executing')").run(received,device)
    return this.list(device,seen)
  })}
  async dismiss(ids:string[],allFailures=false){return this.lock(async()=>{
    if(!Array.isArray(ids)||!ids.length||ids.length>500||ids.some(id=>typeof id!=='string'||!/^[a-zA-Z0-9-]{16,64}$/.test(id)))throw new Error('invalid_ids')
    this.db.transaction(()=>{if(allFailures)this.db.connection.prepare("UPDATE organizer_deletions SET dismissed=1 WHERE state IN ('changed','failed')").run();else for(const id of new Set(ids))this.db.connection.prepare("UPDATE organizer_deletions SET dismissed=1 WHERE id=? AND state IN ('changed','failed','recycled','cancelled','rejected')").run(id)})
    return {items:this.list()}
  })}
  private pauseIfOffline(row:Row){
    const latest=this.row(row.id)
    if(!latest||latest.state!=='checking'||latest.approval!==row.approval)return true
    if(latest.lease<this.clock()-60_000){
      this.db.connection.prepare("UPDATE organizer_deletions SET state='pending',approval='',message='手机已离线，尚未执行；重连后请重新确认' WHERE id=?").run(row.id)
      return true
    }
    return false
  }
  async decide(id:string,approve:boolean){return this.lock(async()=>{
    const row=this.db.connection.prepare('SELECT * FROM organizer_deletions WHERE id=?').get(id) as Row|undefined
    if(this.closing||!row||!['preparing','pending','confirming','queued','checking'].includes(row.state))throw new Error('not_pending')
    if(!approve){this.finish(id,'rejected','电脑已取消');this.jobs.delete(id);return this.list()}
    if(!['pending','confirming'].includes(row.state))throw new Error('not_pending')
    if(row.lease<this.clock()-45_000)throw new Error('phone_offline')
    this.db.connection.prepare("UPDATE organizer_deletions SET state='confirming',approval=?,message='电脑已确认，等待手机核对取消记录',lease=? WHERE id=?").run((JSON.parse(row.plan) as Plan).batchVerification?'batch:'+randomUUID():randomUUID(),this.clock(),id)
    return this.list()
  })}
  async approveMany(ids:string[]){return this.lock(async()=>{
    if(this.closing)throw new Error('stopping')
    if(!Array.isArray(ids)||ids.length<1||ids.length>500||ids.some(id=>typeof id!=='string'||!/^[a-zA-Z0-9-]{16,64}$/.test(id))||new Set(ids).size!==ids.length)throw new Error('invalid_ids')
    const now=this.clock();let approved=0;const challenges=new Map<string,string>()
    this.db.transaction(()=>{
      for(const id of ids){
        const row=this.db.connection.prepare('SELECT * FROM organizer_deletions WHERE id=?').get(id) as Row|undefined
        // Approve the explicit snapshot only. Offline, cancelled, completed and
        // already-confirming records cannot be added or have their challenge reset.
        if(!row||row.state!=='pending'||row.lease<=now-45_000)continue
        const modern=(JSON.parse(row.plan) as Plan).batchVerification
        let challenge=modern?challenges.get(row.device):undefined;if(!challenge){challenge=modern?'batch:'+randomUUID():randomUUID();if(modern)challenges.set(row.device,challenge)}
        this.db.connection.prepare("UPDATE organizer_deletions SET state='confirming',approval=?,message='电脑已确认，等待手机核对整批取消记录',lease=? WHERE id=?").run(challenge,now,id)
        approved++
      }
    })
    return {items:this.list(),approved,skipped:ids.length-approved}
  })}
  private async execute(row:Row,batch:Batch){
    const id=row.id,plan=JSON.parse(row.plan) as Plan
    this.finish(id,'checking','正在核对关联文件')
    if(this.pauseIfOffline(row))return
    const remaining=plan.files.filter(file=>!this.credited(file,batch))
    try{
      const current=remaining.length?await this.plan(row.asset_id,plan.revision,batch,plan):{...plan,files:[]}
      if(JSON.stringify(current)!==JSON.stringify({...plan,files:remaining}))throw new Error('changed')
      // All files are checked before any operation. The native helper also rechecks each file immediately before recycling.
      for(const file of remaining)await this.validate(file)
    }catch{if(!this.closing&&this.row(id)?.state==='checking')this.finish(id,'changed','文件已变化，未执行删除；请重新同步后选择');return}
    if(this.closing||this.pauseIfOffline(row))return
    this.finish(id,'executing','正在移入回收站')
    let completed=0
    try{for(const file of remaining){if(this.closing)throw new Error('stopping');await this.validate(file);await this.recycle(file);completed++;this.finish(id,'executing',`正在移入回收站 ${completed}/${remaining.length} 个文件`)}this.finish(id,'recycled','已移入电脑回收站，可从回收站恢复');for(const file of plan.files)batch.recycled.set(file.path.toLowerCase(),file);this.metrics.recycled++}
    catch{
      const missing=(await Promise.all(remaining.map(file=>lstat(file.path).then(()=>false,()=>true)))).some(Boolean)
      this.finish(id,'failed',missing?`已确认回收 ${completed}/${remaining.length} 个文件，部分处理结果需检查电脑回收站；未继续处理其余文件`:'无法移入回收站，原文件保留；不会永久删除')
    }
    this.needsRescan=true
  }
  private async executeGroup(rows:Row[]){
    const ready:Array<{row:Row;plan:Plan}>=[]
    for(const row of rows){
      if(this.closing)return
      const latest=this.row(row.id);if(!latest||latest.state!=='queued'||latest.approval!==row.approval)continue
      this.finish(row.id,'checking','整批已核对，正在准备回收，无需继续保持手机连接')
      const plan=JSON.parse(row.plan) as Plan
      try{
        const asset=this.reads.getAsset(row.asset_id),resources=this.reads.listResources(row.asset_id)
        if(!asset||asset.asset_state==='deleted'||(plan.mediaFingerprint?mediaFingerprint(resources)!==plan.mediaFingerprint:Number(asset.revision)!==plan.revision))throw new Error('changed')
        for(const file of plan.files)await this.checkFile(file)
        if(!this.closing&&this.row(row.id)?.state==='checking')ready.push({row,plan})
      }catch{if(this.row(row.id)?.state==='checking')this.finish(row.id,'changed','照片文件或同步范围已变化，未执行删除；请重新选择')}
    }
    if(this.closing)return
    const selected=ready.filter(item=>this.row(item.row.id)?.state==='checking'&&this.row(item.row.id)?.approval===item.row.approval)
    const files=new Map<string,FilePlan>()
    for(const item of selected)for(const file of item.plan.files){
      const old=files.get(file.path.toLowerCase());if(old&&(old.sha256!==file.sha256||old.size!==file.size)){for(const candidate of selected)this.finish(candidate.row.id,'changed','本批关联文件已变化，未执行删除；请重新选择');return}
      files.set(file.path.toLowerCase(),file)
    }
    if(!selected.length)return
    for(const item of selected)this.finish(item.row.id,'executing','手机已核对本批，正在批量移入回收站；可关闭 App')
    const outcomes=new Map<string,FileResult>(),all=[...files.values()]
    for(let start=0;start<all.length&&!this.closing;start+=1000){
      const chunk=all.slice(start,start+1000)
      try{
        if(this.options.recycleMany||this.recycle===recycleFile){
          const results=await (this.options.recycleMany??nativeRecycleMany)(chunk),expected=new Set(chunk.map(file=>file.path.toLowerCase()))
          const seen=new Set<string>()
          if(!Array.isArray(results)||results.length>chunk.length)throw new Error('invalid_result')
          for(const result of results){
            if(!result||typeof result.path!=='string'||!expected.has(result.path.toLowerCase())||seen.has(result.path.toLowerCase())||typeof result.recycled!=='boolean')throw new Error('invalid_result')
            seen.add(result.path.toLowerCase())
            // A successful helper reply must also agree with the filesystem. Access
            // errors or a replacement file are uncertain, never reported as success.
            const gone=result.recycled&&await lstat(result.path).then(()=>false,error=>(error as NodeJS.ErrnoException).code==='ENOENT')
            outcomes.set(result.path.toLowerCase(),result.recycled&&!gone?{...result,recycled:false,reason:'unconfirmed'}:result)
          }
        }else{
          for(const file of chunk){try{await this.validate(file);await this.recycle(file);outcomes.set(file.path.toLowerCase(),{path:file.path,recycled:true})}catch{outcomes.set(file.path.toLowerCase(),{path:file.path,recycled:false,reason:'changed'})}}
        }
      }catch{for(const file of chunk)outcomes.set(file.path.toLowerCase(),{path:file.path,recycled:false,reason:'interrupted'})}
    }
    for(const item of selected){
      const results=item.plan.files.map(file=>outcomes.get(file.path.toLowerCase())),done=results.filter(result=>result?.recycled).length
      if(done===item.plan.files.length){this.finish(item.row.id,'recycled','已移入电脑回收站，可从回收站恢复');this.metrics.recycled++}
      else if(done===0&&results.some(result=>result?.reason==='changed'))this.finish(item.row.id,'changed','文件内容已变化，原文件保留；请重新同步后选择')
      else this.finish(item.row.id,'failed',done?`已回收 ${done}/${item.plan.files.length} 个文件，其余未处理；请检查回收站，不会自动重试`:'本批部分文件未能回收，请检查原位置及回收站；不会永久删除或自动重试')
    }
    this.needsRescan=true
  }
  private finish(id:string,state:string,message:string){this.db.connection.prepare('UPDATE organizer_deletions SET state=?,message=? WHERE id=?').run(state,message,id)}
  private credited(file:FilePlan,batch:Batch){const done=batch.recycled.get(file.path.toLowerCase());return done?.sha256===file.sha256&&done.size===file.size}
  private async safe(file:string){
    if(!path.isAbsolute(file))throw new Error('scope')
    const full=path.resolve(file),physical=await realpath(full)
    if(physical.toLowerCase()!==full.toLowerCase()||(await lstat(full)).isSymbolicLink())throw new Error('link')
    let allowed=false
    for(const root of this.roots())if(within(full,path.resolve(root))&&within(physical,await realpath(root)))allowed=true
    if(!allowed)throw new Error('scope')
    const info=await lstat(full);if(!info.isFile()||info.nlink>1)throw new Error('not_regular')
    return info
  }
  private async validate(file:FilePlan){const info=await this.safe(file.path);if(info.size!==file.size||await hash(file.path)!==file.sha256)throw new Error('changed')}
  private async checkFile(file:FilePlan){const info=await this.safe(file.path);if(info.size!==file.size)throw new Error('changed')}
  private async plan(assetId:string,revision:number,batch:Batch,requested?:Plan):Promise<Plan>{
    const asset=this.reads.getAsset(assetId)
    const all=this.reads.listResources(assetId)
    if(!asset||asset.asset_state==='deleted'||(requested?.mediaFingerprint?mediaFingerprint(all)!==requested.mediaFingerprint:Number(asset.revision)!==revision))throw new Error('changed')
    const resources=all.filter(resource=>/^source_/.test(String(resource.role))&&resource.stable_state==='stable')
    if(!resources.length||resources.length>24)throw new Error('resources')
    const files:FilePlan[]=[];const imageHashes=new Set<string>()
    for(const resource of resources){
      const file={path:String(resource.source_path),sha256:String(resource.sha256),size:Number(resource.size_bytes)}
      if(!/\.(jpe?g|png|webp|mp4)$/i.test(file.path)||!/^source_/.test(String(resource.role))||!/[a-f0-9]{64}/.test(file.sha256))throw new Error('resource')
      if(this.credited(file,batch))continue
      if(requested?.batchVerification)await this.checkFile(file);else await this.validate(file);files.push(file)
      if(String(resource.role)==='source_high_quality'&&/[/\\]NikkiPhotos_HighQuality[/\\]/i.test(file.path)&&/\.jpe?g$/i.test(file.path)){
        if(this.options.exportsFor){for(const copy of this.options.exportsFor(file.path)){await this.checkFile(copy);files.push(copy)}}
        else{const end=await jpegImageLength(file.path,file.size);if(end)imageHashes.add(await hash(file.path,end))}
      }
    }
    // Export duplicates were suppressed by the scanner; include only exact image-byte matches, never filename guesses.
    if(imageHashes.size){
      const catalog=await(batch.catalog??=this.catalog())
      for(const entry of catalog)if(imageHashes.has(entry.imageHash)&&!batch.recycled.has(entry.path.toLowerCase())){
        // Catalogue matches are hints only. Recheck selected image bytes and full fingerprint before adding them.
        const info=await this.safe(entry.path),end=await jpegImageLength(entry.path,info.size)
        if(info.size!==entry.size||!end||!imageHashes.has(await hash(entry.path,end)))throw new Error('changed')
        files.push({path:entry.path,size:info.size,sha256:await hash(entry.path)})
      }
    }
    const unique=[...new Map(files.map(file=>[file.path.toLowerCase(),file])).values()].sort((a,b)=>a.path.localeCompare(b.path))
    if(unique.length>100)throw new Error('too_many_files')
    return {files:unique,revision,...(requested?.mediaFingerprint?{mediaFingerprint:requested.mediaFingerprint}:{}),...(requested?.batchVerification?{batchVerification:true}:{})}
  }
  private async catalog():Promise<CatalogEntry[]>{
    this.metrics.catalogPasses++;let visited=0;const result:CatalogEntry[]=[]
    const walk=async(dir:string):Promise<void>=>{for(const entry of await readdir(dir,{withFileTypes:true})){
      if(++visited>100000)throw new Error('too_many_files')
      if(this.closing)throw new Error('stopping')
      const file=path.join(dir,entry.name);if(entry.isSymbolicLink())continue
      if(entry.isDirectory()){await walk(file);continue}
      if(!entry.isFile()||!/\.jpe?g$/i.test(file))continue
      const info=await this.safe(file),end=await jpegImageLength(file,info.size)
      if(end){this.metrics.catalogImages++;result.push({path:file,size:info.size,imageHash:await hash(file,end)})}
    }}
    for(const root of this.roots())if(/^ScreenShot$/i.test(path.basename(root)))await walk(root)
    return result
  }
}
async function recycleFile(file:FilePlan):Promise<void>{
  const helper=process.env.NIKKISYNC_RECYCLE_HELPER
  if(process.platform!=='win32'||!helper||!path.isAbsolute(helper))throw new Error('recycle_unavailable')
  await promisify(execFile)(helper,['--recycle-file',file.path,file.sha256,String(file.size)],{windowsHide:true,timeout:120000})
}
