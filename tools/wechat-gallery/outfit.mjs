import {createHmac} from 'node:crypto';
const clean=x=>typeof x==='string'?x.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,64):'';
export function outfitDescriptors(metadata,identityKey){
 const clothes=Array.isArray(metadata?.dressing?.clothes)?metadata.dressing.clothes:[],versionKey=typeof metadata?.raw?.dictionary?.providerVersion==='string'?metadata.raw.dictionary.providerVersion.slice(0,256):'';
 const entries=[],seen=new Set();
 for(const [index,item] of clothes.slice(0,100).entries()){
  if(!item||typeof item!=='object')continue;
  const candidates=[],add=(url,kind)=>{if(typeof url!=='string'||url.length>2048||candidates.some(x=>x.url===url))return;try{const parsed=new URL(url);if(parsed.protocol==='https:'&&!parsed.username&&!parsed.password)candidates.push({url:parsed.toString(),kind});}catch{}};
  add(item.thumbnail,'item');if(Array.isArray(item.thumbnailFallbacks))for(const fallback of item.thumbnailFallbacks.slice(0,3))add(fallback,'category');
  const proposed=clean(item.name),name=proposed&&!/^服装[\s#：:_-]*\d{6,}$/.test(proposed)?proposed:'名称待解析',key=createHmac('sha256',identityKey).update(JSON.stringify([String(item.id??index),name,candidates,versionKey])).digest('hex').slice(0,32);
  if(seen.has(key))continue;seen.add(key);entries.push({key,name,hasIcon:candidates.length>0,candidates,versionKey});
 }
 return entries;
}
