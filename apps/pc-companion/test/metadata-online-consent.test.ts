import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { MetadataOnlineConsent } from '../src/metadata/MetadataOnlineConsent.js'

const recipients=[{name:'NUAN5',endpoint:'https://nuan5.pro/api/decode-photo2',fields:['游戏UID','编码参数','JPEG前缀MD5']}]
test('online decoding defaults on, preserves opt-out and validates explicit re-enabling and recipient changes',async()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'momo-consent-'));const file=path.join(dir,'consent.json')
  try{
    const gate=new MetadataOnlineConsent(file,recipients);assert.equal(gate.enabled(),true)
    gate.setEnabled(false)
    let calls=0;const resolver=gate.guard({id:'test',resolve:async()=>{calls++;return {metadata:{},provider:'test'}}})
    await assert.rejects(resolver.resolve({assetId:'a',uid:'u',nativeParamToken:'x'}));assert.equal(calls,0)
    assert.throws(()=>gate.setEnabled(true,'old'));assert.equal(gate.enabled(),false)
    gate.setEnabled(true,gate.state().policyVersion);await resolver.resolve({assetId:'a',uid:'u',nativeParamToken:'x'});assert.equal(calls,1)
    assert.equal(new MetadataOnlineConsent(file,recipients).enabled(),true)
    assert.equal(new MetadataOnlineConsent(file,[{...recipients[0]!,endpoint:'https://other.example.test'}]).enabled(),false)
    assert.equal(new MetadataOnlineConsent(file,recipients,true).enabled(),false)
    gate.setEnabled(false);assert.equal(new MetadataOnlineConsent(file,recipients).enabled(),false)
    assert.doesNotMatch(readFileSync(file,'utf8'),/nativeParam|"uid"|"assetId"/)
  }finally{rmSync(dir,{recursive:true,force:true})}
})
test('withdrawal aborts pending work and rejects subsequent requests without changing existing media',async()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'momo-withdraw-'))
  try{
    const gate=new MetadataOnlineConsent(path.join(dir,'consent.json'),recipients);gate.setEnabled(true,gate.state().policyVersion)
    let calls=0;const resolver=gate.guard({id:'test',resolve:request=>{calls++;return new Promise((_,reject)=>request.signal!.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}))}})
    const pending=resolver.resolve({assetId:'a',uid:'u',nativeParamToken:'x'});gate.setEnabled(false)
    await assert.rejects(pending,/aborted/);await assert.rejects(resolver.resolve({assetId:'b',uid:'u',nativeParamToken:'x'}));assert.equal(calls,1)
  }finally{rmSync(dir,{recursive:true,force:true})}
})
