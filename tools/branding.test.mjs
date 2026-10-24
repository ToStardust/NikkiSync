import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

test('packaged background service enables the runtime low-memory mode',()=>{
 const script=readFileSync(new URL('../apps/windows-shell/package.ps1',import.meta.url),'utf8');
 assert.match(script,/--compile-exec-argv[=\s]+["']?--smol/);
});
test('Windows and Android icons derive from the user-approved Momo Camera artwork',()=>{
 const root=new URL('../',import.meta.url),read=p=>readFileSync(new URL(p,root));
 assert.equal(createHash('sha256').update(read('assets/branding/momo-camera.png')).digest('hex'),'c96328abf0bd9e62eca04b5a602c096cce74fd3bbcf8e3f84e889d5a697dbd19');
 const ico=read('apps/windows-shell/Assets/app.ico');assert.equal(ico.readUInt16LE(2),1);assert.ok(ico.readUInt16LE(4)>=5);
 assert.match(read('apps/windows-shell/NikkiSync.WindowsShell.csproj').toString(),/<ApplicationIcon>Assets\\app.ico/);
 assert.match(read('apps/windows-shell/MainWindow.xaml').toString(),/Icon="Assets\/app.ico"/);
 assert.match(read('apps/windows-shell/Services/TrayService.cs').toString(),/ExtractAssociatedIcon/);
 assert.match(read('apps/mobile/app/src/main/AndroidManifest.xml').toString(),/android:icon="@mipmap\/ic_launcher"/);
 assert.match(read('apps/mobile/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml').toString(),/adaptive-icon/);
 for(const density of ['mdpi','hdpi','xhdpi','xxhdpi','xxxhdpi'])assert.equal(read('apps/mobile/app/src/main/res/mipmap-'+density+'/ic_launcher.png').readUInt32BE(12),0x49484452);
});
