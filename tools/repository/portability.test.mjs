import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
test('Android build entry uses the contributor environment instead of a developer-specific JDK/SDK/cache', () => {
  const script = readFileSync(new URL('../../apps/mobile/scripts/build-android.ps1', import.meta.url), 'utf8');
  assert.doesNotMatch(script, /Stardust|5xuhj0ry160q40clulazy9h7d/);
  assert.match(script, /\$env:JAVA_HOME/);
  assert.match(script, /\$env:ANDROID_HOME|\$env:ANDROID_SDK_ROOT/);
});
test('optional MCP launcher has configurable runtime paths and defaults to its own repository', () => {
  const script = readFileSync(new URL('../../desktop-launchers/start-nikkisync-gpt-mcp.ps1', import.meta.url), 'utf8');
  assert.doesNotMatch(script, /Stardust/);
  assert.match(script, /\$PSScriptRoot/);
  assert.match(script, /\[string\]\$PythonPath/);
});
