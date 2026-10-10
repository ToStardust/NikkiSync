import { randomBytes } from 'node:crypto'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { createGalleryServer, releaseProtocolRuntime, type GalleryConfig, type GalleryEvents, type GallerySource } from './GalleryRuntime.mjs'

type Listener = { port: number; stop(): Promise<void> }
export interface WeChatGalleryStatus { state: 'idle'|'starting'|'waiting'|'connected'|'disconnected'|'closed'|'expired'|'error'; photoCount: number; originalsSent: number; expiresAt?: string }
export interface WeChatGalleryConfig {
  host: string
  snapshot(): Promise<GallerySource>
  qrSvg(payload: string): Promise<string>
  listen?(config: GalleryConfig, source: GallerySource, events: GalleryEvents): Promise<Listener>
  ttlMs?: number
  reservePort?(): Promise<number>
  onWorkSettled?(): void
}
async function listen(config: GalleryConfig, source: GallerySource, events: GalleryEvents): Promise<Listener> {
  const service = createGalleryServer(config, source, {events})
  try {
    await new Promise<void>((resolve,reject)=>{service.server.once('error',reject);service.server.listen(config.port,config.host,resolve)})
    // Lifetime errors close the session, never become an unhandled process exception.
    service.server.on('error',()=>{events.disconnected();void service.stop()})
    return {port:(service.server.address() as net.AddressInfo).port,stop:service.stop}
  } catch {await service.stop();throw new Error('微信照片连接未能开启')}
}
export class WeChatGalleryService {
  private current: WeChatGalleryStatus = {state:'idle',photoCount:0,originalsSent:0}
  private listener: Listener | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private generation = 0
  private queue: Promise<unknown> = Promise.resolve()
  constructor(private readonly config: WeChatGalleryConfig) {}
  status(): WeChatGalleryStatus { return {...this.current} }
  start(): Promise<WeChatGalleryStatus & {qrSvg:string}> {
    const generation=++this.generation
    const operation=this.queue.catch(()=>{}).then(()=>this.startSession(generation))
    this.queue=operation
    return operation
  }
  private async release(): Promise<void> {
    clearTimeout(this.timer);this.timer=undefined
    const old=this.listener;this.listener=undefined
    await old?.stop()
    releaseProtocolRuntime()
    this.config.onWorkSettled?.()
  }
  async stop(): Promise<void> {++this.generation;this.current={state:'closed',photoCount:0,originalsSent:0};await this.release()}
  private async startSession(generation:number): Promise<WeChatGalleryStatus & {qrSvg:string}> {
    const active=()=>generation===this.generation
    const guard=()=>{if(!active())throw new Error('连接操作已取消')}
    let listener:Listener|undefined
    await this.release();guard()
    this.current={state:'starting',photoCount:0,originalsSent:0}
    try {
      const host=this.config.host
      if (!net.isIPv4(host)||! /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)) throw new Error('请连接局域网后重试')
      const source=await this.config.snapshot();guard()
      const port=await (this.config.reservePort??(async()=>{
        const reserve=net.createServer()
        await new Promise<void>((resolve,reject)=>{reserve.once('error',reject);reserve.listen(0,host,resolve)})
        const value=(reserve.address() as net.AddressInfo).port
        await new Promise<void>(resolve=>reserve.close(()=>resolve()));return value
      }))();guard()
      const expiresAt=new Date(Date.now()+(this.config.ttlMs??600000)).toISOString()
      const payload:GalleryConfig={type:'NikkiSyncLocalGalleryLive',version:1,resume:1,host,port,key:randomBytes(32).toString('hex'),sessionId:randomBytes(16).toString('hex'),expiresAt}
      this.current={state:'waiting',photoCount:source.count,originalsSent:0,expiresAt}
      const events:GalleryEvents={authenticated:()=>{if(active())this.current.state='connected'},disconnected:()=>{if(active())this.current.state='disconnected';this.config.onWorkSettled?.()},transferred:()=>{if(active())this.current.originalsSent++},refreshed:count=>{if(active())this.current.photoCount=count},settled:()=>this.config.onWorkSettled?.()}
      listener=await (this.config.listen??listen)(payload,source,events);guard()
      const svg=await this.config.qrSvg(JSON.stringify(payload));payload.key='';guard()
      this.listener=listener;listener=undefined
      this.timer=setTimeout(()=>{if(active()){++this.generation;this.current.state='expired';void this.release()}},Math.max(1,Date.parse(expiresAt)-Date.now()));this.timer.unref()
      return {...this.status(),qrSvg:svg}
    } catch(error) {
      await listener?.stop()
      if(active())this.current={state:'error',photoCount:0,originalsSent:0}
      throw error
    }
  }
}

// Package-owned conversion script only; source bytes travel through pipes, never a command string/file.
export function resizeForWeChat(bytes:Uint8Array, script:string):Promise<Uint8Array> {
  return new Promise((resolve,reject)=>{
    const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-File',script],{windowsHide:true,stdio:['pipe','pipe','pipe']})
    const chunks:Buffer[]=[];let size=0,settled=false
    const finish=(failed:boolean)=>{if(settled)return;settled=true;clearTimeout(timer);if(failed){child.kill();reject(new Error('照片预览暂不可用'))}else resolve(Buffer.concat(chunks))}
    const timer=setTimeout(()=>finish(true),15000)
    child.on('error',()=>finish(true));child.stdin.on('error',()=>finish(true));child.stderr.on('data',()=>{})
    child.stdout.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>524288)finish(true);else chunks.push(chunk)})
    child.on('close',code=>finish(code!==0||size<4));child.stdin.end(bytes)
  })
}
