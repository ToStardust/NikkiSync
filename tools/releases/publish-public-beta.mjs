// Run manually only after the human authorizes GitHub publication. Tokens stay in memory.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {readFile,stat,mkdir,writeFile} from 'node:fs/promises';
import {resolve,join,relative,basename} from 'node:path';
import {createHash,verify} from 'node:crypto';

const root=resolve(import.meta.dirname,'../..'),repo='ToStardust/NikkiSync';
const configArgument=process.argv.find(arg=>arg.startsWith('--config='));
const config=configArgument?JSON.parse(await readFile(resolve(root,configArgument.slice(9)),'utf8')):{};
const tag=config.tag??'v1.0.5-public-beta.2',version=config.version??'1.0.5',build=config.build??2026101805;
assert.match(version,/^\d+\.\d+\.\d+$/);assert.match(tag,/^v[\w.-]+$/);assert.ok(Number.isSafeInteger(build));
const localPath=value=>{const full=resolve(root,value);assert.ok(full.startsWith(root+'\\'),'Release input must stay inside the workspace');return full;};
const bundle=localPath(config.bundle??'release/MomoCamera-PublicBeta-1.0.5-2026-10-18-Anonymous-Beta2');
const archive=config.archive?localPath(config.archive):bundle+'.zip';
const output=localPath(config.output??'out/github-publication-1.0.5');
const git=(args,input)=>execFileSync('git',args,{cwd:root,input,encoding:'utf8',stdio:['pipe','pipe','pipe'],env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'Never'}}).trim();
const sha=async path=>{const hash=createHash('sha256');for await(const bytes of createReadStream(path))hash.update(bytes);return hash.digest('hex');};
const expected=config.expected??{
  'MomoCamera-PC-1.0.5.exe':'43c922b13ce93e7aa67b6a2362c8816cb0302ecc2e309d80b377ee9d89bf7e8e',
  'MomoCamera-Android-1.0.5.apk':'dfc634d3fe0d0d29b35eec9209977ce2453754a0c0daf6def9988f1af0b82aa3',
  'MomoCamera-PublicBeta-1.0.5-2026-10-18-Anonymous-Beta2.zip':'75614120199aaeb14260dba1b843500e87bad3e9c6668b6169ec2081fb93e721'
};
const legal=new Set(['PRIVACY_POLICY.md','USER_AGREEMENT.md','PERMISSIONS_DATA.md','SDK_SERVICES.md'].map(name=>'docs/store-submission/'+name));

async function audit(){
  const identities=JSON.parse(await readFile(join(output,'private-identity.json'),'utf8'));
  assert.ok(identities.length>0&&identities.every(value=>typeof value==='string'&&value.length>0));
  const changed=new Set([...git(['diff','--name-only','-z','HEAD']).split('\0'),...git(['ls-files','--others','--exclude-standard','-z']).split('\0')].filter(Boolean));
  const selected=[...changed].filter(path=>
    /^(apps|packages|assets|scripts|integrations|tools)\//.test(path)&&!path.startsWith('tools/store-submission/')
    ||['.gitignore','README.md','package.json','package-lock.json','.github/workflows/ci.yml'].includes(path)
    ||legal.has(path)||path.startsWith('docs/handoff/')||path.startsWith('docs/releases/')
    ||/^docs\/remote-bridge\/PUBLIC_BETA[^/]*\.txt$/.test(path)).sort();
  const findings=[];
  for(const path of selected){
    if(/\.(?:db|sqlite|jks|keystore|pfx|p12|key|env|log|exe|apk|aab|zip)$/i.test(path)||/\.(?:env|db|sqlite)[.-]/i.test(path))findings.push({path,kind:'private-or-generated-file'});
    if(path.endsWith('.pem')&&path!=='apps/windows-shell/Assets/update-public-key.pem')findings.push({path,kind:'unexpected-key-file'});
    let bytes;try{bytes=await readFile(join(root,path));}catch(error){if(error.code==='ENOENT')continue;throw error;}
    if(bytes.length>10*1024*1024)findings.push({path,kind:'oversized-source-file'});
    if(identities.some(value=>['utf8','utf16le'].some(encoding=>bytes.includes(Buffer.from(value,encoding)))))findings.push({path,kind:'private-identity'});
    if(bytes.includes(0))continue;
    const text=bytes.toString('utf8');
    if(/-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{25,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}\b/.test(text))findings.push({path,kind:'secret-pattern'});
    if(/\b\d{6}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[0-9Xx]\b/.test(text))findings.push({path,kind:'identity-number-pattern'});
    if(/\b1[3-9]\d{9}\b/.test(text))findings.push({path,kind:'phone-number-pattern'});
  }
  await mkdir(output,{recursive:true});await writeFile(join(output,'source-audit.json'),JSON.stringify({selected,excluded:[...changed].filter(p=>!selected.includes(p)),findings},null,2));
  console.log(JSON.stringify({selected: selected.length,excluded:changed.size-selected.length,findings}));
  assert.equal(findings.length,0,'Review source-audit.json; never print private matches.');return selected;
}

async function privacy(commit,reportPath){
  assert.ok(reportPath,'Pass the actual rebuilt EXE verification report as the last argument');
  const report=JSON.parse(await readFile(resolve(root,reportPath),'utf8'));
  assert.ok(report.actualSingleExe&&report.embeddedApkMatches&&report.isolatedDashboardBoot);
  assert.equal(report.version,version);assert.equal(report.build,build);
  assert.equal(report.exeSha256,expected[`MomoCamera-PC-${version}.exe`]);
  assert.equal(report.apkSha256,expected[`MomoCamera-Android-${version}.apk`]);
  assert.ok(resolve(report.runtimeDirectory).startsWith(join(root,'out')+'\\'));
  execFileSync('python',[join(root,'tools/releases/audit-private-identities.py'),
    '--identity-file',join(output,'private-identity.json'),'--revision',commit,
    '--report',join(output,'final-privacy-audit.json'),bundle,archive,report.runtimeDirectory,...(config.extraAssets??[]).map(localPath)],{cwd:root,stdio:'inherit'});
}

async function assets(){
  const feed=config.feed?localPath(config.feed):join(bundle,'维护者-更新发布文件');
  const files=[join(bundle,`MomoCamera-PC-${version}.exe`),join(bundle,`MomoCamera-Android-${version}.apk`),archive,
    join(bundle,'SHA256SUMS.txt'),join(bundle,config.readme??'README.txt'),join(bundle,config.notes??'RELEASE_NOTES.txt'),
    join(feed,'MomoCamera-Windows-update.json'),join(feed,'MomoCamera-Windows-update.json.sig'),...(config.extraAssets??[]).map(localPath)];
  const manifestBytes=await readFile(files[6]),signature=await readFile(files[7]);
  assert.ok(verify('RSA-SHA256',manifestBytes,await readFile(join(root,'apps/windows-shell/Assets/update-public-key.pem')),signature));
  const manifest=JSON.parse(manifestBytes);assert.equal(manifest.Version,version);assert.equal(manifest.Build,build);
  assert.equal(manifest.DownloadUrl,`https://github.com/${repo}/releases/download/${tag}/MomoCamera-PC-${version}.exe`);
  const records=[];
  for(const path of files){const name=basename(path),hash=await sha(path),size=(await stat(path)).size;
    assert.match(name,/^[A-Za-z0-9_.-]+$/,'Use ASCII GitHub asset names to avoid server-side renaming and collisions');
    if(expected[name])assert.equal(hash,expected[name],name+' changed since delivery verification');records.push({name,path,size,sha256:hash});}
  assert.equal(manifest.Sha256.toLowerCase(),records[0].sha256);assert.equal(manifest.Size,records[0].size);
  return records;
}

function authentication(){
  assert.equal(git(['remote','get-url','origin']),`https://github.com/${repo}.git`);
  let credential;try{credential=git(['credential','fill'],`protocol=https\nhost=github.com\npath=${repo}.git\n\n`);}catch{throw new Error('Existing GitHub credential helper could not authenticate; no credentials were printed.');}
  const token=credential.split(/\r?\n/).find(line=>line.startsWith('password='))?.slice(9);assert.ok(token,'GitHub credential unavailable');return token;
}

async function github(token,path,options={}){
  const url=new URL(path.startsWith('https:')?path:'https://api.github.com'+path);
  assert.ok(['api.github.com','uploads.github.com'].includes(url.hostname)&&url.protocol==='https:');
  const response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(600000),...options,
    headers:{'Authorization':'Bearer '+token,'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','User-Agent':'MomoCamera-Release',...options.headers}});
  if(!response.ok)throw new Error(`GitHub ${options.method??'GET'} ${url.pathname}: HTTP ${response.status}`);
  return response.status===204?null:response.json();
}

async function main(){
  const mode=process.argv[2]??'audit';
  if(mode==='audit'){await audit();console.log(JSON.stringify({assets:(await assets()).map(({path,...item})=>item)}));return;}
  if(mode==='stage'){const files=await audit();assert.ok(files.length>0);git(['add','--',...files]);console.log('Staged only audited product sources and public release documents.');return;}
  const token=authentication();
  const metadata=await github(token,'/repos/'+repo);assert.ok(metadata.permissions?.push,'GitHub repository push access is required');
  if(mode==='inspect'){console.log(JSON.stringify({repository:metadata.full_name,defaultBranch:metadata.default_branch,releases:(await github(token,`/repos/${repo}/releases?per_page=20`)).map(({tag_name,draft,prerelease})=>({tag_name,draft,prerelease}))}));return;}
  assert.equal(mode,'publish','Expected audit, stage, inspect or publish');
  const commit=process.argv[3];assert.match(commit??'',/^[a-f0-9]{40}$/);assert.equal(git(['rev-parse','HEAD']),commit);
  await privacy(commit,process.argv[4]);
  const ref=await github(token,`/repos/${repo}/git/ref/heads/main`);assert.equal(ref.object.sha,commit,'Push the audited commit before publishing');
  const tagRef=await github(token,`/repos/${repo}/git/ref/tags/${tag}`);assert.equal(tagRef.object.sha,commit);
  const localAssets=await assets(),body=await readFile(join(root,'docs/releases/'+tag+'.md'),'utf8');
  const matches=(await github(token,`/repos/${repo}/releases?per_page=100`)).filter(item=>item.tag_name===tag);
  assert.ok(matches.length<=1,'Ambiguous existing release');let release=matches[0];
  let saved;try{saved=JSON.parse(await readFile(join(output,'release-state.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(saved){
    assert.equal(saved.tag,tag);assert.equal(saved.commit,commit);assert.ok(Number.isSafeInteger(saved.releaseId));
    const recorded=await github(token,`/repos/${repo}/releases/${saved.releaseId}`);
    assert.equal(recorded.tag_name,tag,'Recorded draft tag changed; inspect instead of creating a duplicate');
    if(release)assert.equal(release.id,recorded.id,'Recorded release differs from tag lookup');
    release=recorded;
  }
  if(!release)release=await github(token,`/repos/${repo}/releases`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tag_name:tag,target_commitish:commit,name:`大喵相机助手 ${version} 公测版`,body,draft:true,prerelease:true,make_latest:'false'})});
  await mkdir(output,{recursive:true});await writeFile(join(output,'release-state.json'),JSON.stringify({releaseId:release.id,tag,commit,url:release.html_url},null,2));
  for(const item of localAssets){
    const existing=(await github(token,release.assets_url)).find(asset=>asset.name===item.name);
    if(existing){assert.equal(existing.size,item.size);assert.equal(existing.digest,'sha256:'+item.sha256,'Existing asset content differs; do not overwrite');console.log('Already verified '+item.name);continue;}
    assert.ok(release.draft,'Do not mutate an existing published release');
    const url=new URL(release.upload_url.replace(/\{.*$/,''));url.searchParams.set('name',item.name);
    console.log('Uploading '+item.name+' ('+item.size+' bytes)');
    async function* stream(){let sent=0,last=0;for await(const chunk of createReadStream(item.path)){sent+=chunk.length;const progress=Math.floor(sent/item.size*20);if(progress>last){last=progress;console.log(item.name+' '+Math.min(100,progress*5)+'%');}yield chunk;}}
    const asset=await github(token,url.href,{method:'POST',headers:{'Content-Type':'application/octet-stream','Content-Length':String(item.size)},body:stream(),duplex:'half',signal:AbortSignal.timeout(1800000)});
    assert.equal(asset.size,item.size);assert.equal(asset.digest,'sha256:'+item.sha256,'Uploaded asset digest mismatch');
  }
  const uploaded=await github(token,release.assets_url);
  for(const item of localAssets){const asset=uploaded.find(a=>a.name===item.name);assert.ok(asset);assert.equal(asset.digest,'sha256:'+item.sha256);assert.equal(asset.state,'uploaded');}
  if(release.draft)release=await github(token,`/repos/${repo}/releases/${release.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({draft:false,prerelease:true,make_latest:'false'})});
  const publicRelease=await fetch(`https://api.github.com/repos/${repo}/releases/tags/${tag}`,{headers:{'User-Agent':'MomoCamera-Release'},signal:AbortSignal.timeout(30000)});
  assert.ok(publicRelease.ok,'Public release not yet visible');const published=await publicRelease.json();assert.equal(published.draft,false);
  const report={repository:repo,tag,commit,url:published.html_url,prerelease:published.prerelease,assets:published.assets.map(({name,size,digest,browser_download_url})=>({name,size,digest,url:browser_download_url}))};
  await writeFile(join(output,'published.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
