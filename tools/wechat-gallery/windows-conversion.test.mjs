import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {PNG} from 'pngjs';
import {clientApi} from '../wechat-crypto-spike/client-api.mjs';

const previewScript=fileURLToPath(new URL('./resize-preview.ps1',import.meta.url));
const iconScript=fileURLToPath(new URL('./resize-icon.ps1',import.meta.url));
const input=Buffer.from(clientApi('synthetic-image').imageBytes());
function policy(){
 const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8; Import-Module Microsoft.PowerShell.Security -ErrorAction Stop; Get-ExecutionPolicy'],{windowsHide:true,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);return result.stdout.trim();
}
function jpegDimensions(bytes){
 assert.equal(bytes.readUInt16BE(0),0xffd8);assert.equal(bytes.readUInt16BE(bytes.length-2),0xffd9);
 for(let offset=2;offset+9<bytes.length;offset+=bytes.readUInt16BE(offset+2)+2){
  if([0xc0,0xc1,0xc2].includes(bytes[offset+1]))return [bytes.readUInt16BE(offset+7),bytes.readUInt16BE(offset+5)];
 }
 throw new Error('JPEG has no dimensions');
}
async function worker(kind){
 assert.equal(policy(),'Restricted','fixture must reproduce the Windows client script restriction');
 const original=Buffer.from(input);
 if(kind==='control'){
  const blocked=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-File',previewScript],{input,windowsHide:true});
  assert.notEqual(blocked.status,0,'control must fail before decoding any photo');
  assert.match(blocked.stderr.toString(),/PSSecurityException|UnauthorizedAccess/);
 }else if(kind==='preview'||kind==='development-preview'){
  const output=kind==='preview'
   ?await (await import('../../apps/pc-companion/dist/src/wechat/WeChatGalleryService.js')).resizeForWeChat(input,previewScript)
   :await (await import('./source.mjs')).resizePreview(input);
  assert.deepEqual(jpegDimensions(Buffer.from(output)),[96,96]);assert.ok(output.length<=524288);
 }else if(kind==='icon'){
  const output=await (await import('../../apps/pc-companion/dist/src/wechat/WeChatIconProvider.js')).resizeWeChatIcon(input,iconScript);
  const png=PNG.sync.read(Buffer.from(output));assert.equal(png.width,96);assert.equal(png.height,96);assert.ok(output.length<=262144);
 }else if(kind==='rotation'){
  const output=await (await import('./png-export.mjs')).rotatePng(input,90);
  const before=PNG.sync.read(input),after=PNG.sync.read(Buffer.from(output));
  assert.equal(after.width,before.height);assert.equal(after.height,before.width);
  for(let y=0;y<before.height;y++)for(let x=0;x<before.width;x++){
   const src=(y*before.width+x)*4,dst=(x*after.width+after.width-1-y)*4;
   assert.deepEqual(after.data.subarray(dst,dst+4),before.data.subarray(src,src+4));
  }
 }else throw new Error('Unknown conversion fixture');
 assert.deepEqual(input,original,'source image bytes must remain unchanged');
 assert.equal(process.env.PSExecutionPolicyPreference,'Restricted');
 assert.equal(policy(),'Restricted','conversion must not change its parent or persistent execution policy');
}
if(process.argv[2]==='--conversion-worker'){
 await worker(process.argv[3]);
}else{
 for(const kind of ['control','preview','development-preview','icon','rotation']){
  test(`Windows ${kind} works with an inherited Restricted policy and preserves the parent policy`,{skip:process.platform!=='win32',timeout:40000},()=>{
   const result=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--conversion-worker',kind],{
    // Match Explorer/WPF launch: do not inherit PowerShell 7's incompatible module path from the test shell.
    env:{...process.env,PSExecutionPolicyPreference:'Restricted',PSModulePath:join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','Modules')},
    windowsHide:true,encoding:'utf8',timeout:35000,maxBuffer:65536,
   });
   assert.equal(result.status,0,result.error?.message||result.stderr||result.stdout);
  });
 }
}
