# M3 update — vendor Live Photo adapters

- Xiaomi/HyperOS Motion Photo export is now device-verified as recognized and playable after adding real cover-frame timestamp matching plus compatible MotionPhoto/MicroVideo metadata.
- M3 is now explicitly a vendor-adapter layer, not one universal Android container.
- vivo/iQOO OriginOS adapter has been implemented as a same-stem JPG+MP4 pair with vivo private metadata and `vivoMediaExtInfo`; real vivo/iQOO device verification is still pending.
- See `docs/M3_VENDOR_LIVEPHOTO_ADAPTERS.md` before modifying Motion/Live Photo export.

# M4 update — local metadata read/write

- M4.0 local metadata read/write is implemented and validated.
- PC scanner now extracts the current Infinity Nikki HighQuality JPEG native parameter token from the final JPEG tail: **44-char Base64 / 32 decoded bytes**.
- Real-library validation: **175 active assets**, **175 canonical metadata records**, **127 assets with a native token**.
- Android detail UI reads canonical metadata and exposes an initial camera-parameter editor for focal length, exposure, brightness, contrast, saturation, vibrance, highlights, and shadows.
- Edits use signed `PATCH /v1/assets/:assetId/metadata`, allocate normal revisions, and never modify the game source files.
- Scanner reconciliation merges scanner-owned metadata instead of overwriting user edits.
- Full Infinity Nikki native parameter decoding is still unresolved. Inspected HighQuality JPEG APP metadata contains no full EXIF/XMP parameter payload; the 32-byte token remains opaque until a verified local decoder is found.
- M4.1 boundary correction: parseable HighQuality JPEGs contain a large printable Base64 parameter payload **between the last two trailing `FFD9` markers**, followed by the existing 44-char/32-byte token. Real scan: 127/127 token-bearing assets also contain this payload (median ~48 KB). PC SQLite stores both; LAN API redacts `raw.nativeParamPayload`.
- Resolver input/cache now includes UID + full payload + token + payload MD5 and is provider-version/input-fingerprint aware, so resolver/dictionary updates can re-enrich cached photos without an Android app update.
- M4.1 provider-neutral automatic resolution is now implemented in the PC runtime. Assets with UID + native token are queued, successful resolver results are cached into `InfinityPhotoMetadata`, failures use retry backoff, and every successful enrichment participates in the existing revision/WebSocket pipeline.
- A generic remote JSON resolver transport exists but is disabled by default. The separately implemented `Nuan5CompatibleResolver` has a source-verified endpoint and request/response contract, remains explicit opt-in, and still requires user authorization for its one-photo public-endpoint E2E; see `docs/M4_1_NUAN5_PROTOCOL_EVIDENCE.md`.
- Payload-size correction: **do not classify 24/64-char envelopes as legacy solely by length**. Binary inspection shows all inspected large envelopes are 16-byte-block aligned after Base64 decode, and the short forms decode to complete 16/48-byte blocks as well. Many photos share repeated 16-byte blocks at fixed offsets. Every scanner-verified Base64 envelope is now passed losslessly as `base64-envelope`, with ASCII-MD5 and decoded byte length; do not claim a specific cipher/mode without stronger evidence.
- Resolver endpoint/provider version can be hot-migrated outside the binary with `%LOCALAPPDATA%\NikkiSync\metadata-resolver.json` (read on PC startup). This supports future service changes without APK/EXE code changes. Current automated suite: **37/37**.
- See `docs/M4_METADATA_READ_WRITE.md` before changing metadata behavior.

# NikkiSync — GPT 本地工作区交接

## MCP workspace

GPT 应通过 `coding-tools-mcp` 访问且仅修改此目录：

```text
D:\GAME\InfinityNikki Launcher\InfinityNikki\X6Game\CameraPartner\NikkiSync
```

桌面入口为 `C:\Users\Stardust\Desktop\start-nikkisync-gpt-mcp.cmd`。它固定使用 `127.0.0.1:8767`、OAuth 和 `safe` 权限模式；端口不会与 PhotoLayout（8765）或 Neon Road（8766）冲突。启动后用户会从两个可见窗口取得当次 OAuth 密码和 Cloudflare 临时 URL。密码、URL、Cookie、Token 都不能写进代码、文档或对话记录。

桌面的 `NikkiSync PC` 文件夹是已构建的交付物，不是 GPT 的编辑目标。GPT 应修改本工作区源码并重新产出 `release/` 内容。

## 当前可交付状态

### M4.1 NUAN5-compatible resolver（2026-09-03）

- 继续 M4 前先读 `docs/M4_1_NUAN5_PROTOCOL_EVIDENCE.md`。
- Scanner 现会本地派生 `raw.nativeParamNuan5Md5`；该字段是请求所需输入，且不会下发到 LAN API。
- `Nuan5CompatibleResolver` 已通过显式配置接入，默认禁用，未启用批量。
- 已获用户明确授权并完成 1 张真实照片 E2E，成功得到并映射相机、画面调整、游戏时间/坐标和穿搭 ID；详见 `docs/M4_1_NUAN5_PROTOCOL_EVIDENCE.md`。不得将此结果扩大为批量授权、默认开启或第三方 endpoint 授权。

### M4.2 metadata dictionary（2026-09-03）

- 已新增 provider-neutral、版本化的 PC 端参数字典层；设计见 `docs/superpowers/specs/2026-09-03-m4-2-metadata-dictionary-design.md`。
- 字典可把 `clothing/filter/lighting/pose/location` ID 富化成名称及可选分类、稀有度、thumbnail reference；未知 ID 不丢，已有 canonical/user 名称优先。
- 字典快照存 SQLite，`%LOCALAPPDATA%\\NikkiSync\\metadata-dictionary.json` 可在 PC 启动时作为可选本地 manifest 载入；无效/缺失不会阻塞启动。
- 字典 provider/version 变化可对已解析照片执行纯本地 re-enrich；不会调用 NUAN5，不构成批量解析授权。
- Resolver 新返回的 ID 会在落库前使用当前本地字典富化。
- M4.2.1 已完成 provider-neutral 远程 JSON 字典更新器：仅当 `%LOCALAPPDATA%\NikkiSync\metadata-dictionary-remote.json` 中明确 `enabled: true` 且 endpoint 为 HTTPS 时才启用。启动时执行一次、默认每 6 小时运行一次，使用 `Accept-Language`、ETag/`If-None-Match` 和 Last-Modified/`If-Modified-Since` 条件 GET；请求体为空，不含 UID、照片参数、token、MD5 或媒体字节。
- M4.2.1 的所有远程 provider 测试都只命中本机 `127.0.0.1` fixture；本仓库没有配置、没有访问任何真实字典 URL。`304` 零写入，失败保留旧 SQLite 快照。字典版本更新时，只有仍等于上一版字典值的字段会自动升级；用户自行改过的名称/分类/稀有度/thumbnail 保持不变。
- M4.2.2 clothing ID alignment 已于 2026-09-03 用同一张已验证照片再次做 **1 次**用户明确授权的 NUAN5 请求完成证据闭环；详见 `docs/M4_2_2_CLOTHING_ID_ALIGNMENT_EVIDENCE.md`。真实返回的 14 个 `clothes[]` 为 `1020100111`、`1020600111`、`1020710111`、`1020730111`、`1020740111`、`1020750111`、`1020810145`、`1020820183`、`1020830126`、`1020840126`、`1020850162`、`1020900111`、`1020970111`、`1023860042`，确认与此前独立观察到的游戏客户端/资产 10 位 entity-ID 空间一致，不需要额外 NUAN5-specific clothing ID translation layer。此次请求仍不构成批量/后台/默认 provider 授权。
- 下一步是 M4.2.2B：从本地 Infinity Nikki 客户端的数据表/字符串表/本地化资源中直接对齐这些 10 位 ID 到名称、slot/category、rarity 与 icon/thumbnail reference。`71/73/81-85/97/386` 的具体语义尚未获本地表证据，不要猜。缩略图 PC 代理/缓存也尚未实现。
- M4.2.2B 初步本机调查已记录在 `docs/M4_2_2B_LOCAL_DICTIONARY_EXTRACTION.md`：当前客户端 `X6Game/Content/Paks` 为 `2816` 代 IoStore/pak，明确存在 `Default_Loc`、`Default_L10N`、`Default_Misc_json`、`Default_Lua` 等候选分包。对真实 clothing IDs 做 ASCII/u32 原始字节扫描未找到可信表记录，`Default_Movie` 中单个 u32 命中已通过高熵上下文判为随机碰撞，因此不要采用 naive grep 路线。下一步必须做 archive-aware extraction。
- 当前公开 CUE4Parse 已有 `GAME_InfinityNikki` 专用 pak 处理，UEExtractor 也明确支持 Infinity Nikki 并可抽取 DataTable/StringTable/locres；推荐先做 standalone CUE4Parse-compatible read-only inventory/target-ID probe，再决定是否把 extractor 打包进 NikkiSync。桌面壳已于 2026-09-04 安装 .NET SDK 8.0.424；不要因此给 Android 或摄影同步服务强加 .NET SDK 依赖。

### M4.3 Windows desktop shell（2026-09-04）

- PC 发布包已拆分为 `release\NikkiSync\NikkiSync-PC.exe`（WPF/WebView2 桌面窗口）与 `NikkiSync-PC-service.exe`（Bun 扫描、SQLite、LAN sync、本机控制页服务）。桌面壳不再打开默认浏览器。
- 本机控制页仅监听 `127.0.0.1`；首次没有有效配对设备时才自动渲染二维码。已有设备时显示服务状态、局域网地址、扫描照片数、已配对设备数和 `生成新二维码` 按钮。二维码刷新不撤销已有设备。
- 窗口关闭隐藏到托盘；托盘菜单为“显示 NikkiSync”和“退出 NikkiSync”。开机自启开关经 WebView2 的同源 bridge 操作仅当前用户 `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` 的 `NikkiSync PC` 项，不需要管理员权限，也不经 LAN 暴露。
- 验证结果：`npm test` 56/56 PASS；`dotnet test apps/windows-shell.Tests/NikkiSync.WindowsShell.Tests.csproj --no-restore` 5/5 PASS；`npm run pc:exe` 和 `apps/windows-shell/package.ps1 -VerifyOnly` PASS。
- 尚未启动新成品 exe 做手工验收，避免在未重新确认的情况下触发用户已有的远程字典 opt-in 配置。后续人工验收：启动 `NikkiSync-PC.exe`、首次扫码、重启确认不自动显示二维码、手动生成新二维码、切换开机自启、关闭到托盘、从托盘退出并确认 service 进程结束。
- 2026-09-04 startup repair：受限运行环境下 `%LOCALAPPDATA%\NikkiSync` 可能对 Bun service 只读并触发 `SQLITE_READONLY`。服务现会优先使用原 AppData，探测不可写时自动回退至发布包同目录 `data\`；测试已覆盖。真实冷扫描也可能超过 10 秒，WPF 壳启动等待已提高到 2 分钟。修复后受限环境的实际 `http://127.0.0.1:28950/api/status` 返回 `ready`、175 assets；回归为 `npm test` 57/57 PASS 与 WPF 5/5 PASS。

- M0.16–M1.1：真实《无限暖暖》素材扫描、AssetResolver、SQLite、HTTPS REST、mDNS、一次配对、Ed25519 请求签名与 TLS pinning 已完成。
- M2.0：原生 Android 13+ 图库、分页、实时 WebSocket、多选、SHA-256 校验后保存原图到 `Pictures/NikkiSync` 已完成。
- Android APK 已使用本机 JBR 17 / Android SDK 35 / Gradle 8.13 构建、签名验证、安装到 Android 15 真机；USB 回环链路已验证 174 张图库加载与 1 张原图实际写入 MediaStore。
- PC EXE：`release/NikkiSync-PC.exe` 已通过回环启动验收。它包含 Bun 运行时，不依赖用户安装 Node/npm；同级 `migrations/0001_initial.sql` 必须随 EXE 保留。数据库与 TLS 身份存入 `%LOCALAPPDATA%/NikkiSync`。

## 尚未完成的验收

真实 Wi-Fi/mDNS 联调尚未完成：需让手机和 PC 位于同一普通 Wi-Fi，允许 Windows 防火墙的“专用网络”，启动 EXE，然后完成配对、App 重启重连、游戏新拍素材出现、原图保存与 PC 服务重启后的恢复连接。不要把 USB `adb reverse` 的结果误写成 Wi-Fi/mDNS 验收通过。

M3 Android Motion/Live Photo 已进入厂商适配阶段；Xiaomi/HyperOS 已在用户设备上验证可识别和播放，其他厂商 adapter 见 `docs/M3_VENDOR_LIVEPHOTO_ADAPTERS.md`。当前按用户要求暂缓继续扩厂商覆盖，优先推进 M4 参数读取/读写与原生解码。

## 修改与验证约定

在改动前先读取相关源文件，并说明计划修改的文件。完成后按影响范围运行：

```powershell
npm test
npm run mobile:validate
npm run mobile:build
npm run pc:exe
```

Android 真机安装仅在用户授权且 USB 调试设备已连接时执行：

```powershell
npm run mobile:install
```

EXE 打包入口是 `apps/pc-companion/src/windows-app.ts`；开发服务入口是 `apps/pc-companion/src/dev-server.ts`；Android 应用在 `apps/mobile`。游戏目录发现已由 PC Scanner 自动完成，任何 UI 或配置都不应要求用户填写游戏安装路径。

## 关键限制

- 保持本地优先：不上传游戏素材，不引入云存储或云账号依赖。
- 保持 OAuth MCP 的 workspace 精确指向本项目，不扩大至用户目录、桌面或磁盘根目录。
- 默认服务会监听局域网供手机使用；调试时可用 `NIKKISYNC_BIND=127.0.0.1` 与 `adb reverse` 做不暴露局域网的回环验证。
- 不删除或覆盖用户已有照片、数据库或桌面部署物；若需要迁移 `%LOCALAPPDATA%/NikkiSync` 数据，先说明并取得确认。
