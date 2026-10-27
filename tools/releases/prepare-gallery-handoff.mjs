// Build a technical handoff from an explicit public-source allowlist only.
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,copyFile,stat} from 'node:fs/promises';
import {resolve,join,relative,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';

const root=resolve(import.meta.dirname,'../..');
const target=join(root,'release/NikkiGallery-Handoff-1.0.7-2026-10-19');
await mkdir(target); // Refuse overwrite of a previously prepared package.
const docs=['README.md','CHANGES.md','SYNC_COMPATIBILITY.md','SOURCE_MAP.md','ACCEPTANCE.md'];
const copies=docs.map(name=>[join('docs/handoff/nikki-gallery-2026-10-19',name),name]);
copies.push(['LICENSE','LICENSE'],
  ['packages/protocol/src/index.ts','contract/protocol.ts'],
  ['packages/core/src/types.ts','contract/core-types.ts'],
  ['packages/core/src/decoded-metadata.ts','reference/decoded-metadata.ts'],
  ['integrations/nikki-gallery/metadata-adapter.ts','reference/metadata-adapter.ts']);
const files=[];
for(const [source,destination] of copies){
  const bytes=await readFile(join(root,source));
  if(docs.includes(destination))assert.doesNotMatch(bytes.toString('utf8'),/上架|软著|备案|身份证|手机号|[A-Za-z]:[\\/]Users[\\/]/);
  await mkdir(dirname(join(target,destination)),{recursive:true});
  await copyFile(join(root,source),join(target,destination));files.push(destination);
}
await build({entryPoints:[join(root,'integrations/nikki-gallery/metadata-adapter.ts')],bundle:true,platform:'node',format:'esm',outfile:join(target,'metadata-adapter.mjs'),logLevel:'silent'});
files.push('metadata-adapter.mjs');
const adapter=await import(pathToFileURL(join(target,'metadata-adapter.mjs')).href);
const converted=adapter.toNikkiSyncMetadata({decoded:{hasParams:true,camera:{focalLength:50,brightness:0,rotation:90}},capturedAt:'2026-10-19T00:00:00Z'});
assert.equal(converted.camera.focalLength,50);assert.equal(converted.camera.brightness,0);
const manifest={version:'1.0.7',desktopBuild:2026101903,androidVersionCode:31,
  sourceTag:'v1.0.7-public-beta.1',repository:'https://github.com/ToStardust/NikkiSync',
  comparison:'Current local implementation; recipient baseline commit is unknown',
  adapterSmokeTest:'passed',files:[]};
for(const name of files.sort()){
  const bytes=await readFile(join(target,name));
  manifest.files.push({path:name.replaceAll('\\','/'),bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
await writeFile(join(target,'MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n');
await writeFile(join(target,'SHA256SUMS.txt'),manifest.files.map(f=>`${f.sha256}  ${f.path}`).join('\n')+'\n');
console.log(JSON.stringify({directory:relative(root,target),files:manifest.files.length+2,adapterSmokeTest:'passed'}));
