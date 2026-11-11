import test from 'node:test'
import assert from 'node:assert/strict'
import {runInNewContext} from 'node:vm'
import {webcrypto,randomUUID} from 'node:crypto'
import {readFileSync} from 'node:fs'
import path from 'node:path'
import type {AddressInfo} from 'node:net'
import {DatabaseManager} from '@nikkisync/database'
import {InspirationRepository} from '../src/inspiration/InspirationRepository.js'
import {createDesktopControlServer} from '../src/desktop/DesktopControlServer.js'
import {inspirationScript} from '../src/desktop/InspirationPanel.js'

test('desktop can paste an obfuscated code and save a reference; stale edit remains visible',async()=>{
  const db=new DatabaseManager(':memory:');db.initialize(readFileSync(path.resolve('packages/database/migrations/0001_initial.sql'),'utf8'))
  const store=new InspirationRepository(db),server=createDesktopControlServer({inspirations:store,getStatus:()=>({service:'ready',host:'127.0.0.1',port:1,assets:0,pairedDevices:0,firstRun:true}),createPairingUri:()=>'',qrSvg:async()=>''})
  try{
    await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const html=await(await fetch(base)).text(),token=/name="nikkisync-desktop-token" content="([^"]+)"/.exec(html)?.[1];assert.ok(token)
    class Element {
      value='';textContent='';hidden=false;disabled=false;className='';content='';src='';alt='';isConnected=true
      children:Element[]=[];onclick?:()=>any;onchange?:(e:any)=>any;oninput?:()=>any
      append(...x:Element[]){this.children.push(...x)}replaceChildren(){this.children=[]}scrollIntoView(){}addEventListener(){}
    }
    const elements=new Map<string,Element>(),element=(id:string)=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id)!}
    element('#inspiration-editor').hidden=true;element('meta').content=token
    const listeners=new Map<string,(event:any)=>void>()
    const document={querySelector:(s:string)=>s.startsWith('meta[')?element('meta'):element(s),createElement:()=>new Element(),addEventListener:(name:string,handler:(event:any)=>void)=>listeners.set(name,handler)}
    const clipboard={readText:async()=> '染色码：1wP🌸Xw中KyiXS4#',writeText:async(_value:string)=>{}}
    let blobCount=0
    const context={document,navigator:{clipboard},fetch:(url:string,options:RequestInit)=>fetch(base+url,options),crypto:{randomUUID,subtle:webcrypto.subtle},
      URL:{createObjectURL:()=>`blob:test-${++blobCount}`,revokeObjectURL:()=>{}},confirm:()=>true,Date,Uint8Array,Array,Error,encodeURIComponent,console}
    runInNewContext(inspirationScript+'\nglobalThis.hook={loadInspiration};',context)
    element('#inspiration-add').onclick!();await element('#inspiration-paste').onclick!()
    assert.equal(element('#inspiration-code').value,'1wPXwKyiXS4#')
    element('#inspiration-title').value='春日搭配';element('#inspiration-notes').value='配蓝色发饰';element('#inspiration-tags').value='外景、暖色'
    const image=Buffer.from([137,80,78,71,13,10,26,10,1,2,3]);const file=new File([image],'reference.png',{type:'image/png'})
    let prevented=false
    listeners.get('paste')!({clipboardData:{items:[{kind:'file',type:'image/png',getAsFile:()=>file}]},preventDefault:()=>{prevented=true}})
    assert.equal(prevented,true);assert.equal(element('#inspiration-image-list').children.length,1)
    prevented=false
    listeners.get('paste')!({clipboardData:{items:[{kind:'string',type:'text/plain'}]},preventDefault:()=>{prevented=true}})
    assert.equal(prevented,false)
    const paste=(pasted:File)=>listeners.get('paste')!({clipboardData:{items:[{kind:'file',type:pasted.type,getAsFile:()=>pasted}]},preventDefault:()=>{}})
    paste(new File([new Uint8Array(15*1024*1024+1)],'large.png',{type:'image/png'}))
    assert.match(element('#inspiration-editor-note').textContent,/15 MB/);assert.equal(element('#inspiration-image-list').children.length,1)
    element('#inspiration-images').onchange!({target:{files:[file,file,file,file],value:'x'}})
    paste(file);assert.match(element('#inspiration-editor-note').textContent,/5 张/);assert.equal(element('#inspiration-image-list').children.length,5)
    while(element('#inspiration-image-list').children.length>1)element('#inspiration-image-list').children[1]!.children[1]!.onclick!()
    await element('#inspiration-save').onclick!()
    const original=store.list('',10).items[0]!;assert.equal(original.entry.code.rawCode,'1wPXwKyiXS4#');assert.equal(original.entry.images.length,1)
    assert.equal(original.entry.images[0]!.mimeType,'image/png');assert.equal(original.entry.images[0]!.bytes,image.length)
    prevented=false
    listeners.get('paste')!({clipboardData:{items:[{kind:'file',type:'image/png',getAsFile:()=>file}]},preventDefault:()=>{prevented=true}})
    assert.equal(prevented,false)
    assert.equal(original.entry.title,'春日搭配');assert.equal(original.entry.notes,'配蓝色发饰');assert.deepEqual(original.entry.tags,['外景','暖色'])
    const card=element('#inspiration-list').children[0]!,actions=card.children[card.children.length-1]!
    actions.children[1]!.onclick!();element('#inspiration-code').value='PHONE-UNSAVED'
    store.save({...original.entry,notes:'changed elsewhere'},original.revision)
    await element('#inspiration-save').onclick!()
    assert.equal(element('#inspiration-code').value,'PHONE-UNSAVED');assert.match(element('#inspiration-editor-note').textContent,/另一端修改/)
    assert.equal(store.get(original.entry.id)?.entry.notes,'changed elsewhere')
  }finally{await new Promise<void>(r=>server.close(()=>r()));db.close()}
})
