const inspirationData={inspirationOpen:false,inspirationBusy:false,inspirationItems:[],inspirationNext:null,inspirationMessage:'',inspirationEditing:false,inspirationDraft:{title:'',code:'',type:'outfit',status:'want',categories:''},inspirationStatusNames:['自搭','想尝试','已复刻','试过了','已归档'],inspirationStatusIndex:1,inspirationTypeIndex:1};
const statuses=['self','want','reproduced','tried','archived'],types=['dye','outfit','unknown'];
function candidates(value){
 const found=[];for(const line of value.split(/\r?\n/)){if(/https?:\/\//i.test(line))continue;for(const part of line.split(/[#＃]/).slice(0,-1)){const cleaned=part.slice(-160).replace(/[^a-z0-9]/gi,'');const match=/(1[a-z0-9]{10})$/i.exec(cleaned);if(match&&!found.includes(match[1]+'#'))found.push(match[1]+'#');}}return found;
}
const inspirationPage={
 openInspiration(){
  if(!this._active||this.data.busy||this.data.saving||this.data.viewerOpen||this.data.connectionOpen)return;
  if(!this.data.connected){this.openConnection?.();return;}
  this.stopRefresh();this._inspirationCoverCache=new Map();this._inspirationFullCache=new Map();this.setData({inspirationOpen:true,myOpen:false});this.loadInspiration(false);
 },
 closeInspiration(){if(this.data.inspirationEditing)this.cancelInspirationEdit();this._inspirationEpoch=(this._inspirationEpoch||0)+1;this.setData({inspirationOpen:false,inspirationBusy:false});if(this._active&&this.data.connected)this.scheduleRefresh();},
 loadInspiration(more=false){
  if(!this._active||!this.data.connected||this.data.inspirationBusy||!this._channel?.inspiration)return;
  const epoch=this._inspirationEpoch=(this._inspirationEpoch||0)+1;this.setData({inspirationBusy:true,inspirationMessage:'正在读取电脑灵感库…'});
  for(const path of this._inspirationCoverCache?.values()||[])this.removeFile(path);this._inspirationCoverCache?.clear();
  const items=[],seen=new Set();let page=0;
  const next=after=>{if(seen.has(after)||++page>20){finish(after);return;}seen.add(after);
   try{this._channel.inspiration('list',{after},r=>{
    if(!this._active||!this.data.inspirationOpen||epoch!==this._inspirationEpoch)return;
    if(r.status!=='ok'||!Array.isArray(r.value?.items)){this.setData({inspirationBusy:false,inspirationMessage:'读取失败，请确认电脑使用支持灵感库的新版助手。'});return;}
    items.push(...r.value.items);if(r.value.next&&page<6)next(r.value.next);else finish(r.value.next);
   });}catch(_){this.setData({inspirationBusy:false,inspirationMessage:'连接暂时不可用，请稍后重试。'});}
  };
  const finish=after=>{this.setData({inspirationItems:items.map(item=>({...item,statusLabel:this.data.inspirationStatusNames[Math.max(0,statuses.indexOf(item.status))]})),inspirationNext:after||null,inspirationBusy:true,inspirationMessage:'正在载入参考图…'});this.loadInspirationCovers(epoch,0);};
  next(more?this.data.inspirationNext||'':'');
 },
 moreInspiration(){if(this.data.inspirationNext)this.loadInspiration(true);},
 refreshInspiration(){this.loadInspiration(false);},
 loadInspirationCovers(epoch,index){
  if(!this._active||!this.data.inspirationOpen||epoch!==this._inspirationEpoch)return;
  const item=this.data.inspirationItems[index];if(!item){this.setData({inspirationBusy:false,inspirationMessage:'与电脑共用灵感库 · App 连接后同步'});return;}
  const next=()=>this.loadInspirationCovers(epoch,index+1);if(!item.images.length){next();return;}
  const ref=item.images[0],cached=this._inspirationCoverCache?.get(ref.key);if(cached){this.setData({['inspirationItems['+index+'].coverPath']:cached});next();return;}
  try{this._channel.reference(item.id,ref.key,r=>{
   if(!this._active||epoch!==this._inspirationEpoch){r.image?.fill(0);return;}
   if(r.status!=='ok'){next();return;}
   const path=wx.env.USER_DATA_PATH+'/nikkisync-inspiration-thumb-'+Date.now()+'-'+index+'.jpg',data=r.image.buffer.slice(r.image.byteOffset,r.image.byteOffset+r.image.length);r.image.fill(0);this._files.add(path);
   wx.getFileSystemManager().writeFile({filePath:path,data,success:()=>{new Uint8Array(data).fill(0);if(!this._active||epoch!==this._inspirationEpoch){this.removeFile(path);return;}this._inspirationCoverCache?.set(ref.key,path);this.setData({['inspirationItems['+index+'].coverPath']:path});next();},fail:()=>{new Uint8Array(data).fill(0);this.removeFile(path);next();}});
  },true);}catch(_){this.setData({inspirationBusy:false,inspirationMessage:'参考图暂不可用，可刷新后重试。'});}
 },
 editInspiration(event){if(this.data.inspirationBusy||this._popupClosing||this.data.connectionOpen)return;const item=event?.currentTarget?.dataset?.id?this.data.inspirationItems.find(i=>i.id===event.currentTarget.dataset.id):null;
  this._inspirationEditingItem=item;this.setData({inspirationEditing:true,inspirationDraft:{title:item?.title||'',code:item?.code||'',type:item?.type||'outfit',status:item?.status||'want',categories:(item?.categories||[]).join('、')},inspirationStatusIndex:Math.max(0,statuses.indexOf(item?.status||'want')),inspirationTypeIndex:Math.max(0,types.indexOf(item?.type||'outfit'))});this.presentPopup?.('inspirationEditor',{});
 },
 cancelInspirationEdit(){this.setData({inspirationEditing:false});this.closeConnection?.();},
 inspirationInput(event){const key=event.currentTarget.dataset.field;if(!['title','code','categories'].includes(key))return;this.setData({['inspirationDraft.'+key]:event.detail.value});},
 inspirationTypeChanged(event){const index=Number(event.detail.value);if(!types[index])return;this.setData({inspirationTypeIndex:index,'inspirationDraft.type':types[index]});},
 inspirationStatusChanged(event){const index=Number(event.detail.value);if(!statuses[index])return;this.setData({inspirationStatusIndex:index,'inspirationDraft.status':statuses[index]});},
 pasteInspiration(){wx.getClipboardData({success:r=>{if(!this._active||!this.data.inspirationEditing)return;const matches=candidates(r.data||'');this.setData({'inspirationDraft.code':matches.length===1?matches[0]:r.data||'',inspirationMessage:matches.length===1?'已提取可能的分享码，请核对后保存。':'未找到唯一的码，已保留粘贴原文，请手动核对。'});}});},
 saveInspiration(){const draft=this.data.inspirationDraft,item=this._inspirationEditingItem;
  if(!draft.code.trim()&&!item?.images?.length){this.setData({inspirationMessage:'请填写分享码，保存后可添加参考图。'});return;}
  this.inspirationMutation('save',{id:item?.id||'',revision:item?.revision||0,title:draft.title,code:draft.code,type:draft.type,status:draft.status,categories:[...new Set(draft.categories.split(/[、,，]/).map(s=>s.trim()).filter(Boolean))]},()=>{this.cancelInspirationEdit();this.loadInspiration(false);});
 },
 inspirationMutation(action,input,success){
  if(!this._active||!this.data.connected||this.data.busy||this.data.saving||this.data.inspirationBusy)return;
  this.setData({inspirationBusy:true,inspirationMessage:'正在同步…'});const epoch=this._inspirationEpoch;
  const done=r=>{if(!this._active||!this.data.inspirationOpen||epoch!==this._inspirationEpoch)return;this.setData({inspirationBusy:false});
   if(r.status!=='ok'){this.setData({inspirationMessage:'保存未完成或另一端已修改。输入仍保留，请刷新记录后核对；不要反复提交。'});return;}success?.(r.value);};
  try{this._channel.inspiration(action,input,done);}catch(_){this.setData({inspirationBusy:false,inspirationMessage:'输入过长或连接不可用，内容已保留。'});}
 },
 copyInspiration(event){const item=this.data.inspirationItems.find(i=>i.id===event.currentTarget.dataset.id);if(item)wx.setClipboardData({data:item.code});},
 inspirationOptions(event){if(this.data.inspirationBusy)return;const item=this.data.inspirationItems.find(i=>i.id===event.currentTarget.dataset.id);if(!item)return;
  wx.showActionSheet({itemList:['编辑灵感','添加参考图','管理参考图','删除灵感'],success:r=>{if(!this._active||!this.data.inspirationOpen)return;if(r.tapIndex===0)this.editInspiration(event);else if(r.tapIndex===1)this.addInspirationImage(event);else if(r.tapIndex===3)this.deleteInspiration(event);else if(item.images.length)wx.showActionSheet({itemList:item.images.map((_,n)=>'移除参考图 '+(n+1)),success:choice=>{const ref=item.images[choice.tapIndex];if(ref&&this._active)this.removeInspirationImage({currentTarget:{dataset:{id:item.id,key:ref.key}}});}});else this.setData({inspirationMessage:'还没有参考图，可以先添加。'});}});
 },
 deleteInspiration(event){const item=this.data.inspirationItems.find(i=>i.id===event.currentTarget.dataset.id);if(!item||this.data.inspirationBusy)return;wx.showModal({title:'删除这条灵感？',content:'电脑与 App 也会同步这次删除。系统相册原图保留。',success:r=>{if(r.confirm)this.inspirationMutation('delete',{id:item.id,revision:item.revision},()=>this.loadInspiration(false));}});},
 addInspirationImage(event){
  if(typeof wx.chooseMedia!=='function'){this.setData({inspirationMessage:'当前微信版本不支持选择参考图，请更新微信后重试。'});return;}
  const item=this.data.inspirationItems.find(i=>i.id===event.currentTarget.dataset.id);if(!item||this.data.inspirationBusy)return;
  if(item.images.length>=5){this.setData({inspirationMessage:'一条灵感最多添加 5 张参考图。'});return;}
  const epoch=this._inspirationEpoch;this._inspirationExternal=true;wx.chooseMedia({count:1,mediaType:['image'],sourceType:['album'],complete:()=>{if(!this._inspirationNativeHidden)this._inspirationExternal=false;},success:r=>{
   if(!this._alive||!this.data.inspirationOpen||epoch!==this._inspirationEpoch)return;
   const file=r.tempFiles?.[0];if(!file||file.size>15*1024*1024){this.setData({inspirationMessage:'请选择不超过 15 MB 的图片。'});return;}
   const read=()=>wx.getFileSystemManager().readFile({filePath:file.tempFilePath,success:result=>{
    if(!this._active||!this.data.connected||epoch!==this._inspirationEpoch||this.data.inspirationBusy)return;
    const bytes=new Uint8Array(result.data),mime=bytes[0]===255&&bytes[1]===216?'image/jpeg':bytes[0]===137&&bytes[1]===80?'image/png':bytes[0]===82&&bytes[1]===73?'image/webp':bytes[4]===102&&bytes[5]===116?'image/heic':'';
    if(!mime){bytes.fill(0);this.setData({inspirationMessage:'请选择 JPEG、PNG、WebP 或 HEIC 图片。'});return;}
    this.setData({inspirationBusy:true,inspirationMessage:'正在添加参考图…'});
    try{this._channel.inspirationUpload(item.id,item.revision,mime,bytes,result=>{
     if(!this._active||!this.data.inspirationOpen||epoch!==this._inspirationEpoch)return;
     this.setData({inspirationBusy:false,inspirationMessage:result.status==='ok'?'参考图已同步到电脑。':'参考图未完成或记录已变化，请刷新核对。'});this.loadInspiration(false);
    });}catch(_){this.setData({inspirationBusy:false,inspirationMessage:'添加未完成，请检查连接。'});}finally{bytes.fill(0);}
   },fail:()=>this.setData({inspirationMessage:'无法读取所选参考图。'})});
   if(this._active)read();else this._inspirationExternalResult=()=>{if(this._alive&&this.data.inspirationOpen&&epoch===this._inspirationEpoch)read();};
  }});
 },
 viewInspirationImage(event){
  const item=this.data.inspirationItems.find(i=>i.id===event.currentTarget.dataset.id);if(!item||this.data.inspirationBusy||!item.images.length)return;
  const epoch=this._inspirationEpoch;this.setData({inspirationBusy:true,inspirationMessage:'正在读取参考图…'});const paths=[];
  const receive=index=>{
   if(!this._active||!this.data.inspirationOpen||epoch!==this._inspirationEpoch)return;
   if(index>=item.images.length){this.setData({inspirationBusy:false,inspirationMessage:''});this._inspirationExternal=true;wx.previewImage({urls:paths,current:paths[0],complete:()=>{if(!this._inspirationNativeHidden)this._inspirationExternal=false;}});return;}
   const ref=item.images[index],cached=this._inspirationFullCache?.get(ref.key);if(cached){paths.push(cached);receive(index+1);return;}
   try{this._channel.reference(item.id,ref.key,r=>{
    if(!this._active||!this.data.inspirationOpen||epoch!==this._inspirationEpoch){r.image?.fill(0);return;}
    if(r.status!=='ok'){this.setData({inspirationBusy:false,inspirationMessage:'参考图读取失败，请重试。'});return;}
    const ext={'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/heic':'heic','image/heif':'heif'}[r.mime];
    const path=wx.env.USER_DATA_PATH+'/nikkisync-inspiration-'+Date.now()+'-'+index+'.'+ext;this._files.add(path);
    const data=r.image.buffer.slice(r.image.byteOffset,r.image.byteOffset+r.image.length);r.image.fill(0);
    wx.getFileSystemManager().writeFile({filePath:path,data,success:()=>{new Uint8Array(data).fill(0);if(!this._active||epoch!==this._inspirationEpoch){this.removeFile(path);return;}this._inspirationFullCache?.set(ref.key,path);while(this._inspirationFullCache?.size>5){const oldest=this._inspirationFullCache.keys().next().value;this.removeFile(this._inspirationFullCache.get(oldest));this._inspirationFullCache.delete(oldest);}paths.push(path);receive(index+1);},fail:()=>{new Uint8Array(data).fill(0);this.removeFile(path);this.setData({inspirationBusy:false,inspirationMessage:'参考图缓存写入失败。'});}});
   });}catch(_){this.setData({inspirationBusy:false,inspirationMessage:'连接暂时不可用。'});}
  };receive(0);
 },
 removeInspirationImage(event){const item=this.data.inspirationItems.find(i=>i.id===event.currentTarget.dataset.id);if(!item)return;this.inspirationMutation('removeImage',{id:item.id,revision:item.revision,key:event.currentTarget.dataset.key},()=>this.loadInspiration(false));}
};
module.exports={inspirationPage,inspirationData,candidates};
