const { parseGalleryQr, connectGallery } = require('../../lib/gallery-channel.js');
const { saveOriginalBatch } = require('../../lib/original-save.js');
const { createIconCache } = require('../../lib/icon-cache.js');
const { createGalleryCache } = require('../../lib/gallery-cache.js');
const { createLiveCache } = require('../../lib/live-gallery.js');
const { createShareCardJob, saveShareCard } = require('../../lib/share-card.js');
const {inspirationPage,inspirationData}=require('../../lib/inspiration-page.js');
const {deletionPage,deletionData}=require('../../lib/deletion-page.js');
const {profilePage,profileData}=require('../../lib/profile-page.js');
let sequence = 0;
const DETAIL_CACHE_MS = 60 * 1000;
const DETAIL_CACHE_LIMIT = 36;
function photoSaveMessage(message) {
  try {
    if (wx.getDeviceInfo?.().platform === 'ios') {
      return message + ' 找不到照片时，请在「照片」中按最近添加排序，或到「最近保存」查看。';
    }
  } catch (_) {}
  return message;
}
Page({
  ...inspirationPage,
  ...deletionPage,
  ...profilePage,
  data: { ...inspirationData,busy: false, connected: false, resumeAvailable:false, total: 0, photos: [], next: null, selectedPath: '', selectedDate: '', viewerOpen: false, viewerChrome: true, connectionOpen: false,
    popupMode: 'connection', popupPosition: 'bottom', popupOverlay: true, popupRound: true, popupDuration: 220, popupStyle: 'background:#FFFCF7;border-radius:32px 32px 0 0;',
    downloadEnabled: false, saving: false, saveStopping: false, retryCount: 0, selectionMode: false, selectedCount: 0, saveMessage: '', permissionDenied: false,
    ...deletionData,...profileData,viewerVideo:false,viewerLive:false,livePath:'',livePackPath:'',livePlaying:false,
    shareOpen:false,shareBusy:false,shareSaving:false,sharePath:'',sharePreviewHeight:0,shareIndex:0,shareCount:0,shareMessage:'',
    selectedId: '', viewerFrames: [], viewerIndex: -1, viewerPosition: 0, viewerSelected: false, viewerClosing: false, viewerPhase: 'open', viewerSettle: 0,
    viewerQuality: 'preview', viewerPreviewPath: '', viewerOriginalPath: '', originalReady: false, hdLoading: false, hdMessage: '',
    infoOpen: false, infoMounted: false, infoExpanded: false, infoPhase: 'exit', infoFrame: 0, infoSettle: 0, infoLoading: false, infoRows: [], infoMessage: '', reduceMotion: false, windowHeight: 800,
    windowWidth:400,viewerImageWidth:400,viewerImageHeight:800,writeExif:true,exportEnabled:false,browseEnabled:false,viewerRotation:0,viewerMime:'image/jpeg',rotationWidth:400,rotationHeight:800,groups:[],libraryTotal:0,
    searchText:'',filterVersion:'',filterFrom:'',filterTo:'',filtersOpen:false,filterActive:false,versionOptions:[{label:'全部版本',version:''}],versionIndex:0,
    outfitItems:[],outfitTotal:0,outfitOffset:0,outfitNext:null,outfitNote:'',
    ambientPath: '', pageStart: 0, pageEnd: 0, loaded: 0, dateSummary: '', message: '', connectionDiagnostic: '' },
  onLoad() { this._alive = true; this._generation = 0; this._connectionEpoch = 0; this._popupEpoch = 0; this._saveEpoch = 0; this._metadataEpoch = 0; this._viewerSeq = 0; this._popupClosing = false; this._files = new Set();
    this.initProfile?.();
    this._selected = new Set(); this._saved = new Map(); this._retryIds = []; this._previewCache = new Map(); this._hdEpoch = 0; this._polls = 0; this._infoSeq=0;this._motionTimers={};this._motionSerial={};this.resetViewerGesture();
    this._rotations=new Map();this._query={};this._shareEpoch=0;this._sharePaths=[];this._resumable=false;this._resumeOffset=0;this._resumeAttempts=0;
    this._outfitEpoch=0;this._outfits=new Map();this._outfitBusy=0;this._details=new Map();
    this._liveIds=new Set();this._liveEpoch=0;try{if(typeof createLiveCache==='function')this._liveCache=createLiveCache(wx);}catch(_){}
    try{if(typeof createIconCache==='function')this._iconCache=createIconCache(wx);}catch(_){}
    try{if(typeof createGalleryCache==='function')this._galleryCache=createGalleryCache(wx);}catch(_){}
    try{const info=wx.getWindowInfo?.()||{},height=info.windowHeight,width=info.windowWidth;this.setData({writeExif:wx.getStorageSync?.('nikkisync.writeExif')!==false,reduceMotion:wx.getStorageSync?.('nikkisync.reduceMotion')===true,windowHeight:Number.isFinite(height)&&height>0?height:800,windowWidth:Number.isFinite(width)&&width>0?width:400});}catch(_){} },
  toggleExif(event){if(this.data.saving)return;const enabled=typeof event?.detail?.value==='boolean'?event.detail.value:!this.data.writeExif;this.setData({writeExif:enabled});try{wx.setStorageSync?.('nikkisync.writeExif',enabled);}catch(_){}},
  searchChanged(event){this.setData({searchText:event.detail.value});},
  toggleFilters(){if(!this.data.saving)this.setData({filtersOpen:!this.data.filtersOpen});},
  versionChanged(event){const index=Number(event.detail.value),entry=this.data.versionOptions[index];if(entry)this.setData({versionIndex:index,filterVersion:entry.version});},
  fromChanged(event){this.setData({filterFrom:event.detail.value});},
  toChanged(event){this.setData({filterTo:event.detail.value});},
  applyFilters(){
    if(!this._alive||!this._active||!this.data.connected||this.data.busy||this.data.saving||this.data.infoLoading||this.data.hdLoading||this.data.viewerOpen||this.data.connectionOpen)return;
    if(!this.data.browseEnabled){this.setData({message:'版本分组与搜索需要电脑运行新版 EXE。'});return;}
    const text=this.data.searchText.trim(),from=this.data.filterFrom,to=this.data.filterTo;
    if(text.length>80){this.setData({message:'搜索文字最多 80 个字符。'});return;}
    if(from&&to&&from>to){this.setData({message:'开始日期不能晚于结束日期。'});return;}
    this._query={text,version:this.data.filterVersion,from,to,offsetMinutes:-new Date().getTimezoneOffset()};
    this.setData({filterActive:!!(text||from||to||this.data.filterVersion),filtersOpen:false});this.loadPage(0);
  },
  clearFilters() {
    if (this.data.busy || this.data.saving) return;
    this._query = {};
    this._resumeOffset = 0;
    this.setData({searchText:'',filterVersion:'',filterFrom:'',filterTo:'',versionIndex:0,filterActive:false,filtersOpen:false});
    if (this.data.connected) this.applyFilters();
  },
  groupsFor(photos){const groups=[];for(let n=0;n<photos.length;n++){const photo=Object.assign({},photos[n],{index:n}),version=photo.version||'',last=groups[groups.length-1];
    const group=last&&last.version===version?last:{version,label:version?version+' 版本':'版本未知',inferred:false,photos:[]};if(group!==last)groups.push(group);if(photo.versionSource==='inferred')group.inferred=true;group.photos.push(photo);}return groups;},
  rotatePhoto(){this.setRotation(((this.data.viewerRotation||0)+90)%360);},
  restoreRotation(){this.setRotation(0);},
  setRotation(angle){
    if(!this._alive||!this._active||!this.data.viewerOpen||this.data.viewerClosing||this.data.busy||this.data.saving||this.data.infoLoading||this.data.infoOpen||this.data.hdLoading)return;
    if(!this.data.exportEnabled){this.setData({hdMessage:'旋转保存需要电脑运行新版 EXE。'});return;}
    const id=this.data.selectedId;if(!id)return;this._rotations.set(id,angle);
    const photos=this.data.photos.map(x=>Object.assign({},x,{rotation:this._rotations.get(x.id)||0}));this.setData({photos,groups:this.groupsFor(photos)});this.displayPhoto(this.data.viewerIndex);
  },
  cancelMotion(name) {
    if(!this._motionTimers)return;
    if(this._motionTimers[name]!==undefined && typeof clearTimeout==='function')clearTimeout(this._motionTimers[name]);
    delete this._motionTimers[name];this._motionSerial[name]=(this._motionSerial[name] || 0)+1;
  },
  deferMotion(name,ms,action) {
    this.cancelMotion(name);const serial=this._motionSerial[name];
    if(typeof setTimeout!=='function'){action();return;}
    this._motionTimers[name]=setTimeout(()=>{
      if(!this._alive || !this._active || serial!==this._motionSerial[name])return;
      delete this._motionTimers[name];action();
    },ms);
  },
  toggleReducedMotion(event) {
    const reduced=typeof event?.detail?.value==='boolean'?event.detail.value:!this.data.reduceMotion;
    this.setData({reduceMotion:reduced});
    try{wx.setStorageSync?.('nikkisync.reduceMotion',reduced);}catch(_){}
  },
  onShow() { this._active = true;this.scheduleDeletionPolling?.();if(this._inspirationNativeHidden){this._inspirationNativeHidden=false;this._inspirationExternal=false;const result=this._inspirationExternalResult;this._inspirationExternalResult=null;result?.();return;} if (this._pending) { const config = this._pending; this._pending = null; this.connect(config); }else if(this._resumable){this._resumeAttempts=0;this.resumeConnection();} },
  onHide() {
    this.stopDeletionPolling?.();
    if(this._inspirationExternal){this._active=false;this._inspirationNativeHidden=true;this.stopRefresh();return;}
    if(this.data.inspirationOpen)this.closeInspiration();
    this._active=false;this.stopResume();this._resumeOffset=Math.max(0,this.data.pageStart-1);
    this._saveEpoch++;this._metadataEpoch++;this._generation++;
    const retained=this._resumable&&this._channel?.suspend?.()===true;this._resumable=!!retained;
    this.closeShareCard();
    this.resetViewerGesture();
    this.stopRefresh(); this.discardOriginal();if(!retained){this._selected.clear();this._saved.clear();}this._retryIds=[];
    this._saveJob?.cancel(); this._popupEpoch++; this._popupClosing = false;if(!retained){this._channel?.close();this._connectionEpoch++;}this.clearFiles(retained);
    if (this._alive) this.setData({resumeAvailable:!!retained,connectionOpen: false, ambientPath: '', saving: false, saveStopping: false, retryCount: 0, infoOpen: false, infoMounted: false, infoExpanded: false, infoPhase: 'exit', viewerClosing: false, viewerPhase: 'open', infoLoading: false, hdLoading: false, downloadEnabled: false, selectedCount:this._selected.size, selectionMode:retained&&this.data.selectionMode});
    if (this._alive && !this._scanning) this.setData({ connected: false, busy: false, photos: [],groups:[], selectedPath: '', viewerOpen: false, viewerChrome: true, message:retained?'连接已暂停，回到前台后自动恢复。':'连接已关闭。重新连接需要电脑生成新浏览码。' });
  },
  onUnload() {this.stopDeletionPolling?.();this._alive=false;this._active=false;this._resumable=false;this.stopResume();this.closeShareCard();this.resetViewerGesture();this.stopRefresh(); this.discardOriginal();this._pending=null;this._saveEpoch++;this._metadataEpoch++;this._saveJob?.cancel();this._selected.clear();this._saved.clear();this._retryIds=[];this._popupEpoch++;this._generation++;this._connectionEpoch++;this._channel?.close();this.clearFiles();},
  stopResume(){if(typeof clearTimeout==='function')clearTimeout(this._resumeTimer);this._resumeTimer=null;},
  resumeConnection(){
    if(!this._alive||!this._active||!this._resumable||this.data.busy)return;
    this.stopResume();this._resumeAttempts++;this.setData({busy:true,message:'正在恢复与电脑的连接…'});
    if(!this._channel?.resume?.()&&this._resumable)this.setData({busy:false,message:'恢复暂未成功，请确认电脑仍在运行并连接同一 Wi-Fi，再点重试连接。'});
  },
  connectionInterrupted(){
    this.stopDeletionPolling?.();
    this.stopRefresh();this._generation++;this._metadataEpoch++;this._resumeOffset=Math.max(0,this.data.pageStart-1);
    if(!this._alive)return;
    this.setData({connected:false,busy:false,downloadEnabled:false,hdLoading:false,infoLoading:false,resumeAvailable:this._resumable,message:this._resumable?'连接暂时中断，正在等待恢复。':'连接已结束，请重新扫码。'});
    if(this._active&&this._resumable&&this._resumeAttempts<3&&typeof setTimeout==='function'){
      this.stopResume();this._resumeTimer=setTimeout(()=>{this._resumeTimer=null;this.resumeConnection();},1000*(this._resumeAttempts+1));
    }else if(this._active&&this._resumable)this.setData({message:'暂时连不上电脑，请确认同一 Wi-Fi 和电脑仍在运行，再点重试连接。'});
  },
  removeFile(path) { if (!path) return; this._files.delete(path); try { wx.getFileSystemManager().unlink({ filePath: path, fail() {} }); } catch (_) {} },
  clearFiles(keepPreviews=false) {this.discardLive();this._liveIds.clear();this._outfitEpoch++;this._outfitBusy=0;if(!keepPreviews){this._outfits.clear();this._details.clear();}this._iconCache?.release(keepPreviews);this._galleryCache?.flush();const retained=keepPreviews?new Set(this._previewCache.values()):new Set();for(const path of Array.from(this._files))if(!retained.has(path))this.removeFile(path);if(!keepPreviews)this._previewCache.clear();},
  scanPc() {
    if (!this._alive || !this._active || this.data.busy || this.data.saving || this.data.infoLoading || this.data.hdLoading) return;
    this.stopDeletionPolling?.();this._deletionCancel=new Set();this.setData({deletionEnabled:false,deletionItems:[],viewerDeletionId:'',deletionMessage:'',deletionOpen:false,connectionDiagnostic:''});
    this._resumable=false;this._resumeOffset=0;this._resumeAttempts=0;this.stopResume();this.setData({resumeAvailable:false});
    this.resetViewerGesture();this.stopRefresh(); this.discardOriginal(); this._selected.clear(); this._saved.clear(); this._retryIds=[]; this._polls=0;this._hdFailedId='';
    this._metadataEpoch++;this._rotations.clear();this._query={};this.setData({groups:[],exportEnabled:false,browseEnabled:false,searchText:'',filterVersion:'',filterFrom:'',filterTo:'',versionIndex:0,filterActive:false});
    if (this._channel) this._channel.close(); this._popupEpoch++; this._generation++; this._connectionEpoch++; this.clearFiles();
    this._scanning = true; this.setData({ busy: true, connected: false, connectionOpen: false, downloadEnabled: false, selectionMode: false, selectedCount: 0, saveStopping: false, retryCount: 0, saveMessage: '', ambientPath: '', loaded: 0, photos: [], selectedPath: '', viewerOpen: false, viewerClosing: false, viewerPhase: 'open', infoMounted: false, infoOpen: false, viewerChrome: true, message: '请扫描电脑端的连接二维码' });
    wx.scanCode({ onlyFromCamera: true, scanType: ['qrCode'], success: value => {
      this._scanning = false; if (!this._alive) return; let config;
      try { config = parseGalleryQr(value.result); } catch (_) { this.setData({ busy: false, message: '连接码无效或已过期，请在电脑重新生成' }); return; }
      if (!this._active) { this._pending = config; return; } this.connect(config);
    }, fail: () => { this._scanning = false; if (this._alive) this.setData({ busy: false, message: '扫码已取消。' }); } });
  },
  connect(config) {
    if (!this._alive || !this._active) return; const epoch = ++this._connectionEpoch;
    this.setData({ busy: true, message: '正在连接电脑…', connectionDiagnostic: '' });
    this._channel = connectGallery(wx, config, {
      progress:message=>{if(this._alive&&this._active&&epoch===this._connectionEpoch)this.setData({message});},
      ready: capabilities => { if (!this._alive || !this._active || epoch !== this._connectionEpoch) return;
        this._resumable=!!capabilities?.resume;this._resumeAttempts=0;this.stopResume();this.setData({deletionEnabled:!!capabilities?.deletion});this.scheduleDeletionPolling?.();
        this.setData({ connected: true, busy: false,resumeAvailable:false,downloadEnabled: !!capabilities?.download,exportEnabled:!!capabilities?.export,browseEnabled:!!capabilities?.browse }); this.loadPage(this._resumeOffset); this.scheduleRefresh();this.scheduleDeletionPolling?.(); },
      disconnected:()=>{if(this._alive&&epoch===this._connectionEpoch)this.connectionInterrupted();},
      failed: message => {
        if (!this._alive || epoch !== this._connectionEpoch) return;
        this._resumable=false;this._generation++;this._metadataEpoch++;
        this.stopResume();this.stopRefresh();this.stopDeletionPolling?.();this.clearFiles();
        const diagnostic = /（(C0[1-7])：([^）]+)）/.exec(message);
        this.setData({
          connected:false,busy:false,resumeAvailable:false,hdLoading:false,infoLoading:false,
          photos:[],groups:[],ambientPath:'',selectedPath:'',viewerOpen:false,
          message:diagnostic?message.replace(diagnostic[0], '（'+diagnostic[2]+'）'):message,
          connectionDiagnostic:diagnostic?diagnostic[1]:'',
        });
      }
    });
  },
  loadPage(offset, viewerTarget) {
    if (!this._alive || !this._active || !this.data.connected || this.data.busy || this.data.saving || this.data.infoLoading || this.data.hdLoading || !(this.data.browseEnabled?typeof this._channel?.browse==='function':typeof this._channel?.list==='function')) return;
    this.adoptSelection(); this.discardOriginal();this.resetViewerGesture();
    this._metadataEpoch++;
    const generation = ++this._generation; this._popupEpoch++; const keepViewer=Number.isInteger(viewerTarget) && this.data.viewerOpen;
    this.setData({ busy: true, photos: [], ambientPath: '', loaded: 0, selectedPath: '', viewerPreviewPath:'', viewerOriginalPath:'', infoOpen: false, infoMounted: false, viewerClosing: false, viewerPhase: 'open', viewerOpen: keepViewer, viewerChrome: true, message: '正在读取电脑照片…' });
    try{const received=value=>{
      if (!this._alive || !this._active || generation !== this._generation) return;
      if (value.status !== 'ok') { this.setData({ busy: false, message: value.message }); return; }
      if (offset > 0 && value.total > 0 && value.items.length === 0) {
        this._resumeOffset = 0;
        this.setData({busy:false,viewerOpen:false});
        this.loadPage(0);
        return;
      }
      const apply=keys=>{
        if(this._alive&&this._active&&generation===this._generation)this.applyPage(value,offset,generation,keepViewer?viewerTarget:undefined,keys);
      };
      if(this._galleryCache&&value.items.length&&this._channel.previewCacheKeys){
        try{this._channel.previewCacheKeys(value.items.map(item=>item.id),apply);}catch(_){apply();}
      }else apply();
    };if(this.data.browseEnabled&&typeof this._channel.browse==='function')this._channel.browse(offset,this._query,received);else this._channel.list(offset,received);}catch(_){this.transferUnavailable();}
  },
  transferUnavailable() {
    if (!this.data.connected) return;
    this.stopRefresh();if(this._resumable&&this._channel?.interrupt?.())return;this._channel?.close();this._resumable=false;this.stopResume();
    if(this._alive && this._active)this.setData({busy:false,connected:false,hdLoading:false,infoLoading:false,message:'连接已结束，请在电脑生成新浏览码后重新连接。'});
  },
  applyPage(value, offset, generation, viewerTarget, cacheKeys) {
      for(const item of value.items)if(item.live===true)this._liveIds.add(item.id);else this._liveIds.delete(item.id);
      const photos = value.items.map((x,index) => {
        const cacheKey=cacheKeys?.[index];
        const path = (cacheKey?this._galleryCache?.getPreview(cacheKey):this._previewCache.get(x.id)) || '';
        if (path) {
          this._previewCache.delete(x.id);
          this._previewCache.set(x.id,path);
        }
        return {
          id:x.id,...(cacheKey?{cacheKey}:{}),video:x.video===true,live:x.live===true,
          date:x.date?new Date(Date.parse(x.date)-new Date().getTimezoneOffset()*60000).toISOString().slice(0,10):'日期未知',
          version:x.version||'',versionSource:x.versionSource||'unknown',mime:x.mime||'image/jpeg',
          rotation:x.live?0:this._rotations.get(x.id)||0,path,selected:this._selected.has(x.id),
          saveState:this._saved.get(x.id)||'',state:path?'':x.video?'▶ 视频':'等待加载'
        };
      });
      const dates = photos.map(x => x.date).filter(x => x !== '日期未知');
      const cachedPhotos = photos.filter(photo=>photo.path);
      const first = dates[0], last = dates[dates.length - 1];
      const versions=Array.isArray(value.versions)?[{label:'全部版本',version:''},...value.versions.map(x=>({label:(x.version?x.version+' 版本':'版本未知')+' · '+x.count+' 张',version:x.version||'unknown'}))]:this.data.versionOptions;
      this.setData({ total: value.total,libraryTotal:value.libraryTotal??value.total,versionOptions:versions,versionIndex:Math.max(0,versions.findIndex(x=>x.version===this.data.filterVersion)), next: value.next, photos,groups:this.groupsFor(photos), pageStart: photos.length ? offset + 1 : 0, pageEnd: offset + photos.length,
        selectedCount:this._selected.size, dateSummary: first ? (first === last ? first : first + ' · ' + last) : '日期未知',
        loaded:cachedPhotos.length,ambientPath:cachedPhotos[0]?.path||'' });
      this.prunePreviews();
      if(Number.isInteger(viewerTarget) && this.data.viewerOpen && photos.length)this.displayPhoto(Math.min(viewerTarget,photos.length-1));
      this.loadPreview(0, generation);
  },
  loadPreview(index, generation) {
    if (!this._alive || !this._active || generation !== this._generation) return;
    if (index >= this.data.photos.length) { this.setData({ busy: false, message: this.data.filterActive&&!this.data.photos.length?'没有符合条件的照片，可以清除筛选。':'' });
      if(this.data.viewerOpen && this._nativeScale>=1.4)this.loadViewerOriginal(); return; }
    if(this.data.photos[index].video || this.data.photos[index].path){this.loadPreview(index+1,generation);return;}
    const {id,cacheKey}=this.data.photos[index];
    try{this._channel.preview(id, value => {
      if (!this._alive || !this._active || generation !== this._generation) { if (value.image) value.image.fill(0); return; }
      if (value.status !== 'ok') { this.updatePhoto(index, { state: '照片不可用' }); if (this.data.connected) this.loadPreview(index + 1, generation); return; }
      const bytes = value.image.slice(); value.image.fill(0);
      const cache=cacheKey&&this._galleryCache;
      const path=cache?cache.reservePreview(bytes.length):wx.env.USER_DATA_PATH+'/nikkisync-gallery-'+Date.now()+'-'+(++sequence)+'.jpg';
      const discard=()=>cache?cache.discardPreview(path):this.removeFile(path);
      const failed = () => { bytes.fill(0); discard(); if (this._alive && generation === this._generation) { this.updatePhoto(index, { state: '预览写入失败' }); this.loadPreview(index + 1, generation); } };
      try { wx.getFileSystemManager().writeFile({ filePath: path, data: bytes.buffer,
        success: () => { bytes.fill(0); if (!this._alive || !this._active || generation !== this._generation) { discard(); return; }
          if(cache)cache.savePreview(cacheKey,path,bytes.length);else this._files.add(path);
          this._previewCache.delete(id);this._previewCache.set(id,path); this.updatePhoto(index, { path, state: '' }); this.prunePreviews();this.loadPreview(index + 1, generation); }, fail: failed }); }
      catch (_) { failed(); }
    });}catch(_){this.transferUnavailable();}
  },
  updatePhoto(index, changes) { const photos = this.data.photos.slice(); photos[index] = Object.assign({}, photos[index], changes);
    const available = photos.filter(x => x.path);
    const update={photos,groups:this.groupsFor(photos), loaded: available.length, ambientPath: available.length ? available[0].path : ''};
    if(this.data.viewerOpen && photos[index].id===this.data.selectedId && this.data.viewerQuality!=='original')Object.assign(update,{selectedPath:photos[index].path,viewerPreviewPath:photos[index].path});
    this.setData(update); },
  prunePreviews() {
    const keep=new Set(this.data.photos.map(x=>x.id));
    for(const [id,path] of this._previewCache){if(this._previewCache.size<=36)break;if(!keep.has(id)){this._previewCache.delete(id);if(this._files.has(path))this.removeFile(path);}}
  },
  stopRefresh() { if(typeof clearTimeout==='function')clearTimeout(this._refreshTimer);this._refreshTimer=null; },
  scheduleRefresh() {
    this.stopRefresh();
    if(!this._alive || !this._active || !this.data.connected || !this.data.downloadEnabled || this._polls>=18 || typeof setTimeout!=='function')return;
    this._refreshTimer=setTimeout(()=>{this._refreshTimer=null;this.refreshPhotos(true);this.scheduleRefresh();},30000);
  },
  refreshPhotos(automatic) {
    if(!this._alive || !this._active || !this.data.connected || !this.data.downloadEnabled || this.data.busy || this.data.saving || this.data.infoLoading || this.data.hdLoading || this.data.viewerOpen || this.data.connectionOpen || this.data.myOpen || this.data.inspirationOpen || this.data.selectionMode || this.data.selectedCount || (automatic===true && this.data.pageStart>1) || typeof this._channel?.refresh!=='function') {
      if(automatic!==true && this._alive)this.setData({message:'请先结束选择、预览或保存，再刷新照片。'});wx.stopPullDownRefresh?.();return;
    }
    const generation=++this._generation;this._polls++;this._metadataEpoch++;
    this.setData({busy:true,message:'正在检查新照片…'});
    try{this._channel.refresh(value=>{
      wx.stopPullDownRefresh?.();
      if(!this._alive || !this._active || generation!==this._generation)return;
      if(value.status!=='ok'){this.setData({busy:false,message:'刷新暂时不可用；请确认电脑正在运行新版 EXE。'});return;}
      this._details.clear();this._outfits.clear();
      if(this.data.browseEnabled){this.setData({busy:false});this.loadPage(0);}else this.applyPage(value,0,generation);
    });}catch(_){wx.stopPullDownRefresh?.();this.setData({busy:false,message:'刷新暂时不可用，请重新连接。'});}
  },
  onPullDownRefresh() { this.refreshPhotos(); },
  presentPopup(mode, content) {
    if (!this._alive || !this._active || this._popupClosing || this.data.viewerOpen || this.data.connectionOpen) return;
    const epoch = ++this._popupEpoch, viewer = mode === 'viewer';
    // One native container: apply its geometry before changing show, as in the official demo.
    this.setData(Object.assign({}, content, {
      popupMode: mode, popupPosition: viewer ? 'center' : 'bottom', popupOverlay: !viewer,
      popupRound: !viewer, popupDuration: viewer ? 0 : 220,
      popupStyle: viewer ? 'width:100vw;height:100vh;background:transparent;' : 'background:#FFFCF7;border-radius:32px 32px 0 0;',
      viewerPhase: viewer?'enter':this.data.viewerPhase
    }), () => {
      if (!this._alive || !this._active || epoch !== this._popupEpoch) return;
      this.setData(viewer ? { viewerOpen: true, connectionOpen: false, viewerChrome: true } : { connectionOpen: true, viewerOpen: false });
      if(viewer)this.deferMotion('viewerEnter',16,()=>{if(epoch===this._popupEpoch && this.data.viewerOpen && !this.data.viewerClosing)this.setData({viewerPhase:'open'});});
    });
  },
  openConnection() { this.presentPopup('connection', {}); },
  closeConnection() { if (this._alive) { if (this.data.connectionOpen) this._popupClosing = true; this._popupEpoch++; this.setData({ connectionOpen: false }); } },
  nextPage() { if (this.data.next !== null) this.loadPage(this.data.next); },
  previousPage() { if(this.data.pageStart>1)this.loadPage(Math.max(0,this.data.pageStart-13)); },
  firstPage() { this.loadPage(0); },
  startSelection() { if (!this.data.saving && !this.data.busy) this.setData({selectionMode:true}); },
  adoptSelection() { for(const photo of this.data.photos)if(photo.selected && photo.id)this._selected.add(photo.id); },
  syncSelection() {const photos=this.data.photos.map(x=>Object.assign({},x,{selected:this._selected.has(x.id)}));this.setData({selectedCount:this._selected.size,viewerSelected:this._selected.has(this.data.selectedId),photos,groups:this.groupsFor(photos)});},
  cancelSelection() { if (this.data.saving) return; this._selected.clear();this.setData({selectionMode:false});this.syncSelection(); },
  toggleSelection(event) {
    if(this.data.saving || this.data.busy) return;
    const index=Number(event.currentTarget.dataset.index),photo=this.data.photos[index];if(photo?.video){this.setData({saveMessage:'视频请点开后逐个保存。'});return;}if(!photo?.path)return;
    if(this._selected.has(photo.id))this._selected.delete(photo.id);else if(this._selected.size<100)this._selected.add(photo.id);else {this.setData({saveMessage:'每批最多选择 100 张；保存后可继续选择。'});return;}
    this.setData({selectionMode:true});this.syncSelection();
  },
  selectAll() {if(this.data.saving || this.data.busy) return;for(const photo of this.data.photos)if(photo.path && this._selected.size<100)this._selected.add(photo.id);this.syncSelection();},
  toggleViewedSelection() { if(this.data.viewerOpen)this.toggleSelection({currentTarget:{dataset:{index:this.data.viewerIndex}}}); },
  longSelect(event) {if(this.data.saving || this.data.busy) return;this._ignoreTapUntil=Date.now()+500;this.toggleSelection(event);},
  tileTapped(event) {if(Date.now()<(this._ignoreTapUntil || 0)) return;if(this.data.selectionMode)this.toggleSelection(event);else this.openPhoto(event);},
  saveSelected() {this.adoptSelection();this.beginSave(Array.from(this._selected));},
  saveViewed() {
    if(this.data.viewerVideo){this.saveVideo();return;}
    const id=this.data.selectedId;if(!id)return;
    if(!this.data.viewerLive){this.beginSave([id]);return;}
    const connection=this._connectionEpoch;
    try{wx.showActionSheet({itemList:['照片','视频'],success:result=>{
      if(!this._alive||!this._active||!this.data.viewerOpen||this.data.viewerClosing||id!==this.data.selectedId||connection!==this._connectionEpoch)return;
      if(result.tapIndex===0)this.beginSave([id]);else if(result.tapIndex===1)this.saveVideo();
    }});}catch(_){if(this._alive)this.setData({saveMessage:'暂时无法打开保存选项，请重试。'});}
  },
  saveVideo(){
    if(!this._alive||!this._active||!this.data.viewerOpen||!this.data.viewerLive||this.data.saving||this.data.busy||!this.data.connected)return;
    if(!this.data.livePath){this.requestLive('motion',true);return;}
    const epoch=this._liveEpoch,id=this.data.selectedId;this.setData({saving:true,saveMessage:'正在保存视频到相册…'});
    this._liveCache.saveVideo(this.data.livePath,result=>{if(!this._alive)return;
      this.setData({saving:false,...(epoch===this._liveEpoch&&id===this.data.selectedId?{permissionDenied:!!result.permissionDenied,saveMessage:result.status==='saved'?'视频已保存到相册':result.status==='cancelled'?'已取消保存视频':'视频保存失败，请检查相册权限后重试。'}:{})});
    });
  },
  discardLive(){this._liveEpoch++;this._liveCache?.clear();if(this._alive)this.setData({livePath:'',livePackPath:'',livePlaying:false});},
  playLive(){
    if(this.data.livePlaying){this.setData({livePlaying:false});return;}
    if(this.data.livePath){this.setData({livePlaying:true});return;}this.requestLive('motion');
  },
  livePlaybackFailed(event){if(event.currentTarget?.dataset?.path!==this.data.livePath)return;this.setData({livePlaying:false,hdMessage:'微信暂时无法播放这段视频，Live 原文件仍可导出。'});},
  exportLivePhoto(){
    if(this.data.livePackPath){
      if(this.data.busy||this.data.saving||!this._liveCache)return;
      const path=this.data.livePackPath;this._liveCache.share(path,result=>{if(!this._alive)return;
        this.setData({livePackPath:result.status==='shared'?'':this._active&&this.data.viewerOpen?path:'',saveMessage:result.status==='shared'?'Live 文件已转发；请按已验证的方法导入系统相册。':result.status==='cancelled'?'已取消转发，可重试。':result.status==='unsupported'?'当前微信不支持文件转发，请更新微信后重试。':'文件转发未完成，请重试。'});
      });return;
    }
    this.requestLive('live');
  },
  requestLive(kind,save=false){
    if(kind!=='motion')return;
    if(!this._alive||!this._active||!this.data.viewerOpen||!this.data.viewerLive||!this.data.connected||!this.data.downloadEnabled||this.data.busy||this.data.saving||this.data.infoLoading||this.data.hdLoading||this.data.viewerClosing||!this._liveCache)return;
    const id=this.data.selectedId,epoch=++this._liveEpoch,connection=this._connectionEpoch,rotation=this.data.viewerRotation||0;
    const current=()=>this._alive&&this._active&&epoch===this._liveEpoch&&connection===this._connectionEpoch&&id===this.data.selectedId;
    this.setData({busy:true,saveMessage:rotation?'电脑正在旋转视频画面…':'正在读取动态视频…'});
    const failed = (message = rotation?'旋转视频未完成，请检查电脑连接后重试。':'动态视频暂不可用，请检查连接或重试。') => {
      if (current()) this.setData({ busy: false, saveMessage: message });
    };
    const received=value=>{
      if(!current()){value.image?.fill(0);return;}if(value.status!=='ok'){value.image?.fill(0);failed();return;}
      this._liveCache.put(value,kind,path=>{if(!current())return;if(!path){failed();return;}
        this.setData({busy:false,livePath:path,livePlaying:!save,saveMessage:''});if(save)this.saveVideo();
      });
    };
    const requestMotion = () => {
      const progress = (done, total) => {
        if (current()) this.setData({ saveMessage: '接收动态视频 · ' + Math.floor(done / total * 100) + '%' });
      };
      try { this._channel.motion(id, received, progress, rotation); } catch (_) { failed(); }
    };
    try {
      if (!rotation) { requestMotion(); return; }
      this._channel.motionRotationSupported(supported => {
        if (!current()) return;
        if (supported) requestMotion();
        else if (save) failed('旋转后保存视频需要更新电脑端。');
        else failed('旋转后播放视频需要更新电脑端。');
      });
    } catch (_) { failed(); }
  },
  stopSaving() {
    if(!this._alive || !this._active || !this.data.saving || this.data.saveStopping || typeof this._saveJob?.stopAfterCurrent!=='function')return;
    this.setData({saveStopping:true,saveMessage:'当前这张处理完后停止，未完成的照片可以重试。'});
    this._saveJob.stopAfterCurrent();
  },
  retryUnfinished() { this.beginSave(this._retryIds.slice()); },
  beginSave(ids) {
    if(!this._alive || !this._active || !this.data.connected || !this.data.downloadEnabled || this.data.busy || this.data.saving || this.data.infoLoading || this.data.hdLoading || this.data.viewerClosing || !ids.length) return;
    const epoch=++this._saveEpoch;
    this._retryIds=[];
    this.setData({saving:true,saveStopping:false,retryCount:0,permissionDenied:false,saveMessage:'正在申请相册保存权限…'});
    const current=()=>this._alive && this._active && epoch===this._saveEpoch,connection=this._connectionEpoch;
    try {this._saveJob=saveOriginalBatch(wx,this._channel,ids,{
      saved:id=>{if(!this._alive||connection!==this._connectionEpoch)return;this._saved.set(id,'saved');this._selected.delete(id);
        if(this._active){const photos=this.data.photos.map(p=>p.id===id?Object.assign({},p,{selected:false,saveState:'saved'}):p);this.setData({photos,groups:this.groupsFor(photos),selectedCount:this._selected.size,viewerSelected:this._selected.has(this.data.selectedId)});}},
      progress:value=>{if(current() && !this.data.saveStopping)this.setData({saveMessage:(value.state==='download'?'下载原图':value.state==='save'?'保存到相册':'校验完成')+' '+value.index+'/'+value.total+' · '+value.percent+'%'});},
      complete:value=>{
        if(!current())return;
        const saved=value.results.filter(x=>x.status==='saved').length;
        const savedIds=new Set(value.results.filter(x=>x.status==='saved').map(x=>x.id));
        this._retryIds=ids.filter(id=>!savedIds.has(id));
        for(const result of value.results){this._saved.set(result.id,result.status);if(result.status==='saved')this._selected.delete(result.id);}
        const photos=this.data.photos.map(photo=>{const result=value.results.find(x=>x.id===photo.id);return result?Object.assign({},photo,{saveState:result.status,selected:result.status==='saved'?false:photo.selected}):photo;});
        const resultMessage = '已保存 '+saved+' 张'+(this._retryIds.length?'，'+this._retryIds.length+' 张未完成':'')+(value.cancelled?'（已停止）。':'。');
        this.setData({saving:false,saveStopping:false,retryCount:this._retryIds.length,photos,groups:this.groupsFor(photos),selectedCount:this._selected.size,viewerSelected:this._selected.has(this.data.selectedId),permissionDenied:!!value.permissionDenied,
          saveMessage:value.permissionDenied?'相册权限未获准。开启权限后可重试未完成项；若连接已关闭，请重新扫码。':saved?photoSaveMessage(resultMessage):resultMessage});
      }
    },{exif:this.data.writeExif&&this.data.exportEnabled,rotations:Object.fromEntries(ids.map(id=>[id,this._rotations.get(id)||0]))});} catch (_) {this._retryIds=ids.slice();this.setData({saving:false,saveStopping:false,retryCount:ids.length,saveMessage:'无法开始保存，请重新连接后重试。'});}
  },
  openAlbumSettings() {if(this._alive && this._active && !this.data.saving)wx.openSetting({});},
  generateShareCard(){
    if(!this._alive||!this._active||!this.data.viewerOpen||this.data.viewerClosing||!this.data.connected||!this.data.downloadEnabled||this.data.busy||this.data.saving||this.data.infoLoading||this.data.hdLoading)return;
    const id=this.data.selectedId,epoch=++this._shareEpoch,connection=this._connectionEpoch;
    const current=()=>this._alive&&this._active&&epoch===this._shareEpoch&&id===this.data.selectedId&&connection===this._connectionEpoch;
    this._shareJob?.dispose();this._sharePaths=[];this._shareOriginalSaved=false;
    this.setData({shareOpen:true,shareBusy:true,shareSaving:false,sharePath:'',sharePreviewHeight:0,shareIndex:0,shareCount:0,shareMessage:'正在准备分享图…',saving:true});
    const fail=error=>{if(current())this.setData({shareBusy:false,saving:false,shareMessage:error?.message||'分享图生成失败，请重试。'});};
    try{wx.createSelectorQuery().in(this).select('#share-card-canvas').fields({node:true,size:true}).exec(result=>{
      if(!current())return;
      const canvas=result?.[0]?.node;if(!canvas){fail(new Error('当前微信无法生成分享图，请更新后重试。'));return;}
      try{const job=createShareCardJob(wx,{canvas,channel:this._channel,id,date:this.data.selectedDate,rotation:this.data.viewerRotation,iconCache:this._iconCache,branding:this.shareBranding?.(),
        originalPath:this.data.viewerOriginalPath||'',progress:message=>{if(current())this.setData({shareMessage:message});}});
        this._shareJob=job;
        job.result.then(value=>{if(!current()){job.dispose();return;}this._sharePaths=value.paths;
          const message=(value.paths.length>1?'内容较多，已分成 '+value.paths.length+' 张分享图。':'分享图已生成，可保存到相册。')+(value.missingIcons?' '+value.missingIcons+' 个图标暂缺，可稍后重新生成。':'');
          this.setData({shareBusy:false,saving:false,sharePath:value.paths[0],shareCount:value.paths.length,shareMessage:message});
        }).catch(fail);
      }catch(error){fail(error);}
    });}catch(error){fail(error);}
  },
  closeShareCard(){
    this._shareEpoch=(this._shareEpoch||0)+1;
    this._shareOriginalSaveJob?.cancel();this._shareOriginalSaveJob=null;
    const disconnected=this.data.shareBusy?this._shareJob?.cancel():false;
    if(!this.data.shareBusy)this._shareJob?.dispose();
    if(disconnected){this.stopRefresh();if(this._alive)this.setData({connected:false,downloadEnabled:false,message:this._resumable?'已取消生成，连接将自动恢复。':'已取消正在传输的分享图。请在电脑生成新浏览码后重新连接。'});}
    this._shareJob=null;this._sharePaths=[];
    if(this._alive)this.setData({shareOpen:false,shareBusy:false,shareSaving:false,sharePath:'',sharePreviewHeight:0,shareCount:0,shareIndex:0,shareMessage:'',...(this.data.shareBusy?{saving:false}:{})});
  },
  previousShareCard(){this.changeShareCard(-1);},
  nextShareCard(){this.changeShareCard(1);},
  changeShareCard(delta){if(this.data.shareBusy||this.data.shareSaving)return;const index=this.data.shareIndex+delta;if(index>=0&&index<this._sharePaths.length)this.setData({shareIndex:index,sharePath:this._sharePaths[index],sharePreviewHeight:0,shareMessage:'分享图 '+(index+1)+' / '+this._sharePaths.length});},
  sharePreviewLoaded(event){
    if(!this.data.shareOpen||event.currentTarget?.dataset?.path!==this.data.sharePath)return;
    const {width,height}=event.detail||{};
    if(width>0&&height>0&&width<=4096&&height<=4096)this.setData({sharePreviewHeight:Math.ceil((this.data.windowWidth*694/750)*height/width)});
  },
  saveOriginalAndShareCard(){return this.saveGeneratedShareCard(true);},
  async saveGeneratedShareCard(withOriginal){
    if(!this._alive||!this._active||!this.data.shareOpen||this.data.shareBusy||this.data.shareSaving||!this.data.sharePath)return;
    // WXML supplies a tap event to the single-save action.
    const both=withOriginal===true,id=this.data.selectedId,path=this.data.sharePath,epoch=this._shareEpoch,job=this._shareJob;
    job?.pin(path);this.setData({shareSaving:true,permissionDenied:false,shareMessage:both&&!this._shareOriginalSaved?'正在下载并保存原图…':'正在保存分享图…'});
    const current=()=>this._alive&&this._active&&epoch===this._shareEpoch&&id===this.data.selectedId;
    try{
      if(both&&!this._shareOriginalSaved){
        if(!this.data.connected||!this.data.downloadEnabled||!id)throw Error('请重新连接电脑后保存原图。');
        const result=await new Promise(resolve=>{this._shareOriginalSaveJob=saveOriginalBatch(wx,this._channel,[id],{complete:resolve},{exif:false});});
        if(!current())return;
        this._shareOriginalSaveJob=null;
        if(result.permissionDenied)throw Error('请允许相册权限后重试。');
        if(!result.results.some(item=>item.id===id&&item.status==='saved'))throw Error('原图保存未完成，请检查电脑连接后重试。');
        this._shareOriginalSaved=true;this.setData({shareMessage:'原图已保存，正在保存分享图…'});
      }
      if(!current())return;
      await saveShareCard(wx,path);
      if(current())this.setData({shareMessage:photoSaveMessage(both?'原图和这张分享图已保存到相册。':'这张分享图已保存到相册。')});
    }catch(error){
      if(current())this.setData({shareMessage:(both&&this._shareOriginalSaved?'原图已保存。':'')+error.message,permissionDenied:/权限/.test(error.message)});
    }finally{
      job?.unpin(path);
      if(current()){this._shareOriginalSaveJob=null;this.setData({shareSaving:false});}
    }
  },
  showPhotoInfo() {
    if(!this._alive || !this._active || !this.data.viewerOpen || this.data.viewerClosing)return;
    if(!this.data.infoOpen){
      const mounted=this.data.infoMounted,frame=++this._infoSeq;this.cancelMotion('infoExit');this._infoTouch=null;
      this.setData({infoMounted:true,infoOpen:true,infoExpanded:true,infoFrame:frame,livePlaying:false,infoPhase:mounted?'open':'enter'},()=>{
        if(!mounted)this.deferMotion('infoEnter',16,()=>{if(this.data.infoOpen && frame===this.data.infoFrame)this.setData({infoPhase:'open'});});
      });
    }
    if(this.data.busy || this.data.saving || this.data.infoLoading || this.data.hdLoading){this.setData({infoMessage:'请等待当前传输完成后，再点参数。'});return;}
    const id=this.data.selectedId;
    if(!this.data.connected || !this.data.downloadEnabled){this.setData({infoRows:[],infoMessage:'需要连接电脑的新版浏览码，才能读取参数。'});return;}
    const cached = this._details.get(id);
    this._details.delete(id);
    if (cached && Date.now() < cached.expiresAt) {
      this._details.set(id,cached);
      this.setData({infoRows:cached.rows,infoMessage:'来自电脑已有解析结果'});
      this.loadOutfit(id,0);
      return;
    }
    // Pending/partial results must reread the PC so background decoding can appear.
    for(const key of this._outfits.keys())if(key.startsWith(id+':'))this._outfits.delete(key);
    const epoch=++this._metadataEpoch;
    this.setData({infoLoading:true,infoRows:[],infoMessage:'正在读取电脑已解析的参数…',outfitItems:[],outfitTotal:0,outfitOffset:0,outfitNext:null,outfitNote:''});
    const cacheKey=this.data.photos[this.data.viewerIndex]?.cacheKey;
    const saved=this._galleryCache?.getDetails(cacheKey);
    const received=value=>{
      if(!this._alive || !this._active || epoch!==this._metadataEpoch || id!==this.data.selectedId)return;
      if(value.status==='ok'&&value.unchanged&&saved){
        value={...saved,status:'ok'};
        this.seedOutfitPages(id,saved.items.map((item,index)=>({...item,key:index.toString(16).padStart(32,'0')})),true);
      }else if(value.status==='ok'&&value.version&&Array.isArray(value.items)){
        this._galleryCache.saveDetails(cacheKey,value);
        this.seedOutfitPages(id,value.items,false);
      }
      if(value.status==='ok'&&value.availability==='available'&&value.rows.length){
        if(this._details.size>=DETAIL_CACHE_LIMIT)this._details.delete(this._details.keys().next().value);
        this._details.set(id,{rows:value.rows,expiresAt:Date.now()+DETAIL_CACHE_MS});
      }
      const state={infoLoading:false,infoRows:value.status==='ok'?value.rows:[],infoMessage:value.status!=='ok'?'参数暂时不可用。':value.availability==='unavailable'?'电脑尚未解析出这张照片的参数。':value.availability==='partial'?'部分服装名称尚未解析。':'来自电脑已有解析结果'};
      this.setData(state);if(value.status==='ok'&&this.data.infoOpen)this.loadOutfit(id,0);
    };
    try{
      if(cacheKey&&this._galleryCache&&this._channel.cachedDetails)this._channel.cachedDetails(id,saved?.version,received);
      else this._channel.metadata(id,received);
    }catch(_){this.setData({infoLoading:false,infoMessage:'请等待当前传输完成或重新连接。'});}
  },
  seedOutfitPages(id,items,fromDisk){
    for(let offset=0;offset<Math.max(1,items.length);offset+=6){
      while(this._outfits.size>=40)this._outfits.delete(this._outfits.keys().next().value);
      this._outfits.set(id+':'+offset,{status:'ok',offset,total:items.length,next:offset+6<items.length?offset+6:null,items:items.slice(offset,offset+6),fromDisk});
    }
  },
  loadOutfit(id,offset){
    if(!this._iconCache||!this._alive||!this._active||!this.data.infoOpen||id!==this.data.selectedId||typeof this._channel?.outfit!=='function'||this._outfitBusy)return;
    const epoch=++this._outfitEpoch,connection=this._connectionEpoch;this._outfitBusy=epoch;
    const live=()=>this._alive&&this._active&&connection===this._connectionEpoch,current=()=>live()&&epoch===this._outfitEpoch&&this.data.infoOpen&&id===this.data.selectedId;
    const finish=()=>{if(live()&&this._outfitBusy===epoch){this._outfitBusy=0;this.setData({infoLoading:false});}};
    this.setData({infoLoading:true,outfitItems:[],outfitTotal:0,outfitOffset:0,outfitNext:null,outfitNote:'正在读取整套穿搭…'});
    let total=null,partial=false;const keys=new Set();
    const update=(index,patch)=>{if(!current())return;const items=this.data.outfitItems.slice();items[index]=Object.assign({},items[index],patch);this.setData({outfitItems:items});};
    const icons=index=>{
      if(!current()){finish();return;}
      const item=this.data.outfitItems[index];if(!item){this.setData({outfitNote:partial?'部分穿搭未全部载入，请重新打开重试。':this.data.outfitTotal?'':'这张照片暂时没有已解析的服装信息。'});finish();return;}
      if(!item.hasIcon){icons(index+1);return;}
      const hit=this._iconCache.get(item.cacheKey||item.key);if(hit){update(index,{iconPath:hit.path,iconSource:hit.source,iconState:''});icons(index+1);return;}
      try{this._channel.icon(id,item.key,value=>{
        if(!current()){value.image?.fill(0);finish();return;}
        if(value.status!=='ok'||value.icon!==true||value.original!==false){value.image?.fill(0);update(index,{iconState:'暂不可用'});icons(index+1);return;}
        this._iconCache.put(item.cacheKey||item.key,value.image,value.mime,value.source,cached=>{if(!current()){finish();return;}update(index,cached?{iconPath:cached.path,iconSource:cached.source,iconState:''}:{iconState:'暂不可用'});icons(index+1);});
      });}catch(_){update(index,{iconState:'暂不可用'});this.setData({outfitNote:'服装图标暂时不可用，名称与参数仍可查看。'});finish();}
    };
    const unavailable=()=>{partial=true;if(this.data.outfitItems.length){icons(0);return;}this.setData({outfitNote:'穿搭信息暂时不可用，已有文字参数保留。'});finish();};
    const apply=(value,offset)=>{if(!current()){finish();return;}
      if(value.status!=='ok'||!Number.isInteger(value.total)||value.total<0||value.total>100||value.offset!==offset||!Array.isArray(value.items)||value.items.length!==Math.min(6,value.total-offset)||value.next!==(offset+value.items.length<value.total?offset+value.items.length:null)||(total!==null&&total!==value.total)||value.items.some(x=>keys.has(x.key))){unavailable();return;}
      total=value.total;for(const item of value.items)keys.add(item.key);
      this.setData({outfitTotal:total,outfitNext:null,outfitItems:this.data.outfitItems.concat(value.items.map(x=>Object.assign({},x,{iconPath:'',iconSource:'',iconState:x.hasIcon?'载入中':'暂无图标'})))});
      if(value.next!==null)page(value.next);else icons(0);
    };
    const page=offset=>{
      if(!current()){finish();return;}
      const cacheKey=id+':'+offset,cached=this._outfits.get(cacheKey);
      if(cached&&(!cached.fromDisk||cached.items.every(item=>!item.hasIcon||this._iconCache.get(item.cacheKey)))){
        this._outfits.delete(cacheKey);this._outfits.set(cacheKey,cached);apply(cached,offset);return;
      }
      try{const request=this._channel.cachedOutfit||this._channel.outfit;request(id,offset,value=>{if(current()&&value.status==='ok'){while(this._outfits.size>=40)this._outfits.delete(this._outfits.keys().next().value);this._outfits.set(cacheKey,value);}apply(value,offset);});}catch(_){apply({status:'failed'},offset);}
    };page(0);
  },
  outfitIconFailed(event){const key=event.currentTarget.dataset.key,path=event.currentTarget.dataset.path,index=this.data.outfitItems.findIndex(x=>x.key===key&&x.iconPath===path);if(index<0)return;this._iconCache?.invalidate(this.data.outfitItems[index].cacheKey||key);const items=this.data.outfitItems.slice();items[index]=Object.assign({},items[index],{iconPath:'',iconState:'暂不可用'});this.setData({outfitItems:items});},
  closeInfo() {
    this._infoTouch=null;this.cancelMotion('infoEnter');
    if(!this._alive)return;
    const frame=this.data.infoFrame;this.setData({infoOpen:false,infoPhase:'exit',infoSettle:this.data.infoSettle+1});
    this.deferMotion('infoExit',this.data.reduceMotion?120:160,()=>{if(!this.data.infoOpen && frame===this.data.infoFrame)this.setData({infoMounted:false,infoExpanded:false});});
  },
  toggleInfoSize() {
    if(this._alive && this._active && this.data.viewerOpen && this.data.infoOpen && Date.now()>=(this._infoIgnoreTapUntil || 0)){this.cancelMotion('infoEnter');this.setData({infoPhase:'open',infoExpanded:!this.data.infoExpanded,infoSettle:this.data.infoSettle+1});}
  },
  infoTouchStart(event) {
    if(!this.currentViewerEvent(event) || !this.data.infoOpen)return;
    const touches=event.touches || [],first=touches[0];
    this._infoTouch=first?{x:first.clientX,y:first.clientY,endX:first.clientX,endY:first.clientY,multi:touches.length!==1}:null;
  },
  infoTouchMove(event) {
    if(!this.currentViewerEvent(event) || !this.data.infoOpen || !this._infoTouch)return;
    const touches=event.touches || [],first=touches[0];
    if(touches.length>1)this._infoTouch.multi=true;
    if(first){this._infoTouch.endX=first.clientX;this._infoTouch.endY=first.clientY;}
  },
  infoTouchEnd(event) {
    if(!this.currentViewerEvent(event) || !this.data.infoOpen)return;
    const start=this._infoTouch;this._infoTouch=null;if(!start)return;
    if(event.motion?.multi)start.multi=true;
    const last=event.changedTouches?.[0],dx=(last?.clientX ?? start.endX)-start.x,dy=(last?.clientY ?? start.endY)-start.y;
    if(event.motion?.moved || start.multi || Math.abs(dx)+Math.abs(dy)>8)this._infoIgnoreTapUntil=Date.now()+400;
    this.cancelMotion('infoEnter');
    if(start.multi || event.type==='touchcancel' || Math.abs(dy)<44 || Math.abs(dy)<=Math.abs(dx)*1.6){this.setData({infoPhase:'open',infoSettle:this.data.infoSettle+1});return;}
    if(dy<0)this.setData({infoPhase:'open',infoExpanded:true,infoSettle:this.data.infoSettle+1});
    else if(this.data.infoExpanded)this.setData({infoPhase:'open',infoExpanded:false,infoSettle:this.data.infoSettle+1});
    else this.closeInfo();
  },
  swallowTap() {},
  openPhoto(event) { const index = Number(event.currentTarget.dataset.index), photo = this.data.photos[index];
    if (Number.isInteger(index) && photo && (photo.path||photo.video) && !this.data.infoLoading && !this.data.viewerOpen && !this.data.connectionOpen && !this._popupClosing) {
      this._metadataEpoch++;
      this.discardOriginal();
      this.presentPopup('viewer', this.photoState(index));
    } },
  photoState(index) {
    const photo=this.data.photos[index];
    this.resetViewerGesture();const frame=++this._viewerSeq;this._activeViewerFrame=frame;
    const rotation=this._rotations.get(photo.id)||0,swapped=rotation===90||rotation===270;
    return {viewerVideo:photo.video===true,viewerLive:photo.live===true||photo.video===true,livePath:'',livePackPath:'',livePlaying:false,viewerRotation:rotation,viewerMime:photo.mime||'image/jpeg',viewerImageWidth:this.data.windowWidth,viewerImageHeight:this.data.windowHeight,rotationWidth:swapped?this.data.windowHeight:this.data.windowWidth,rotationHeight:swapped?this.data.windowWidth:this.data.windowHeight,selectedPath:photo.path,viewerPreviewPath:photo.path,viewerOriginalPath:'',originalReady:false,selectedId:photo.id || '',selectedDate:photo.date || '日期未知',viewerIndex:index,
      viewerPosition:Math.max(0,this.data.pageStart-1)+index+1,viewerSelected:this._selected.has(photo.id),viewerQuality:'preview',hdMessage:'',saveMessage:'',
      viewerDeletionId:this.deletionIdForPhoto?.(photo.id)||'',viewerFrames:[{key:frame,initialScale:1}],viewerClosing:false,viewerPhase:'open',viewerSettle:0,infoOpen:false,infoMounted:false,infoPhase:'exit',infoExpanded:false,infoLoading:false,infoRows:[],infoMessage:'',outfitItems:[],outfitTotal:0,outfitOffset:0,outfitNext:null,outfitNote:''};
  },
  displayPhoto(index) { this.closeShareCard();this.discardOriginal();this._metadataEpoch++;this.setData(this.photoState(index)); },
  previousPhoto() { this.movePhoto(-1); },
  nextPhoto() { this.movePhoto(1); },
  movePhoto(direction) {
    if(!this.data.viewerOpen || this.data.viewerClosing || this.data.busy || this.data.saving || this.data.infoLoading || this.data.infoOpen)return;
    const index=this.data.viewerIndex+direction;
    if(index>=0 && index<this.data.photos.length){this.displayPhoto(index);return;}
    if(this.data.hdLoading)return;
    if(direction>0 && this.data.next!==null)this.loadPage(this.data.next,0);
    else if(direction<0 && this.data.pageStart>1)this.loadPage(Math.max(0,this.data.pageStart-13),11);
  },
  discardOriginal() { this.discardLive();this._hdEpoch++;if(this._originalPath){this.removeFile(this._originalPath);this._originalPath='';} },
  resetViewerGesture() {for(const name of ['viewerEnter','viewerExit','infoEnter','infoExit','photoTap'])this.cancelMotion(name);this._photoTap=null;this._activeViewerFrame=0;this._nativeScale=1;this._viewerTouch=null;this._viewerIgnoreTapUntil=0;this._infoTouch=null;this._infoIgnoreTapUntil=0;},
  currentViewerEvent(event) {
    const frame=Number(event?.currentTarget?.dataset?.frame);
    return this._alive && this._active && this.data.viewerOpen && !this.data.viewerClosing && Number.isSafeInteger(frame) && frame>0 && frame===this._activeViewerFrame;
  },
  viewerImageLoaded(event){
    if(!this.currentViewerEvent(event)||event.currentTarget.dataset.path!==this.data.viewerPreviewPath)return;
    const width=Number(event.detail?.width),height=Number(event.detail?.height);
    if(Number.isFinite(width)&&Number.isFinite(height)&&width>0&&height>0&&width<=100000&&height<=100000)this.setData({viewerImageWidth:width,viewerImageHeight:height});
  },
  viewerScaled(event) {
    if(!this.currentViewerEvent(event))return;
    const scale=Number(event.detail?.scale);if(!Number.isFinite(scale) || scale<1 || scale>6)return;
    // Native component owns the live transform. Writing it back to scale-value creates an echo loop.
    // Only explicit double taps supply a new scale command; old frame events are ignored.
    this._nativeScale=scale;
    if(scale>=1.4)this.loadViewerOriginal();
  },
  loadViewerOriginal() {
    if(this.data.viewerVideo)return;
    if(!this._alive || !this._active || !this.data.viewerOpen || this.data.viewerClosing || this.data.viewerQuality==='original' || !this.data.downloadEnabled || !this.data.connected || this.data.busy || this.data.saving || this.data.infoLoading || this.data.hdLoading || !this.data.selectedId || this._hdFailedId===this.data.selectedId)return;
    const id=this.data.selectedId,epoch=++this._hdEpoch,connection=this._connectionEpoch;
    this.setData({hdLoading:true,hdMessage:'正在加载高清原图…'});
    const live=()=>this._alive && this._active && connection===this._connectionEpoch;
    const current=()=>live() && epoch===this._hdEpoch && this.data.viewerOpen && id===this.data.selectedId;
    const finish=()=>{if(live()){this.setData({hdLoading:false});if(this._nativeScale>=1.4 && this.data.selectedId!==id)this.loadViewerOriginal();}};
    const failed=()=>{if(current()){this._hdFailedId=id;this.setData({hdMessage:'高清加载未完成，仍显示预览图。'});}finish();};
    try{this._channel.original(id,value=>{
      if(!current()){value.image?.fill(0);finish();return;}
      if(value.status!=='ok' || value.original!==true || !(value.image instanceof Uint8Array) || !['image/jpeg','image/png'].includes(value.mime)){value.image?.fill(0);failed();return;}
      const path=wx.env.USER_DATA_PATH+'/nikkisync-hd-'+Date.now()+'-'+(++sequence)+(value.mime==='image/png'?'.png':'.jpg'),bytes=value.image,
        buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);
      const wipe=()=>{bytes.fill(0);new Uint8Array(buffer).fill(0);};
      const failure=()=>{wipe();this.removeFile(path);failed();};
      try{wx.getFileSystemManager().writeFile({filePath:path,data:buffer,success:()=>{
        wipe();if(!current()){this.removeFile(path);finish();return;}
        this._files.add(path);this._originalPath=path;this.setData({selectedPath:path,viewerOriginalPath:path,originalReady:false,viewerQuality:'original',hdMessage:'高清原图'});finish();
      },fail:failure});}catch(_){failure();}
    });}catch(_){failed();}
  },
  originalLoaded(event) {if(event?.currentTarget?.dataset?.path && event.currentTarget.dataset.path!==this._originalPath)return;
    if(this._originalPath && this.data.viewerOriginalPath===this._originalPath)this.setData({originalReady:true});},
  originalFailed(event) {if(event?.currentTarget?.dataset?.path && event.currentTarget.dataset.path!==this._originalPath)return;
    this.discardOriginal();this._hdFailedId=this.data.selectedId;this.setData({selectedPath:this.data.viewerPreviewPath,viewerOriginalPath:'',originalReady:false,viewerQuality:'preview',hdMessage:'原图暂时无法显示，仍显示预览图。'});},
  viewerTouchStart(event) {
    if(!this.currentViewerEvent(event))return;
    const touches=event.touches || [],first=touches[0];
    const image=!!event.currentTarget?.dataset?.image || !event.currentTarget;
    this._viewerTouch=first?{x:first.clientX,y:first.clientY,endX:first.clientX,endY:first.clientY,moved:touches.length>1,multi:touches.length>1,swipe:image && this._nativeScale<=1.05 && !this.data.infoOpen}:null;
  },
  viewerPhotoTap(event){
    if(!this.currentViewerEvent(event)||this.data.infoOpen||this.data.shareOpen||this.data.livePlaying||Date.now()<this._viewerIgnoreTapUntil)return;
    if(this.data.viewerVideo||!this.data.viewerPreviewPath){this.toggleViewerChrome();return;}
    const frame=this._activeViewerFrame,now=Date.now(),previous=this._photoTap;
    const {x,y}=event.detail||{},near=!previous||![x,y,previous.x,previous.y].every(Number.isFinite)||Math.hypot(x-previous.x,y-previous.y)<=36;
    if(previous&&previous.frame===frame&&now-previous.time<=280&&near){
      this.cancelMotion('photoTap');this._photoTap=null;
      const target=this._nativeScale>1.05?1:2,seed=this.data.viewerFrames[0];
      // A pinch can change the live scale without changing the last commanded prop.
      const key=seed.initialScale===target?++this._viewerSeq:frame;
      this._activeViewerFrame=key;this._nativeScale=target;
      this.setData({viewerFrames:[{key,initialScale:target}]});
      if(target>1)this.loadViewerOriginal();
      return;
    }
    if(previous)this.toggleViewerChrome();
    this._photoTap={frame,time:now,x,y};
    this.deferMotion('photoTap',280,()=>{this._photoTap=null;if(frame===this._activeViewerFrame&&!this.data.viewerClosing&&!this.data.infoOpen&&!this.data.shareOpen)this.toggleViewerChrome();});
  },
  viewerTouchMove(event) {
    if(!this.currentViewerEvent(event))return;
    const touches=event.touches || [],first=touches[0],start=this._viewerTouch;
    if(start){if(touches.length>1)start.multi=true;if(first){start.endX=first.clientX;start.endY=first.clientY;}
      if(touches.length>1 || (first && Math.hypot(first.clientX-start.x,first.clientY-start.y)>8))start.moved=true;}
  },
  viewerTouchEnd(event) {
    if(!this.currentViewerEvent(event))return;
    const start=this._viewerTouch;if(!start)return;
    if(event.motion?.multi)start.multi=true;
    if(event.motion?.moved)start.moved=true;
    if(start.moved || start.multi){this._viewerIgnoreTapUntil=Date.now()+400;this._photoTap=null;this.cancelMotion('photoTap');}
    const last=event?.changedTouches?.[0],dx=(last?.clientX ?? start.endX)-start.x,dy=(last?.clientY ?? start.endY)-start.y;
    this._viewerTouch=null;
    const valid=event?.type!=='touchcancel' && start.swipe && !start.multi && this._nativeScale<=1.05;
    if(valid && dy>=88 && dy>Math.abs(dx)*1.6 && !this.data.busy && !this.data.saving && !this.data.infoLoading && !this.data.infoOpen)this.dismissPhoto();
    else {this.setData({viewerSettle:this.data.viewerSettle+1});if(valid && Math.abs(dx)>=60 && Math.abs(dx)>Math.abs(dy)*1.6)this.movePhoto(dx<0?1:-1);}
  },
  toggleViewerChrome() { if(this.data.viewerOpen && this.data.infoOpen){this.closeInfo();return;}if (this.data.viewerOpen && Date.now()>=(this._viewerIgnoreTapUntil || 0)) this.setData({ viewerChrome: !this.data.viewerChrome }); },
  dismissPhoto() {
    if(!this._alive || !this._active || !this.data.viewerOpen || this.data.viewerClosing)return;
    this.cancelMotion('viewerEnter');this._popupClosing=true;
    const frame=this._activeViewerFrame;this.setData({viewerClosing:true,viewerPhase:'exit',infoOpen:false,infoMounted:false});
    this.deferMotion('viewerExit',this.data.reduceMotion?120:180,()=>{if(frame===this._activeViewerFrame && this.data.viewerClosing)this.closePhoto();});
  },
  closePhoto() { if (this._alive) { this.closeShareCard();this.resetViewerGesture();this.discardOriginal();if (this.data.viewerOpen) this._popupClosing = true; this._popupEpoch++; this.setData({ viewerOpen: false,viewerClosing:false,viewerPhase:'open',infoOpen:false,infoMounted:false,viewerOriginalPath:'',originalReady:false }); } },
  viewerLeaving() { this.closePhoto(); },
  viewerLeft() { if (this._alive && !this.data.viewerOpen) { this._popupClosing = false; this.setData({ selectedPath: '', viewerChrome: true }); } },
  popupLeaving() { if (this.data.popupMode === 'viewer') this.closePhoto(); else if(this.data.popupMode==='inspirationEditor')this.cancelInspirationEdit();else this.closeConnection(); },
  popupLeft() { this._popupClosing = false; if (this.data.popupMode === 'viewer') this.viewerLeft(); },
  imageFailed(event) { const index = Number(event.currentTarget.dataset.index), photo = this.data.photos[index]; if (!photo || !photo.path) return;
    this._previewCache.delete(photo.id);this._galleryCache?.invalidatePreview(photo.cacheKey,photo.path);if(this._files.has(photo.path))this.removeFile(photo.path); this.updatePhoto(index, { path: '', state: '图片无法显示' }); }
});
