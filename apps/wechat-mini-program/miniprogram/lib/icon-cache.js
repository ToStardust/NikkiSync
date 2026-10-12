let sequence=0;
function createIconCache(wxApi,options){
 options=options||{};const maxEntries=options.maxEntries||64,maxBytes=options.maxBytes||4*1024*1024,fs=wxApi.getFileSystemManager(),entries=new Map(),owned=new Set();let bytes=0,epoch=0;
 const remove=path=>{owned.delete(path);try{fs.unlink({filePath:path,fail(){}});}catch(_){}},drop=key=>{const value=entries.get(key);if(value){entries.delete(key);bytes-=value.size;remove(value.path);}};
 try{fs.readdir?.({dirPath:wxApi.env.USER_DATA_PATH,success(value){for(const name of value.files||[]){if(typeof name!=='string'||!/^nikkisync-icon-\d+-\d+\.png$/.test(name))continue;const path=wxApi.env.USER_DATA_PATH+'/'+name;if(!owned.has(path))remove(path);}},fail(){}});}catch(_){}
 return {
  get(key){const value=entries.get(key);if(value){entries.delete(key);entries.set(key,value);return Object.assign({},value);} },
  invalidate:drop,
  put(key,image,mime,source,done){
   if(!/^[a-f0-9]{32}$/.test(key)||!(image instanceof Uint8Array)||!image.length||image.length>Math.min(maxBytes,262144)||mime!=='image/png'||!['item','category'].includes(source)){image?.fill(0);done();return;}
   const generation=epoch,path=wxApi.env.USER_DATA_PATH+'/nikkisync-icon-'+Date.now()+'-'+(++sequence)+'.png',size=image.length,buffer=image.buffer.slice(image.byteOffset,image.byteOffset+size);image.fill(0);
   owned.add(path);
   const wipe=()=>new Uint8Array(buffer).fill(0),failed=()=>{wipe();remove(path);if(generation===epoch)done();};
   try{fs.writeFile({filePath:path,data:buffer,success(){wipe();if(generation!==epoch){remove(path);return;}drop(key);while(entries.size>=maxEntries||bytes+size>maxBytes)drop(entries.keys().next().value);
    const value={path,size,source};entries.set(key,value);bytes+=size;done(Object.assign({},value));},fail:failed});}catch(_){failed();}
  },
  clear(){epoch++;for(const key of Array.from(entries.keys()))drop(key);},
  stats(){return {entries:entries.size,bytes};}
 };
}
module.exports={createIconCache};
