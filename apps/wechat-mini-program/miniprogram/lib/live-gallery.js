let serial=0;
const pinned=new Set(),active=new Set();
function createLiveCache(wxApi){
 const files=new Set();let epoch=0;
 const remove=path=>{files.delete(path);active.delete(path);if(pinned.has(path))return;try{wxApi.getFileSystemManager().unlink({filePath:path,fail(){}});}catch(_){} };
 // Own leaf prefix only; do not touch any gallery originals, exports or unrelated user files.
 try{wxApi.getFileSystemManager().readdir({dirPath:wxApi.env.USER_DATA_PATH,success:r=>(r.files||[]).forEach(name=>{const path=wxApi.env.USER_DATA_PATH+'/'+name;if(/^nikkisync-live-cache-\d+-\d+\.(livp|mp4)$/.test(name)&&!pinned.has(path)&&!active.has(path))remove(path);}),fail(){}});}catch(_){}
 return {
  clear(){epoch++;for(const path of Array.from(files))remove(path);},
  put(value,kind,done){
   const bytes=value?.image,live=kind==='live';
   if(value?.status!=='ok'||!(bytes instanceof Uint8Array)||bytes.length<4||bytes.length>100663296||!(live?value.live===true&&value.mime==='application/x-livp':value.motion===true&&value.mime==='video/mp4')){bytes?.fill(0);done(null);return;}
   const current=epoch,path=wxApi.env.USER_DATA_PATH+'/nikkisync-live-cache-'+Date.now()+'-'+(++serial)+(live?'.livp':'.mp4'),copy=bytes;files.add(path);active.add(path);let settled=false;
   const finish=ok=>{if(settled)return;settled=true;copy.fill(0);if(!ok||current!==epoch){remove(path);done(null);}else done(path);};
   try{wxApi.getFileSystemManager().writeFile({filePath:path,data:copy.buffer,success:()=>finish(true),fail:()=>finish(false)});}catch(_){finish(false);}
  },
  share(path,done){
   if(!files.has(path)||!path.endsWith('.livp')||typeof wxApi.shareFileMessage!=='function'){done({status:'unsupported'});return;}
   pinned.add(path);let settled=false;
   const finish=status=>{if(settled)return;settled=true;pinned.delete(path);if(status==='shared'||!files.has(path))remove(path);done({status});};
   try{wxApi.shareFileMessage({filePath:path,fileName:'NikkiSync-Live-'+Date.now()+'.livp',success:()=>finish('shared'),fail:e=>finish(/cancel/i.test(e?.errMsg||'')?'cancelled':'failed')});}catch(_){finish('failed');}
  }
 };
}
module.exports={createLiveCache};
