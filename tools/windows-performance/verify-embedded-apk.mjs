// Verify the actual delivered single EXE without touching user profiles or starting the backend.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve, sep, relative } from 'node:path';
import { createHash } from 'node:crypto';
const root=resolve(import.meta.dirname,'../..');
const release=resolve(root,process.argv[2]??'release/NikkiSync-Portable-RotationReturn');
if(!release.startsWith(join(root,'release')+sep))throw new Error('Expected a workspace release directory');
const entries=await readdir(release);
if(entries.length!==1||entries[0]!=='NikkiSync-PC.exe')throw new Error('Expected exactly one portable EXE');
const directory=await mkdtemp(join(root,'out','embedded-apk-'));
const exe=join(release,'NikkiSync-PC.exe');
const child=spawn(exe,['--verify-package',directory],{windowsHide:true,stdio:'ignore'});
const watchdog=setTimeout(()=>child.kill(),60000);
let code;try{[code]=await once(child,'exit');}finally{clearTimeout(watchdog);}
if(code!==0)throw new Error('Embedded runtime verification failed');
const result=JSON.parse(await readFile(join(directory,'verification.json'),'utf8'));
if(!result.ok||!result.payloadEmbedded)throw new Error('Runtime payload was not embedded');
const digest=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
const apkHash=await digest(join(root,'release','NikkiSync','NikkiSync-Android.apk'));
const embeddedHash=await digest(join(result.runtimeDirectory,'runtime','NikkiSync-Android.apk'));
if(apkHash!==embeddedHash)throw new Error('EXE includes a different APK');
const report={release:relative(root,release),exeSha256:await digest(exe),apkSha256:apkHash,embeddedApkMatches:true,exactlyOneExe:true,userProfileUntouched:true};
await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({report:relative(root,join(directory,'report.json')),...report}));
