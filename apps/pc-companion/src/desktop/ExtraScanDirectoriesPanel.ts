export const extraScanDirectoriesHtml=`<section class="settings-card glass" id="extra-scan-section"><h2>额外扫描目录</h2>
<p class="page-subtitle">把游戏外的截图、搬迁的相册加入本机共享相册。可添加多个文件夹，重启后保留。确认后，已配对的手机都可访问其中的照片。</p>
<p class="page-subtitle">游戏内拼图会从 ScreenShot 自动补收，无需重复添加。搬迁后只找到 ScreenShot 也可以选择，助手会检查同一游戏目录下的隐藏原生相册，确认后一起加入。</p>
<div class="directory-help"><button type="button" id="scan-directory-help" class="secondary" aria-expanded="false" aria-controls="scan-directory-guide">不知道该选哪个文件夹？查看目录说明</button><div id="scan-directory-guide" class="directory-guide" hidden><p><strong>旋转吧大喵：</strong>打开它的“设置 → 输出目录”，选择实际保存照片的位置。默认通常为系统“视频”里的 <code>SpinningMomo</code>；改过位置时以软件设置为准。</p><p><strong>搬迁的游戏相册：</strong>优先选择 <code>GamePlayPhotos</code> 或下面的 UID 文件夹，可同时收录原图与 LIVE。也可选择搬迁后的游戏目录，助手会定位其中的相册。</p><p><strong>只想加入普通照片：</strong>选 <code>NikkiPhotos_HighQuality</code>（原图）或导出照片文件夹。不要选 <code>NikkiPhotos_LowQuality</code>（缩略图）。LIVE 需要封面与视频一起保留。</p><p>包含子文件夹；支持 JPG/JPEG、PNG、WebP 和原生 LIVE 配对。普通录像不会自动变成 LIVE；软件截图可能不带游戏拍摄参数。PNG/WebP 可原样保存，手机旋转保存当前请使用 JPEG。请选照片文件夹，避免选整个磁盘。</p></div></div>
<div class="about-actions"><button id="add-scan-directory" class="primary" disabled>添加文件夹</button><button id="add-spinning-directory" class="secondary" disabled>选择旋转吧大喵输出目录</button><button id="rescan-directories" class="secondary">重新扫描</button></div>
<p id="scan-directory-message" class="page-subtitle" role="status">添加前会显示识别结果，由你确认后开始扫描。移除只停止扫描和分享，不删除原文件。</p>
<div id="scan-directory-preview" hidden style="margin:16px 0;padding:16px;border:1px solid var(--border);border-radius:16px"><p id="scan-directory-preview-roots" style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px"></p><p id="scan-directory-preview-note" class="page-subtitle"></p><div class="about-actions"><button id="confirm-scan-directory" class="primary">确认加入共享相册</button><button id="cancel-scan-directory" class="secondary">取消</button></div></div>
<div id="scan-directory-list" aria-label="已添加的额外扫描目录"></div><details class="automatic-directories"><summary>默认相册 · 自动发现与同步 <span>查看目录</span></summary><p class="page-subtitle">优先读取原生照片参数，同时补收 ScreenShot 中的拼图与独有照片；导出副本不会重复展示。</p><div id="automatic-scan-directories"></div></details>
<p class="page-subtitle">修改目录后，Android App 会自动同步变化；照片较多时请等待扫描完成。</p></section>`

export const extraScanDirectoriesScript=String.raw`
  const extraHelp=document.querySelector('#scan-directory-help'),extraGuide=document.querySelector('#scan-directory-guide');
  function showDirectoryGuide(open){extraGuide.hidden=!open;extraHelp.setAttribute('aria-expanded',String(open));extraHelp.textContent=open?'收起目录说明':'不知道该选哪个文件夹？查看目录说明';}
  showDirectoryGuide(false);
  extraHelp.onclick=()=>showDirectoryGuide(extraGuide.hidden);
  const extraAdd=document.querySelector('#add-scan-directory'),extraSpinning=document.querySelector('#add-spinning-directory'),extraRescan=document.querySelector('#rescan-directories');
  const extraMessage=document.querySelector('#scan-directory-message'),extraPreview=document.querySelector('#scan-directory-preview');
  let extraBusy=false,extraLoading=false,extraProposal,extraRemoval,extraLastState;
  extraAdd.disabled=extraSpinning.disabled=!bridge;
  const extraErrors={invalid_directory:'请选择一个有效的照片文件夹。',directory_unavailable:'目录暂时无法读取，请确认磁盘在线且有访问权限。',choose_subfolder:'请选具体的照片文件夹，不要选择整个磁盘或共享根目录。',thumbnail_only:'这是缩略图目录。请选择同级 NikkiPhotos_HighQuality，或上一级 UID / GamePlayPhotos 文件夹。',choose_photo_folder:'未在这里找到相册，请直接选择实际保存照片的文件夹。',too_many_directories:'最多添加16个目录，请先移除不再使用的目录。',already_covered:'此目录已被默认相册或已添加目录覆盖，或与其重叠，无需重复添加。',selection_expired:'选择结果已过期，请重新选择文件夹。',directory_not_found:'此目录已被移除，请刷新后重试。',scan_unavailable:'扫描操作未完成，请稍后重试。'};
  async function extraRequest(action,body){
    const token=document.querySelector('meta[name="nikkisync-desktop-token"]')?.content||'';
    const response=await fetch('/api/scan-directories'+(action?'/'+action:''),{method:body?'POST':'GET',headers:{'x-nikkisync-desktop-token':token,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const value=await response.json();if(!response.ok)throw new Error(extraErrors[value.error]||'暂时无法管理扫描目录，请确认已打开新版电脑助手。');return value;
  }
  function extraButtons(){extraAdd.disabled=extraSpinning.disabled=!bridge||extraBusy;extraRescan.disabled=extraBusy;document.querySelector('#confirm-scan-directory').disabled=extraBusy;document.querySelector('#cancel-scan-directory').disabled=extraBusy;}
  function renderExtraState(state){
    extraLastState=state;const list=document.querySelector('#scan-directory-list');list.replaceChildren();
    for(const item of state.directories||[]){
      const row=document.createElement('div');row.className='scan-folder-card';
      const title=document.createElement('strong');title.textContent=item.path.split(/[\\/]/).filter(Boolean).pop()||'照片目录';row.appendChild(title);
      const name=document.createElement('p');name.textContent=item.path;name.className='scan-folder-path';row.appendChild(name);
      const spinning=item.source==='spinning_momo'||item.source===undefined&&/(?:^|[/\\\\])(?:SpinningMomo|旋转吧大喵)(?:[/\\\\]|$)/i.test(item.path);
      const mode=document.createElement('p');mode.className='page-subtitle';mode.textContent=item.mode==='native'?'暖暖原生相册 · 包含子文件夹':spinning?'旋转吧大喵 · 包含子文件夹':'外部图片目录 · 包含子文件夹';row.appendChild(mode);
      if(item.mode==='images'){const source=document.createElement('button');source.dataset.action='mark-spinning-momo';source.className='secondary';source.textContent=spinning?'取消旋转吧大喵标记':'标记为旋转吧大喵';source.disabled=extraBusy;source.onclick=()=>extraOperation(()=>extraRequest('source',{id:item.id,source:spinning?'other':'spinning_momo'}));row.appendChild(source);}
      const remove=document.createElement('button');remove.dataset.action='remove-scan-directory';remove.className='secondary';remove.textContent=extraRemoval===item.id?'确认移除（保留原文件）':'移除';remove.disabled=extraBusy;
      remove.onclick=async()=>{if(extraBusy)return;if(extraRemoval!==item.id){extraRemoval=item.id;renderExtraState(extraLastState);return;}await extraOperation(async()=>{await extraRequest('remove',{id:item.id});extraRemoval=undefined;});};row.appendChild(remove);list.appendChild(row);
    }
    if(!(state.directories||[]).length){const empty=document.createElement('p');empty.className='page-subtitle';empty.textContent='尚未添加额外目录，默认游戏相册仍会自动扫描。';list.appendChild(empty);}
    const automatic=document.querySelector('#automatic-scan-directories');automatic.replaceChildren();
    const roots=(state.automaticRoots||[]).filter((root,index,all)=>!all.some((parent,other)=>other!==index&&root.toLowerCase().startsWith(parent.toLowerCase()+'\\')));
    for(const root of roots){const row=document.createElement('div');row.className='scan-folder-card';const label=document.createElement('strong');label.textContent=/ScreenShot$/i.test(root)?'拼图与导出补充':'游戏原生相册';row.appendChild(label);const value=document.createElement('p');value.className='scan-folder-path';value.textContent=root;row.appendChild(value);automatic.appendChild(row);}
    if(!roots.length)automatic.textContent='尚未找到默认游戏相册，可添加照片文件夹使用。';
    if(!extraBusy&&state.message)extraMessage.textContent=state.message;
    if(state.busy&&!extraBusy)extraMessage.textContent='正在扫描目录，照片较多时可能需要一些时间…';
  }
  async function loadExtraDirectories(){
    if(extraLoading)return;extraLoading=true;
    try{renderExtraState(await extraRequest(''));}catch(error){if(!extraBusy)extraMessage.textContent=error.message;}finally{extraLoading=false;}
  }
  async function extraOperation(work){
    if(extraBusy)return;extraBusy=true;extraButtons();extraMessage.textContent='正在更新目录并扫描照片，照片较多时可能需要一些时间…';
    try{await work();extraBusy=false;await loadExtraDirectories();if(!document.querySelector('#sync-account-content').hidden)void loadSyncAccounts();}catch(error){extraMessage.textContent=error.message;}finally{extraBusy=false;extraButtons();if(extraLastState)renderExtraState({...extraLastState,message:extraMessage.textContent});}
  }
  extraAdd.onclick=()=>{if(!extraBusy)bridge?.postMessage({type:'chooseExtraScanDirectory'});};
  extraSpinning.onclick=()=>{if(!extraBusy)bridge?.postMessage({type:'chooseSpinningMomoDirectory'});};
  extraRescan.onclick=()=>extraOperation(()=>extraRequest('rescan',{}));
  document.querySelector('#cancel-scan-directory').onclick=()=>{extraProposal=undefined;extraPreview.hidden=true;};
  document.querySelector('#confirm-scan-directory').onclick=()=>{if(extraProposal)return extraOperation(async()=>{await extraRequest('confirm',{proposalId:extraProposal});extraProposal=undefined;extraPreview.hidden=true;});};
  async function handleExtraDirectoryMessage(event){
    if(event.data?.type==='extraScanDirectoryError'){extraMessage.textContent='无法打开文件夹选择器，请关闭其他选择窗口后重试。';return;}
    if(event.data?.type!=='extraScanDirectorySelected'||typeof event.data.path!=='string'||extraBusy)return;
    extraBusy=true;extraButtons();extraPreview.hidden=true;extraMessage.textContent='正在识别所选目录…';
    try{
      const proposal=await extraRequest('inspect',{path:event.data.path,...(event.data.source==='spinning_momo'?{source:'spinning_momo'}:{})});extraProposal=proposal.id;
      document.querySelector('#scan-directory-preview-roots').textContent=proposal.roots.map(item=>item.path).join('\n');
      document.querySelector('#scan-directory-preview-note').textContent='预览发现'+(proposal.limited?'至少':'')+proposal.images+'张图片、'+proposal.videos+'段视频。'+proposal.hint+(proposal.limited?'此处为有限预览，加入后会完整扫描。':'');
      extraPreview.hidden=false;extraMessage.textContent='请核对以上目录，确认后才会开始共享。';
    }catch(error){extraMessage.textContent=error.message;}finally{extraBusy=false;extraButtons();}
  }
`
