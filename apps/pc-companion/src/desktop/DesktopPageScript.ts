import {extraScanDirectoriesScript} from './ExtraScanDirectoriesPanel.js'
import {organizerScript} from './OrganizerPanel.js'
import {accountSyncScript} from './AccountSyncPanel.js'
import {inspirationScript} from './InspirationPanel.js'
export const desktopPageScript = `
${organizerScript}
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

  const headings={connect:['暖暖相册','电脑里的风景与穿搭，在手机上慢慢欣赏。'],settings:['同步设置','管理这台电脑的连接与启动偏好。'],organizer:['最近删除','核对手机整理的照片，确认后移入电脑回收站。'],inspiration:['灵感库','收藏喜欢的染色码、搭配码和穿搭参考图。'],about:['关于','版本、更新与项目仓库。']};
  const navigation=[...document.querySelectorAll('[data-view]')];
  let desktopView='connect';
  function showDesktopView(view){
    desktopView=view;
    for(const page of document.querySelectorAll('[data-page]'))page.hidden=page.dataset.page!==view;
    for(const item of navigation){if(item.dataset.view===view)item.setAttribute('aria-current','page');else item.removeAttribute('aria-current');}
    document.querySelector('#desktop-title').textContent=headings[view][0];
    document.querySelector('#desktop-subtitle').textContent=headings[view][1];
    if(view==='settings')void loadExtraDirectories();
    if(view==='inspiration')void loadInspiration();
  }
  for(const button of navigation)button.onclick=()=>showDesktopView(button.dataset.view);
  ${inspirationScript}
  document.querySelector('#open-network-settings').onclick=()=>{showDesktopView('settings');document.querySelector('#network-permission-section').scrollIntoView?.({block:'start'});};
  document.querySelector('#open-scan-settings').onclick=()=>{showDesktopView('settings');showDirectoryGuide(true);document.querySelector('#extra-scan-section').scrollIntoView?.({block:'start'});document.querySelector('#scan-directory-help').focus();};
  document.querySelector('#self-check-network-settings').onclick=()=>document.querySelector('#open-network-settings').click();
  document.querySelector('#self-check-scan-settings').onclick=()=>document.querySelector('#open-scan-settings').click();

  const bridge=window.chrome?.webview,autostart=document.querySelector('#autostart');
  const diagnosticButtons=[document.querySelector('#export-connection-diagnostics'),document.querySelector('#pairing-export-diagnostics'),document.querySelector('#about-export-diagnostics')];
  let diagnosticBusy=false;
  for(const button of diagnosticButtons){button.disabled=!bridge;button.onclick=()=>{if(!bridge||diagnosticBusy)return;diagnosticBusy=true;for(const item of diagnosticButtons)item.disabled=true;bridge.postMessage({type:'exportConnectionDiagnostics'});};}
  const sendDiagnostics=document.querySelector('#send-support-diagnostics');
  sendDiagnostics.disabled=!bridge;
  sendDiagnostics.onclick=()=>{
    if(!bridge||sendDiagnostics.disabled)return;
    sendDiagnostics.disabled=true;
    bridge.postMessage({type:'sendSupportDiagnostics'});
  };
  const authorize=document.querySelector('#authorize-network'),revoke=document.querySelector('#revoke-network');
  let networkAuthorized=false,networkCanRevoke=false;
  authorize.disabled=!bridge;revoke.disabled=true;
  authorize.onclick=()=>bridge?.postMessage({type:'authorizeNetwork'});
  revoke.onclick=()=>bridge?.postMessage({type:'revokeNetwork'});
  const conflictCheck=document.querySelector('#check-network-conflicts'),conflictRepair=document.querySelector('#repair-network-conflicts'),conflictRestore=document.querySelector('#restore-network-conflicts');
  let conflictBusy=false,conflictAllowed=true,authorizationBusy=false;
  function conflictButtons(){conflictCheck.disabled=conflictRestore.disabled=!bridge||conflictBusy||authorizationBusy;conflictRepair.disabled=!bridge||conflictBusy||authorizationBusy||!conflictAllowed;}
  conflictCheck.onclick=()=>bridge?.postMessage({type:'checkNetworkConflicts'});
  conflictRepair.onclick=()=>bridge?.postMessage({type:'repairNetworkConflicts'});
  conflictRestore.onclick=()=>bridge?.postMessage({type:'restoreNetworkConflicts'});
  conflictButtons();
  if(!bridge)document.querySelector('#network-conflict-note').textContent='请在 Windows 助手中检查和修复连接权限。';
  if(!bridge)document.querySelector('#network-authorization-note').textContent='请在 Windows 应用内点击“允许手机连接”完成网络授权。';
  const updates=document.querySelector('#check-updates'),updateDot=document.querySelector('#about-update-dot');
  updates.disabled=!bridge;
  if(!bridge)document.querySelector('#desktop-update-note').textContent='可从夸克或百度网盘下载新版；一键更新请在 Windows 助手内使用。';
  updates.onclick=()=>bridge?.postMessage({type:'checkUpdates'});
  for(const link of document.querySelectorAll('[data-project]'))link.onclick=event=>{
    if(bridge){event.preventDefault();bridge.postMessage({type:'openProjectLink',project:link.dataset.project});}
  };
  autostart.disabled=true;
  bridge?.addEventListener('message',event=>{
    void handleExtraDirectoryMessage(event);
    if(event.data?.type==='connectionDiagnostics'){
      diagnosticBusy=!!event.data.busy;for(const button of diagnosticButtons)button.disabled=!bridge||diagnosticBusy;
      if(typeof event.data.message==='string')for(const note of document.querySelectorAll('[data-diagnostics-status]'))note.textContent=event.data.message;
    }
    if(event.data?.type==='supportDiagnostics'){
      sendDiagnostics.disabled=!bridge||!!event.data.busy;
      if(typeof event.data.message==='string')document.querySelector('#support-diagnostics-note').textContent=event.data.message;
    }
    if(event.data?.type==='networkConflicts'){
      conflictBusy=!!event.data.busy;if(typeof event.data.canRepair==='boolean')conflictAllowed=event.data.canRepair;
      conflictButtons();
      if(typeof event.data.message==='string')document.querySelector('#network-conflict-note').textContent=event.data.message;
    }
    if(event.data?.type==='networkAuthorization'){
      authorizationBusy=!!event.data.busy;conflictButtons();
      if(typeof event.data.authorized==='boolean')networkAuthorized=event.data.authorized;
      if(typeof event.data.canRevoke==='boolean')networkCanRevoke=event.data.canRevoke;
      authorize.disabled=!!event.data.busy||networkAuthorized;
      revoke.disabled=!!event.data.busy||!networkCanRevoke;
      authorize.textContent=networkAuthorized?'已添加本地网络权限':'连接排障：允许手机连接';
      document.querySelector('#permission-self-check').textContent=typeof event.data.message==='string'&&event.data.message.includes('暂时无法读取')
        ?'暂时无法确认 Windows 本地网络权限。请在“同步设置”重新检查；连接失败时仍可尝试授权。'
        :networkAuthorized?'已检测到本助手的本地网络允许规则。若手机仍连接失败，继续检查冲突规则或改用热点。':'尚未检测到本助手的本地网络允许规则。连接失败时到“同步设置”点击“允许手机连接”。';
      if(typeof event.data.message==='string'){
        document.querySelector('#network-authorization-note').textContent=event.data.message;
        document.querySelector('#network-home-note').textContent=networkAuthorized?'本助手已添加本地网络权限。电脑和手机仍需连接同一 Wi-Fi，或让电脑连接这台手机的热点；若仍连接超时，可到同步设置查看授权状态。':'电脑和手机连接同一 Wi-Fi，或让电脑连接这台手机的热点。扫码后连接超时，可到同步设置点击“允许手机连接”，在 Windows 弹窗中选择“是”；已能连接时无需操作。';
      }
    }
    if(event.data?.type==='syncServiceRestart'){document.querySelector('#restart-sync-service').disabled=!!event.data.busy||!bridge;if(typeof event.data.message==='string')document.querySelector('#sync-service-note').textContent=event.data.message;}
    if(event.data?.type==='autostart'){autostart.checked=!!event.data.enabled;autostart.disabled=false;document.querySelector('#autostart-note').textContent=event.data.message||'登录 Windows 后，自动准备照片同步。更新或移动程序后，首次打开会自动同步自启动路径。';}
    if(event.data?.type==='packageInfo'){
      if(typeof event.data.version==='string')document.querySelector('#desktop-version').textContent='版本 '+event.data.version+(event.data.build?' · 构建号 '+event.data.build:'');
      const available=typeof event.data.availableUpdateVersion==='string'&&Number.isSafeInteger(event.data.availableUpdateBuild)&&event.data.availableUpdateBuild>event.data.build;
      const revision=available&&event.data.availableUpdateVersion===event.data.version;
      updateDot.hidden=!available;updates.textContent=available?(revision?'更新当前版本修订':'更新至 '+event.data.availableUpdateVersion):'检查更新';
      if(available)document.querySelector('#desktop-update-note').textContent=revision?'发现同版本修订：当前构建 '+event.data.build+' → 新构建 '+event.data.availableUpdateBuild+'。点击查看修复内容。':'发现新版本 '+event.data.availableUpdateVersion+'，点击查看更新内容。';
      else if(bridge)document.querySelector('#desktop-update-note').textContent='网盘下载新版，或检查签名更新源进行一键更新。';
    }
  });
  ${extraScanDirectoriesScript}
  ${accountSyncScript}
  bridge?.postMessage({type:'getAutostart'});
  if(!bridge)document.querySelector('#autostart-note').textContent='请在 Windows 应用内设置。';
  autostart.onchange=()=>{autostart.disabled=true;bridge?.postMessage({type:'setAutostart',enabled:autostart.checked});};

  const modal=document.querySelector('#modal'),qr=document.querySelector('#modal-qr'),message=document.querySelector('#pairing-message');
  const renew=document.querySelector('#renew'),retry=document.querySelector('#pairing-retry'),pairingHelp=document.querySelector('#pairing-help'),close=document.querySelector('#close');
  const selfCheck=document.querySelector('.self-check');
  let generation=0;
  function dismiss(){generation++;qr.replaceChildren();message.textContent='';pairingHelp.hidden=true;renew.disabled=false;window.nikkiDesktop.closeDialog(modal);}
  async function pair(){
    const current=++generation;qr.replaceChildren();retry.hidden=true;pairingHelp.hidden=true;renew.disabled=true;message.textContent='正在生成配对二维码…';
    window.nikkiDesktop.openDialog(modal,close,renew);
    try{
      const response=await fetch('/api/pairing',{method:'POST'});
      if(!response.ok)throw new Error();
      const data=await response.json();if(current!==generation)return;
      if(typeof data.qrSvg!=='string'||!data.qrSvg.includes('<svg'))throw new Error();
      qr.innerHTML=data.qrSvg;message.textContent='用 NikkiSync App 扫码 · 配对码 5 分钟内有效';
    }catch{if(current===generation){message.textContent='二维码生成失败。请确认同步服务运行中；仍失败时检查电脑连接权限。';retry.hidden=false;pairingHelp.hidden=false;}}
    finally{if(current===generation)renew.disabled=false;}
  }
  renew.onclick=pair;retry.onclick=pair;close.onclick=dismiss;
  pairingHelp.onclick=()=>{dismiss();selfCheck.open=true;selfCheck.scrollIntoView?.({block:'center'});};
  modal.onclick=event=>{if(event.target===modal)dismiss();};
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!modal.hidden)dismiss();});

  const restartService=document.querySelector('#restart-sync-service'),serviceNote=document.querySelector('#sync-service-note');
  restartService.hidden=true;serviceNote.hidden=true;
  restartService.onclick=()=>{if(!bridge||restartService.disabled)return;restartService.disabled=true;serviceNote.textContent='正在重新启动同步服务，配对与照片记录会保留…';bridge.postMessage({type:'restartSyncService'});};
  let polling=false,disposed=false,wasServiceOnline=true;
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
      wasServiceOnline=true;
      document.querySelector('#connection-self-check').textContent='电脑同步服务正在运行。请继续确认手机与电脑在同一局域网；若仍超时，检查 Windows 权限和设备隔离。';
      restartService.hidden=true;serviceNote.hidden=true;restartService.disabled=false;renew.disabled=false;
      const first=document.querySelector('#android-first-pairing'),paired=document.querySelector('#android-paired');
      if(status.pairedDevices>0){if(first){first.hidden=true;first.querySelector('.qr')?.replaceChildren();}paired.hidden=false;}
      else if(!first||first.hidden)paired.hidden=true;
    }catch{
      if(!disposed){document.querySelector('#desktop-status-text').textContent='同步服务暂不可用';document.querySelector('#desktop-status').dataset.state='offline';
        document.querySelector('#connection-self-check').textContent='电脑同步服务暂不可用。点击上方“重启同步服务”，恢复后再让手机重试连接。';
        document.querySelector('#android-paired').hidden=true;const first=document.querySelector('#android-first-pairing');if(first){first.hidden=true;first.querySelector('.qr')?.replaceChildren();}
        generation++;qr.replaceChildren();renew.disabled=true;restartService.hidden=false;restartService.disabled=!bridge;serviceNote.hidden=false;
        if(wasServiceOnline&&desktopView==='connect'){selfCheck.open=true;selfCheck.scrollIntoView?.({block:'center'});}
        wasServiceOnline=false;
      }
    }finally{polling=false;}
  };
  const timer=setInterval(async()=>{await updateStatus();if(desktopView==='settings'&&!document.hidden&&!disposed)await loadExtraDirectories();if(desktopView==='inspiration'&&!document.hidden&&!disposed)maybeRefreshInspiration();},2000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)void updateStatus();});
  window.addEventListener('pagehide',()=>{disposed=true;generation++;qr.replaceChildren();clearInterval(timer);});
})();
`
