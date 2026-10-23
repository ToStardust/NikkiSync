// Verify the delivered EXE/APK/feed and a synthetic empty-library boot in an
// isolated profile. Never open the user's SQLite, pairings or actual game files.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, join, sep, relative } from 'node:path';
import { createHash, verify } from 'node:crypto';
import net from 'node:net';
import { tmpdir } from 'node:os';

const root=resolve(import.meta.dirname,'../..');
const bundle=resolve(root,process.argv[2]??'release/MomoCamera-PublicBeta-1.0.1-2026-10-18');
const version=process.argv[3]??'1.0.1',build=Number(process.argv[4]??2026101801);
const expectedApkHash=process.argv[5]??'1358c8191146370e9859e7ce41e54397f7221f634d25763061036c88c1a0e2ea';
assert.match(version,/^\d+\.\d+\.\d+$/);assert.ok(Number.isSafeInteger(build));assert.match(expectedApkHash,/^[a-f0-9]{64}$/);
assert.ok(bundle.startsWith(join(root,'release')+sep));
// A full D: workspace must not prevent isolated read-only package verification.
const output=await mkdtemp(process.env.NIKKISYNC_VERIFICATION_TEMP==='1'
  ? join(tmpdir(),'MomoCamera-package-check-') : join(root,'out','public-beta-check-'));
const exe=join(bundle,`MomoCamera-PC-${version}.exe`);
const apk=join(bundle,`MomoCamera-Android-${version}.apk`);
const hash=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
async function run(args,env={}) {
  const child=spawn(exe,args,{windowsHide:true,stdio:'ignore',env:{...process.env,...env}});
  const timer=setTimeout(()=>child.kill(),200000);
  try { const [code]=await once(child,'exit');assert.equal(code,0,'Delivered EXE verification failed'); }
  finally {clearTimeout(timer);}
}
const infoFile=join(output,'release-info.json');
await run(['--release-info',infoFile]);
const info=JSON.parse(await readFile(infoFile,'utf8'));
assert.equal(info.version,version);assert.equal(info.build,build);
const feed=join(bundle,'维护者-更新发布文件');
const manifestBytes=await readFile(join(feed,'MomoCamera-Windows-update.json'));
const signature=await readFile(join(feed,'MomoCamera-Windows-update.json.sig'));
const publicKey=await readFile(join(root,'apps/windows-shell/Assets/update-public-key.pem'));
assert.ok(verify('RSA-SHA256',manifestBytes,publicKey,signature));
const manifest=JSON.parse(manifestBytes);
assert.equal(manifest.Build,info.build);assert.equal(manifest.Sha256.toLowerCase(),await hash(exe));
const extracted=join(output,'embedded');await mkdir(extracted);
await run(['--verify-package',extracted]);
const embedded=JSON.parse(await readFile(join(extracted,'verification.json'),'utf8'));
assert.ok(embedded.ok&&embedded.payloadEmbedded);
const apkHash=await hash(apk);assert.equal(apkHash,expectedApkHash);
assert.equal(await hash(join(embedded.runtimeDirectory,'runtime/NikkiSync-Android.apk')),apkHash);
for(const name of ['PRIVACY_POLICY.md','USER_AGREEMENT.md','PERMISSIONS_DATA.md','SDK_SERVICES.md'])
  assert.equal(await hash(join(embedded.runtimeDirectory,'runtime/legal',name)),await hash(join(root,'docs/store-submission',name)));

const profile=join(output,'startup'),data=join(profile,'localdata/NikkiSync');await mkdir(data,{recursive:true});
const marker=join(data,'retention-probe.txt');await writeFile(marker,'keep user data');
await writeFile(join(data,'metadata-resolver.json'),JSON.stringify({enabled:false}));
await writeFile(join(data,'metadata-dictionary-remote.json'),JSON.stringify({enabled:false,provider:{type:'nikki-albums-public'},gallery:{enabled:false}}));
const game=join(output,'synthetic-game/InfinityNikki');await mkdir(join(game,'X6Game'),{recursive:true});await writeFile(join(game,'InfinityNikki.exe'),'');
const reserve=net.createServer();await new Promise(done=>reserve.listen(0,'127.0.0.1',done));
const port=reserve.address().port;await new Promise(done=>reserve.close(done));
await run(['--verify-startup',profile,String(port)],{LOCALAPPDATA:join(profile,'localdata'),DOTNET_BUNDLE_EXTRACT_BASE_DIR:join(output,'native-cache'),NIKKISYNC_GAME_ROOT:game,NIKKISYNC_BIND:'127.0.0.1',NIKKISYNC_PORT:'0',NIKKISYNC_MDNS:'0'});
const startup=JSON.parse(await readFile(join(profile,'startup-verification.json'),'utf8'));
assert.ok(startup.ok&&startup.browserVisible&&startup.loaderHidden);
assert.equal(await readFile(marker,'utf8'),'keep user data');
const files=await readdir(bundle,{recursive:true});
assert.ok(!files.some(n=>/\.(?:jks|key|dpapi|db|sqlite|pfx)$/i.test(n)));
const report={version:info.version,build:info.build,signedManifest:true,actualSingleExe:true,embeddedApkMatches:true,runtimeDirectory:embedded.runtimeDirectory,apkSha256:apkHash,exeSha256:await hash(exe),isolatedDashboardBoot:true,syntheticLibrary:true,privateUserProfileUntouched:true,startupTimings:startup.stages,files};
await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({report:relative(root,join(output,'report.json')),...report}));
