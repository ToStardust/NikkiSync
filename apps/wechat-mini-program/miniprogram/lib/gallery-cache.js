const INDEX = 'nikkisync.galleryCache.v1';
const MAX_PREVIEWS = 128, MAX_BYTES = 32 * 1024 * 1024;
const MAX_DETAILS = 80, MAX_DETAIL_TEXT = 240000;
const TTL = 7 * 24 * 60 * 60 * 1000;
const fileName = /^nikkisync-gallery-cache-v1-\d+-\d+\.jpg$/;
const keyOk = key => typeof key==='string' && /^[a-f0-9]{64}$/.test(key);
const recent = time => Number.isFinite(time) && time<=Date.now() && Date.now()-time<TTL;
let serial=0;

function createGalleryCache(wx) {
  const fs=wx.getFileSystemManager(),root=wx.env.USER_DATA_PATH;
  const previews=new Map(),details=new Map(),owned=new Set();
  let bytes=0,detailText=0;
  const remove=path=>{owned.delete(path);try{fs.unlink({filePath:path,fail(){}});}catch(_){}};
  function dropPreview(key) {
    const item=previews.get(key);if(!item)return;
    previews.delete(key);bytes-=item.size;remove(root+'/'+item.file);
  }
  function dropDetails(key) {
    const item=details.get(key);if(!item)return;
    details.delete(key);detailText-=JSON.stringify(item).length;
  }
  function flush() {
    try{wx.setStorageSync?.(INDEX,{previews:[...previews.values()],details:[...details.values()]});}catch(_){}
  }
  function rememberDetails(item) {
    const size=JSON.stringify(item).length;
    if(size>16000)return;
    dropDetails(item.key);
    while(details.size>=MAX_DETAILS||detailText+size>MAX_DETAIL_TEXT)dropDetails(details.keys().next().value);
    details.set(item.key,item);detailText+=size;
  }
  try {
    const saved=wx.getStorageSync?.(INDEX);
    for(const item of (Array.isArray(saved?.previews)?saved.previews:[]).slice(-MAX_PREVIEWS)){
      if(!item||!keyOk(item.key)||typeof item.file!=='string'||!fileName.test(item.file)||!recent(item.time)
         ||!Number.isInteger(item.size)||item.size<4||item.size>524288||bytes+item.size>MAX_BYTES||previews.has(item.key)||owned.has(root+'/'+item.file))continue;
      previews.set(item.key,item);bytes+=item.size;owned.add(root+'/'+item.file);
    }
    for(const item of (Array.isArray(saved?.details)?saved.details:[]).slice(-MAX_DETAILS)){
      if(!item||!keyOk(item.key)||!keyOk(item.version)||!recent(item.time)||!['available','partial','unavailable'].includes(item.availability)
         ||!Array.isArray(item.rows)||item.rows.length>16||!Array.isArray(item.items)||item.items.length>100)continue;
      if(item.rows.some(row=>!row||typeof row.label!=='string'||typeof row.value!=='string')
         ||item.items.some(entry=>!entry||typeof entry.name!=='string'||typeof entry.hasIcon!=='boolean'||!keyOk(entry.cacheKey)))continue;
      rememberDetails(item);
    }
    fs.readdir?.({dirPath:root,success({files}){for(const name of files||[])if(typeof name==='string'&&fileName.test(name)&&!owned.has(root+'/'+name))remove(root+'/'+name);},fail(){}});
  }catch(_){}
  return {
    getPreview(key) {
      const item=previews.get(key);if(!item)return;
      const path=root+'/'+item.file;
      try{
        if(!recent(item.time)||(fs.statSync&&fs.statSync(path).size!==item.size))throw Error('Invalid cached preview');
        fs.accessSync?.(path);
      }catch(_){dropPreview(key);flush();return;}
      previews.delete(key);previews.set(key,item);return path;
    },
    reservePreview(size) {
      while(previews.size>=MAX_PREVIEWS||bytes+size>MAX_BYTES)dropPreview(previews.keys().next().value);
      const path=root+'/nikkisync-gallery-cache-v1-'+Date.now()+'-'+(++serial)+'.jpg';
      owned.add(path);return path;
    },
    savePreview(key,path,size) {
      dropPreview(key);
      previews.set(key,{key,file:path.slice(root.length+1),size,time:Date.now()});bytes+=size;flush();
    },
    discardPreview:remove,
    invalidatePreview(key,path) {if(previews.get(key)?.file===path.slice(root.length+1)){dropPreview(key);flush();}},
    getDetails(key) {
      const item=details.get(key);if(!item)return;
      dropDetails(key);
      if(recent(item.time)){rememberDetails(item);return item;}
    },
    saveDetails(key,value) {
      const {version,availability,rows,items}=value;
      rememberDetails({key,version,availability,rows,items:items.map(({name,hasIcon,cacheKey})=>({name,hasIcon,cacheKey})),time:Date.now()});
      flush();
    },
    flush
  };
}
module.exports={createGalleryCache};
