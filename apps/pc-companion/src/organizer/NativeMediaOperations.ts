import {execFile} from 'node:child_process'
import {mkdtemp,writeFile,readFile,unlink,rmdir,lstat,realpath} from 'node:fs/promises'
import {promisify} from 'node:util'
import path from 'node:path'
import os from 'node:os'
import type {FilePlan,FileResult} from './DeletionQueue.js'

const run=promisify(execFile)
function helper(){const file=process.env.NIKKISYNC_RECYCLE_HELPER;if(process.platform!=='win32'||!file||!path.isAbsolute(file))throw new Error('native_media_unavailable');return file}
async function task<T>(work:(directory:string)=>Promise<T>){
  const directory=await realpath(await mkdtemp(path.join(os.tmpdir(),'momo-media-')))
  try{return await work(directory)}finally{
    // Remove only our fixed files, never recursively delete an unknown directory.
    for(const name of ['request.json','result.json','preview.jpg'])await unlink(path.join(directory,name)).catch(()=>{})
    await rmdir(directory).catch(()=>{})
  }
}
export async function recycleMany(files:FilePlan[]):Promise<FileResult[]>{
  if(!files.length||files.length>1000)throw new Error('invalid_batch')
  return task(async directory=>{
    const request=path.join(directory,'request.json'),result=path.join(directory,'result.json')
    await writeFile(request,JSON.stringify({files}),{mode:0o600})
    await run(helper(),['--recycle-batch',request,result],{windowsHide:true,timeout:900000,maxBuffer:65536})
    const info=await lstat(result);if(!info.isFile()||info.isSymbolicLink()||info.size>2*1024*1024)throw new Error('invalid_batch_result')
    const value=JSON.parse(await readFile(result,'utf8')) as {items:FileResult[]}
    if(!Array.isArray(value.items)||value.items.length>files.length)throw new Error('invalid_batch_result')
    return value.items
  })
}
let previewsActive=0
const previewWaiters:Array<()=>void>=[]
export async function nativePreview(file:FilePlan):Promise<Uint8Array>{
  if(previewsActive>=2)await new Promise<void>(resolve=>previewWaiters.push(resolve))
  else previewsActive++
  try{return await task(async directory=>{
    const output=path.join(directory,'preview.jpg')
    await run(helper(),['--organizer-preview',file.path,output],{windowsHide:true,timeout:20000,maxBuffer:65536})
    const info=await lstat(output);if(!info.isFile()||info.isSymbolicLink()||info.size>2*1024*1024)throw new Error('invalid_preview')
    return readFile(output)
  })}finally{const next=previewWaiters.shift();if(next)next();else previewsActive--}
}
