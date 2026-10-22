// Negative acceptance against the actual portable EXE. Every case must be rejected
// before opening the firewall policy. Never launch runas or a valid allow operation.
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {once} from 'node:events'
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises'
import {join,resolve,relative} from 'node:path'

const root=resolve(import.meta.dirname,'../..')
const exe=resolve(root,process.argv[2])
assert.ok(exe.startsWith(join(root,'release')+'\\'))
const parent=join(root,'out/network-authorization-1.0.14');await mkdir(parent,{recursive:true})
const output=await mkdtemp(join(parent,'helper space 中文-'))
const corrupt=join(output,'NikkiSync-PC-service.exe');await writeFile(corrupt,new Uint8Array([1,2,3]))
const cases=[
  {name:'arbitrary-program',args:['--authorize-network',join(process.env.SystemRoot,'System32/cmd.exe'),'28080','allow']},
  {name:'corrupt-backend',args:['--authorize-network',corrupt,'28080','allow']},
  {name:'unsupported-operation',args:['--authorize-network',corrupt,'28080','reset-all']},
  {name:'invalid-port',args:['--authorize-network',corrupt,'0','allow']},
  {name:'malformed-mode',args:['--authorize-network']}
]
const results=[]
for(const test of cases){
  const child=spawn(exe,test.args,{stdio:'ignore',windowsHide:true})
  const timer=setTimeout(()=>child.kill(),15000)
  try{const [code]=await once(child,'exit');assert.equal(code,3,test.name);results.push({name:test.name,code,rejected:true})}
  finally{clearTimeout(timer)}
}
const report={actualPortableExecutable:true,noElevation:true,noValidFirewallWriteInvoked:true,results}
await writeFile(join(output,'verification.json'),JSON.stringify(report,null,2))
console.log(JSON.stringify({report:relative(root,join(output,'verification.json')),...report}))
