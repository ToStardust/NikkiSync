import { desktopIcon as icon } from './DesktopIcons.js'

export const wechatPanelHtml = `<section class="connection-card glass" aria-labelledby="wechat-entry-title">
 <div class="channel-top"><span class="channel-icon wechat">${icon('wechat')}</span><span class="channel-tag">iPhone · Android</span></div>
 <h2 id="wechat-entry-title">微信小程序</h2><p class="channel-description">微信扫码，浏览相册，保存照片与视频。</p>
 <details id="wechat-entry-code" class="wechat-entry-code" open><summary>首次使用？微信扫码打开小程序</summary><img id="wechat-entry-image" src="/wechat-entry.png" alt="大喵相机助手微信小程序码" width="220" height="220"><p class="channel-note">先用微信扫一扫打开小程序，再扫描下方按钮生成的电脑连接码。<br>下次可从微信“最近使用的小程序”进入。</p></details>
 <ol class="connection-steps"><li><span class="step-number">1</span>用微信扫描上方小程序码</li><li><span class="step-number">2</span>在小程序内扫码连接电脑</li><li><span class="step-number">3</span>挑选照片，保存原图到手机</li></ol>
 <button id="wechat-start" class="primary channel-action" aria-haspopup="dialog">微信下载照片 ${icon('arrow')}</button><p id="wechat-summary" class="channel-note" aria-live="polite">照片与视频分别保存 · 连接有效 10 分钟</p>
 </section>`
export const wechatDialogHtml = `<div id="wechat-modal" class="modal" hidden><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="wechat-title" aria-describedby="wechat-description"><div class="dialog-header"><h2 id="wechat-title">连接微信小程序</h2><button id="wechat-close" class="icon-button" aria-label="收起二维码，保持连接">${icon('close')}</button></div><p id="wechat-description" class="dialog-description">先打开「大喵相机助手」小程序，<br>在小程序内扫描下方连接码。手机和电脑需在同一局域网。</p><div id="wechat-qr" class="qr"></div><p id="wechat-state" class="dialog-status" role="status"></p><p id="wechat-expiry" class="dialog-meta"></p><button id="wechat-renew" class="primary dialog-action">生成新连接二维码</button><button id="wechat-organizer" class="secondary dialog-action">收起二维码，前往最近删除</button><button id="wechat-stop" class="secondary dialog-action">结束微信连接</button><p class="dialog-note">收起二维码后仍保持连接，可以进入“最近删除”确认手机申请。<br>重新生成、结束连接或到期后需重新扫码。请勿转发二维码。</p></section></div>`
export const wechatPanelScript=`(()=>{
 const token=document.querySelector('meta[name="nikkisync-desktop-token"]').content;
 const entry=document.querySelector('#wechat-entry-code'),entryKey='momo.wechat-entry.seen.v1';
 function rememberEntry(){if(entry)entry.open=false;try{localStorage.setItem(entryKey,'1')}catch{}}
 if(entry){try{if(localStorage.getItem(entryKey)==='1')entry.open=false}catch{}entry.addEventListener?.('toggle',()=>{if(!entry.open)rememberEntry()});}
 const modal=document.querySelector('#wechat-modal'),qr=document.querySelector('#wechat-qr'),state=document.querySelector('#wechat-state'),expiry=document.querySelector('#wechat-expiry'),start=document.querySelector('#wechat-start'),renew=document.querySelector('#wechat-renew');
 let generation=0,timer,until,polling=false,svg='',sessionState='idle',creating=false;
 const api=async(method,path)=>{const r=await fetch('/api/wechat/'+path,{method,headers:{'X-NikkiSync-Desktop-Token':token}});if(!r.ok)throw new Error('连接未能开启，请确认电脑有局域网连接及可用照片后重试');return r.json()};
 function release(){clearInterval(timer);timer=undefined;qr.replaceChildren();expiry.textContent='';svg='';until=undefined;sessionState='idle';}
 function close(){modal.hidden=true;qr.replaceChildren();window.nikkiDesktop?.closeDialog(modal);start.focus();}
 async function stop(){const current=++generation;release();close();start.disabled=true;try{await api('DELETE','session');document.querySelector('#wechat-summary').textContent='微信连接已结束';}catch{document.querySelector('#wechat-summary').textContent='结束状态暂不可用，请检查连接';}finally{if(current===generation)start.disabled=renew.disabled=false;}}
 function show(){modal.hidden=false;qr.innerHTML=sessionState==='waiting'?svg:'';window.nikkiDesktop?.openDialog(modal,document.querySelector('#wechat-close'),start);}
 async function create(){if(creating)return;creating=true;const current=++generation;release();show();start.disabled=renew.disabled=true;state.textContent='准备照片与二维码…';
  try{const data=await api('POST','session');if(current!==generation)return;svg=data.qrSvg;until=data.expiresAt;if(!modal.hidden)qr.innerHTML=svg;
   const update=async()=>{if(current!==generation||polling||document.hidden)return;polling=true;try{const value=await api('GET','status');if(current!==generation)return;
    sessionState=value.state;state.textContent=({waiting:'等待扫码',connected:'手机已连接',disconnected:'手机连接已暂停，回到小程序可自动恢复',closed:'连接已结束',expired:'连接已过期',error:'连接暂不可用'})[value.state]||'准备中';
    if(['connected','disconnected'].includes(value.state)){if(value.state==='connected')rememberEntry();qr.replaceChildren();state.textContent+='。如需重新扫码，请生成新连接码。';renew.textContent='重新扫码：生成新连接码';}
    else renew.textContent='生成新连接二维码';
    document.querySelector('#wechat-summary').textContent=state.textContent;start.textContent='显示微信连接二维码';
    const seconds=Math.max(0,Math.ceil((Date.parse(until)-Date.now())/1000));expiry.textContent=value.photoCount+' 项 · 已发送 '+value.originalsSent+' 份照片/视频 · 剩余 '+Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');
    if(seconds===0||['closed','expired','error'].includes(value.state)){svg='';qr.replaceChildren();clearInterval(timer);start.textContent='微信下载照片';}
   }catch(e){if(current===generation){release();state.textContent=e.message}}finally{polling=false}};
   await update();if(current===generation&&svg)timer=setInterval(update,1000);
  }catch(e){if(current===generation)state.textContent=e.message}finally{creating=false;if(current===generation)start.disabled=renew.disabled=false}}
 start.onclick=()=>svg&&Date.parse(until)>Date.now()&&!['closed','expired','error'].includes(sessionState)?show():create();renew.onclick=create;document.querySelector('#wechat-close').onclick=close;document.querySelector('#wechat-stop').onclick=stop;
 document.querySelector('#wechat-organizer').onclick=()=>{close();document.querySelector('[data-view="organizer"]')?.click();};
 modal.onclick=e=>{if(e.target===modal)void close()};document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!modal.hidden)void close()});
 window.addEventListener('pagehide',()=>{generation++;release();void fetch('/api/wechat/session',{method:'DELETE',headers:{'X-NikkiSync-Desktop-Token':token},keepalive:true})});
})();`
