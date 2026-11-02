// Offline visual check of the same Canvas renderer; synthetic background, no user photo input.
// Pass the bundled Node module directory as argv[2]. This is not a WeChat device acceptance test.
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdir,unlink} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {resolve,join} from 'node:path';
const require=createRequire(import.meta.url),{createCanvas,Image,GlobalFonts}=require(resolve(process.argv[2],'@napi-rs/canvas'));
if(process.platform==='win32')GlobalFonts.registerFromPath('C:/Windows/Fonts/msyh.ttc','sans-serif');
const out=resolve('out/share-card-visual');await mkdir(out,{recursive:true});
const background=createCanvas(720,1000),c=background.getContext('2d');
const gradient=c.createLinearGradient(0,0,720,1000);gradient.addColorStop(0,'#CA9DAC');gradient.addColorStop(.55,'#EFBCB0');gradient.addColorStop(1,'#FFF1CB');c.fillStyle=gradient;c.fillRect(0,0,720,1000);
for(const [y,color] of [[540,'#C8B3C0'],[680,'#B7A7BD'],[820,'#A2A6AF']]){c.beginPath();c.moveTo(0,y);c.bezierCurveTo(190,y-190,440,y+210,720,y-110);c.lineTo(720,1000);c.lineTo(0,1000);c.closePath();c.fillStyle=color;c.fill();}
const source=join(out,'synthetic-background.png');await writeFile(source,background.toBuffer('image/png'));
const m={exports:{}};runInNewContext(await readFile(new URL('../../apps/wechat-mini-program/miniprogram/lib/share-card.js',import.meta.url),'utf8'),{module:m,Uint8Array,Date,Promise,setTimeout,clearTimeout});
const canvas=createCanvas(1080,1440);canvas.createImage=()=>new Image();let index=0;
const wx={env:{USER_DATA_PATH:out},getFileSystemManager:()=>({writeFile:o=>writeFile(o.filePath,Buffer.from(o.data)).then(()=>o.success(),()=>o.fail()),unlink:o=>unlink(o.filePath).catch(()=>{})}),createOffscreenCanvas:o=>createCanvas(o.width,o.height),canvasToTempFilePath:o=>{const path=join(out,'share-card-'+(++index)+'.png');writeFile(path,o.canvas.toBuffer('image/png')).then(()=>o.success({tempFilePath:path}),()=>o.fail());}};
const names=['风中奇遇 · 发型','晨曦诗篇 · 连衣裙','玫瑰的回信 · 外套','月光碎片 · 耳饰','温柔的星愿 · 颈饰','晴日漫游 · 鞋子','花间薄雾 · 袜子','微风来信 · 手套','星光织梦 · 发饰','落日拥抱 · 腕饰','暮色花园 · 戒指','云端散步 · 手持物','春日手记 · 背饰'];
const iconBytes=names.map((_,n)=>{
 const tile=createCanvas(192,192),p=tile.getContext('2d');p.fillStyle=['#DCAAC0','#DFC59A','#ADBACB','#C0B0CC'][n%4];p.strokeStyle='#FFEEDD';p.lineWidth=4;
 if(n%4===0){p.beginPath();p.moveTo(70,30);p.lineTo(122,30);p.lineTo(128,69);p.lineTo(158,157);p.quadraticCurveTo(96,181,34,157);p.lineTo(64,69);p.closePath();p.fill();p.stroke();p.beginPath();p.moveTo(57,111);p.lineTo(139,111);p.stroke();}
 else if(n%4===1){p.beginPath();p.arc(96,84,46,0,Math.PI*2);p.stroke();p.fillStyle='#E9C9AE';p.beginPath();p.moveTo(96,124);p.lineTo(113,143);p.lineTo(96,164);p.lineTo(79,143);p.closePath();p.fill();p.stroke();}
 else if(n%4===2){p.beginPath();p.moveTo(58,41);p.lineTo(130,41);p.lineTo(128,113);p.lineTo(160,146);p.quadraticCurveTo(166,165,136,168);p.lineTo(44,168);p.lineTo(44,139);p.lineTo(66,124);p.closePath();p.fill();p.stroke();}
 else{p.beginPath();p.moveTo(48,58);p.quadraticCurveTo(96,13,144,58);p.lineTo(151,144);p.quadraticCurveTo(96,92,41,144);p.closePath();p.fill();p.stroke();}
 return tile.toBuffer('image/png');
});
const channel={metadata:(_,done)=>done({status:'ok',rows:[{label:'游戏版本',value:'示例'},{label:'焦距',value:'29.4'},{label:'光圈',value:'1.2'},{label:'晕影',value:'0'},{label:'柔光',value:'95.8'},{label:'柔光范围',value:'1.0'},{label:'亮度',value:'55.8'},{label:'曝光',value:'0.16'},{label:'对比度',value:'33.7'},{label:'饱和度',value:'-0.55'},{label:'自然饱和',value:'1.0'},{label:'高光',value:'0.4'},{label:'阴影',value:'1.0'},{label:'光照',value:'午后暖光（示例）'},{label:'滤镜',value:'粉色晴天（示例）'}]}),
 outfit:(_,offset,done)=>done({status:'ok',offset,total:names.length,items:names.slice(offset,offset+6).map((name,n)=>({name:offset+n<3?'名称待解析':name,key:(offset+n).toString(16).padStart(32,'0'),hasIcon:true})),next:offset+6<names.length?offset+6:null}),
 icon:(_,key,done)=>done({status:'ok',icon:true,image:Uint8Array.from(iconBytes[Number.parseInt(key,16)]),mime:'image/png',source:'item'})};
const job=m.exports.createShareCardJob(wx,{channel,id:'a'.repeat(32),date:'2026-10-06 · 合成示例',canvas,originalPath:source});
const result=await job.result;console.log(JSON.stringify({paths:result.paths,pages:result.paths.length,syntheticOnly:true}));
