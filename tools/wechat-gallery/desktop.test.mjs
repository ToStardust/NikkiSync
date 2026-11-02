import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { readFileSync } from 'node:fs';
test('renewed gallery QR uses the current network instead of the startup address',async()=>{
 const {WeChatGalleryService}=await import('../../apps/pc-companion/dist/src/wechat/WeChatGalleryService.js');
 let host='192.168.137.1';const hosts=[],qrHosts=[];
 const service=new WeChatGalleryService({host:()=>host,snapshot:async()=>({count:0}),reservePort:async()=>28081,
  qrSvg:async payload=>{qrHosts.push(JSON.parse(payload).host);return '<svg/>';},
  listen:async config=>{hosts.push(config.host);return {port:config.port,stop:async()=>{}};}});
 try{
  await service.start();await service.stop();host='10.1.4.35';await service.start();
  assert.deepEqual(hosts,['192.168.137.1','10.1.4.35']);assert.deepEqual(qrHosts,hosts);
 }finally{await service.stop();}
});
test('integrated desktop QR/status/close uses local token and never exposes QR secret via status',async()=>{
 const {createDesktopControlServer}=await import('../../apps/pc-companion/dist/src/desktop/DesktopControlServer.js');
 let started=0,closed=0;
 const server=createDesktopControlServer({getStatus:()=>({service:'ready',host:'192.168.1.8',port:28080,assets:12,pairedDevices:1,firstRun:false}),createPairingUri:()=>'',qrSvg:async()=>'<svg/>',
  wechatGallery:{start:async()=>{started++;return {state:'waiting',photoCount:12,originalsSent:0,qrSvg:'<svg/>'};},status:()=>({state:'waiting',photoCount:12,originalsSent:0}),stop:async()=>{closed++;}}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 try{
  const html=await(await fetch(base)).text();assert.match(html,/首次使用引导/);assert.doesNotMatch(html,/id="wechat-start"|id="wechat-modal"|微信小程序/);assert.match(html,/Android App/);
  const token=/name="nikkisync-desktop-token" content="([^"]+)"/.exec(html)?.[1];assert.ok(token);
  const headers={'X-NikkiSync-Desktop-Token':token};
  assert.equal((await fetch(base+'/api/wechat/session',{method:'POST'})).status,403);
  assert.equal((await fetch(base+'/api/wechat/session',{method:'POST',headers:{...headers,Origin:'https://evil.example'}})).status,403);
  assert.equal((await fetch(base+'/api/wechat/session',{method:'POST',headers})).status,200);assert.equal(started,1);
  const state=await(await fetch(base+'/api/wechat/status',{headers})).json();assert.doesNotMatch(JSON.stringify(state),/qrSvg|key|token/);
  assert.equal((await fetch(base+'/api/wechat/session',{method:'DELETE',headers})).status,200);assert.equal(closed,1);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('embedded gallery runtime works without reading MiniProgram source or loading node:sqlite in Bun', async()=>{
  const kit=await import('../../apps/pc-companion/dist/src/wechat/GalleryRuntime.mjs');
  assert.equal(typeof kit.createGalleryServer,'function');
  assert.equal(typeof kit.createIndexedPreviewSource,'function');
});

test('embedded fixed protocol modules use the host realm with separate cached exports',async()=>{
 const {clientApi}=await import('../../apps/pc-companion/dist/src/wechat/GalleryRuntime.mjs');
 const gallery=clientApi('gallery-channel'),noise=clientApi('noise-vendor'),wire=clientApi();
 assert.equal(clientApi('gallery-channel'),gallery);
 assert.notEqual(gallery,wire);
 assert.equal(Object.getPrototypeOf(gallery),Object.prototype,'fixed bundled code must not allocate another JavaScript VM');
 assert.equal(Object.getPrototypeOf(gallery),Object.getPrototypeOf(wire));
 assert.equal(Object.getPrototypeOf(noise),Object.getPrototypeOf(wire));
 assert.throws(()=>clientApi('unknown'));
});

test('closing the embedded protocol runtime drops its module cache without mutating issued exports',async()=>{
 const kit=await import('../../apps/pc-companion/dist/src/wechat/GalleryRuntime.mjs');
 const old=kit.clientApi(),oldPrototype=Object.getPrototypeOf(old);
 assert.equal(typeof kit.releaseProtocolRuntime,'function');
 kit.releaseProtocolRuntime();
 const fresh=kit.clientApi();
 assert.notEqual(fresh,old);assert.equal(Object.getPrototypeOf(fresh),oldPrototype);
 assert.equal(typeof old.frame,'function');
 assert.equal(typeof fresh.frame,'function');
 kit.releaseProtocolRuntime();
});
test('closing integrated panel during first poll hides QR and cannot restart connection polling',async()=>{
 const {wechatPanelScript}=await import('../../apps/pc-companion/dist/src/desktop/WeChatGalleryPanel.js');
 class Element{content='local-token';innerHTML='';hidden=true;disabled=false;textContent='';replaceChildren(){this.innerHTML='';}focus(){}}
 const elements=new Map(),el=selector=>{if(!elements.has(selector))elements.set(selector,new Element());return elements.get(selector);};
 let completePoll,connectionTimers=0,closed=0;
 runInNewContext(wechatPanelScript,{document:{querySelector:el,addEventListener(){}},window:{addEventListener(){}},Date,
  setInterval:(callback,delay)=>{if(delay===1000)connectionTimers++;return 1;},clearInterval(){},
  fetch:async(url,{method}={})=>{
   if(method==='POST')return {ok:true,json:async()=>({qrSvg:'<svg/>',expiresAt:new Date(Date.now()+600000).toISOString()})};
   if(method==='DELETE'){closed++;return {ok:true,json:async()=>({state:'closed'})};}
   return new Promise(resolve=>{completePoll=value=>resolve({ok:true,json:async()=>value});});
  }});
 const opening=el('#wechat-start').onclick();for(let i=0;!completePoll&&i<20;i++)await Promise.resolve();assert.ok(completePoll);
 await el('#wechat-close').onclick();completePoll({state:'waiting',photoCount:3,originalsSent:0});await opening;
 assert.equal(closed,1);assert.equal(el('#wechat-modal').hidden,true);assert.equal(el('#wechat-qr').innerHTML,'');assert.equal(connectionTimers,0);
});
test('desktop gallery is off until requested, renew stops old listener, close during snapshot cancels late start',async()=>{
  const {WeChatGalleryService}=await import('../../apps/pc-companion/dist/src/wechat/WeChatGalleryService.js');
  let built=0,stops=0,resolveSnapshot;
  const service=new WeChatGalleryService({host:'192.168.1.8',reservePort:async()=>33333,qrSvg:async()=>'<svg/>',
    snapshot:async()=>{built++;return {count:3};},
    listen:async(config,source,events)=>{events.authenticated();return {port:33333,stop:async()=>{stops++;}};}});
  assert.equal(built,0);assert.equal(service.status().state,'idle');
  const first=await service.start();assert.equal(first.photoCount,3);assert.equal(first.qrSvg,'<svg/>');
  assert.equal(service.status().state,'connected');
  assert.doesNotMatch(JSON.stringify(service.status()),/key|qrSvg|token/);
  await service.start();assert.equal(stops,1);
  await service.stop();assert.equal(stops,2);assert.equal(service.status().state,'closed');
  const delayed=new WeChatGalleryService({host:'192.168.1.8',qrSvg:async()=>'<svg/>',
    snapshot:()=>new Promise(resolve=>{resolveSnapshot=resolve;}),
    listen:async()=>{throw new Error('Must not listen after cancellation');}});
  const starting=delayed.start();for(let i=0;!resolveSnapshot&&i<10;i++)await Promise.resolve();await delayed.stop();resolveSnapshot({count:1});
  await assert.rejects(starting);assert.equal(delayed.status().state,'closed');
});
test('packaging integrates one gallery service with scanning/APK pairing, no separate node process',()=>{
  const app=readFileSync(new URL('../../apps/pc-companion/src/windows-app.ts',import.meta.url),'utf8');
  assert.match(app,/new WeChatGalleryService/);assert.match(app,/wechatGallery:/);
  assert.match(app,/await wechat\.stop\(\)/);
  assert.doesNotMatch(app,/spawn\([^\n]*node/);
});
