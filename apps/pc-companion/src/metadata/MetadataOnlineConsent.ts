import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import type { PhotoMetadataResolver } from './types.js'

export interface MetadataRecipient { name: string; endpoint: string; fields: string[] }
export class MetadataOnlineConsent {
  static readonly POLICY_VERSION='2026-10-13.1'
  private granted=false
  private readonly fingerprint: string
  private readonly active=new Set<AbortController>()
  constructor(private readonly file: string,private readonly recipients: MetadataRecipient[],initiallyDisabled=false){
    this.fingerprint=createHash('sha256').update(JSON.stringify(recipients)).digest('hex')
    try{
      const saved=JSON.parse(readFileSync(file,'utf8')) as Record<string,unknown>
      this.granted=!initiallyDisabled&&saved.enabled===true&&saved.policyVersion===MetadataOnlineConsent.POLICY_VERSION
        &&saved.recipients===this.fingerprint&&typeof saved.acceptedAt==='string'&&Number.isFinite(Date.parse(saved.acceptedAt))
    } catch {
      // Missing and unreadable settings cannot establish consent.
      this.granted = false
    }
  }
  enabled(): boolean{return this.granted}
  state(){return {enabled:this.granted,policyVersion:MetadataOnlineConsent.POLICY_VERSION,recipients:this.recipients.map(r=>{
    const url=new URL(r.endpoint);url.username='';url.password='';url.search='';url.hash=''
    return {name:r.name,endpoint:url.toString(),fields:[...r.fields]}
  })}}
  setEnabled(enabled: boolean,policyVersion?: string): void {
    if(typeof enabled!=='boolean'||(enabled&&policyVersion!==MetadataOnlineConsent.POLICY_VERSION))throw new Error('请先阅读并同意当前在线解析说明')
    if(!enabled){this.granted=false;this.abortPending()}
    mkdirSync(path.dirname(this.file),{recursive:true})
    const temporary=this.file+'.tmp'
    writeFileSync(temporary,JSON.stringify({enabled,policyVersion:MetadataOnlineConsent.POLICY_VERSION,recipients:this.fingerprint,
      ...(enabled?{acceptedAt:new Date().toISOString()}:{})}),{encoding:'utf8',mode:0o600})
    renameSync(temporary,this.file);this.granted=enabled
  }
  abortPending(): void{for(const controller of this.active)controller.abort();this.active.clear()}
  guard(resolver: PhotoMetadataResolver): PhotoMetadataResolver {
    const withConsent = async <T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> => {
      if (!this.granted) throw new Error('在线参数解析尚未开启')
      const controller = new AbortController()
      this.active.add(controller)
      try { return await work(controller.signal) }
      finally { this.active.delete(controller) }
    }
    const combine = (consent: AbortSignal, request?: AbortSignal) => request ? AbortSignal.any([consent, request]) : consent
    return {id:resolver.id,...(resolver.version?{version:resolver.version}:{}),...(resolver.capabilities?{capabilities:resolver.capabilities}:{}),
      ...(resolver.batchSize ? { batchSize: resolver.batchSize } : {}),
      ...(resolver.resolveBatch ? {
        resolveBatch: (requests, database) => withConsent(signal =>
          resolver.resolveBatch!(requests.map(request => ({...request, signal: combine(signal, request.signal)})), database))
      } : {}),
      resolve: (request, database) => withConsent(signal => resolver.resolve({...request, signal: combine(signal, request.signal)}, database))
    }
  }
}
