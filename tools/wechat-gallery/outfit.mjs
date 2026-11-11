import {createHash,createHmac} from 'node:crypto';
const clean=x=>typeof x==='string'?x.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,64):'';
export function outfitDescriptors(metadata,identityKey,localClothingIcons){
 const clothes=Array.isArray(metadata?.dressing?.clothes)?metadata.dressing.clothes:[];
 const dictionaryVersion=metadata?.raw?.dictionary?.providerVersion;
 const versionKey=typeof dictionaryVersion==='string'
  ? (localClothingIcons?dictionaryVersion.replace(/:local-icons-[a-f0-9]{64}(?=:|$)/,''):dictionaryVersion).slice(0,256)
  : '';
 const entries=[],seen=new Set();
 for(const [index,item] of clothes.slice(0,100).entries()){
  const legacyId=localClothingIcons&&(typeof item==='string'||typeof item==='number')?item:undefined;
  if((!item||typeof item!=='object')&&legacyId===undefined)continue;
  const partId=item.id??legacyId;
  const exactId=typeof partId==='string'||typeof partId==='number';
  const id=String(exactId?partId:index);
  const candidates=[];
  if(!localClothingIcons){
   const add=(url,kind)=>{if(typeof url!=='string'||url.length>2048||candidates.some(x=>x.url===url))return;try{const parsed=new URL(url);if(parsed.protocol==='https:'&&!parsed.username&&!parsed.password)candidates.push({url:parsed.toString(),kind});}catch{}};
   add(item.thumbnail,'item');if(Array.isArray(item.thumbnailFallbacks))for(const fallback of item.thumbnailFallbacks.slice(0,3))add(fallback,'category');
  }
  const localDigest=exactId?localClothingIcons?.sha256For(id):undefined;
  const iconIdentity=localClothingIcons?['local-clothing-png',localDigest]:candidates;
  const proposed=clean(item.name),name=proposed&&!/^服装[\s#：:_-]*\d{6,}$/.test(proposed)?proposed:'名称待解析';
  const key=createHmac('sha256',identityKey).update(JSON.stringify([id,name,iconIdentity,versionKey])).digest('hex').slice(0,32);
  const cacheKey=createHash('sha256').update(JSON.stringify([iconIdentity,versionKey])).digest('hex');
  if(seen.has(key))continue;
  seen.add(key);
  entries.push({key,name,hasIcon:!!localDigest||candidates.length>0,candidates,versionKey,cacheKey,...(localDigest?{localClothingId:id}:{})});
 }
 return entries;
}
