import { desktopIcon as icon } from './DesktopIcons.js'

export const wechatPanelHtml = `<section class="connection-card glass" aria-labelledby="wechat-entry-title">
 <div class="channel-top"><span class="channel-icon wechat">${icon('wechat')}</span><span class="channel-tag">开发测试</span></div>
 <h2 id="wechat-entry-title">微信小程序</h2><p class="channel-description">无需安装，在微信里打开你的相册。</p>
 <ol class="connection-steps"><li><span class="step-number">1</span>在电脑上生成连接二维码</li><li><span class="step-number">2</span>用微信「扫一扫」打开相册</li><li><span class="step-number">3</span>挑选照片，保存原图到手机</li></ol>
 <button id="wechat-start" class="primary channel-action" aria-haspopup="dialog">微信下载照片 ${icon('arrow')}</button><p class="channel-note">原图与参数 · Live 文件导出 · 连接有效 10 分钟</p>
 </section>`
export const wechatDialogHtml = `<div id="wechat-modal" class="modal" hidden><section class="dialog" role="dialog" aria-modal="true" aria-labelledby="wechat-title" aria-describedby="wechat-description"><div class="dialog-header"><h2 id="wechat-title">连接微信小程序</h2><button id="wechat-close" class="icon-button" aria-label="结束微信连接">${icon('close')}</button></div><p id="wechat-description" class="dialog-description">用微信「扫一扫」扫描下方二维码，<br>在「大喵相机助手」里浏览电脑相册。</p><div id="wechat-qr" class="qr"></div><p id="wechat-state" class="dialog-status" role="status"></p><p id="wechat-expiry" class="dialog-meta"></p><button id="wechat-renew" class="primary dialog-action">生成新连接二维码</button><p class="dialog-note">关闭连接面板或到期后，需重新扫码。请勿转发二维码。<br>已发送计数不代表手机相册保存成功。</p></section></div>`
export const wechatPanelScript=`(()=>{
 const token=document.querySelector('meta[name="nikkisync-desktop-token"]').content;
 const modal=document.querySelector('#wechat-modal'),qr=document.querySelector('#wechat-qr'),state=document.querySelector('#wechat-state'),expiry=document.querySelector('#wechat-expiry'),start=document.querySelector('#wechat-start'),renew=document.querySelector('#wechat-renew');
 let generation=0,timer,until,polling=false;
 const api=async(method,path)=>{const r=await fetch('/api/wechat/'+path,{method,headers:{'X-NikkiSync-Desktop-Token':token}});if(!r.ok)throw new Error('连接未能开启，请确认电脑有局域网连接及可用照片后重试');return r.json()};
 function release(){clearInterval(timer);timer=undefined;qr.replaceChildren();expiry.textContent='';}
 async function close(){const current=++generation;release();modal.hidden=true;start.disabled=true;window.nikkiDesktop?.closeDialog(modal);try{await api('DELETE','session')}catch{}finally{if(current===generation){start.disabled=false;start.focus()}}}
 async function create(){const current=++generation;release();modal.hidden=false;start.disabled=renew.disabled=true;state.textContent='准备照片与二维码…';window.nikkiDesktop?.openDialog(modal,document.querySelector('#wechat-close'),start);
  try{const data=await api('POST','session');if(current!==generation)return;qr.innerHTML=data.qrSvg;until=data.expiresAt;
   const update=async()=>{if(current!==generation||polling||document.hidden)return;polling=true;try{const value=await api('GET','status');if(current!==generation)return;
    state.textContent=({waiting:'等待扫码',connected:'手机已连接',disconnected:'手机连接已暂停，回到小程序可自动恢复',closed:'连接已结束',expired:'连接已过期',error:'连接暂不可用'})[value.state]||'准备中';
    const seconds=Math.max(0,Math.ceil((Date.parse(until)-Date.now())/1000));expiry.textContent=value.photoCount+' 张照片 · 已发送 '+value.originalsSent+' 份原图/Live资源 · 剩余 '+Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');
    if(seconds===0||['closed','expired','error'].includes(value.state)){qr.replaceChildren();clearInterval(timer)}
   }catch(e){if(current===generation){release();state.textContent=e.message}}finally{polling=false}};
   await update();if(current===generation&&!modal.hidden&&qr.innerHTML)timer=setInterval(update,1000);
  }catch(e){if(current===generation)state.textContent=e.message}finally{if(current===generation)start.disabled=renew.disabled=false}}
 start.onclick=create;renew.onclick=create;document.querySelector('#wechat-close').onclick=close;
 modal.onclick=e=>{if(e.target===modal)void close()};document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!modal.hidden)void close()});
 window.addEventListener('pagehide',()=>{generation++;release();void fetch('/api/wechat/session',{method:'DELETE',headers:{'X-NikkiSync-Desktop-Token':token},keepalive:true})});
})();`
