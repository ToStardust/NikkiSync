const { NAMES, parseLiveQr, receiveLiveProbe } = require('../../lib/live-probe.js');
const { saveProbeCandidate } = require('../../lib/live-probe-save.js');
const ownedName = /^nikkisync-live-probe-\d+-\d+-(baseline\.jpg|paired\.jpg|paired\.mov|motion\.jpg|paired\.livp)$/;
const inUse = new Set();
const leased = new Set();
let sequence = 0;
Page({
  data: { busy:false, saving:false, ready:false, previewReady:false, previewPath:'', videoPath:'', liveVerified:false,
    mode:0, modes:['1 · 普通图片（权限对照）','2 · 单文件 Motion JPEG','3 · LIVP 配对资源包','4 · 图片＋视频顺序保存'],
    message:'只接收电脑生成的动态测试画面，不读取你的游戏照片。',device:'',ios:false,result:'' },
  onLoad(){
    this._alive=true;this._active=false;this._generation=0;this._owned=new Set();this._files=null;
    let device={},app={};try{device=wx.getDeviceInfo();app=wx.getAppBaseInfo();}catch(_){}
    const ios=device.platform==='ios';
    this.setData({ios,device:(ios?'iOS':'非 iPhone')+' · 微信 '+(app.version||'未知')+' · 基础库 '+(app.SDKVersion||'未知')});
    try{wx.getFileSystemManager().readdir({dirPath:wx.env.USER_DATA_PATH,success:r=>{
      (r.files||[]).filter(name=>ownedName.test(name)).forEach(name=>{const path=wx.env.USER_DATA_PATH+'/'+name;if(!inUse.has(path)&&!leased.has(path))this.remove(path);});
    },fail(){}});}catch(_){}
  },
  onShow(){this._active=true;if(this._pending){const config=this._pending;this._pending=null;this.startTest(config);}},
  onHide(){
    this._active=false;
    if(!this._scanning){
      if(this._cancel)this._cancel();
      // These are small NON-PRIVATE fixtures. Retain completed files while the
      // user checks Photos / grants system permission; clean on unload/startup.
      if(this.data.busy){this._generation++;this.clearFiles();if(this._alive)this.setData({busy:false});}
    }
  },
  onUnload(){this._alive=false;this._active=false;this._pending=null;this._generation++;if(this._cancel)this._cancel();this.clearFiles();},
  remove(path){
    if(typeof path!=='string'||path.indexOf(wx.env.USER_DATA_PATH+'/')!==0||!ownedName.test(path.slice(wx.env.USER_DATA_PATH.length+1)))return;
    leased.delete(path);
    try{wx.getFileSystemManager().unlink({filePath:path,fail(){}});}catch(_){}
  },
  clearFiles(){
    this._files=null;
    if(this._owned)this._owned.forEach(path=>{if(!inUse.has(path)){this.remove(path);this._owned.delete(path);}});
    if(this._alive&&!this.data.saving)this.setData({ready:false,previewReady:false,previewPath:'',videoPath:''});
  },
  scanTest(){
    if(!this._alive||!this._active||this.data.busy||this.data.saving)return;
    this._scanning=true;this.setData({busy:true,message:'请扫描电脑新生成的 Live 合成测试码。普通图库二维码不能用于本测试。'});
    wx.scanCode({onlyFromCamera:true,scanType:['qrCode'],success:r=>{
      this._scanning=false;if(!this._alive)return;let config;
      try{config=parseLiveQr(r.result);}catch(_){this.setData({busy:false,message:'测试码无效或过期，请在电脑重新生成。'});return;}
      if(!this._active){this._pending=config;return;}this.startTest(config);
    },fail:()=>{this._scanning=false;if(this._alive)this.setData({busy:false,message:'已取消扫码，未保存相册。'});}});
  },
  startTest(config){
    if(!this._alive||!this._active)return;
    if(this._cancel)this._cancel();this.clearFiles();const generation=++this._generation;
    this.setData({busy:true,result:'',message:'正在接收并校验本机封装的合成素材…'});
    this._cancel=receiveLiveProbe(wx,config,value=>{
      const current=()=>this._alive&&this._active&&generation===this._generation;
      if(value.status!=='ok'){if(current())this.setData({busy:false,message:value.message});return;}
      if(!current()){NAMES.forEach(name=>value.files[name].fill(0));return;}
      const prefix=wx.env.USER_DATA_PATH+'/nikkisync-live-probe-'+Date.now()+'-'+(++sequence)+'-',paths={},operationPaths=[];
      const write=async()=>{
        try{
          for(const name of NAMES){
            if(!current())throw Error('Cancelled');
            const path=prefix+name,bytes=value.files[name];this._owned.add(path);leased.add(path);operationPaths.push(path);
            await new Promise((resolve,reject)=>{try{wx.getFileSystemManager().writeFile({filePath:path,data:bytes.buffer,success:()=>{
              bytes.fill(0);if(!current()){this.remove(path);reject(Error('Cancelled'));}else{paths[name]=path;resolve();}
            },fail:()=>reject(Error('Write failed'))});}catch(_){reject(Error('Write failed'));}});
          }
          if(!current())throw Error('Cancelled');this._files=paths;
          this.setData({busy:false,ready:true,previewPath:paths['baseline.jpg'],videoPath:paths['paired.mov'],previewReady:false,
            message:'素材校验通过。先确认视频能动且有测试音，再依次测试保存方式；每项仅点击一次。'});
        }catch(_){
          operationPaths.forEach(path=>{if(!inUse.has(path)){this.remove(path);this._owned.delete(path);}});
          if(current()){this._files=null;this.setData({busy:false,ready:false,previewReady:false,previewPath:'',videoPath:'',message:'缓存写入失败或测试已取消；未保存相册。'});}
        }
        finally{NAMES.forEach(name=>value.files[name].fill(0));}
      };
      void write();
    });
  },
  imageLoaded(){if(this._alive&&this._files)this.setData({previewReady:true});},
  imageFailed(){if(this._alive){this.setData({previewReady:false,message:'封面无法预览；不执行相册保存。'});}},
  videoFailed(){if(this._alive)this.setData({message:'微信视频预览失败。普通图、单文件测试仍可做；配对封装的 Apple 正控制未通过，不能据此断言全平台不支持。'});},
  changeMode(event){const mode=Number(event.detail.value);if(!this.data.saving&&Number.isInteger(mode)&&mode>=0&&mode<4)this.setData({mode,result:''});},
  saveCandidate(){
    if(!this._alive||!this._active||!this._files||!this.data.ready||!this.data.previewReady||this.data.busy||this.data.saving)return;
    if(!this.data.ios){this.setData({message:'这一步只用于 iPhone 微信验收。Android 保存成功不能证明 iOS LIVE。'});return;}
    const modes=['baseline','motion','livp','pair'],mode=modes[this.data.mode],paths=Object.assign({},this._files),pinned=Object.values(paths);
    pinned.forEach(path=>inUse.add(path));this.setData({saving:true,result:'',message:'正在测试系统保存接口…'});
    const done=result=>{
      pinned.forEach(path=>inUse.delete(path));
      if(!this._alive){pinned.forEach(path=>{this.remove(path);this._owned.delete(path);});}
      if(!this._alive)return;
      const message=result.outcome==='api_saved'?'系统接口返回已保存 '+result.saved+' 项；不代表相册已识别 LIVE。请在 iPhone 相册核验。'
        :result.outcome==='partial'?'只保存了图片，视频未完成；这是部分失败，不是 Live 保存成功。已存图片不会自动删除。'
        :'系统接口拒绝或保存失败；不自动降级为静态图，不调用其他 App。';
      this.setData({saving:false,liveVerified:false,message,result:this.data.modes[this.data.mode]+'：'+result.outcome});
    };
    try{saveProbeCandidate(wx,mode,paths,()=>this._alive,done);}catch(_){done({outcome:'failed',saved:0,live:'unverified'});}
  }
});
