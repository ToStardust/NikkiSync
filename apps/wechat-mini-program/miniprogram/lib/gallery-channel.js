const { parseEncryptedQr, prologue, frame } = require('./encrypted-probe.js');
const { createGalleryPeer, createDownloadPeer, createLivePeer, sha256, sha256Original, sha256Live } = require('./noise-vendor.js');
const MAX_IMAGE = 524288, MAX_TOTAL = 16777216, MAX_ORIGINAL = 16777216, MAX_DOWNLOAD_TOTAL = 134217728;
const MAX_LIVE=100663296,MAX_LIVE_TOTAL=536870912;
function parseGalleryQr(raw) {
  let v; try { if (typeof raw !== 'string' || raw.length > 2048) throw new Error(); v = JSON.parse(raw); } catch (_) { throw new Error('本机浏览码无效。'); }
  if (!v || !['NikkiSyncLocalGalleryPreview','NikkiSyncLocalGalleryDownload','NikkiSyncLocalGalleryLive'].includes(v.type)) throw new Error('请使用本机图库浏览码。');
  const resume=v.resume;if(resume!==undefined&&resume!==1)throw new Error('本机浏览码无效。');
  const base=Object.assign({},v,{type:'NikkiSyncEncryptedTcpProbe'});delete base.resume;
  const out = parseEncryptedQr(JSON.stringify(base));
  out.type = v.type;if(resume===1)out.resume=1;return out;
}
// Bind recovery capability and phase to Noise; the original QR PSK never authorizes recovery.
function galleryPrologue(value,resuming=false){return prologue(value)+(value.resume===1?'\nNikkiSyncGallerySession-v1':'')+(resuming?'\nNikkiSyncGalleryResume-v1':'');}
function encode(value) {
  const text = JSON.stringify(value).replace(/[^\x20-\x7e]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')); if (text.length > 4096) throw new Error('Invalid control message');
  return Uint8Array.from(text.split('').map(x => x.charCodeAt(0)));
}
function decode(bytes) {
  if (!bytes.length || bytes.length > 4096 || bytes.some(x => x < 32 || x > 126)) throw new Error('Invalid control message');
  return JSON.parse(Array.from(bytes).map(x => String.fromCharCode(x)).join(''));
}
function fields(value, names) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(x => names.indexOf(x) < 0)) throw new Error('Unexpected fields'); }
function validateExportOptions(value){fields(value,['exif','rotation']);if(typeof value.exif!=='boolean'||[0,90,180,270].indexOf(value.rotation)<0)throw new Error('Export options');return value;}
function validateBrowseQuery(value){
 fields(value,['text','version','from','to','offsetMinutes']);
 if(value.text!==undefined&&(typeof value.text!=='string'||value.text.length>80||/[\u0000-\u001f\u007f]/.test(value.text)))throw new Error('Search bounds');
 if(value.version!==undefined&&(typeof value.version!=='string'||value.version!==''&&value.version!=='unknown'&&!/^\d{1,3}(\.\d{1,3}){1,2}$/.test(value.version)))throw new Error('Version bounds');
 ['from','to'].forEach(key=>{const v=value[key];if(v!==undefined&&(typeof v!=='string'||v!==''&&(!/^\d{4}-\d\d-\d\d$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)))throw new Error('Date bounds');});
 if(value.from&&value.to&&value.from>value.to)throw new Error('Date order');
 if(value.offsetMinutes!==undefined&&(!Number.isInteger(value.offsetMinutes)||value.offsetMinutes< -720||value.offsetMinutes>840))throw new Error('Timezone bounds');return value;
}
function hashHex(bytes, original, live=false) { return Array.from(live?sha256Live(bytes):original ? sha256Original(bytes) : sha256(bytes)).map(x => ('0' + x.toString(16)).slice(-2)).join(''); }
function createGalleryDecoder(onFrame, totalLimit = MAX_TOTAL) {
  if (totalLimit !== MAX_TOTAL && totalLimit !== MAX_DOWNLOAD_TOTAL && totalLimit!==MAX_LIVE_TOTAL) throw new Error('Unknown profile');
  let buffer = new Uint8Array(0), dead = false, total = 0;
  const close = () => { dead = true; buffer.fill(0); buffer = new Uint8Array(0); };
  return { close, feed(bytes) {
    if (dead) throw new Error('Closed');
    try {
      if (!(bytes instanceof Uint8Array) || (total += bytes.length) > totalLimit) throw new Error('Limit');
      // TCP callbacks are not records. Bun/WeChat may coalesce many valid records into one event.
      // Only copy the incomplete header/current frame: retained memory never exceeds 4114 bytes.
      let offset=0;
      while (!dead && offset<bytes.length) {
        const target=buffer.length<2?2:2+buffer[0]*256+buffer[1];
        if(target>4114||target===2&&buffer.length===2)throw new Error('Frame limit');
        const take=Math.min(target-buffer.length,bytes.length-offset),next=new Uint8Array(buffer.length+take);
        next.set(buffer);next.set(bytes.subarray(offset,offset+take),buffer.length);buffer.fill(0);buffer=next;offset+=take;
        if(buffer.length<2)continue;
        const length=buffer[0]*256+buffer[1];if(!length||length>4112)throw new Error('Frame limit');
        if(buffer.length===length+2){
          const value=buffer.slice(2);buffer.fill(0);buffer=new Uint8Array(0);
          try{onFrame(value);}finally{value.fill(0);}
        }
      }
    } catch (_) { close(); throw new Error('Frame rejected'); }
  } };
}
function connectGallery(wxApi, config, hooks) {
  let socket, peer, decoder, checked, key, resumeKey, timer, deadline, stopped = false, stage = 0, serial = 0, request, canDownload = false,liveProfile=false,epoch=0,quota=0,received=0,suspended=false;
  const detach = () => { ++epoch;clearTimeout(timer);timer=null;decoder?.close();peer?.close();decoder=null;peer=null;stage=0;serial=0;
    const pending=request;request=null;if(pending?.image)pending.image.fill(0);const old=socket;socket=null;try{old?.close();}catch(_){}return pending; };
  const cleanup = () => {const pending=detach();clearTimeout(deadline);key?.fill(0);resumeKey?.fill(0);resumeKey=null;key=null;checked=null;config=null;return pending;};
  const fail = () => { if (stopped) return; stopped = true;const expired=checked&&Date.now()>=Date.parse(checked.expiresAt),pending=cleanup();
    if (hooks.failed) hooks.failed(expired?'连接已过期，请在电脑生成新浏览码。':'连接已关闭，请重新生成浏览码。'); if (pending) pending.done({ status: 'failed', message: '传输中断或校验失败。' }); };
  const close = () => { if (!stopped) { stopped = true; cleanup(); } };
  const recoverable=()=>!stopped&&!!resumeKey&&Date.now()<Date.parse(checked.expiresAt)&&quota<256;
  const suspend=()=>{if(!recoverable()){close();return false;}suspended=true;const pending=detach();pending?.done({status:'failed',message:'传输已暂停，请回到前台后重试。'});return true;};
  const transportLost=()=>{if(stopped)return;if(suspended)return;if(!recoverable()){fail();return;}suspended=true;const pending=detach();hooks.disconnected?.();pending?.done({status:'failed',message:'连接暂时中断，请重试。'});};
  const send = value => { const packet = frame(peer.encrypt(encode(value))); socket.write(packet.buffer); };
  const complete = result => { const done = request.done; if (result.status !== 'ok' && request.image) request.image.fill(0); request = null; clearTimeout(timer); done(result); };
  const start = (kind, data, done, progress) => {
    if(!stopped && quota>=256){fail();throw new Error('Gallery quota exhausted');}
    if (stopped || suspended || stage !== 2 || request || typeof done !== 'function') throw new Error('Gallery unavailable');
    ++quota;request = Object.assign({ kind, req: ++serial, done, progress }, data); timer = setTimeout(fail, ['motion','live'].includes(kind)?480000:['original','export'].includes(kind) ? 120000 : 20000);
    try { send(Object.assign({ kind, req: serial }, data)); } catch (_) { fail(); }
  };
  const channel = { close, list(offset, done) { if (!Number.isInteger(offset) || offset < 0 || offset > 500) throw new Error('Offset'); start('list', { offset }, done); },
    refresh(done) { if(!canDownload) throw new Error('Refresh unavailable'); start('refresh', {}, done); },
    preview(id, done) { if (typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)) throw new Error('Photo id'); start('get', { id }, done); },
    original(id, done, progress) { if (!canDownload || typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)) throw new Error('Original unavailable'); start('original', { id }, done, progress); },
    metadata(id, done) { if (!canDownload || typeof id !== 'string' || !/^[a-f0-9]{32}$/.test(id)) throw new Error('Metadata unavailable'); start('metadata', { id }, done); } };
  channel.browse=(offset,query,done)=>{if(!canDownload||!Number.isInteger(offset)||offset<0||offset>500)throw new Error('Browse unavailable');validateBrowseQuery(query);start('browse',{offset,query},done);};
  channel.export=(id,options,done,progress)=>{if(!canDownload||typeof id!=='string'||!/^[a-f0-9]{32}$/.test(id))throw new Error('Export unavailable');validateExportOptions(options);start('export',{id,options},done,progress);};
  channel.motion=(id,done,progress)=>{if(!liveProfile||typeof id!=='string'||!/^[a-f0-9]{32}$/.test(id))throw new Error('Live unavailable');start('motion',{id},done,progress);};
  channel.live=(id,options,done,progress)=>{if(!liveProfile||typeof id!=='string'||!/^[a-f0-9]{32}$/.test(id))throw new Error('Live unavailable');validateExportOptions(options);if(options.rotation!==0)throw new Error('Live rotation unavailable');start('live',{id,options},done,progress);};
  channel.outfit=(id,offset,done)=>{if(!canDownload||typeof id!=='string'||!/^[a-f0-9]{32}$/.test(id)||!Number.isInteger(offset)||offset<0||offset>100)throw new Error('Outfit unavailable');start('outfit',{id,offset},done);};
  channel.icon=(id,key,done)=>{if(!canDownload||typeof id!=='string'||!/^[a-f0-9]{32}$/.test(id)||typeof key!=='string'||!/^[a-f0-9]{32}$/.test(key))throw new Error('Icon unavailable');start('icon',{id,key},done);};
  channel.suspend=suspend;
  channel.interrupt=()=>{const retained=suspend();if(retained)hooks.disconnected?.();return retained;};
  channel.resume=()=>{if(!recoverable()){if(!stopped)fail();return false;}if(!suspended)return false;suspended=false;dial(true);return true;};
  const ready=()=>hooks.ready?.({download:canDownload,export:canDownload,browse:canDownload,resume:!!resumeKey});
  const dial=resuming=>{
    const connection=++epoch;timer=setTimeout(transportLost,15000);
    wxApi.getRandomValues({ length: 64, fail:()=>{if(connection===epoch)transportLost();}, success: value => {
      let entropy;
      try {
        if (!(value.randomValues instanceof ArrayBuffer) || value.randomValues.byteLength !== 64) throw new Error('RNG'); entropy = new Uint8Array(value.randomValues);
        if (stopped||connection!==epoch) { entropy.fill(0); return; } if (Date.now() >= Date.parse(checked.expiresAt)) throw new Error('Expired');
        peer = (liveProfile?createLivePeer:canDownload ? createDownloadPeer : createGalleryPeer)(true, resuming?resumeKey:key, galleryPrologue(checked,resuming), entropy); entropy.fill(0);key?.fill(0);socket = wxApi.createTCPSocket();
        decoder = createGalleryDecoder(bytes => {
          if (Date.now() >= Date.parse(checked.expiresAt)) throw new Error('Expired');
          if (stage === 1) { peer.receiveHandshake(bytes); stage = 2; clearTimeout(timer);
            if(checked.resume===1)start('session',{},result=>{if(result.status==='ok')ready();});else ready();return; }
          if (stage !== 2 || !request) throw new Error('Unexpected response');
          const plain = peer.decrypt(bytes);
          try {
            if(request.kind==='session'){
              const response=decode(plain);fields(response,['kind','req','key','expiresAt']);
              if(response.kind!=='session'||response.req!==request.req||typeof response.key!=='string'||!/^[a-f0-9]{64}$/.test(response.key)||response.expiresAt!==checked.expiresAt)throw new Error('Resume credential');
              const next=Uint8Array.from(response.key.match(/../g).map(x=>parseInt(x,16)));if(resumeKey&&next.some((x,i)=>x!==resumeKey[i])){next.fill(0);throw new Error('Resume credential changed');}
              resumeKey?.fill(0);resumeKey=next;complete({status:'ok'});return;
            }
            if (request.image && request.received < request.image.length) {
              if (!plain.length || plain.length > request.image.length - request.received) throw new Error('Image chunk limit');
              request.image.set(plain, request.received); request.received += plain.length;
              if (request.progress) request.progress(request.received, request.image.length); return;
            }
            const response = decode(plain); if (response.req !== request.req) throw new Error('Wrong request');
            if (response.kind === 'error') { fields(response, ['kind','req']); complete({ status: 'failed', message: '照片已改变或不可用。' }); return; }
            if (request.kind === 'list' || request.kind === 'refresh' || request.kind==='browse') {
              const browse=request.kind==='browse';fields(response, browse?['kind','req','offset','total','items','next','versions','libraryTotal']:['kind','req','offset','total','items','next']);
              if (response.kind !== request.kind || response.offset !== (request.kind === 'refresh' ? 0 : request.offset) || !Number.isInteger(response.total) || response.total < 0 || response.total > 500
                || !Array.isArray(response.items) || response.items.length > 12 || (response.next !== null && (!Number.isInteger(response.next) || response.next <= response.offset || response.next > response.total))) throw new Error('List limit');
              if(response.items.length!==Math.min(12,Math.max(0,response.total-response.offset)) || response.next!==(response.offset+response.items.length<response.total?response.offset+response.items.length:null)) throw new Error('List shape');
              const ids = new Set();
              response.items.forEach(x => { fields(x, browse?['id','date','version','versionSource','mime','live']:['id','date','live']); if (x.live!==undefined&&typeof x.live!=='boolean'||!/^[a-f0-9]{32}$/.test(x.id) || ids.has(x.id) || typeof x.date !== 'string'
                || (x.date !== '' && (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(x.date) || !Number.isFinite(Date.parse(x.date))))) throw new Error('List item'); ids.add(x.id); });
              if(browse){
                if(!Number.isInteger(response.libraryTotal)||response.libraryTotal<response.total||response.libraryTotal>500||!Array.isArray(response.versions)||response.versions.length>32)throw new Error('Version list');
                const versionNames=new Set();let sum=0;response.versions.forEach(x=>{fields(x,['version','count','inferred']);if(typeof x.version!=='string'||x.version!==''&&!/^\d{1,3}(\.\d{1,3}){1,2}$/.test(x.version)||versionNames.has(x.version)||!Number.isInteger(x.count)||x.count<1||x.count>500||typeof x.inferred!=='boolean')throw new Error('Version entry');versionNames.add(x.version);sum+=x.count;});if(sum!==response.libraryTotal)throw new Error('Version total');
                response.items.forEach(x=>{if(typeof x.version!=='string'||x.version!==''&&!/^\d{1,3}(\.\d{1,3}){1,2}$/.test(x.version)||!['explicit','inferred','unknown'].includes(x.versionSource)||x.version===''&&x.versionSource!=='unknown'||x.version!==''&&x.versionSource==='unknown'||x.mime!==undefined&&!['image/jpeg','image/png'].includes(x.mime))throw new Error('Version item');});
              }
              complete(Object.assign({ status: 'ok' }, response));
            } else if(request.kind==='outfit'){
              fields(response,['kind','req','id','offset','total','items','next']);
              if(response.kind!=='outfit'||response.id!==request.id||response.offset!==request.offset||!Number.isInteger(response.total)||response.total<0||response.total>100||!Array.isArray(response.items)||response.items.length!==Math.min(6,Math.max(0,response.total-response.offset))||response.next!==(response.offset+response.items.length<response.total?response.offset+response.items.length:null))throw new Error('Outfit list bounds');
              const keys=new Set();response.items.forEach(item=>{fields(item,['key','name','hasIcon']);if(typeof item.key!=='string'||!/^[a-f0-9]{32}$/.test(item.key)||keys.has(item.key)||typeof item.name!=='string'||!item.name.length||item.name.length>64||/[\u0000-\u001f\u007f]/.test(item.name)||typeof item.hasIcon!=='boolean')throw new Error('Outfit item');keys.add(item.key);});
              complete(Object.assign({status:'ok'},response));
            } else if (request.kind === 'metadata') {
              fields(response,['kind','req','id','availability','rows']);
              if (response.kind !== 'metadata' || response.id !== request.id || !['available','partial','unavailable'].includes(response.availability)
                || !Array.isArray(response.rows) || response.rows.length > 16) throw new Error('Metadata bounds');
              response.rows.forEach(row => {fields(row,['label','value']);if(typeof row.label !== 'string' || !row.label.length || row.label.length>24
                || typeof row.value !== 'string' || row.value.length>160) throw new Error('Metadata row');});
              complete({status:'ok',availability:response.availability,rows:response.rows});
            } else if (!request.image) {
              const live=request.kind==='live',motion=request.kind==='motion',media=live||motion,icon=request.kind==='icon',exported=request.kind==='export',original = request.kind === 'original',full=original||exported||media;
              fields(response, icon?['kind','req','id','key','size','sha256','mime','source']:exported?['kind','req','id','size','sha256','mime','exifApplied','rotation']:['kind','req','id','size','sha256','mime']);
              if (response.kind !== (media?request.kind:icon?'icon':exported?'export':original ? 'original' : 'photo') || response.id !== request.id || !(live?response.mime==='application/x-livp':motion?response.mime==='video/mp4':icon?response.mime==='image/png':full ? ['image/jpeg','image/png'].includes(response.mime) : response.mime === 'image/jpeg') || !Number.isInteger(response.size)
                || response.size < 4 || response.size > (media?MAX_LIVE:icon?262144:full ? MAX_ORIGINAL : MAX_IMAGE) || !/^[a-f0-9]{64}$/.test(response.sha256)) throw new Error('Image header');
              if(icon){if(response.key!==request.key||!['item','category'].includes(response.source))throw new Error('Icon header');request.source=response.source;}
              if(exported){if(typeof response.exifApplied!=='boolean'||response.rotation!==request.options.rotation||response.exifApplied&&!request.options.exif||response.mime==='image/jpeg'&&response.exifApplied!==request.options.exif)throw new Error('Export header');request.exifApplied=response.exifApplied;request.rotation=response.rotation;}
              request.mime = response.mime;
              request.image = new Uint8Array(response.size); request.received = 0; request.hash = response.sha256;
            } else {
              const icon=request.kind==='icon';fields(response, icon?['kind','req','id','key']:['kind','req','id']); const image = request.image;
              const live=request.kind==='live',motion=request.kind==='motion',exported=request.kind==='export',original = request.kind === 'original',full=original||exported||live||motion;
              const signature = live?[80,75,3,4].every((x,i)=>image[i]===x):motion?image.length>=16&&[102,116,121,112].every((x,i)=>image[i+4]===x):request.mime === 'image/png' ? [137,80,78,71,13,10,26,10].every((x,i)=>image[i]===x) : image[0]===255 && image[1]===216;
              if (response.kind !== 'end' || response.id !== request.id || hashHex(image,full,live||motion) !== request.hash || !signature
                || icon&&response.key!==request.key || (!full && !icon && (image[image.length-2] !== 255 || image[image.length-1] !== 217))) throw new Error('Image integrity');
              complete({ status: 'ok', id: response.id, image, mime: request.mime, sha256: request.hash, original,...(live?{live:true}:motion?{motion:true}:icon?{icon:true,key:request.key,source:request.source}:exported?{exported:true,exifApplied:request.exifApplied,rotation:request.rotation}:{}) });
            }
          } finally { plain.fill(0); }
        }, liveProfile?MAX_LIVE_TOTAL:canDownload ? MAX_DOWNLOAD_TOTAL : MAX_TOTAL);
        socket.onConnect(() => { if (stopped||connection!==epoch) return; try { if (stage !== 0) throw new Error('Stage'); stage = 1; socket.write(frame(peer.sendHandshake()).buffer); } catch (_) { fail(); } });
        socket.onMessage(event => { if (stopped||connection!==epoch) return; try { if (!(event.message instanceof ArrayBuffer)||(received+=event.message.byteLength)>(liveProfile?MAX_LIVE_TOTAL:canDownload?MAX_DOWNLOAD_TOTAL:MAX_TOTAL)) throw new Error('Buffer'); decoder.feed(new Uint8Array(event.message)); } catch (_) { fail(); } });
        const lost=()=>{if(connection===epoch)transportLost();};socket.onError(lost);socket.onClose(lost);socket.connect({ address: checked.host, port: checked.port });
      } catch (_) { if (entropy) entropy.fill(0); if(connection===epoch)fail(); }
    } });
  };
  try {
    checked = parseGalleryQr(JSON.stringify(config));liveProfile=checked.type==='NikkiSyncLocalGalleryLive';canDownload=liveProfile||checked.type==='NikkiSyncLocalGalleryDownload';key=Uint8Array.from(checked.key.match(/../g).map(x=>parseInt(x,16)));checked.key=null;config=null;
    if(typeof wxApi.getRandomValues!=='function'||typeof wxApi.createTCPSocket!=='function')throw new Error('Missing secure API');
    deadline=setTimeout(fail,Date.parse(checked.expiresAt)-Date.now());dial(false);
  } catch (_) { fail(); }
  return channel;
}
module.exports = { parseGalleryQr, galleryPrologue, connectGallery, createGalleryDecoder, encode, decode, fields, hashHex, validateBrowseQuery,validateExportOptions, MAX_IMAGE, MAX_TOTAL, MAX_ORIGINAL, MAX_DOWNLOAD_TOTAL,MAX_LIVE,MAX_LIVE_TOTAL };
