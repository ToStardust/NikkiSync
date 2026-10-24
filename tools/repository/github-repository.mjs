// Use the existing Git credential manager in memory. Never save or print tokens.
import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const mode = process.argv[2] ?? 'view';
if (!['view', 'publish'].includes(mode)) throw new Error('Expected view or publish');
const credentials = await new Promise((done, reject) => {
  const child = execFile('git', ['credential', 'fill'], { cwd: root, timeout: 15000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' } }, (error, stdout) => {
    if (error) return reject(new Error('GitHub credential manager is unavailable; no credentials were printed.'));
    const record = Object.fromEntries(stdout.trim().split(/\r?\n/).map(line => { const at = line.indexOf('='); return [line.slice(0, at), line.slice(at + 1)]; }));
    if (!record.password || record.host !== 'github.com') return reject(new Error('No existing GitHub credential was returned.'));
    done(record);
  });
  child.stdin.end('protocol=https\nhost=github.com\n\n');
});
const url = 'https://api.github.com/repos/ToStardust/NikkiSync';
const headers = { Authorization: 'Bearer ' + credentials.password, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'NikkiSync-repository-maintenance' };
const response = await fetch(url, { method: mode === 'publish' ? 'PATCH' : 'GET', headers,
  ...(mode === 'publish' ? { body: JSON.stringify({ private: false, default_branch: 'main', description: '无限暖暖摄影同步工具：Windows 桥接、Android 相册和微信小程序；穿搭与拍摄参数分享图。', homepage: '' }) } : {}), signal: AbortSignal.timeout(20000) });
if (!response.ok) throw new Error('GitHub repository API returned HTTP ' + response.status);
const repo = await response.json();
console.log(JSON.stringify({ repository: repo.full_name, url: repo.html_url, visibility: repo.visibility, private: repo.private, defaultBranch: repo.default_branch, admin: repo.permissions?.admin }));
