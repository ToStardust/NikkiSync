let fileSequence = 0;
function saveOriginalBatch(wxApi, channel, ids, hooks, options) {
  hooks = hooks || {};
  options=options||{};if(options.exif!==undefined&&typeof options.exif!=='boolean')throw new Error('Export preference');
  const angles={};for(const id of ids||[]){const angle=options.rotations?.[id]??0;if([0,90,180,270].indexOf(angle)<0)throw new Error('Rotation');angles[id]=angle;}
  const attachExif=options.exif===true;
  if (!Array.isArray(ids) || !ids.length || ids.length > 100 || new Set(ids).size !== ids.length
    || ids.some(id => typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id))) throw new Error('Selection limit');
  const queue = ids.slice(), results = [];
  let stopped = false, stopRequested = false, finished = false, phase = 'permission', path = '', bytes, lastPercent = -1;
  const fs = wxApi.getFileSystemManager();
  const remove = file => { if (file) { try { fs.unlink({filePath:file,fail(){}}); } catch (_) {} } };
  const finish = extra => { if (finished) return; finished = true; stopped = true; if (hooks.complete) hooks.complete(Object.assign({results:results.slice(),cancelled:false,permissionDenied:false},extra)); };
  const progress = (state, percent) => { if (!stopped && hooks.progress) hooks.progress({state,index:results.length+1,total:queue.length,percent:percent || 0,results:results.slice()}); };
  const completeFile = (id, saved, denied) => {
    results.push({id,status:saved?'saved':'failed'});
    if (denied) finish({permissionDenied:true,cancelled:stopRequested});
    else if (stopRequested) finish({cancelled:true});
    else if (!stopped) next();
  };
  function next() {
    if (stopped) return;
    if (results.length >= queue.length) {finish();return;}
    const id = queue[results.length]; phase = 'download'; lastPercent = -1; progress('download',0);
    try {
      const exported=attachExif||angles[id]!==0;
      const downloaded=value=>{
        if (stopped) {value.image?.fill(0);return;}
        if (value.status !== 'ok' || (exported?(value.exported!==true||value.original!==false||value.rotation!==angles[id]||typeof value.exifApplied!=='boolean'||value.mime==='image/jpeg'&&value.exifApplied!==attachExif):value.original!==true) || !(value.image instanceof Uint8Array)
          || value.image.length < 4 || value.image.length > 16777216 || !['image/jpeg','image/png'].includes(value.mime)
          || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)) {
          value.image?.fill(0);completeFile(id,false);return;
        }
        bytes = value.image; path = wxApi.env.USER_DATA_PATH + (exported?'/nikkisync-export-':'/nikkisync-original-') + Date.now() + '-' + (++fileSequence) + (value.mime === 'image/png' ? '.png' : '.jpg');
        const file = path, input = bytes, buffer = input.buffer.slice(input.byteOffset,input.byteOffset+input.byteLength); phase = 'write'; progress('verify',100);
        const wipe = () => {input.fill(0);new Uint8Array(buffer).fill(0);bytes=null;};
        const failure = () => {wipe();remove(file);path='';if(!stopped)completeFile(id,false);};
        try { fs.writeFile({filePath:file,data:buffer,
          success() {
            wipe();
            if (stopped) {remove(file);path='';return;}
            phase = 'save';progress('save',100);
            const saved = (ok,error) => {
              remove(file);path='';
              // A save already handed to the OS can finish while this job is canceled in background.
              // Record only native success, so a recovered selection does not offer the saved photo again.
              if(ok)hooks.saved?.(id);
              if (!stopped) completeFile(id,ok,!ok && /auth|deny|permission/i.test(error?.errMsg || ''));
            };
            try {wxApi.saveImageToPhotosAlbum({filePath:file,success:()=>saved(true),fail:error=>saved(false,error)});}
            catch (_) {saved(false);}
          },fail:failure}); } catch (_) {failure();}
      }, downloading=(received,total) => {
        const percent=Math.floor(received/total*100);
        if(percent!==lastPercent){lastPercent=percent;progress('download',percent);}
      };
      if(exported)channel.export(id,{exif:attachExif,rotation:angles[id]},downloaded,downloading);else channel.original(id,downloaded,downloading);
    } catch (_) {
      // A closed session cannot be retried with its consumed QR. Mark unattempted items failed; never save a preview instead.
      for (const remaining of queue.slice(results.length)) results.push({id:remaining,status:'failed'});
      finish();
    }
  }
  const job = { stopAfterCurrent() {
    if (finished || stopRequested) return;
    stopRequested = true;
    // Keep the encrypted response and native file ownership intact. Stop only at a file boundary.
    if (phase === 'permission') finish({cancelled:true});
  }, cancel() {
    if (finished) return; stopped = true;
    if (phase === 'download') {try {if(channel.interrupt)channel.interrupt();else channel.close();} catch (_) {}}
    // write/save callbacks own their input until the native operation completes.
    if (phase !== 'write' && phase !== 'save') {bytes?.fill(0);remove(path);path='';}
    finish({cancelled:true});
  } };
  try {
    if(typeof wxApi.authorize !== 'function' || typeof wxApi.saveImageToPhotosAlbum !== 'function') throw new Error('Album API unavailable');
    wxApi.authorize({scope:'scope.writePhotosAlbum',success:()=>{if(!stopped)next();},fail:()=>finish({permissionDenied:true})});
  } catch (_) {finish({permissionDenied:true});}
  return job;
}
module.exports = {saveOriginalBatch};
