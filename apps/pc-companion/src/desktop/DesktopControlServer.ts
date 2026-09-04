import http from 'node:http'
import type { DesktopStatus } from './DesktopStatusService.js'

export interface DesktopControlServerConfig {
  getStatus(): DesktopStatus
  createPairingUri(): string
  qrSvg(uri: string): Promise<string>
}

function html(status: DesktopStatus, qrSvg?: string): string {
  const pairing = qrSvg
    ? `<section class="pairing-card"><h2>首次配对</h2><p>请使用手机 NikkiSync 扫描二维码。</p><div class="qr">${qrSvg}</div></section>`
    : '<section class="paired-card"><h2>已连接</h2><p>手机已配对。需要添加新设备时可生成新的二维码。</p></section>'
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>NikkiSync PC</title><style>
:root{color-scheme:dark}body{margin:0;background:#17131f;color:#f8f3ff;font:15px system-ui,"Microsoft YaHei",sans-serif}.app{padding:24px;min-width:440px}.header{display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #42384e;padding-bottom:18px}.header h1{font-size:24px;margin:0}.chip{background:#243f34;color:#a6f3c8;border-radius:99px;padding:7px 11px;font-size:13px}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:20px 0}.stat{background:#272033;border:1px solid #44374f;border-radius:12px;padding:13px}.stat b{display:block;font-size:20px;margin-top:5px}.pairing-card,.paired-card{background:#211b2a;border:1px solid #493b57;border-radius:16px;padding:20px;text-align:center}.pairing-card h2,.paired-card h2{margin:0 0 8px}.qr{display:flex;justify-content:center;margin-top:16px}.qr svg{width:260px;height:260px;background:#fff;border-radius:12px;padding:10px}.actions{display:flex;justify-content:center;margin:20px 0}.primary{border:0;border-radius:10px;background:#dfadff;color:#25162e;padding:11px 18px;font-weight:700;cursor:pointer}.setting{display:flex;gap:9px;align-items:center;color:#cabed6;border-top:1px solid #42384e;padding-top:16px}.modal[hidden]{display:none}.modal{position:fixed;inset:0;background:#0009;display:grid;place-items:center}.dialog{background:#282033;border:1px solid #5b456d;border-radius:16px;padding:22px;text-align:center}.dialog .qr{margin:12px 0}.secondary{border:1px solid #715885;border-radius:8px;background:transparent;color:#f5edff;padding:8px 15px;cursor:pointer}</style>
<main class="app"><header class="header"><h1>NikkiSync PC</h1><span class="chip">同步服务运行中</span></header><section class="stats"><div class="stat">局域网地址<b>${status.host}:${status.port}</b></div><div class="stat">已扫描照片<b>${status.assets}</b></div><div class="stat">已配对设备<b>${status.pairedDevices}</b></div></section>${pairing}<div class="actions"><button id="renew" class="primary">生成新二维码</button></div><label class="setting"><input id="autostart" type="checkbox">开机时自动启动 NikkiSync</label></main><div id="modal" class="modal" hidden><div class="dialog"><h2>扫描二维码</h2><div id="modal-qr" class="qr"></div><button id="close" class="secondary">关闭</button></div></div>
<script>const bridge=window.chrome?.webview;const autostart=document.querySelector('#autostart');bridge?.postMessage({type:'getAutostart'});bridge?.addEventListener('message',e=>{if(e.data?.type==='autostart')autostart.checked=!!e.data.enabled});autostart.onchange=()=>bridge?.postMessage({type:'setAutostart',enabled:autostart.checked});const modal=document.querySelector('#modal'),modalQr=document.querySelector('#modal-qr');document.querySelector('#renew').onclick=async()=>{const r=await fetch('/api/pairing',{method:'POST'});const data=await r.json();modalQr.innerHTML=data.qrSvg;modal.hidden=false};document.querySelector('#close').onclick=()=>{modal.hidden=true};</script></html>`
}

export function createDesktopControlServer(config: DesktopControlServerConfig): http.Server {
  return http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
    const status = config.getStatus()
    if (requestUrl.pathname === '/api/status' && request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify(status)); return
    }
    if (requestUrl.pathname === '/api/pairing' && request.method === 'POST') {
      const qrSvg = await config.qrSvg(config.createPairingUri())
      response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); response.end(JSON.stringify({ ...status, qrSvg })); return
    }
    if (requestUrl.pathname === '/' && request.method === 'GET') {
      const qrSvg = status.firstRun ? await config.qrSvg(config.createPairingUri()) : undefined
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); response.end(html(status, qrSvg)); return
    }
    response.writeHead(404); response.end()
  })
}
