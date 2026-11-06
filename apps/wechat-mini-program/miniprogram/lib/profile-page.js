const key='nikkisync.stylistProfile.v1';
const profileData={myOpen:false,profileUid:'',profileName:'',profileMessage:'',profileSavedName:'',profileSavedUid:'',profileTitle:'大喵相机',profileFooter:'MomoCamera',albumTitle:'暖暖相册'};
function clean(value,max){if(typeof value!=='string')throw Error('请填写文字');const text=value.trim();if(text.length>max||/[\u0000-\u001f\u007f]/.test(text))throw Error('文字过长或包含不支持的字符');return text;}
function readProfile(wxApi) {
  try {
    const value = wxApi.getStorageSync(key) || {};
    return { uid: clean(value.uid || '', 20), name: clean(value.name || '', 32) };
  } catch (_) {
    return { uid: '', name: '' };
  }
}
function albumTitle(name) {
  return name ? name + '家的暖暖相册' : '暖暖相册';
}
const profilePage={
 initProfile() {
   const profile = readProfile(wx);
   this.applyProfile(profile.uid, profile.name);
 },
 applyProfile(uid, name) {
   const title = albumTitle(name);
   this.setData({
     profileUid:uid, profileName:name, profileSavedUid:uid, profileSavedName:name,
     profileInitial:Array.from(name)[0]||'喵',
     profileTitle:name?name+'的大喵相机':'大喵相机',
     profileFooter:(uid?'UID：'+uid+' ':'')+'MomoCamera',
     albumTitle:title,
   });
   try { wx.setNavigationBarTitle?.({ title }); } catch (_) {}
 },
 profileInput(event){const field=event.currentTarget.dataset.field;if(['profileUid','profileName'].includes(field))this.setData({[field]:event.detail.value});},
 saveProfile(){try{const uid=clean(this.data.profileUid,20),name=clean(this.data.profileName,32);if(uid&&!/^\d{1,20}$/.test(uid))throw Error('UID 请填写 1–20 位数字');wx.setStorageSync(key,{uid,name});this.applyProfile(uid,name);this.setData({profileMessage:'摄影名片已保存在这台手机，之后生成的分享图会使用这份水印。'});}catch(e){this.setData({profileMessage:e.message||'保存失败，请重试。'});}},
 clearProfile(){try{wx.setStorageSync(key,{uid:'',name:''});this.applyProfile('','');this.setData({profileMessage:'已清除摄影名片。'});}catch(_){this.setData({profileMessage:'清除失败，请重试。'});}},
 shareBranding(){return {title:this.data.profileTitle||'大喵相机',footer:this.data.profileFooter||'MomoCamera'};},
 openMy(){if(!this._active||this.data.busy||this.data.saving||this.data.viewerOpen||this.data.inspirationBusy)return;if(this.data.inspirationOpen)this.closeInspiration();this.stopRefresh();this.setData({myOpen:true});},
 openAlbum(){if(this.data.busy||this.data.saving||this.data.inspirationBusy)return;if(this.data.inspirationOpen)this.closeInspiration();this.setData({myOpen:false});if(this._active&&this.data.connected)this.scheduleRefresh();}
};
module.exports={profileData,profilePage,readProfile,albumTitle};
