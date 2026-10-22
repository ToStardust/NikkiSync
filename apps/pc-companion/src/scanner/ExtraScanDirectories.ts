import {createHash,randomBytes} from 'node:crypto'
import {readFileSync,writeFileSync,renameSync,unlinkSync,lstatSync} from 'node:fs'
import {realpath,stat,readdir} from 'node:fs/promises'
import path from 'node:path'
import type {ExtraScanRoot} from './types.js'
import type {ScannerService} from './ScannerService.js'

const MAX_DIRECTORIES=16
const key=(value:string)=>path.resolve(value).toLowerCase()
const within=(value:string,root:string)=>key(value)===key(root)||key(value).startsWith(key(root)+path.sep)
const overlaps=(a:string,b:string)=>within(a,b)||within(b,a)
const idFor=(value:string)=>'dir_'+createHash('sha256').update(key(value)).digest('hex').slice(0,24)

export function loadExtraScanDirectories(file:string):ExtraScanRoot[]{
  try{
    const info=lstatSync(file);if(info.isSymbolicLink()||info.size>65536)return []
    const value=JSON.parse(readFileSync(file,'utf8')) as {directories?:unknown}
    if(!Array.isArray(value.directories)||value.directories.length>MAX_DIRECTORIES)return []
    const result:ExtraScanRoot[]=[]
    for(const entry of value.directories){
      if(!entry||typeof entry.path!=='string'||entry.path.length>4096||!path.isAbsolute(entry.path)||path.parse(entry.path).root===entry.path||!['native','images'].includes(entry.mode))continue
      if(result.some(previous=>overlaps(previous.path,entry.path)))continue
      result.push({id:idFor(entry.path),path:path.resolve(entry.path),mode:entry.mode})
    }
    return result
  }catch{return []}
}

export function loadRetiredExtraDirectories(file:string):string[]{
  try{
    const info=lstatSync(file);if(info.isSymbolicLink()||info.size>65536)return []
    const value=JSON.parse(readFileSync(file,'utf8')) as {retiredRoots?:unknown}
    return Array.isArray(value.retiredRoots)?value.retiredRoots.slice(0,MAX_DIRECTORIES).filter((entry):entry is string=>typeof entry==='string'&&entry.length<=4096&&path.isAbsolute(entry)&&key(entry)!==key(path.parse(entry).root)):[]
  }catch{return []}
}

export interface ExtraDirectoryProposal {id:string;roots:ExtraScanRoot[];images:number;videos:number;limited:boolean;hint:string}

export class ExtraScanDirectories{
  private directories:ExtraScanRoot[]
  private proposals=new Map<string,{proposal:ExtraDirectoryProposal;expires:number}>()
  private operations:Promise<unknown>=Promise.resolve()
  private busy=false
  private lastResult=''
  constructor(private readonly file:string,private readonly scanner:ScannerService,private readonly onScopeChanged?:()=>Promise<void>){this.directories=loadExtraScanDirectories(file)}
  state(){return {directories:this.directories.map(entry=>({...entry})),automaticRoots:this.scanner.getAutomaticRoots(),busy:this.busy,message:this.lastResult,scannerStatus:this.scanner.getStatus().status}}

  async inspect(selected:string):Promise<ExtraDirectoryProposal>{
    if(typeof selected!=='string'||selected.length>4096||!path.isAbsolute(selected))throw new Error('invalid_directory')
    let canonical:string
    try{canonical=await realpath(selected);if(!(await stat(canonical)).isDirectory())throw new Error()}catch{throw new Error('directory_unavailable')}
    if(key(canonical)===key(path.parse(canonical).root))throw new Error('choose_subfolder')
    if(/(?:^|[/\\])NikkiPhotos_LowQuality(?:[/\\]|$)/i.test(canonical))throw new Error('thumbnail_only')
    const roots:ExtraScanRoot[]=[]
    // Narrow game/install selections to actual media folders, avoiding Paks and engine caches.
    for(const relative of ['Saved/GamePlayPhotos','GamePlayPhotos','X6Game/Saved/GamePlayPhotos','X6Game/GamePlayPhotos']){
      const candidate=path.join(canonical,relative)
      if(await directoryExists(candidate)){const resolved=await realpath(candidate);roots.push({id:idFor(resolved),path:resolved,mode:'native'})}
    }
    if(roots.length===0){
      if(/^X6Game$/i.test(path.basename(canonical))||await directoryExists(path.join(canonical,'X6Game'))){
        const base=await directoryExists(path.join(canonical,'X6Game'))?path.join(canonical,'X6Game'):canonical
        for(const name of ['ScreenShot','Video','Videos']){const candidate=path.join(base,name);if(await directoryExists(candidate)){const resolved=await realpath(candidate);roots.push({id:idFor(resolved),path:resolved,mode:'images'})}}
        if(roots.length===0)throw new Error('choose_photo_folder')
      }else{
        const native=/^(GamePlayPhotos|NikkiPhotos_HighQuality)$/i.test(path.basename(canonical))||await directoryExists(path.join(canonical,'NikkiPhotos_HighQuality'))||(/[/\\]GamePlayPhotos[/\\]/i.test(canonical)&&/^Videos?$/i.test(path.basename(canonical)))
        roots.push({id:idFor(canonical),path:canonical,mode:native?'native':'images'})
      }
    }
    const unique=roots.filter((root,index)=>!roots.some((other,otherIndex)=>otherIndex<index&&overlaps(root.path,other.path)))
    if(this.directories.length+unique.length>MAX_DIRECTORIES)throw new Error('too_many_directories')
    const existing=await resolveScopes([...this.directories.map(item=>item.path),...this.scanner.getAutomaticRoots()])
    if(unique.some(root=>existing.some(added=>overlaps(root.path,added))))throw new Error('already_covered')
    let images=0,videos=0,observed=0,folders=0,limited=false
    const visit=async(directory:string,depth:number):Promise<void>=>{
      if(depth>8||observed>=500||folders>=150){limited=true;return}folders++
      for(const entry of await readdir(directory,{withFileTypes:true})){
        if(entry.isSymbolicLink())continue
        if(entry.isDirectory()){await visit(path.join(directory,entry.name),depth+1);continue}
        if(++observed>500){limited=true;break}
        if(/\.(jpe?g|png|webp)$/i.test(entry.name))images++
        else if(/\.mp4$/i.test(entry.name))videos++
      }
    }
    try{for(const root of unique)await visit(root.path,0)}catch{throw new Error('directory_unavailable')}
    const hint=unique.some(root=>root.mode==='images')?'外部图片可浏览和保存；软件截图不一定包含游戏穿搭与拍摄参数。不会把普通录像当作 LIVE。':'已识别暖暖原生相册。选择 GamePlayPhotos 或 UID 文件夹可同时包含原图、缩略图和 LIVE；只选原图子目录不会加入同级 LIVE。'
    const proposal={id:randomBytes(18).toString('base64url'),roots:unique,images,videos,limited,hint}
    for(const [id,item]of this.proposals)if(item.expires<Date.now())this.proposals.delete(id)
    if(this.proposals.size>=8)this.proposals.delete(this.proposals.keys().next().value!)
    this.proposals.set(proposal.id,{proposal,expires:Date.now()+600_000})
    return proposal
  }

  add(id:string):Promise<ReturnType<ExtraScanDirectories['state']>>{return this.serialize(async()=>{
    const item=this.proposals.get(id);this.proposals.delete(id)
    if(!item||item.expires<Date.now())throw new Error('selection_expired')
    const existing=await resolveScopes([...this.directories.map(value=>value.path),...this.scanner.getAutomaticRoots()])
    for(const root of item.proposal.roots){
      if(key(await realpath(root.path))!==key(root.path))throw new Error('directory_unavailable')
      if(existing.some(value=>overlaps(value,root.path)))throw new Error('already_covered')
    }
    if(this.directories.length+item.proposal.roots.length>MAX_DIRECTORIES)throw new Error('too_many_directories')
    await this.change([...this.directories,...item.proposal.roots])
    this.lastResult=this.scanner.getStatus().lastScan?.errors.length?'目录已添加，但部分文件暂不可读。请确认磁盘在线后重新扫描，之前的索引已保留。':'目录已加入扫描。新照片会继续自动收录；手机会通过现有连接同步更新。'
    return this.state()
  }).then(()=>this.state())}
  remove(id:string):Promise<ReturnType<ExtraScanDirectories['state']>>{return this.serialize(async()=>{
    if(!this.directories.some(entry=>entry.id===id))throw new Error('directory_not_found')
    await this.change(this.directories.filter(entry=>entry.id!==id))
    this.lastResult='已停止扫描和分享此目录，电脑原文件与手机已保存的文件保留。'
    return this.state()
  }).then(()=>this.state())}
  rescan():Promise<ReturnType<ExtraScanDirectories['state']>>{return this.serialize(async()=>{const result=await this.scanner.setExtraDirectories(this.directories);this.lastResult=result.errors.length?'扫描完成，部分目录暂不可读；已保留之前的索引，请确认磁盘在线后重试。':'扫描完成，手机相册会自动同步更新。';return this.state()}).then(()=>this.state())}
  private async change(next:ExtraScanRoot[]):Promise<void>{
    const previous=this.directories
    this.save(next,previous.filter(entry=>!next.some(item=>item.id===entry.id)).map(entry=>entry.path))
    try{await this.onScopeChanged?.();await this.scanner.setExtraDirectories(next);this.directories=next}
    catch(error){this.save(previous);await this.scanner.setExtraDirectories(previous);throw error}
  }
  private save(entries:ExtraScanRoot[],retiredRoots:string[]=[]):void{
    try{if(lstatSync(this.file).isSymbolicLink())throw new Error('unsafe_settings')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}
    const temporary=this.file+'.tmp-'+randomBytes(8).toString('hex')
    try{writeFileSync(temporary,JSON.stringify({version:1,directories:entries,retiredRoots}),{encoding:'utf8',mode:0o600,flag:'wx'});renameSync(temporary,this.file)}
    finally{try{unlinkSync(temporary)}catch{}}
  }
  private serialize<T>(operation:()=>Promise<T>):Promise<T>{
    const result=this.operations.then(async()=>{this.busy=true;try{return await operation()}finally{this.busy=false}})
    this.operations=result.catch(()=>{});return result
  }
}

async function directoryExists(directory:string):Promise<boolean>{try{return (await stat(directory)).isDirectory()}catch{return false}}
async function resolveScopes(roots:string[]):Promise<string[]>{return Promise.all(roots.map(root=>realpath(root).catch(()=>root)))}
