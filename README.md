# 大喵相机助手 · NikkiSync

《无限暖暖》的非官方摄影同步工具，包含 Windows 桥接与托盘程序、Android 相册和微信小程序。支持浏览游戏照片、读取穿搭和拍摄参数、生成分享图、下载原图/视频；Android 提供旋转、预览手势、持久缓存及能力范围内的 LIVE 保存。

**给对接开发者：先阅读 [开发与接口入口](docs/INTEGRATION.md)。** 原创源码使用 [MIT](LICENSE)；游戏美术和第三方资源不在本项目 MIT 授权范围内，参见 [第三方说明](THIRD_PARTY_NOTICES.md)。

当前 Windows 优先自动查找安装位置，无需先开游戏；手动选择仅为备选。Android 保留液态玻璃 UI、旋转与预测性返回、穿搭/参数分享图。小程序支持普通照片/视频和分享图；iPhone 小程序原生 LIVE 保存仍搁置。

照片同步在本机/局域网完成。在线参数解析默认开启，可在同步设置关闭，此前手动关闭的选择会保留；开启时会向第三方发送游戏UID、编码参数及校验值。公共字典与游戏版本检查也可能访问公开服务，可按 [离线配置](docs/INTEGRATION.md#在线元数据及离线模式) 配置。源码不含个人照片、数据库、配对密钥、私有签名密钥和编译包。

**下载 [1.0.5 公测版](https://github.com/ToStardust/NikkiSync/releases/tag/v1.0.5-public-beta.2)**：提供 Windows EXE、独立 Android APK 和统一 ZIP；EXE 内置同一份匿名签名 APK。新增 LIVE 自动静音动态预览、电脑一键更新、侧栏关于、离线已保存预览，以及原图/组件/EXIF与关联修图改进。[本版说明](docs/releases/v1.0.5-public-beta.2.md)

本次公测 APK 改用匿名签名证书，无法直接覆盖此前使用旧签名的安装版本。请保留旧 App 和数据，不要为解决签名冲突直接卸载或清除数据；需要迁移的用户请先通过项目仓库反馈。此后公测版将沿用这份新签名。Windows 更新方式不变，保留已有数据。动态播放与系统相册 LIVE 识别仍需按机型测试。历史 [0.2.14](https://github.com/ToStardust/NikkiSync/releases/tag/v0.2.14) 发布保留。

下面保留早期里程碑记录；当前功能与构建入口以 [INTEGRATION.md](docs/INTEGRATION.md) 和 `docs/remote-bridge` 最新验收记录为准。

面向《无限暖暖》的本地摄影同步 App monorepo。PC Companion 是远程图库的 source of truth；移动端按需缓存预览、按用户操作保存原图。媒体字节使用 HTTP(S)，WebSocket 只承载事件，断线恢复以 revision journal 为准。

## 早期里程碑（历史记录）

- M0.16 Sample Analyzer：可运行的 Node CLI，支持文件树、图片/JPEG tail、视频探测和合成样本测试。
- M0.17 SQLite Schema v1：Asset/Resource 双层模型、revision journal、配对与 resolver candidate 表及仓储层。
- M0.18 Protocol Contract v1：共享 TypeScript contract、协议版本、路由与 DTO。
- M0.19 AssetResolver v1：已用 418 个真实文件验证；确定识别 111 组 High/Low 与 3 组 Live cover/MP4，且没有额外 motion 误配。
- M1.0 PC Scanner Foundation：自动发现游戏目录，稳定性守卫、资源分类、Resolver v1 聚合、幂等 SQLite reconciliation、软删除与 fs.watch 去抖已接入。
- M1.1 Local Sync Server：HTTPS REST、Range 流式资源、revision changes、WebSocket、mDNS、一次性配对、Ed25519 请求签名与本地 TLS pinning 已接入。
- M2.0 Mobile Gallery MVP：Android 13+ 原生客户端已接入 mDNS 自动重发现、一次配对、PC 图库分页、实时 revision 唤醒、LIVE 标识、多选与 SHA-256 校验后的系统相册原图保存。

PC Companion 从内部缓存、便携安装位置、Windows 安装记录、快捷方式和常见游戏目录发现游戏位置；运行中的游戏仅为补充线索。存在隐藏的 `X6Game/Saved/GamePlayPhotos` 时优先扫描原件，`ScreenShot/Video` 作为旧版或缺失原图库时的回退。

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

交给通过本地 MCP 或 GitHub 连接的 GPT 继续开发时，先让它阅读最新的 [GPT_HANDOFF_2026-09-04.md](docs/GPT_HANDOFF_2026-09-04.md)；较早的 [GPT_HANDOFF_2026-09-02.md](docs/GPT_HANDOFF_2026-09-02.md) 仅作为历史记录。

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

日常使用可双击构建好的单文件 `NikkiSync-PC.exe`。它自动发现游戏目录，把私有数据库和 TLS 身份保存到 `%LOCALAPPDATA%/NikkiSync`，启动局域网同步并显示电脑控制页。单文件包内含运行组件，无需另放 migration 或安装 .NET；首次展开后复用本机缓存。可执行包不提交到源码仓库。

PC 扫描原图库，启动本地 HTTPS 服务并提供短时一次性配对链接；桌面界面将其显示为二维码。默认监听本地接口。USB 开发验收可设 `NIKKISYNC_BIND=127.0.0.1`、固定 `NIKKISYNC_PORT`，再执行 `adb reverse tcp:<port> tcp:<port>`。

Android 工程位于 `apps/mobile`，目标为 Android 13+ / compileSdk 35。配置 JDK 17、Android SDK 35、Build Tools 35.0.1 及相应环境变量，使用项目 Gradle Wrapper 或 `npm run mobile:build` 构建；完整入口见 [对接文档](docs/INTEGRATION.md)。

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
