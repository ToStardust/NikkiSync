import {randomUUID} from 'node:crypto'
import type {GallerySource} from './GalleryRuntime.mjs'
import type {InspirationRepository,InspirationEntry} from '../inspiration/InspirationRepository.js'
const uuid=(id:unknown)=>{if(typeof id!=='string'||!/^[a-f0-9]{32}$/.test(id))throw Error('invalid_id');return id.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/,'$1-$2-$3-$4-$5')}
const key=(id:string)=>id.replaceAll('-','').toLowerCase()
const text=(v:unknown,max:number)=>{if(typeof v!=='string'||v.length>max)throw Error('invalid_text');return v}
export function withWeChatInspiration(source:GallerySource,store:InspirationRepository,resize?:(bytes:Uint8Array)=>Promise<Uint8Array>):GallerySource{
 const summary=(item:ReturnType<InspirationRepository['get']>)=>item?{id:key(item.entry.id),revision:item.revision,title:item.entry.title,notes:item.entry.notes.slice(0,2000),categories:item.entry.categories,status:item.entry.status,code:item.entry.code.rawCode,type:item.entry.code.type,images:item.entry.images.map(i=>({key:key(i.id),mime:i.mimeType,bytes:i.bytes}))}:null
 const current=(id:unknown,revision:unknown)=>{const item=store.get(uuid(id));if(!item||item.entry.deletedAt||item.revision!==revision)throw Error('conflict');return item}
 source.inspiration=async(action,input)=>{
  if(action==='list'){const after=input.after?uuid(input.after):'',result=store.list(after,1);return {items:result.items.filter(i=>!i.entry.deletedAt).map(summary),next:result.nextCursor?key(result.nextCursor):null}}
  if(action==='save'){
   const previous=input.id?current(input.id,input.revision):undefined,old=previous?.entry,now=Date.now()
   const rawCode=text(input.code,2000),type=text(input.type,20),title=text(input.title,200),status=text(input.status,20)
   const categories=input.categories;if(!Array.isArray(categories)||categories.length>30)throw Error('invalid_categories');categories.forEach(c=>text(c,60))
   const changed=old&&(old.code.rawCode!==rawCode||old.code.type!==type)
   const entry:InspirationEntry={id:old?.id??randomUUID(),title,notes:old?.notes??'',tags:old?.tags??[],categories:categories as string[],status,createdAt:old?.createdAt??now,deletedAt:0,
    code:{id:old?.code.id??randomUUID(),rawCode,type,sourceText:old?.code.sourceText??'',sourceUrl:old?.code.sourceUrl??null,parsedState:changed?'pending':old?.code.parsedState??'pending',snapshotJson:changed?null:old?.code.snapshotJson??null,resolverVersion:changed?null:old?.code.resolverVersion??null,dictionaryVersion:changed?null:old?.code.dictionaryVersion??null,resolvedAt:changed?0:old?.code.resolvedAt??0},images:old?.images??[]}
   return {item:summary(store.save(entry,previous?.revision??0))}
  }
  if(action==='delete'){const item=current(input.id,input.revision);return {item:summary(store.save({...item.entry,deletedAt:Date.now()},item.revision))}}
  if(action==='removeImage'){const item=current(input.id,input.revision),imageId=uuid(input.key);return {item:summary(store.save({...item.entry,images:item.entry.images.filter(i=>i.id!==imageId)},item.revision))}}
  throw Error('invalid_action')
 }
 source.inspirationImage=async(id,imageKey,preview)=>{
  const item=store.get(uuid(id));if(!item||item.entry.deletedAt)throw Error('missing_entry')
  const image=item.entry.images.find(i=>i.id===uuid(imageKey));if(!image)throw Error('missing_image')
  const value=store.image(image.sha256);if(!value)throw Error('missing_image')
  if(preview&&resize){try{return {image:await resize(value.bytes),mime:'image/jpeg'}}finally{value.bytes.fill(0)}}
  return {image:value.bytes,mime:value.mimeType}
 }
 source.inspirationUpload=async(meta,bytes)=>{
  const item=current(meta.id,meta.revision);if(item.entry.images.length>=5)throw Error('image_limit')
  store.putImage(String(meta.sha256),String(meta.mime),bytes)
  const image={id:randomUUID(),sha256:String(meta.sha256),mimeType:String(meta.mime),bytes:bytes.length,addedAt:Date.now()}
  return {item:summary(store.save({...item.entry,images:[...item.entry.images,image]},item.revision))}
 }
 return source
}
