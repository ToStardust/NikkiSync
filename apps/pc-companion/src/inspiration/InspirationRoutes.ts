import type { IncomingMessage,ServerResponse } from 'node:http'
import { InspirationRepository } from './InspirationRepository.js'

function json(res:ServerResponse,status:number,value:unknown){const body=Buffer.from(JSON.stringify(value));res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':body.length,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(body)}
async function read(req:IncomingMessage,limit:number):Promise<Buffer>{const parts:Buffer[]=[];let size=0;for await(const chunk of req){const b=Buffer.from(chunk);size+=b.length;if(size>limit)throw Error('too_large');parts.push(b)}return Buffer.concat(parts)}

/** Shared by signed LAN requests and the token-protected local desktop control page. */
export async function inspirationRoute(req:IncomingMessage,res:ServerResponse,url:URL,prefix:string,store:InspirationRepository,authorized:(body:Buffer)=>boolean):Promise<void>{
  const path=url.pathname.slice(prefix.length),imageMatch=/^\/images\/([a-f0-9]{64})$/.exec(path)
  try{
    const method=req.method??''
    if(!['GET','HEAD','POST','PUT'].includes(method))return json(res,405,{error:'method_not_allowed'})
    const body=method==='PUT'?await read(req,15*1024*1024):method==='POST'?await read(req,512*1024):Buffer.alloc(0)
    if(!authorized(body))return json(res,401,{error:'unauthorized'})
    if(method==='GET'&&path===''){
      const limitText=url.searchParams.get('limit')??'100',limit=Number(limitText)
      return json(res,200,store.list(url.searchParams.get('after')??'',limit))
    }
    if(method==='GET'&&imageMatch){
      const image=store.image(imageMatch[1]!);if(!image)return json(res,404,{error:'not_found'})
      res.writeHead(200,{'content-type':image.mimeType,'content-length':image.bytes.length,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end(image.bytes);return
    }
    if(method==='HEAD'&&imageMatch){const info=store.imageInfo(imageMatch[1]!);if(!info){res.writeHead(404);res.end();return}res.writeHead(200,{'content-type':info.mimeType,'content-length':info.size,'cache-control':'no-store','x-content-type-options':'nosniff'});res.end();return}
    if(method==='PUT'&&imageMatch){store.putImage(imageMatch[1]!,String(req.headers['content-type']??''),body);return json(res,200,{ok:true})}
    if(method==='POST'&&path===''){
      if(!String(req.headers['content-type']??'').startsWith('application/json'))return json(res,400,{error:'bad_request'})
      const input=JSON.parse(body.toString('utf8')) as {entry?:unknown;baseRevision?:unknown}
      if(typeof input.baseRevision!=='number')throw Error('invalid_entry')
      return json(res,200,store.save(input.entry,input.baseRevision))
    }
    return json(res,404,{error:'not_found'})
  }catch(error){
    const code=error instanceof Error?error.message:''
    if(code==='conflict')return json(res,409,{error:'conflict'})
    if(code==='too_large')return json(res,413,{error:'too_large'})
    return json(res,400,{error:'invalid_request'})
  }
}
