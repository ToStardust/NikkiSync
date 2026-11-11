import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,readFile,rm,realpath} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {createHash} from 'node:crypto'
import {DatabaseManager,AssetRepository,ResourceRepository} from '@nikkisync/database'
import {DeletionQueue} from '../src/organizer/DeletionQueue.js'
import {withWeChatDeletion} from '../src/wechat/WeChatDeletion.js'
import type {GallerySource} from '../src/wechat/GalleryRuntime.mjs'

async function fixture(){
 const root=await realpath(await mkdtemp(path.join(tmpdir(),'momo-wechat-delete-'))),file=path.join(root,'generated.png'),bytes=Buffer.from('generated deletion fixture only')
 await writeFile(file,bytes)
 const db=new DatabaseManager();db.initialize();const assets=new AssetRepository(db),resources=new ResourceRepository(db)
 const assetId='asset_'+ 'a'.repeat(32),revision=assets.create({assetId,assetType:'photo',assetState:'ready',discoveredAt:'2026-11-02T00:00:00Z'})
 resources.create({resourceId:'resource_fixture',assetId,role:'source_primary',fileName:'generated.png',sourcePath:file,pathKey:file.toLowerCase(),mimeType:'image/png',fileExt:'.png',sizeBytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')})
 let recycled=0
 const queue=new DeletionQueue(db,()=>[root],async()=>{},async()=>{recycled++})
 const photoId='b'.repeat(32),base={deletionTarget:(id:string)=>{if(id!==photoId)throw Error('scope');return {assetId,revision}}} as unknown as GallerySource
 const source=withWeChatDeletion(base,queue);source.deletionConnected!()
 const call=(action:string,input:Record<string,unknown>)=>source.deletion!(action,input) as Promise<{items:Array<{id:string;photoId:string;state:string;approval?:string;count:number}>}>
 return {db,queue,source,photoId,file,call,recycled:()=>recycled,close:async()=>{await source.deletionDisconnected!();await queue.stop();db.close();await rm(root,{recursive:true,force:true})}}
}
test('mini online deletion requires PC confirmation and a fresh phone echo; wire never exposes asset/path',async()=>{
 const f=await fixture();try{
  const first=await f.call('request',{ids:[f.photoId]});await f.queue.idle();assert.equal(f.recycled(),0)
  const state=await f.call('sync',{cancel:[],approvals:[]});assert.equal(state.items[0]!.state,'pending')
  const wire=JSON.stringify(state);assert.ok(!wire.includes('asset_'));assert.ok(!wire.includes(f.file));assert.equal(state.items[0]!.photoId,f.photoId)
  await f.queue.decide(first.items[0]!.id,true);assert.equal(f.recycled(),0)
  const challenge=await f.call('sync',{cancel:[],approvals:[]});assert.ok(challenge.items[0]!.approval)
  await f.call('sync',{cancel:[],approvals:[{id:first.items[0]!.id,approval:challenge.items[0]!.approval}]});await f.queue.idle()
  assert.equal(f.recycled(),1);assert.equal((await f.call('sync',{cancel:[],approvals:[]})).items[0]!.state,'recycled')
 }finally{await f.close()}
})
test('cancellation wins over PC challenge in the same message and does not execute',async()=>{
 const f=await fixture();try{
  const r=await f.call('request',{ids:[f.photoId]});await f.queue.idle();const id=r.items[0]!.id
  await f.queue.decide(id,true);const state=await f.call('sync',{cancel:[],approvals:[]})
  await f.call('sync',{cancel:[id],approvals:[{id,approval:state.items[0]!.approval}]});await f.queue.idle()
  assert.equal(f.recycled(),0);assert.equal(f.queue.list()[0]!.state,'cancelled');assert.ok(await readFile(f.file))
 }finally{await f.close()}
})
test('disconnect cancels unexecuted requests; recovery cannot replay the old approval',async()=>{
 const f=await fixture();try{
  const r=await f.call('request',{ids:[f.photoId]});await f.queue.idle();const id=r.items[0]!.id
  await f.queue.decide(id,true);const state=await f.call('sync',{cancel:[],approvals:[]})
  await f.source.deletionDisconnected!()
  const cancelled=f.queue.list()[0]!
  assert.equal(cancelled.state,'cancelled');assert.equal(cancelled.online,false);assert.equal(cancelled.sessionCancelled,true)
  await assert.rejects(()=>f.call('request',{ids:[f.photoId]}));f.source.deletionConnected!()
  const synced=await f.call('sync',{cancel:[],approvals:[{id,approval:state.items[0]!.approval}]})
  assert.equal(synced.items[0]?.state,'cancelled');assert.ok(!('sessionCancelled' in synced.items[0]!))
  await f.queue.idle();assert.equal(f.recycled(),0)
 }finally{await f.close()}
})
test('rejects forged IDs, paths, oversize, duplicate targets and another session request IDs atomically',async()=>{
 const f=await fixture();try{
  for(const input of [{ids:[f.photoId,'c'.repeat(32)]},{ids:[f.photoId],path:f.file},{ids:[f.photoId,f.photoId]},{ids:Array(21).fill(f.photoId)}])await assert.rejects(()=>f.call('request',input))
  assert.equal(f.queue.list().length,0)
  await assert.rejects(()=>f.call('sync',{cancel:['a'.repeat(32)],approvals:[]}));assert.equal(f.recycled(),0)
 }finally{await f.close()}
})
test('changed source after approval is retained and never reported as recycled',async()=>{
 const f=await fixture();try{
  const r=await f.call('request',{ids:[f.photoId]});await f.queue.idle();const id=r.items[0]!.id
  await f.queue.decide(id,true);const state=await f.call('sync',{cancel:[],approvals:[]});await writeFile(f.file,'changed by generated test')
  await f.call('sync',{cancel:[],approvals:[{id,approval:state.items[0]!.approval}]});await f.queue.idle()
  assert.equal(f.recycled(),0);assert.equal(f.queue.list()[0]!.state,'changed');assert.ok(await readFile(f.file))
 }finally{await f.close()}
})
test('a replacement authenticated socket cancels the previous socket intentions before accepting an echo',async()=>{
 const f=await fixture();try{
  const r=await f.call('request',{ids:[f.photoId]});await f.queue.idle();const id=r.items[0]!.id
  await f.queue.decide(id,true);const state=await f.call('sync',{cancel:[],approvals:[]})
  f.source.deletionConnected!();await f.call('sync',{cancel:[],approvals:[{id,approval:state.items[0]!.approval}]});await f.queue.idle()
  assert.equal(f.recycled(),0);assert.equal(f.queue.list()[0]!.state,'cancelled')
 }finally{await f.close()}
})
test('restart abandons transient mini intentions while leaving ordinary paired-device pending items intact',async()=>{
 const f=await fixture();let restarted:DeletionQueue|undefined
 try{
  await f.call('request',{ids:[f.photoId]});await f.queue.idle()
  await f.queue.sync('paired-android',[{id:'cccccccc-cccc-cccc-cccc-cccccccccccc',assetId:'asset_'+ 'a'.repeat(32),revision:Number(f.db.connection.prepare('SELECT revision FROM assets LIMIT 1').get()!.revision)}]);await f.queue.idle();await f.queue.stop()
  restarted=new DeletionQueue(f.db,()=>[],async()=>{})
  assert.equal(restarted.list().find(row=>row.id==='cccccccc-cccc-cccc-cccc-cccccccccccc')!.state,'pending')
  assert.equal(restarted.list().filter(row=>row.id!=='cccccccc-cccc-cccc-cccc-cccccccccccc')[0]!.state,'cancelled');assert.equal(f.recycled(),0)
 }finally{await restarted?.stop();await f.close()}
})
