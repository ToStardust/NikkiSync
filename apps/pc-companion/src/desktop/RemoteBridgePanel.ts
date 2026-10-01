export const remotePanelCss = `
.remote-entry{margin:18px 0;padding:16px;border:1px solid #493b57;border-radius:16px;background:#211b2a}.remote-entry p{color:#cabed6;font-size:13px;line-height:1.6;margin:9px 0 0}.remote-dialog{width:min(490px,calc(100vw - 56px));max-height:86vh;overflow:auto;text-align:left}.remote-top{display:flex;align-items:center;justify-content:space-between;gap:12px}.remote-top h2{font-size:19px;margin:0}.remote-caption{color:#cabed6;line-height:1.6;font-size:13px}.remote-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:16px 0}.remote-photo{display:block;border:1px solid #53425f;border-radius:12px;overflow:hidden;background:#1c1723;cursor:pointer}.remote-photo:has(input:checked){border:2px solid #dfadff}.remote-photo img{width:100%;height:122px;object-fit:cover;background:#352c40}.remote-photo span{display:block;font-size:11px;color:#d3c8dc;padding:7px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.remote-photo input{margin:7px 0 0 7px;accent-color:#dfadff}.remote-footer{position:sticky;bottom:-22px;background:#282033;padding:14px 0 8px;display:flex;align-items:center;justify-content:space-between;gap:10px}.remote-message{color:#e6c8f8;font-size:13px;line-height:1.6}.remote-session{text-align:center}.remote-session h3{margin:14px 0 6px}.remote-session p{color:#cabed6;font-size:13px}.remote-session .qr svg{max-width:100%;height:auto}.primary:disabled{opacity:.45;cursor:default}[hidden]{display:none!important}
`

export const remotePanelHtml = `<section class="remote-entry"><button id="remote-open" class="primary">微信下载照片</button><p>选择想带到手机的照片，生成有效 10 分钟的连接二维码。<br>微信小程序接入测试中，请让电脑和手机连接同一 Wi-Fi。</p></section>
<div id="remote-modal" class="modal" hidden><section class="dialog remote-dialog" role="dialog" aria-modal="true" aria-labelledby="remote-title"><div class="remote-top"><h2 id="remote-title">选择照片</h2><button id="remote-close" class="secondary" aria-label="关闭照片连接">关闭</button></div><div id="remote-picker"><p class="remote-caption">仅开放你勾选的照片，最多 100 张。关闭二维码后，手机将无法继续下载。</p><div id="remote-grid" class="remote-grid"></div><button id="remote-more" class="secondary" hidden>加载更多</button><div class="remote-footer"><span id="remote-count">已选择 0 张</span><button id="remote-create" class="primary" disabled>生成连接二维码</button></div></div><div id="remote-session" class="remote-session" hidden><div id="remote-qr" class="qr"></div><h3 id="remote-state">等待扫码</h3><p id="remote-expiry"></p><p>请在 NikkiSync 微信小程序中扫一扫。<br>PC 连接测试版，小程序尚未发布。</p><button id="remote-end" class="secondary">结束连接</button></div><p id="remote-message" class="remote-message" role="status"></p></section></div>`

export const remotePanelScript = `
(()=>{
const token=document.querySelector('meta[name="nikkisync-desktop-token"]').content;
const modal=document.querySelector('#remote-modal'),grid=document.querySelector('#remote-grid'),picker=document.querySelector('#remote-picker'),sessionView=document.querySelector('#remote-session'),message=document.querySelector('#remote-message'),create=document.querySelector('#remote-create'),more=document.querySelector('#remote-more');
const selected=new Set(),urls=new Set();let cursor,sessionId,timer,controller,observer,busy=false,generation=0;
async function api(path,options={}){const r=await fetch('/api/remote/'+path,{...options,headers:{'X-NikkiSync-Desktop-Token':token,'Content-Type':'application/json',...options.headers}});if(!r.ok)throw new Error(r.status===410?'连接已结束，请重新生成二维码':'操作未完成，请重试');return r.json()}
function count(){document.querySelector('#remote-count').textContent='已选择 '+selected.size+' 张';create.disabled=selected.size===0||busy}
function release(){controller?.abort();observer?.disconnect();for(const url of urls)URL.revokeObjectURL(url);urls.clear();clearInterval(timer)}
async function end(){const id=sessionId;sessionId=undefined;if(id)try{await api('session/'+encodeURIComponent(id),{method:'DELETE'})}catch{} }
async function close(){generation++;modal.hidden=true;release();await end();document.querySelector('#remote-open').focus()}
async function load(){if(busy)return;busy=true;more.disabled=true;count();const current=generation;try{const page=await api('photos'+(cursor?'?cursor='+encodeURIComponent(cursor):''));if(current!==generation)return;cursor=page.nextCursor;for(const photo of page.items){const label=document.createElement('label');label.className='remote-photo';const input=document.createElement('input');input.type='checkbox';input.checked=selected.has(photo.resourceId);input.setAttribute('aria-label','选择 '+photo.fileName);input.onchange=()=>{if(input.checked&&selected.size>=100){input.checked=false;message.textContent='一次最多选择 100 张照片';return}input.checked?selected.add(photo.resourceId):selected.delete(photo.resourceId);count()};const img=document.createElement('img');img.alt=photo.fileName;img.dataset.resourceId=photo.previewResourceId||photo.resourceId;const name=document.createElement('span');name.textContent=photo.capturedAt?new Date(photo.capturedAt).toLocaleDateString():photo.fileName;label.append(img,input,name);grid.append(label);observer.observe(img)}more.hidden=!cursor;message.textContent=grid.children.length?'':'暂无可下载的普通照片'}catch(e){message.textContent=e.message}finally{if(current===generation){busy=false;more.disabled=false;count()}}}
document.querySelector('#remote-open').onclick=async()=>{await end();release();generation++;selected.clear();cursor=undefined;sessionId=undefined;busy=false;grid.replaceChildren();picker.hidden=false;sessionView.hidden=true;document.querySelector('#remote-title').textContent='选择照片';message.textContent='';modal.hidden=false;controller=new AbortController();observer=new IntersectionObserver(entries=>{for(const entry of entries){if(!entry.isIntersecting)continue;const img=entry.target;observer.unobserve(img);fetch('/api/remote/preview/'+encodeURIComponent(img.dataset.resourceId),{headers:{'X-NikkiSync-Desktop-Token':token},signal:controller.signal}).then(r=>{if(!r.ok)throw new Error();return r.blob()}).then(blob=>{if(!img.isConnected||modal.hidden)return;const url=URL.createObjectURL(blob);urls.add(url);img.src=url}).catch(()=>{})}},{root:document.querySelector('.remote-dialog'),rootMargin:'100px'});count();await load();if(!modal.hidden)document.querySelector('#remote-close').focus()};
more.onclick=load;document.querySelector('#remote-close').onclick=close;document.querySelector('#remote-end').onclick=close;modal.onclick=e=>{if(e.target===modal)void close()};document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!modal.hidden)void close()});
create.onclick=async()=>{
  if(busy||selected.size===0)return;
  busy=true;count();message.textContent='';const current=generation;
  try{
    const data=await api('session',{method:'POST',body:JSON.stringify({resourceIds:[...selected]})});
    if(current!==generation){await api('session/'+encodeURIComponent(data.sessionId),{method:'DELETE'});return}
    sessionId=data.sessionId;picker.hidden=true;sessionView.hidden=false;
    document.querySelector('#remote-title').textContent='连接二维码';
    document.querySelector('#remote-qr').innerHTML=data.qrSvg;
    document.querySelector('#remote-end').focus();
    let polling=false,finished=false;
    const update=async()=>{
      if(current!==generation||!sessionId)return;
      const seconds=Math.max(0,Math.ceil((Date.parse(data.expiresAt)-Date.now())/1000));
      document.querySelector('#remote-expiry').textContent='已选择 '+selected.size+' 张 · 剩余 '+Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');
      if(seconds===0){finished=true;document.querySelector('#remote-state').textContent='二维码已过期';document.querySelector('#remote-qr').replaceChildren();clearInterval(timer);return}
      if(polling)return;
      polling=true;
      try{
        const state=await api('session/'+encodeURIComponent(sessionId));
        if(current!==generation)return;
        document.querySelector('#remote-state').textContent=({created:'等待扫码',connected:'手机已连接',expired:'二维码已过期',closed:'连接已结束'})[state.state]||'连接已结束';
        if(state.state==='expired'||state.state==='closed'){finished=true;document.querySelector('#remote-qr').replaceChildren();clearInterval(timer)}
      }catch(e){if(current===generation)message.textContent=e.message}finally{polling=false}
    };
    await update();
    if(current===generation&&sessionId&&!finished)timer=setInterval(update,1000);
  }catch(e){if(current===generation)message.textContent=e.message}finally{if(current===generation){busy=false;count()}}
};
window.addEventListener('pagehide',()=>{if(sessionId)void fetch('/api/remote/session/'+encodeURIComponent(sessionId),{method:'DELETE',headers:{'X-NikkiSync-Desktop-Token':token},keepalive:true})});
})();
`
