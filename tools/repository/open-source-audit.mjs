// Read-only pre-publication inventory and credential check. Never print matches.
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
const cwd = resolve(import.meta.dirname, '../..');
const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const files = [...new Set(git('ls-files', '--cached', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean))];
const rules = [
  ['github-token', /\b(?:github_pat_[A-Za-z0-9_]{40,}|gh[pousr]_[A-Za-z0-9]{36,})\b/],
  ['aws-access-key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['private-key-body', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\r\n]+[A-Za-z0-9+/=\r\n]{80,}-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['authenticated-url', /https?:\/\/[^\s<>"':/@]+:[^\s<>"'@]{12,}@/]
];
const forbidden = /(?:^|\/)(?:node_modules|release|out|build|\.gradle|\.codex|\.agents|\.aws)(?:\/|$)|(?:^|\/)\.env(?:\.|$)|\.(?:pem|key|pfx|p12|jks|keystore|sqlite|db|apk|exe|zip|log)$/i;
const findings = [], sizes = [];
function inspect(text, identity) { for (const [rule, pattern] of rules) if (pattern.test(text)) findings.push({ identity, rule }); }
for (const file of files) {
  if (forbidden.test(file)) findings.push({ identity: file, rule: 'excluded-file' });
  const info = statSync(resolve(cwd, file));
  if (info.size > 5 * 1024 * 1024) sizes.push({ file, bytes: info.size });
  if (info.size < 5 * 1024 * 1024) inspect(readFileSync(resolve(cwd, file)).toString('utf8'), file);
}
// Public visibility exposes existing branches/history too. Scan distinct blobs,
// not just the working directory. Authentication material is never echoed.
const objects = git('rev-list', '--objects', '--all').split('\n').filter(Boolean).map(line => line.split(' ')[0]);
const inventory = execFileSync('git', ['cat-file', '--batch-check=%(objectname) %(objecttype) %(objectsize)'], {
  cwd, input: objects.join('\n') + '\n', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024
}).split('\n').filter(Boolean);
let blobs = 0;
for (const line of inventory) {
  const [id, type, size] = line.split(' ');
  if (type !== 'blob') continue;
  blobs++;
  if (Number(size) < 5 * 1024 * 1024) inspect(git('cat-file', 'blob', id), 'history:' + id);
}
console.log(JSON.stringify({ files: files.length, historyBlobs: blobs, largeFiles: sizes, findings }, null, 2));
if (findings.length || sizes.length) process.exitCode = 1;
