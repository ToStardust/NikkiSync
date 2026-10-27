import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('both Windows builders explicitly support CPUs without AVX2', () => {
  for (const path of ['apps/windows-shell/package-portable.ps1', 'apps/windows-shell/package.ps1']) {
    assert.match(read(path), /--target=bun-windows-x64-baseline\b/);
  }
});

test('every allowlisted payload input exists and excludes local profiles and secrets', () => {
  const sources = [...read('apps/windows-shell/package-portable.ps1').matchAll(/'(runtime\/[^']+)'\s*=\s*'([^']+)'/g)];
  assert.ok(sources.length >= 10);
  for (const [, destination, source] of sources) {
    assert.doesNotMatch(destination, /\.env|\.sqlite|\.pem|WebView2/i);
    assert.ok(readFileSync(new URL('../' + source.replaceAll('\\', '/'), import.meta.url)).length, source);
  }
});

test('portable builder stages an allowlist, includes current APK and omits experimental media tools', () => {
  const script = read('apps/windows-shell/package-portable.ps1');
  assert.match(script, /--self-contained true/);
  assert.match(script, /PublishSingleFile=true/);
  assert.match(script, /IncludeNativeLibrariesForSelfExtract=true/);
  assert.match(script, /--compile-exec-argv="--smol"/);
  assert.match(script, /NikkiSync-Android.apk/);
  assert.doesNotMatch(script, /ffmpeg|ffprobe|Copy-Item.*-Recurse/);
  assert.match(script, /PortablePayloadDirectory/);
});

test('portable desktop uses private WebView data and extraction progress while preserving tray lifecycle', () => {
  const source = read('apps/windows-shell/MainWindow.xaml.cs');
  assert.match(source, /RuntimePayload.Prepare/);
  assert.match(source, /CoreWebView2Environment.CreateAsync\(null,.*webview2/);
  assert.match(source, /StartupProgress/);
  assert.match(source, /saveAndroidInstaller/);
  assert.match(source, /_service.StopAsync/);
  assert.match(source, /TrySuspendAsync/);
});

test('startup screen cannot be covered by a native browser before the dashboard is ready', () => {
  assert.match(read('apps/windows-shell/MainWindow.xaml'), /x:Name="ControlPage" Visibility="Collapsed"/);
  const source = read('apps/windows-shell/MainWindow.xaml.cs');
  assert.match(source, /_pageGate\.ShouldShowBrowser\(active\)/);
  assert.match(source, /await WaitForDashboardAsync/);
  assert.match(source, /StartupElapsed/);
  assert.match(source, /_startupTimer\.Stop\(\)/);
  assert.match(read('apps/windows-shell/MainWindow.xaml'), /Source="Assets\/brand.png"/);
});

test('full startup verification requires private app data and waits for actual dashboard readiness', () => {
  const app = read('apps/windows-shell/App.xaml.cs');
  assert.match(app, /--verify-startup/);
  assert.match(app, /LOCALAPPDATA/);
  assert.match(app, /localdata/);
  assert.match(app, /await verificationWindow.StartupCompleted/);
  assert.match(app, /await verificationWindow.ExitAsync/);
  assert.match(read('apps/windows-shell/MainWindow.xaml.cs'), /Path.Combine\(_verificationDirectory, "localdata", "NikkiSync", "webview2"\)/);
});
