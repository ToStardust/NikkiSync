const active=new Set(['preparing','pending','confirming','queued','checking','executing']);
const names={preparing:'核对关联文件',pending:'等待电脑确认',confirming:'电脑已确认，正在核对',queued:'等待处理',checking:'检查原文件',executing:'正在移入回收站',recycled:'已移入电脑回收站',cancelled:'申请已取消',rejected:'电脑已取消',changed:'原文件已变化，未删除',failed:'未全部完成，请检查电脑'};
const deletionData={deletionEnabled:false,deletionItems:[],viewerDeletionId:'',deletionMessage:'',deletionOpen:false};
function checkedItems(value){
 if(!value||!Array.isArray(value.items)||value.items.length>20)throw Error('items');
 return value.items.map(item=>{
  if(!item||!/^[a-f0-9]{32}$/.test(item.id)||!/^[a-f0-9]{32}$/.test(item.photoId)||!names[item.state]||typeof item.message!=='string'||item.message.length>300||!Number.isInteger(item.count)||item.count<0||item.count>100||!Array.isArray(item.files)||item.files.length>100)throw Error('item');
  if(item.approval!==undefined&&(item.state!=='confirming'||typeof item.approval!=='string'||!/^[a-f0-9-]{36}$/.test(item.approval)))throw Error('approval');
  return {id:item.id,photoId:item.photoId,state:item.state,label:names[item.state],message:item.message,count:item.count,canCancel:active.has(item.state)&&item.state!=='executing',...(item.approval?{approval:item.approval}:{})};
 });
}
const deletionPage={
 stopDeletionPolling(){clearTimeout(this._deletionTimer);this._deletionTimer=null;this._deletionEpoch=(this._deletionEpoch||0)+1;this._deletionEchoed=new Set();this._deletionPolls=0;if(this._deletionBusy){this._deletionBusy=false;this.setData({busy:false});}},
 scheduleDeletionPolling(delay){clearTimeout(this._deletionTimer);if(!this._alive||!this._active||!this.data.connected||!this.data.deletionEnabled||!this.data.deletionItems.some(i=>active.has(i.state)))return;
  // Poll promptly at first, then conserve the existing session request quota.
  if(delay===undefined)delay=(this._deletionPolls||0)<10?1500:5000;
  this._deletionTimer=setTimeout(()=>{this._deletionTimer=null;this.pollDeletions();},delay);},
 toggleDeletionList(){this.setData({deletionOpen:!this.data.deletionOpen});},
 requestViewedDeletion(){if(this.data.selectedId)this.requestDeletion([this.data.selectedId]);},
 requestSelectedDeletion(){this.adoptSelection();this.requestDeletion(Array.from(this._selected));},
 deletionIdForPhoto(photoId,items=this.data.deletionItems){
  return items.find(item=>item.photoId===photoId&&item.canCancel)?.id||'';
 },
 requestDeletion(ids){
  if(!this._alive||!this._active||!this.data.connected||!this.data.deletionEnabled||this.data.busy||this.data.saving||this.data.infoLoading||this.data.hdLoading||this.data.inspirationBusy)return;
  if(!ids.length||ids.length>20){this.setData({deletionMessage:'每次可申请 1–20 项，请缩小选择范围。',deletionOpen:true});return;}
  const epoch=this._connectionEpoch;
  wx.showModal({title:'申请删除电脑原文件？',content:'电脑会列出这 '+ids.length+' 项涉及的原图、画质副本、相同内容的导出图和关联视频。请核对文件清单后再确认移入回收站，并保持小程序在前台。断线后未开始的申请会取消。',confirmText:'发送申请',confirmColor:'#B65F78',success:r=>{
   if(!r.confirm||!this._active||!this.data.connected||epoch!==this._connectionEpoch||this.data.busy||this.data.saving)return;
   this._deletionPolls=0;
   this.deletionCall('request',{ids},'申请已发送，请到电脑的“最近删除”确认。确认后自动处理，无需在手机再次点击。');
  }});
 },
 cancelDeletion(event){const id=event?.currentTarget?.dataset?.id;if(!this.data.deletionItems.some(i=>i.id===id&&active.has(i.state)&&i.state!=='executing'))return;
  this._deletionCancel=this._deletionCancel||new Set();this._deletionCancel.add(id);this.setData({deletionMessage:'正在取消申请，请等待电脑返回结果。'});this.pollDeletions();},
 pollDeletions(){
  if(!this._alive||!this._active||!this.data.connected||!this.data.deletionEnabled)return;
  if(this.data.busy||this.data.saving||this.data.infoLoading||this.data.hdLoading||this.data.shareBusy||this.data.shareSaving||this.data.inspirationBusy){this.scheduleDeletionPolling();return;}
  const cancel=Array.from(this._deletionCancel||[]),approvals=this.data.deletionItems.filter(i=>i.state==='confirming'&&i.approval&&!cancel.includes(i.id)).map(i=>({id:i.id,approval:i.approval}));
  this._deletionEchoed=this._deletionEchoed||new Set();for(const item of approvals)this._deletionEchoed.add(item.id+':'+item.approval);this._deletionPolls=(this._deletionPolls||0)+1;
  this.deletionCall('sync',{cancel,approvals});
 },
 deletionCall(action,input,message){
  const epoch=this._deletionEpoch||0;this._deletionBusy=true;this.setData({busy:true,deletionOpen:true});
  try{this._channel.deletion(action,input,result=>{
   if(!this._alive||!this._active||epoch!==(this._deletionEpoch||0))return;
   this._deletionBusy=false;this.setData({busy:false});
   if(result.status!=='ok'){this.setData({deletionMessage:'申请未完成，请检查连接并到电脑核对结果。'});this.scheduleDeletionPolling(5000);return;}
   try{const items=checkedItems(result.value);this._deletionCancel=new Set(Array.from(this._deletionCancel||[]).filter(id=>items.some(i=>i.id===id&&i.canCancel)));
    this.setData({deletionItems:items,viewerDeletionId:this.deletionIdForPhoto(this.data.selectedId,items),
     deletionMessage:message||'电脑确认后自动处理，无需在手机再次点击。'});
    const fresh=items.some(item=>item.state==='confirming'&&item.approval&&!this._deletionCancel.has(item.id)&&!this._deletionEchoed?.has(item.id+':'+item.approval));
    this.scheduleDeletionPolling(fresh?0:undefined);
   }catch(_){this.setData({deletionMessage:'电脑返回的状态无效，未继续确认删除。'});}
  });}catch(_){this._deletionBusy=false;this.setData({busy:false,deletionMessage:'当前连接不支持删除申请，请使用配套新版 EXE。'});this.scheduleDeletionPolling();}
 }
};
module.exports={deletionData,deletionPage};
