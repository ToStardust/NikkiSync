import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {spawn} from 'node:child_process'
import type {MetadataThumbnailCache} from '../metadata/MetadataThumbnailCache.js'
export type IconDescriptor={candidates:{url:string;kind:'item'|'category'}[];versionKey:string}
export type IconResult={image:Uint8Array;mime:'image/png';source:'item'|'category'}
export class WeChatIconProvider{
 private readonly entries=new Map<string,IconResult>()
 private readonly negative=new Map<string,number>()
 private readonly inflight=new Map<string,Promise<IconResult>>()
 private bytes=0
 constructor(private readonly cache:MetadataThumbnailCache,private readonly resize:(bytes:Uint8Array)=>Promise<Uint8Array>,private readonly timeoutMs=15000){
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>15000)throw new Error('Invalid icon deadline')
 }
 async get(descriptor:IconDescriptor):Promise<IconResult>{
  const key=createHash('sha256').update(JSON.stringify([descriptor.candidates,descriptor.versionKey])).digest('hex'),cached=this.entries.get(key)
  if(cached){this.entries.delete(key);this.entries.set(key,cached);return {...cached,image:cached.image.slice()}}
  if((this.negative.get(key)??0)>Date.now())throw new Error('Icon temporarily unavailable')
  this.negative.delete(key)
  let work=this.inflight.get(key)
  if(!work){
   if(this.inflight.size>=128)throw new Error('Icon temporarily unavailable')
   work=this.load(key,descriptor);this.inflight.set(key,work)
   void work.finally(()=>this.inflight.delete(key)).catch(()=>{})
  }
  const result=await work;return {...result,image:result.image.slice()}
 }
 private async load(key:string,descriptor:IconDescriptor):Promise<IconResult>{
  const deadline=Date.now()+this.timeoutMs
  for(const candidate of descriptor.candidates.slice(0,4)){
   if(Date.now()>=deadline)break
   let bytes:Buffer|undefined,image:Uint8Array|undefined
   try{
    const raw=await beforeDeadline(this.cache.get(candidate.url,descriptor.versionKey),deadline);bytes=await beforeDeadline(readFile(raw.path),deadline)
    if(bytes.length>2097152||createHash('sha256').update(bytes).digest('hex')!==raw.sha256)throw new Error('Icon cache changed')
    image=await beforeDeadline(this.resize(bytes),deadline)
    if(image.length<8||image.length>262144||![137,80,78,71,13,10,26,10].every((x,i)=>image![i]===x))throw new Error('Invalid converted icon')
    while(this.entries.size>=128||this.bytes+image.length>16*1024*1024){const first=this.entries.keys().next().value!;const old=this.entries.get(first)!;this.entries.delete(first);this.bytes-=old.image.length;old.image.fill(0)}
    const value:IconResult={image:Uint8Array.from(image),mime:'image/png',source:candidate.kind};this.entries.set(key,value);this.bytes+=value.image.length
    return value
   }catch{}finally{bytes?.fill(0);image?.fill(0)}
  }
  while(this.negative.size>=128)this.negative.delete(this.negative.keys().next().value!)
  this.negative.set(key,Date.now()+30000);throw new Error('Icon temporarily unavailable')
 }
}
function beforeDeadline<T>(work:Promise<T>,deadline:number):Promise<T>{
 return new Promise((resolve,reject)=>{
  let settled=false
  const timer=setTimeout(()=>{settled=true;reject(new Error('Icon deadline exceeded'))},Math.max(0,deadline-Date.now()))
  work.then(value=>{if(settled){if(value instanceof Uint8Array)value.fill(0);return}settled=true;clearTimeout(timer);resolve(value)},error=>{if(settled)return;settled=true;clearTimeout(timer);reject(error)})
 })
}
export function resizeWeChatIcon(bytes:Uint8Array,script:string):Promise<Uint8Array>{
 return new Promise((resolve,reject)=>{
  const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',script],{windowsHide:true,stdio:['pipe','pipe','pipe']}),chunks:Buffer[]=[];let size=0,settled=false
  const finish=(failed:boolean)=>{if(settled)return;settled=true;clearTimeout(timer);if(failed){child.kill();for(const chunk of chunks)chunk.fill(0);reject(new Error('Icon conversion unavailable'))}else resolve(Buffer.concat(chunks))}
  const timer=setTimeout(()=>finish(true),10000);child.on('error',()=>finish(true));child.stdin.on('error',()=>finish(true));child.stderr.on('data',()=>{})
  child.stdout.on('data',(chunk:Buffer)=>{if(settled){chunk.fill(0);return}size+=chunk.length;if(size>262144){chunk.fill(0);finish(true)}else chunks.push(chunk)})
  child.on('close',code=>finish(code!==0||size<8));child.stdin.end(bytes)
 })
}
