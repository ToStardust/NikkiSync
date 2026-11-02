import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readdir,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve,join,relative,sep} from 'node:path';
const root=resolve(import.meta.dirname,'../..'),source=resolve(process.argv[2]??'');
assert.ok(process.argv[2],'Read-only source-video-directory required');
const output=await mkdtemp(join(root,'out','vivo-game-tail-')),classes=join(output,'classes'),media=join(output,'private-media');
await mkdir(classes);
function run(tool,args){
 const r=spawnSync(tool,args,{windowsHide:true,encoding:'utf8',maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe']});
 if(r.error||r.status!==0)throw new Error('Local audit tool failed: '+tool.split(/[\\/]/).pop());
 return r.stdout;
}
const pkg=join(root,'apps/mobile/app/src/main/java/app/nikkisync/mobile/media/live');
run('javac',['--release','17','-encoding','UTF-8','-d',classes,...['QuarterTurn','LivePhotoProfile','JpegSegments','MotionXmp','VivoLegacyMetadata','MotionContainer','MotionContainerVerifier'].map(x=>join(pkg,x+'.java')),join(root,'tools/livephoto/VerifyVivoGameTrailer.java')]);
const report=JSON.parse(run('java',['-cp',classes,'app.nikkisync.mobile.media.live.VerifyVivoGameTrailer',source,media]));
async function files(dir){const found=[];for(const item of await readdir(dir,{withFileTypes:true})){const p=join(dir,item.name);if(item.isDirectory())found.push(...await files(p));else if(item.name.toLowerCase().endsWith('.mp4'))found.push(p)}return found.sort()}
const sources=(await files(source)).slice(0,12);assert.equal(sources.length,report.sampleCount);
const probe=file=>JSON.parse(run('ffprobe',['-v','error','-show_streams','-show_packets','-show_data_hash','sha256','-of','json',file]));
for(let i=0;i<sources.length;i++){
 const a=probe(sources[i]),b=probe(join(media,'sample-'+i,'IMG_live.mp4'));
 assert.equal(a.streams.length,b.streams.length);assert.equal(a.packets.length,b.packets.length);
 for(let n=0;n<a.streams.length;n++)for(const key of ['codec_name','codec_type','width','height','sample_rate','channels','duration','time_base','nb_frames','extradata_hash','side_data_list'])assert.deepEqual(b.streams[n][key],a.streams[n][key],key);
 for(let n=0;n<a.packets.length;n++)for(const key of ['stream_index','pts','dts','duration','size','flags','data_hash'])assert.deepEqual(b.packets[n][key],a.packets[n][key],key);
 report.samples[i].packetCount=a.packets.length;report.samples[i].packetBytesAndTimingIdentical=true;
}
const path=join(output,'report.json');await writeFile(path,JSON.stringify(report,null,2));
console.log(JSON.stringify({report:relative(root,path),sampleCount:report.sampleCount,allPacketsAndTimingIdentical:true,allSourcesUnchanged:true,oemPlaybackTested:false}));
