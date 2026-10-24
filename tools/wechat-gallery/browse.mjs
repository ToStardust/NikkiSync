import {inferInfinityNikkiGameVersion} from '../../apps/pc-companion/dist/src/server/GameVersionCalendar.js';
export function validateQuery(query={}){
 if(!query||typeof query!=='object'||Array.isArray(query)||Object.keys(query).some(x=>!['text','version','from','to','offsetMinutes'].includes(x)))throw new Error('Query fields');
 const out={};for(const key of ['text','version','from','to'])if(query[key]!==undefined){if(typeof query[key]!=='string')throw new Error('Query type');const value=query[key].trim();if(value)out[key]=value;}
 if(out.text&&(out.text.length>80||/[\u0000-\u001f\u007f]/.test(out.text)))throw new Error('Search bounds');
 if(out.version&&out.version!=='unknown'&&!/^\d{1,3}(\.\d{1,3}){1,2}$/.test(out.version))throw new Error('Version bounds');
 for(const key of ['from','to'])if(out[key]&&(!/^\d{4}-\d\d-\d\d$/.test(out[key])||!Number.isFinite(Date.parse(out[key]))||new Date(out[key]).toISOString().slice(0,10)!==out[key]))throw new Error('Date bounds');
 if(out.from&&out.to&&out.from>out.to)throw new Error('Date order');
 if(query.offsetMinutes!==undefined){if(!Number.isInteger(query.offsetMinutes)||query.offsetMinutes< -720||query.offsetMinutes>840)throw new Error('Timezone bounds');out.offsetMinutes=query.offsetMinutes;}
 return out;
}
export function projectPhoto(record){
 const explicit=record.metadata?.identity?.gameVersion,known=typeof explicit==='string'&&/^\d{1,3}(\.\d{1,3}){1,2}$/.test(explicit.trim())?explicit.trim():'';
 const version=known||inferInfinityNikkiGameVersion(record.date);
 return {id:record.id,date:record.date,version:version||'',versionSource:version?(known?'explicit':'inferred'):'unknown',...(record.mime?{mime:record.mime}:{}),...(record.motion?{live:true}:{})};
}
const compareVersion=(a,b)=>{if(!a)return b?1:0;if(!b)return -1;const x=a.split('.').map(Number),y=b.split('.').map(Number);for(let n=0;n<3;n++){const diff=(y[n]||0)-(x[n]||0);if(diff)return diff;}return 0;};
export function browseSnapshot(records,offset,rawQuery){
 if(!Number.isInteger(offset)||offset<0||offset>500||!Array.isArray(records)||records.length>500)throw new Error('Browse bounds');const query=validateQuery(rawQuery),text=query.text?.normalize('NFKC').toLocaleLowerCase();
 const all=records.map(record=>({record,item:projectPhoto(record)})),counts=new Map();
 for(const {item} of all){const key=item.version;const value=counts.get(key)||{version:key,count:0,inferred:false};value.count++;if(item.versionSource==='inferred')value.inferred=true;counts.set(key,value);}
 const filtered=all.filter(({record,item})=>{
  if(query.version&&(query.version==='unknown'?item.version!=='':item.version!==query.version))return false;
  const day=item.date?new Date(Date.parse(item.date)+(query.offsetMinutes||0)*60000).toISOString().slice(0,10):'';
  if((query.from||query.to)&&(!day||query.from&&day<query.from||query.to&&day>query.to))return false;
  if(text){const m=record.metadata||{};const names=(Array.isArray(m.dressing?.clothes)?m.dressing.clothes:[]).slice(0,100).map(x=>x?.name);
   const words=[item.version,day,m.filter?.name,m.lighting?.name,m.location?.name,...names].filter(x=>typeof x==='string').map(x=>x.slice(0,120));
   if(!words.some(x=>x.normalize('NFKC').toLocaleLowerCase().includes(text)))return false;}
  return true;
 }).map(x=>x.item).sort((a,b)=>compareVersion(a.version,b.version)||b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
 const items=filtered.slice(offset,offset+12),versions=Array.from(counts.values()).sort((a,b)=>compareVersion(a.version,b.version));if(versions.length>32)throw new Error('Version count limit');
 return {offset,total:filtered.length,items,next:offset+items.length<filtered.length?offset+items.length:null,versions,libraryTotal:records.length};
}
