// Generated executable payload: embed exact MiniProgram modules; no source tree required at runtime.
import { build } from 'esbuild';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const root=resolve(import.meta.dirname,'..');
const names=['gallery-channel','encrypted-probe','noise-vendor','synthetic-image','tcp-probe'];
const sources=Object.fromEntries(names.map(name=>[name,readFileSync(resolve(root,'apps/wechat-mini-program/miniprogram/lib/'+name+'.js'),'utf8')]));
// Compile the fixed CommonJS modules as lexical factories in the executable.
// No user content is executable code; require remains restricted to this fixed set.
const factories=names.map(name=>JSON.stringify(name)+':(module,require)=>{\n'+sources[name]+'\n}').join(',\n');
const embedded=`const factories={${factories}},cache=new Map();
export function releaseProtocolRuntime(){cache.clear();}
export function clientApi(name='encrypted-probe'){
 if(cache.has(name))return cache.get(name);if(!Object.hasOwn(factories,name))throw new Error('Unknown client module');
 const module={exports:{}};
 factories[name](module,x=>/^\\.\\/(noise-vendor|tcp-probe|synthetic-image|encrypted-probe)\\.js$/.test(x)?clientApi(x.slice(2,-3)):(()=>{throw new Error('Unknown dependency')})());
 cache.set(name,module.exports);return module.exports;}
`;
for(const target of ['src','dist/src']){
 const directory=resolve(root,'apps/pc-companion',target,'wechat');mkdirSync(directory,{recursive:true});
 await build({stdin:{contents:"export {exportJpeg,exportMetadata} from './tools/wechat-gallery/photo-export.mjs';export {exportLive} from './tools/wechat-gallery/live-export.mjs';export {rotatePng} from './tools/wechat-gallery/png-export.mjs';export {createGalleryServer} from './tools/wechat-gallery/server.mjs';export {createIndexedPreviewSource,resizePreview} from './tools/wechat-gallery/source.mjs';export {clientApi,releaseProtocolRuntime} from './tools/wechat-crypto-spike/client-api.mjs';",resolveDir:root,sourcefile:'gallery-runtime-entry.mjs'},
  bundle:true,platform:'node',format:'esm',target:'node24',outfile:resolve(directory,'GalleryRuntime.mjs'),
  packages:'external',external:['node:sqlite'],
  plugins:[{name:'embedded-client',setup(b){
    b.onLoad({filter:/wechat-crypto-spike[\\/]client-api\.mjs$/},()=>({contents:embedded,loader:'js'}));
    b.onLoad({filter:/wechat-gallery[\\/]server\.mjs$/},args=>({contents:readFileSync(args.path,'utf8').split('async function main()')[0],loader:'js',resolveDir:resolve(root,'tools/wechat-gallery')}));
  }}],
  // source.mjs main() / default resizer are not used by the EXE. Explicit resizer path supplied by service.
  logLevel:'error'});
}
