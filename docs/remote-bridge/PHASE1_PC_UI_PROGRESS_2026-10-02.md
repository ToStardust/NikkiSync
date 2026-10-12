# Remote Bridge：PC 选片与临时二维码交付记录

日期：2026-10-02。分支：`feature/remote-bridge-foundation`。
本轮基线：`c3dc39b5a5823abe5157d8da37392339f02ea5aa`，没有从 main 重做。
功能提交：`e849d78bbeb20aeddc882dc754b2e0da9c134efe`。
草稿 PR：[ToStardust/NikkiSync #11](https://github.com/ToStardust/NikkiSync/pull/11)，目标为 `feature/outfit-inspiration`，未合并。

## 本轮完成范围

只推进 Remote Bridge 的 PC 阶段。没有修改 Android、Live/Motion Photo、NUAN5 resolver、穿搭灵感数据模型或 Windows Shell 生命周期，也没有部署公网服务或上传照片。

- Windows PC 启动组合中接入 Bridge；独立 runtime 仍需要显式启用。
- 新增“微信下载照片”入口：选片、分页加载、1–100 张上限、生成二维码、倒计时、连接状态及结束连接。
- 仅允许已入库、ready/stable 的普通 JPG/PNG，优先高清原图；Live/Motion 资源不进入本阶段。
- 二维码 v1 包含 `type`、`version`、`sessionId`、随机 `token`、`expiresAt`、局域网 HTTPS `endpoint` 和 `tlsFingerprintSha256`。二维码是临时凭据，不能写日志、上传或提交到 Git。
- 私有 IPv4 HTTPS 地址校验；拒绝公网地址、URL 凭据及额外路径/参数。
- PC 本机控制 API 使用随机页面 token、Host/Origin/Sec-Fetch-Site 检查；不修改原配对协议。
- 会话只在内存保存、10 分钟过期、选片时固定内容 SHA256；文件下载前校验大小和完整哈希，并使用同一文件句柄传输。
- 关闭或过期时中断未完成的下载；服务停止时关闭会话。用户已经完整下载的副本无法撤回。
- 修复关闭弹窗与首次状态请求竞态，避免关闭后重新启动轮询；过期二维码从界面移除。

## 验证证据

| 项目 | 实际结果 | 边界 |
| --- | --- | --- |
| Node 全量 `npm test -- --runInBand` | 87/87 PASS | 不是 Android/iPhone 验收 |
| Remote + Desktop 聚焦测试 | 10/10 PASS | 含分页、HQ 优先、路径隐藏、token、Range、HEAD、同大小替换、活动下载关闭/过期和 UI 竞态 |
| Windows Shell `dotnet test ... -c Release` | 9/9 PASS | 没有改 Shell 生命周期 |
| `npm run pc:exe` | Bun 服务 EXE + .NET/WPF 壳打包成功 | 未覆盖安装中的旧 EXE，也未称为微信可用版 |
| 真实媒体本地测试 | 从现有 SQLite **只读**选取 12 张可用照片；其中一张 6,363,595 字节原图，下载内容 SHA256 与原文件相同 | 并非对全部 12 张逐张下载验收 |
| Node / Bun / Bun 编译的独立测试 EXE | 相同真实原图通过 token、可信 TLS、完整下载、Range、HEAD、关闭及过期检查 | 两个监听器都绑定 127.0.0.1，不是跨设备网络测试 |
| PC 页面交互 | Edge 560×660 窄视口：照片可见；选择 1/2 张计数正确；二维码/倒计时显示；结束回首页；重开选择为 0 | 验证的是 PC 所使用的 HTML 页面，不是实际 WPF 窗口或微信界面 |

全量测试从 82 项基线增加到 87 项。竞态测试先 RED（关闭后 interval 数量为 1），修复后 GREEN。
活动下载测试使用本轮临时 16 MiB 合成文件，没有修改游戏照片。
打包使用本机现有 Bun 1.3.14 和 .NET；NuGet 漏洞审计因无法连接 api.nuget.org 发出 NU1900 警告，不能据此宣称依赖安全审计已通过。

## 本地交付位置

工作区：`D:\GAME\InfinityNikki Launcher\InfinityNikki\X6Game\CameraPartner\NikkiSync-RemoteBridge`。
打包目录：此工作区下的 `release\NikkiSync`。运行壳必须保留整个目录，不能只复制 152 KB 的 `NikkiSync-PC.exe`，它依赖服务、DLL 和 migrations。

本轮打包 SHA256：

```text
NikkiSync-PC.exe
E10B9FFEB978E8989FEAF3F60BF49E7E891A4879585F24038F7A48BC941E3E2C
NikkiSync-PC-service.exe
F147E4BB5C55A5FB870D2FF95FB101BECA5270FD062E83BC688E6DD5DF0CB353
```

`release/`、`out/`、截图、真实数据库和媒体均被 Git 忽略；没有上传它们。
原 `NikkiSync` 与 `NikkiSync-Outfit` 目录保持不动，已有 sample-analyzer 本地修改没有纳入本轮提交。
本轮临时 UI/下载测试监听器已停止。
最终审查另清理了前序提交在 `LocalSyncServer.ts` 和 `package.json` 的换行符差异，避免 PR 把既有业务整段显示为改写；这不是功能修改。

## 尚未完成：不要把 PC PASS 当作微信 PASS

目前不是可用的微信下载成品。尚无小程序扫码、照片浏览、保存页面及真机证据。

1. 本阶段复用 NikkiSync 既有局域网 TLS 端口，不增加公网监听、路由器转发或第三方媒体存储。
2. 现有证书由 PC 本地生成。Node 测试明确使用该证书作为 CA；二维码携带指纹不代表微信小程序可自行信任该证书。
3. 微信的局域网访问例外、iOS 权限、开发/体验/发布环境差异，以及证书/传输方案，仍需针对实际小程序版本用官方规则和设备验证。不要直接关闭 TLS 验证或用开发工具“跳过域名校验”当作生产验收。
4. 只支持同一局域网的候选地址。尚无跨网桥接、隧道或中继；“Remote Bridge”名字不代表已支持外网。
5. 正式验收必须包含：iPhone 微信扫描、选片预览、保存授权/拒绝处理、原图分辨率、关闭/过期后 410、Wi-Fi 切换/断网及重新连接。

## 接手步骤

先读 `AGENTS.md`、`docs/GPT_HANDOFF_2026-09-04.md` 和本目录的架构、计划、原交接稿及本记录。
继续此功能分支，不自动合并 main，不操作其他业务。

```powershell
npm ci --offline --ignore-scripts
npm test -- --runInBand
dotnet test apps/windows-shell.Tests/NikkiSync.WindowsShell.Tests.csproj -c Release
npm run pc:exe
node tools/remote-bridge-smoke.mjs --database 'C:\Users\Stardust\AppData\Local\NikkiSync\nikkisync.sqlite'
bun tools/remote-bridge-smoke.mjs --database 'C:\Users\Stardust\AppData\Local\NikkiSync\nikkisync.sqlite'
```

`--serve` 只用于 PC 浏览器验收，输出随机本机 HTTP 地址；用 Ctrl+C 结束。
此诊断工具的 QR 地址虽然包含探测到的局域网 IP，服务仍**只监听 loopback**，手机不能连接，不能拿它做微信真机验收。
工具不复制 UID/照片 metadata，不运行线上 resolver；其 TLS/会话/选片数据在独立内存库中。

下一阶段先落实微信网络与信任模型，再实现 Mini Program 客户端并做 iPhone E2E。若所选路线需要新的小程序账户/AppID、基础设施或媒体中继授权，必须明确获取所需信息与授权，不自行扩大范围。
