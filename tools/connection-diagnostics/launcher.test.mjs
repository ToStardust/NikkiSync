import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageDir=process.env.MOMO_DIAGNOSTIC_TEST_DIR??fileURLToPath(new URL('../../release/MomoCamera-Connection-Diagnostics-20261021-Firewall-v2/',import.meta.url))
function run(launcher){
  const result=spawnSync(process.env.ComSpec??'cmd.exe',['/d','/s','/c',`""${launcher}""`],{input:'\r\n',timeout:20000,windowsHide:true,windowsVerbatimArguments:true})
  if(result.error)throw result.error
  return {status:result.status,output:result.stdout.toString('utf8')+result.stderr.toString('utf8')}
}
function fixture(){
  const parent=fileURLToPath(new URL('../../out/connection-diagnostics/',import.meta.url));mkdirSync(parent,{recursive:true})
  const dir=mkdtempSync(path.join(parent,'launcher space 中文-'))
  const launcher=path.join(dir,'Run_Connection_Diagnostics.cmd')
  writeFileSync(launcher,readFileSync(path.join(packageDir,'Run_Connection_Diagnostics.cmd')))
  return {dir,launcher}
}

test('the shipped CMD launcher actually runs the collector and reaches its persistent error/success prompt', {skip:process.platform!=='win32'}, () => {
  const {status,output}=run(path.join(packageDir,'Run_Connection_Diagnostics.cmd'))
  assert.equal(status,0,output)
  assert.match(output,/Report saved:/,'collector must actually execute through CMD, not just run directly in PowerShell')
  assert.match(output,/Press any key|按任意键/,'launcher must reach its final pause')
  assert.doesNotMatch(output,/is not recognized|不是内部或外部命令/)
})

test('missing helper in a path with spaces and Chinese shows the extraction fix and pauses', {skip:process.platform!=='win32'},()=>{
  const {launcher}=fixture();const {status,output}=run(launcher)
  assert.equal(status,1)
  assert.match(output,/Extract ALL files/)
  assert.match(output,/Press any key to close this window/)
})

test('PowerShell failure in a path with spaces and Chinese remains visible until the final prompt', {skip:process.platform!=='win32'},()=>{
  const {dir,launcher}=fixture()
  writeFileSync(path.join(dir,'Collect-ConnectionInfo.ps1'),"throw 'Controlled collector failure'\r\n",'ascii')
  const {status,output}=run(launcher)
  assert.notEqual(status,0)
  assert.match(output,/ERROR: The collector could not finish/)
  assert.match(output,/Controlled collector failure/)
  assert.match(output,/Press any key to close this window/)
})
