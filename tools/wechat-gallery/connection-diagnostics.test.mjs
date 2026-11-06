import test from'node:test';import assert from'node:assert/strict';import{randomBytes}from'node:crypto';import{clientApi}from'../wechat-crypto-spike/client-api.mjs';
const config=()=>({type:'NikkiSyncLocalGalleryLive',version:1,resume:1,deletion:1,host:'192.168.1.2',port:32123,key:randomBytes(32).toString('hex'),sessionId:randomBytes(16).toString('hex'),expiresAt:new Date(Date.now()+600000).toISOString()});
function fixture(){const events={},messages=[],progress=[];const wx={getRandomValues:o=>o.success({randomValues:Uint8Array.from(randomBytes(64)).buffer}),createTCPSocket:()=>({onConnect:f=>events.connect=f,onMessage:f=>events.message=f,onError:f=>events.error=f,onClose:f=>events.close=f,connect(){},write(){},close(){}})};
 const channel=clientApi('gallery-channel').connectGallery(wx,config(),{failed:m=>messages.push(m),progress:m=>progress.push(m)});return{events,messages,progress,channel};}
test('TCP failure is distinct from key verification and never echoes raw network diagnostics',()=>{
 const f=fixture();try{f.events.error({errMsg:'private address and raw system text'});assert.match(f.messages[0],/C02/);assert.doesNotMatch(f.messages[0],/private|192\.168/);}finally{f.channel.close()}
});
test('a closed socket after TCP connect reports handshake phase, not a completed session',()=>{
 const f=fixture();try{f.events.connect();f.events.close();assert.match(f.messages[0],/C03/);assert.ok(f.progress.includes('正在确认连接…'));}finally{f.channel.close()}
});
test('missing secure platform APIs are reported before attempting TCP',()=>{
 let message;const c=clientApi('gallery-channel').connectGallery({},config(),{failed:m=>message=m});try{assert.match(message,/C01/);}finally{c.close()}
});
