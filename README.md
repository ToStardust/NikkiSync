# NikkiSync

面向《无限暖暖》的本地摄影同步 App monorepo。PC Companion 是远程图库的 source of truth；移动端按需缓存预览、按用户操作保存原图。媒体字节使用 HTTP(S)，WebSocket 只承载事件，断线恢复以 revision journal 为准。

## 当前里程碑

- M0.16 Sample Analyzer：可运行的 Node CLI，支持文件树、图片/JPEG tail、视频探测和合成样本测试。
- M0.17 SQLite Schema v1：Asset/Resource 双层模型、revision journal、配对与 resolver candidate 表及仓储层。
- M0.18 Protocol Contract v1：共享 TypeScript contract、协议版本、路由与 DTO。
- M0.19 AssetResolver v1：已用 418 个真实文件验证；确定识别 111 组 High/Low 与 3 组 Live cover/MP4，且没有额外 motion 误配。
- M1.0 PC Scanner Foundation：自动发现游戏目录，稳定性守卫、资源分类、Resolver v1 聚合、幂等 SQLite reconciliation、软删除与 fs.watch 去抖已接入。
- M1.1 Local Sync Server：HTTPS REST、Range 流式资源、revision changes、WebSocket、mDNS、一次性配对、Ed25519 请求签名与本地 TLS pinning 已接入。
- M2.0 Mobile Gallery MVP：Android 13+ 原生客户端已接入 mDNS 自动重发现、一次配对、PC 图库分页、实时 revision 唤醒、LIVE 标识、多选与 SHA-256 校验后的系统相册原图保存。

PC Companion 会自动从内部缓存、便携安装目录祖先或运行中的 `InfinityNikki.exe` 发现游戏位置。存在隐藏的 `X6Game/Saved/GamePlayPhotos` 时只扫描其中的原件；`ScreenShot/Video` 仅作为旧版或缺失原图库时的回退，不要求用户配置目录。

## 工程结构

```text
NikkiSync/
├─ apps/
│  ├─ pc-companion/            # Scanner + Local Sync Server + M2 开发启动入口
│  └─ mobile/                  # Android Gallery MVP（原生 Java，无云 SDK）
├─ packages/
│  ├─ core/                    # 领域类型、path_key、AssetResolver
│  ├─ database/                # SQLite migration、manager、repositories
│  └─ protocol/                # HTTP/WS/配对 contract；复用 core 类型
├─ tools/
│  └─ sample-analyzer/         # 独立 Node CLI；复用 core resolver
├─ docs/
├─ package.json
└─ tsconfig.base.json
```

交给通过本地 MCP 连接的 GPT 继续开发时，先让它阅读 [GPT_HANDOFF_2026-09-02.md](docs/GPT_HANDOFF_2026-09-02.md)。

依赖方向：

```text
core
├─ protocol
├─ database
└─ sample-analyzer

protocol + database
└─ pc-companion
```

`core` 不依赖任何内部包，禁止形成 circular dependency。Protocol v1 的现有字段名保持不变，领域类型由 protocol 重新导出，调用方无需维护第二份定义。

## 环境与验证

需要 Node.js 24+（数据库使用内置 `node:sqlite`）。

```powershell
npm install
npm run typecheck
npm test
npm run db:validate
npm run mobile:validate
```

PC ↔ Android 的 M2 开发联调可运行：

```powershell
npm run pc:serve
```

日常使用不需要运行上述命令：使用 `release/NikkiSync-PC.exe` 双击启动即可。EXE 会自动发现游戏目录、把数据库与 TLS 身份保存到 `%LOCALAPPDATA%/NikkiSync`、启动局域网同步和 mDNS，并打开本机配对页。请保留 EXE 同级的 `migrations/0001_initial.sql` 文件。

PC 会扫描当前原图库、启动本地 HTTPS 服务并打印一个 5 分钟有效且仅可使用一次的 `nikki-sync://pair?...` 配对链接。Android App 可直接粘贴该链接；正式托盘 UI 后续会把同一链接渲染为二维码。默认监听全部本地接口；若要经 USB 做不暴露局域网的真机验收，可设 `NIKKISYNC_BIND=127.0.0.1`、固定 `NIKKISYNC_PORT`，再执行 `adb reverse tcp:<port> tcp:<port>`。

Android 工程位于 `apps/mobile`，目标为 Android 13+ / compileSdk 35。项目已接入本机现有 JBR 17、Android SDK 35 和 Gradle 8.13，使用 `npm run mobile:build` 即可构建并验证 APK；完整边界见 `docs/M2_0_MOBILE_GALLERY_MVP.md`。

分析真实游戏样本：

```powershell
node .\tools\sample-analyzer\analyze.mjs `
  --root "<X6Game\Saved\GamePlayPhotos>" `
  --root "<X6Game\Video>" `
  --output ".\sample-report"
```

`ffprobe` 不存在时，CLI 仍会完成文件、哈希、图片与 JPEG tail 分析，并在报告中记录视频探测失败。

## 冻结原则

- Asset 聚合一到多个 Resource，不能退回“一文件一记录”。
- 游戏原图只读；XMP、水印、模板等必须输出派生文件。
- PC 保留 still + motion + canonical motion metadata，不生成平台专属 Live Photo。
- Metadata 同时保留 normalized 字段与 raw 字段。
- 模板只读取 `TemplatePhotoContext`。
- 核心同步完全局域网运行，不依赖云端。

当前没有复制 NikkiGallery 或 Whimbox 的实现代码，因此没有新增第三方源码许可证义务。后续若引入 MIT 代码须保留版权声明；未经兼容性确认不得复制 GPL 实现。
