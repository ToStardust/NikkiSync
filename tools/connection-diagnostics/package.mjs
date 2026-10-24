import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const source=path.dirname(fileURLToPath(import.meta.url))
const destination=path.resolve(source,'../../release/MomoCamera-Connection-Diagnostics-20261024-Export-v5')
mkdirSync(destination)
for(const name of ['Collect-ConnectionInfo.ps1','Run_Connection_Diagnostics.cmd','使用说明.txt']){
  const text=readFileSync(path.join(source,name),'utf8')
  if(name.endsWith('.cmd')&&/[^\x00-\x7f]/.test(text))throw new Error('CMD entrypoint must remain ASCII for all Windows code pages')
  writeFileSync(path.join(destination,name),text.replace(/\r?\n/g,'\r\n'),'utf8')
}
console.log(destination)
