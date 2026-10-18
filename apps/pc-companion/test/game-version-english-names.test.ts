import test from 'node:test'
import assert from 'node:assert/strict'
import {parseOfficialEnglishNames} from '../src/server/GameVersionEnglishNames.js'
test('English version titles require the fixed official app/feed and ASCII-safe names',()=>{
 const item={feedname:'steam_community_announcements',date:1,title:'Version 2.11 "A New Journey" Content Overview'}
 const json=(i:unknown)=>JSON.stringify({appnews:{appid:3164330,newsitems:[i]}})
 assert.deepEqual(parseOfficialEnglishNames(json(item)),{'2.11':'A New Journey'})
 assert.deepEqual(parseOfficialEnglishNames(json({...item,feedname:'other'})),{})
 assert.deepEqual(parseOfficialEnglishNames(json({...item,date:999999999999})),{})
 assert.deepEqual(parseOfficialEnglishNames(json({...item,title:'Version 2.11 "乱码"'})),{})
})
