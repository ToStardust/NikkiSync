import assert from 'node:assert/strict'
import test from 'node:test'
import http from 'node:http'
import { createDesktopControlServer } from '../src/desktop/DesktopControlServer.js'

test('online metadata settings reject cross-site or unauthenticated changes and require the reviewed policy version',async()=>{
  let enabled=false
  const server=createDesktopControlServer({getStatus:()=>({service:'ready',host:'127.0.0.1',port:1,assets:0,pairedDevices:1,firstRun:false}),
    createPairingUri:()=>'',qrSvg:async()=>'<svg/>',metadataPrivacy:{
      getState:()=>({enabled,policyVersion:'current',recipients:[{name:'NUAN5',endpoint:'https://nuan5.pro/api/decode-photo2',fields:['游戏UID']}]}),
      setEnabled:(value,version)=>{if(value&&version!=='current')throw new Error('bad version');enabled=value}
    }})
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  try{
    const address=server.address();assert.ok(address&&typeof address!=='string');const root=`http://127.0.0.1:${address.port}`
    const html=await (await fetch(root)).text();const token=/name="nikkisync-desktop-token" content="([^"]+)"/.exec(html)![1]!
    assert.ok(html.includes('在线参数解析'))
    const headers={'x-nikkisync-desktop-token':token,'content-type':'application/json'}
    assert.equal((await fetch(root+'/api/privacy/metadata',{method:'POST',body:'{"enabled":true}'})).status,403)
    assert.equal((await fetch(root+'/api/privacy/metadata',{method:'POST',headers:{...headers,origin:'https://untrusted.test'},body:'{"enabled":true,"policyVersion":"current"}'})).status,403)
    assert.equal((await fetch(root+'/api/privacy/metadata',{method:'POST',headers,body:'{"enabled":true,"policyVersion":"old"}'})).status,400)
    assert.equal(enabled,false)
    assert.equal((await fetch(root+'/api/privacy/metadata',{method:'POST',headers,body:'{"enabled":true,"policyVersion":"current"}'})).status,200);assert.equal(enabled,true)
    assert.equal((await fetch(root+'/api/privacy/metadata',{method:'POST',headers,body:'{"enabled":false}'})).status,200);assert.equal(enabled,false)
    // Undici fetch rewrites Host; send the forged HTTP header directly.
    const forgedStatus=await new Promise<number>((resolve,reject)=>{
      const request=http.get(root+'/api/privacy/metadata',{headers:{...headers,host:'untrusted.test'}},response=>{response.resume();resolve(response.statusCode!)});request.on('error',reject)
    })
    assert.equal(forgedStatus,403)
  }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}
})
