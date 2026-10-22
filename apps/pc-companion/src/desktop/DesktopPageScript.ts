import {extraScanDirectoriesScript} from './ExtraScanDirectoriesPanel.js'
export const desktopPageScript = `
(()=>{
  const shell=document.querySelector('.app-shell');
  let activeDialog,returnFocus;
  window.nikkiDesktop={
    openDialog(dialog,focusTarget,trigger){
      activeDialog=dialog;returnFocus=trigger;dialog.hidden=false;shell.inert=true;focusTarget?.focus();
    },
    closeDialog(dialog){
      dialog.hidden=true;
      if(activeDialog===dialog){activeDialog=undefined;shell.inert=false;returnFocus?.focus();returnFocus=undefined;}
    }
  };
  document.addEventListener('keydown',event=>{
    if(event.key!=='Tab'||!activeDialog)return;
    const items=[...activeDialog.querySelectorAll('button:not([disabled]):not([hidden]),input:not([disabled]),a[href]')].filter(item=>item.getClientRects().length>0);
    if(!items.length){event.preventDefault();return;}
    const first=items[0],last=items[items.length-1];
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  });

  const headings={connect:['暖暖相册','电脑里的风景与穿搭，在手机上慢慢欣赏。'],settings:['同步设置','管理这台电脑的连接与启动偏好。'],about:['关于','版本、更新与项目仓库。']};
  const navigation=[...document.querySelectorAll('[data-view]')];
  let desktopView='connect';
  function showDesktopView(view){
    desktopView=view;
    for(const page of document.querySelectorAll('[data-page]'))page.hidden=page.dataset.page!==view;
    for(const item of navigation){if(item.dataset.view===view)item.setAttribute('aria-current','page');else item.removeAttribute('aria-current');}
    document.querySelector('#desktop-title').textContent=headings[view][0];
    document.querySelector('#desktop-subtitle').textContent=headings[view][1];
    if(view==='settings')void loadExtraDirectories();
  }
  for(const button of navigation)button.onclick=()=>showDesktopView(button.dataset.view);
  document.querySelector('#open-network-settings').onclick=()=>{showDesktopView('settings');document.querySelector('#network-permission-section').scrollIntoView?.({block:'start'});};
  document.querySelector('#open-scan-settings').onclick=()=>{showDesktopView('settings');showDirectoryGuide(true);document.querySelector('#extra-scan-section').scrollIntoView?.({block:'start'});document.querySelector('#scan-directory-help').focus();};

  const bridge=window.chrome?.webview,autostart=document.querySelector('#autostart');
  const authorize=document.querySelector('#authorize-network'),revoke=document.querySelector('#revoke-network');
  let networkAuthorized=false,networkCanRevoke=false;
  authorize.disabled=!bridge;revoke.disabled=true;
  authorize.onclick=()=>bridge?.postMessage({type:'authorizeNetwork'});
  revoke.onclick=()=>bridge?.postMessage({type:'revokeNetwork'});
  if(!bridge)document.querySelector('#network-authorization-note').textContent='请在 Windows 应用内点击“允许手机连接”完成网络授权。';
  const installer=document.querySelector('#android-installer'),installerNote=document.querySelector('#android-installer-note');
  const installerUnavailable=document.querySelector('#android-installer-unavailable');
  const updates=document.querySelector('#check-updates'),updateDot=document.querySelector('#about-update-dot');
  updates.disabled=!bridge;
  if(!bridge)document.querySelector('#desktop-update-note').textContent='打开百度网盘下载新版，或在 Windows 应用内检查一键更新。';
  updates.onclick=()=>bridge?.postMessage({type:'checkUpdates'});
  for(const link of document.querySelectorAll('[data-project]'))link.onclick=event=>{
    if(bridge){event.preventDefault();bridge.postMessage({type:'openProjectLink',project:link.dataset.project});}
  };
  installer.hidden=true;installerNote.hidden=true;
  installer.onclick=()=>bridge?.postMessage({type:'saveAndroidInstaller'});
  autostart.disabled=true;
  bridge?.addEventListener('message',event=>{
    void handleExtraDirectoryMessage(event);
    if(event.data?.type==='networkAuthorization'){
      if(typeof event.data.authorized==='boolean')networkAuthorized=event.data.authorized;
      if(typeof event.data.canRevoke==='boolean')networkCanRevoke=event.data.canRevoke;
      authorize.disabled=!!event.data.busy||networkAuthorized;
      revoke.disabled=!!event.data.busy||!networkCanRevoke;
      authorize.textContent=networkAuthorized?'已添加本地网络权限':'连接排障：允许手机连接';
      if(typeof event.data.message==='string'){
        document.querySelector('#network-authorization-note').textContent=event.data.message;
        document.querySelector('#network-home-note').textContent=networkAuthorized?'本助手已添加本地网络权限。电脑和手机仍需连接同一 Wi-Fi，或让电脑连接这台手机的热点；若仍连接超时，可到同步设置查看授权状态。':'电脑和手机连接同一 Wi-Fi，或让电脑连接这台手机的热点。扫码后连接超时，可到同步设置点击“允许手机连接”，在 Windows 弹窗中选择“是”；已能连接时无需操作。';
      }
    }
    if(event.data?.type==='autostart'){autostart.checked=!!event.data.enabled;autostart.disabled=false;}
    if(event.data?.type==='packageInfo'){
      installer.hidden=installerNote.hidden=!event.data.hasAndroidInstaller;
      installerUnavailable.hidden=!!event.data.hasAndroidInstaller;
      if(typeof event.data.version==='string')document.querySelector('#desktop-version').textContent='版本 '+event.data.version+(event.data.build?' · 构建号 '+event.data.build:'');
      const available=typeof event.data.availableUpdateVersion==='string'&&event.data.availableUpdateVersion.length>0;
      updateDot.hidden=!available;updates.textContent=available?'更新至 '+event.data.availableUpdateVersion:'检查更新';
      if(available)document.querySelector('#desktop-update-note').textContent='发现新版本，点击查看更新内容。';
      else if(bridge)document.querySelector('#desktop-update-note').textContent='网盘下载新版，或检查签名更新源进行一键更新。';
    }
  });
  ${extraScanDirectoriesScript}
  bridge?.postMessage({type:'getAutostart'});
  if(!bridge)document.querySelector('#autostart-note').textContent='请在 Windows 应用内设置。';
  autostart.onchange=()=>{autostart.disabled=true;bridge?.postMessage({type:'setAutostart',enabled:autostart.checked});};

  const modal=document.querySelector('#modal'),qr=document.querySelector('#modal-qr'),message=document.querySelector('#pairing-message');
  const renew=document.querySelector('#renew'),retry=document.querySelector('#pairing-retry'),close=document.querySelector('#close');
  let generation=0;
  function dismiss(){generation++;qr.replaceChildren();message.textContent='';renew.disabled=false;window.nikkiDesktop.closeDialog(modal);}
  async function pair(){
    const current=++generation;qr.replaceChildren();retry.hidden=true;renew.disabled=true;message.textContent='正在生成配对二维码…';
    window.nikkiDesktop.openDialog(modal,close,renew);
    try{
      const response=await fetch('/api/pairing',{method:'POST'});
      if(!response.ok)throw new Error();
      const data=await response.json();if(current!==generation)return;
      if(typeof data.qrSvg!=='string'||!data.qrSvg.includes('<svg'))throw new Error();
      qr.innerHTML=data.qrSvg;message.textContent='用 NikkiSync App 扫码 · 配对码 5 分钟内有效';
    }catch{if(current===generation){message.textContent='二维码生成失败，请重试。';retry.hidden=false;}}
    finally{if(current===generation)renew.disabled=false;}
  }
  renew.onclick=pair;retry.onclick=pair;close.onclick=dismiss;
  modal.onclick=event=>{if(event.target===modal)dismiss();};
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!modal.hidden)dismiss();});

  let polling=false,disposed=false;
  const updateStatus=async()=>{
    if(polling||disposed||document.hidden)return;polling=true;
    try{
      const response=await fetch('/api/status');if(!response.ok)throw new Error();
      const status=await response.json();if(disposed)return;
      document.querySelector('#desktop-assets').textContent=String(status.assets);
      document.querySelector('#desktop-devices').textContent=String(status.pairedDevices);
      document.querySelector('#desktop-address').textContent=status.host+':'+status.port;
      document.querySelector('#desktop-status-text').textContent='同步服务运行中';
      document.querySelector('#desktop-status').dataset.state='ready';
      const first=document.querySelector('#android-first-pairing'),paired=document.querySelector('#android-paired');
      if(status.pairedDevices>0){if(first){first.hidden=true;first.querySelector('.qr')?.replaceChildren();}paired.hidden=false;}
      else if(!first||first.hidden)paired.hidden=true;
    }catch{
      if(!disposed){document.querySelector('#desktop-status-text').textContent='同步服务暂不可用';document.querySelector('#desktop-status').dataset.state='offline';}
    }finally{polling=false;}
  };
  const timer=setInterval(async()=>{await updateStatus();if(desktopView==='settings'&&!document.hidden&&!disposed)await loadExtraDirectories();},2000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void updateStatus();});
  window.addEventListener('pagehide',()=>{disposed=true;generation++;qr.replaceChildren();clearInterval(timer);});
})();
`
