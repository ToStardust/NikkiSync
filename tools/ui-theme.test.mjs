import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const roles = {
  background: ['background', 'app_background'], surface: ['surface', 'card_background'],
  text: ['text', 'text_primary'], secondary: ['secondary', 'text_secondary'],
  brand: ['brand', 'brand'], primary: ['primary', 'primary_action'],
  primaryForeground: ['primary-foreground', 'primary_foreground'],
  tint: ['tint', 'accent_surface'], accentInk: ['accent', 'accent'],
  border: ['border', 'ui_border'], backgroundTop: ['background-top', 'background_top'],
  backgroundMiddle: ['background-middle', 'background_middle']
};
const hex = value => value.toUpperCase();
const luminance = value => value.slice(1).match(/../g).map(x => parseInt(x, 16) / 255)
  .map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4)
  .reduce((sum, x, i) => sum + x * [.2126, .7152, .0722][i], 0);
function contrast(a, b) { const values = [luminance(a), luminance(b)].sort((x, y) => y - x); return (values[0] + .05) / (values[1] + .05); }

test('shared Nikki pink palette stays aligned across desktop, Android and mini program', async () => {
  const { colors } = JSON.parse(await read('assets/branding/ui-tokens.json'));
  const desktop = await read('apps/pc-companion/src/desktop/DesktopPage.ts');
  const mini = await read('apps/wechat-mini-program/miniprogram/app.wxss');
  const android = await read('apps/mobile/app/src/main/res/values/colors.xml');
  for (const [role, [css, resource]] of Object.entries(roles)) {
    assert.equal(hex(desktop.match(new RegExp('--' + css + ':\\s*(#[a-fA-F0-9]{6})(?:;|})'))?.[1] ?? ''), colors[role], 'desktop ' + role);
    assert.equal(hex(mini.match(new RegExp('--nikki-' + css + ':\\s*(#[a-fA-F0-9]{6})(?:;|})'))?.[1] ?? ''), colors[role], 'mini ' + role);
    // The user restored Android's original glass/ink while keeping the ambient pink palette.
    if (!['surface','text','secondary','accentInk'].includes(role))
      assert.equal(hex(android.match(new RegExp('<color name="' + resource + '">(#[a-fA-F0-9]{6})</color>'))?.[1] ?? ''), colors[role], 'Android ' + role);
  }
  assert.equal(colors.primary, '#F6BCC0', 'approved warm Nikki pink action surface');
});

test('pastel actions, selected chips and body copy retain readable foregrounds', async () => {
  const { colors: c } = JSON.parse(await read('assets/branding/ui-tokens.json'));
  for (const [foreground, background] of [
    ['primaryForeground', 'primary'], ['accentInk', 'tint'], ['text', 'surface'],
    ['secondary', 'backgroundTop'], ['secondary', 'surface']
  ]) assert.ok(contrast(c[foreground], c[background]) >= 4.5, foreground + ' on ' + background);
});

test('platform chrome and Android primary/selected drawables follow the same theme', async () => {
  const { colors } = JSON.parse(await read('assets/branding/ui-tokens.json'));
  const app = JSON.parse(await read('apps/wechat-mini-program/miniprogram/app.json'));
  assert.equal(hex(app.window.backgroundColor), colors.background);
  assert.equal(hex(app.window.navigationBarBackgroundColor), colors.backgroundTop);
  assert.match(await read('apps/windows-shell/MainWindow.xaml'), new RegExp('Background="' + colors.background + '"'));
  assert.match(await read('apps/mobile/app/src/main/res/drawable/bg_primary_action.xml'), /@color\/primary_action/);
  assert.match(await read('apps/mobile/app/src/main/res/drawable/bg_selected_glass.xml'), /#FFFFFFFF/);
  const mobile = await read('apps/mobile/app/src/main/java/app/nikkisync/mobile/MainActivity.java');
  assert.match(mobile, /bg_gallery_ambient/);
  assert.match(mobile, /PhotoLayoutDock/);
});
test('Android Live format and playback actions use shared Nikki theme resources',async()=>{
 const controls=await read('apps/mobile/app/src/main/java/app/nikkisync/mobile/media/live/LivePhotoControls.java');
 assert.match(controls,/GalleryUxStyle\.glassButton/);assert.match(controls,/R\.color\.text_primary/);assert.match(controls,/R\.color\.text_secondary/);
});
