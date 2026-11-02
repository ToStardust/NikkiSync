import test from 'node:test';import assert from 'node:assert/strict';
const load=()=>import('./browse.mjs');
const records=[{id:'a',date:'2026-09-10T01:00:00.000Z',metadata:{identity:{gameVersion:'2.9'},dressing:{clothes:[{name:'星光裙',id:'PRIVATE'}]}}},
 {id:'b',date:'2026-09-09T01:00:00.000Z',metadata:{identity:{gameVersion:'2.10'},dressing:{clothes:[{name:'花海帽'}]}}},
 {id:'c',date:'2026-08-15T01:00:00.000Z',metadata:{dressing:{clothes:[{name:'星光裙'}]}}}, {id:'d',date:'',metadata:{}}];
test('version projection respects explicit versions, uses the existing cached calendar and leaves unknowns unknown',async()=>{
 const {projectPhoto}=await load();assert.equal(projectPhoto(records[0]).version,'2.9');assert.equal(projectPhoto(records[0]).versionSource,'explicit');
 assert.equal(projectPhoto(records[2]).version,'2.8');assert.equal(projectPhoto(records[2]).versionSource,'inferred');assert.equal(projectPhoto(records[3]).version,'');
});
test('whole-snapshot clothing search/date/version filters combine, without searching internal IDs',async()=>{
 const {browseSnapshot}=await load();const found=browseSnapshot(records,0,{text:'星光裙',version:'2.9',from:'2026-09-01',to:'2026-09-30',offsetMinutes:480});
 assert.equal(found.total,1);assert.equal(found.items[0].id,'a');assert.equal(browseSnapshot(records,0,{text:'PRIVATE'}).total,0);
 assert.equal(browseSnapshot(records,0,{text:'星光裙'}).total,2);assert.equal(browseSnapshot(records,0,{version:'unknown'}).total,1);
});
test('version sorting is numeric, paging stays stable and local-day filters respect timezone boundaries',async()=>{
 const {browseSnapshot}=await load();assert.deepEqual(browseSnapshot(records,0,{}).items.map(x=>x.id),['b','a','c','d']);
 const many=Array.from({length:25},(_,n)=>({...records[0],id:String(n),date:new Date(Date.UTC(2026,8,1,n)).toISOString()}));
 const first=browseSnapshot(many,0,{}),second=browseSnapshot(many,12,{});assert.equal(first.next,12);assert.equal(second.offset,12);assert.equal(second.items.length,12);
 const edge=[{...records[0],date:'2026-09-01T17:00:00.000Z'}];assert.equal(browseSnapshot(edge,0,{from:'2026-09-02',to:'2026-09-02',offsetMinutes:480}).total,1);
});
test('bounded public query rejects invalid dates, long search, unknown fields and unreasonable timezone',async()=>{
 const {validateQuery}=await load();for(const q of [{text:'a'.repeat(81)},{from:'2026-02-30'},{from:'2026-10-01',to:'2026-09-01'},{version:'../private'},{uid:'private'},{offsetMinutes:900}])assert.throws(()=>validateQuery(q));
 assert.deepEqual(validateQuery({}),{});
});
test('malformed explicit version and unavailable metadata never crash a safe calendar fallback',async()=>{
 const {projectPhoto}=await load();assert.equal(projectPhoto({...records[0],metadata:{identity:{gameVersion:29}}}).version,'2.9');
 assert.equal(projectPhoto({...records[0],metadata:{identity:{gameVersion:'invalid'}}}).version,'2.9');
});
