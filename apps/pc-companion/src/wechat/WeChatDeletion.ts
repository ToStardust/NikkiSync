import {randomUUID} from 'node:crypto'
import type {DeleteIntent,DeletionQueue} from '../organizer/DeletionQueue.js'
import type {GallerySource} from './GalleryRuntime.mjs'

const terminal=new Set(['changed','failed','recycled','cancelled','rejected'])
const fields=(value:Record<string,unknown>,keys:string[])=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))throw Error('invalid_request')}
const id=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{32}$/.test(value)
/** A Noise session is a transient requester, never an Android pairing identity. */
export function withWeChatDeletion(source:GallerySource,queue:DeletionQueue):GallerySource{
 const device='wechat:'+randomUUID(),intents=new Map<string,DeleteIntent & {photoId:string}>()
 let online=false,generation=0,tail:Promise<unknown>=Promise.resolve()
 const serial=<T>(work:()=>Promise<T>)=>{const next=tail.then(work);tail=next.catch(()=>{});return next}
 const items=()=>({items:queue.list(device).filter(row=>intents.has(row.id)).map(row=>({
  id:row.id,photoId:intents.get(row.id)!.photoId,state:row.state,message:row.message,count:row.count,
  files:row.files.slice(0,3).map(file=>({name:file.name.slice(0,200),size:file.size})),...(row.approval?{approval:row.approval}:{})
 }))})
 source.deletionConnected=()=>{++generation;online=true;void serial(()=>queue.cancelTransientSession(device))}
 source.deletionDisconnected=()=>{if(!online)return tail.then(()=>{});online=false;++generation;return serial(()=>queue.cancelTransientSession(device))}
 source.deletion=async(action,input)=>{
  const epoch=generation
  return serial(async()=>{
   if(!online||epoch!==generation)throw Error('offline')
   if(action==='request'){
    fields(input,['ids']);const ids=input.ids
    if(!Array.isArray(ids)||!ids.length||ids.length>20||!ids.every(id)||new Set(ids).size!==ids.length)throw Error('invalid_ids')
    const existing=queue.list(device),active=existing.filter(row=>!terminal.has(row.state))
    const additions=ids.filter(photoId=>!active.some(row=>intents.get(row.id)?.photoId===photoId))
    if(active.length+additions.length>20)throw Error('queue_full')
    // Resolve the entire selection from the PC snapshot before inserting anything.
    const next=additions.map(photoId=>({id:randomUUID().replaceAll('-',''),photoId,...source.deletionTarget!(photoId)}))
    for(const item of next)if(!/^asset_[a-zA-Z0-9_-]+$/.test(item.assetId)||!Number.isSafeInteger(item.revision)||item.revision<0)throw Error('invalid_target')
    await queue.sync(device,next)
    for(const item of next)intents.set(item.id,item)
    // Bound session memory; terminal records remain in the PC audit queue.
    for(const row of existing)if(terminal.has(row.state))intents.delete(row.id)
   }else if(action==='sync'){
    fields(input,['cancel','approvals']);const cancel=input.cancel,approvals=input.approvals
    if(!Array.isArray(cancel)||cancel.length>20||!cancel.every(id)||new Set(cancel).size!==cancel.length||!Array.isArray(approvals)||approvals.length>20)throw Error('invalid_sync')
    const echoes=new Map<string,string>()
    for(const value of approvals){fields(value,['id','approval']);if(!id(value.id)||!intents.has(value.id)||typeof value.approval!=='string'||!/^[a-f0-9-]{36}$/.test(value.approval)||echoes.has(value.id))throw Error('invalid_approval');echoes.set(value.id,value.approval)}
    if(cancel.some(key=>!intents.has(key)))throw Error('invalid_cancel')
    await queue.sync(device,[...intents.values()].map(item=>({...item,cancel:cancel.includes(item.id),...(echoes.has(item.id)?{approval:echoes.get(item.id)!}:{})})))
   }else throw Error('invalid_action')
   if(!online||epoch!==generation){await queue.cancelTransientSession(device);throw Error('offline')}
   return items()
  })
 }
 return source
}
