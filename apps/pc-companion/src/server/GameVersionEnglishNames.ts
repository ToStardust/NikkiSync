import { AppSettingsRepository, AssetRepository, ChangeJournalRepository, type DatabaseManager } from '@nikkisync/database'
import {gameVersionEnglishName,setRemoteGameVersionNames} from '../wechat/GalleryRuntime.mjs'
import {inferInfinityNikkiGameVersion} from './GameVersionCalendar.js'

const URL='https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/?appid=3164330&count=100&maxlength=100&feeds=steam_community_announcements&format=json'
const KEY='game_version_english_names'
export function parseOfficialEnglishNames(json:string,now=Date.now()):Record<string,string>{
 const data=JSON.parse(json);if(data?.appnews?.appid!==3164330||!Array.isArray(data.appnews.newsitems))return {}
 const names:Record<string,string>={}
 for(const item of data.appnews.newsitems.slice(0,300)){
  if(item.feedname!=='steam_community_announcements'||typeof item.title!=='string'||typeof item.date!=='number'||item.date*1000>now)continue
  const match=/Version\s+(\d{1,3}\.\d{1,3})\s*["“\[]([^"”\]]{1,120})["”\]]/i.exec(item.title)
  if(match&&/^[A-Za-z0-9][A-Za-z0-9 '\-:,]{0,119}$/.test(match[2]!))names[match[1]!]=match[2]!
 }return names
}
export function restoreEnglishNames(db:DatabaseManager):void{
 try{const cache=new AppSettingsRepository(db).get<Record<string,string>>(KEY);if(cache)setRemoteGameVersionNames(cache)}catch{}
}
export async function updateEnglishNames(db:DatabaseManager,signal:AbortSignal):Promise<void>{
 const response=await fetch(URL,{signal,redirect:'error',headers:{accept:'application/json'}})
 if(!response.ok||!response.body)throw new Error('Version names unavailable')
 const reader=response.body.getReader();const parts:Uint8Array[]=[];let length=0
 try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>1024*1024)throw new Error('Version names size');parts.push(value)}}
 finally{await reader.cancel().catch(()=>{})}
 const names=parseOfficialEnglishNames(Buffer.concat(parts).toString('utf8'))
 if(signal.aborted||!Object.keys(names).length)return
 const changed=new Set(Object.keys(names).filter(v=>!gameVersionEnglishName(v)))
 const settings=new AppSettingsRepository(db);let prior:Record<string,string>={}
 try{prior=settings.get<Record<string,string>>(KEY)??{}}catch{}
 setRemoteGameVersionNames(names)
 db.transaction(()=>{
  const date=new Date().toISOString();settings.set(KEY,{...prior,...names},date)
  const journal=new ChangeJournalRepository(db)
  for(const row of new AssetRepository(db).list()){
   if(row.asset_state==='deleted')continue
   let explicit:string|undefined;try{explicit=JSON.parse(String(row.metadata_json??'{}'))?.identity?.gameVersion}catch{}
   const version=explicit||inferInfinityNikkiGameVersion(row.captured_at?String(row.captured_at):undefined)
   if(!version||!changed.has(version))continue
   const revision=journal.record('asset.updated',String(row.asset_id),{gameVersionEnglishName:true},date)
   db.connection.prepare('UPDATE assets SET revision=?,updated_at=? WHERE asset_id=?').run(revision,date,row.asset_id)
  }
 })
}
