# NikkiSync 开发与对接入口

## 各端与共享数据

| 模块 | 目录 | 职责 |
| --- | --- | --- |
| PC 桥接 | apps/pc-companion/src/windows-app.ts、runtime.ts | 游戏发现、扫描、SQLite、TLS、配对和同步 |
| Windows 界面/单 EXE | apps/windows-shell | 托盘、自动启动、WebView、运行文件复用和错误恢复 |
| Android | apps/mobile/app/src/main/java/app/nikkisync/mobile | 图库、缓存、预览手势、分享图、系统相册保存 |
| 微信小程序 | apps/wechat-mini-program/miniprogram | 临时共享图库、视频下载、分享图与后台重连 |
| 协议 | packages/protocol/src/index.ts | DTO、路由与签名头 |
| 数据模型 | packages/core、packages/database | 资产/资源、元数据、SQLite migration 和变更日志 |

照片是 Asset；同一张照片的高清、低清、封面和视频属于 Resource。新增客户端沿用此模型，保持 UID、资源角色、revision 和协议 v1。游戏文件只读，旋转/附参数/分享图输出派生文件。

## Android/新原生客户端同步

局域网服务使用本地 HTTPS。一次性二维码交换设备公钥和服务器信息，之后使用 Ed25519 签名请求，并校验配对时取得的 TLS 指纹。不要关闭 TLS 校验或绕过认证。

| 接口 | 用途 |
| --- | --- |
| GET /v1/server | 服务器信息 |
| POST /v1/pair | 一次性配对；结构见 protocol 与 PairingService |
| GET /v1/assets | 分页图库 |
| GET /v1/assets/{assetId} | 单照片详情 |
| GET /v1/assets/{assetId}/metadata | 元数据 |
| GET /v1/assets/{assetId}/resources/{resourceId} | 原件下载，支持 Range |
| GET /v1/assets/{assetId}/clothing/{clothingId}/thumbnail | 服装缩略图 |
| GET /v1/changes | revision 增量变更 |

认证头：`X-NikkiSync-Device-Id`、`X-NikkiSync-Timestamp`、`X-NikkiSync-Nonce`、`X-NikkiSync-Signature`。签名规范以 `apps/pc-companion/src/server/AuthService.ts` 和 Android `net/NikkiSyncClient.java` 为准。

可运行的配对、分页、Range、鉴权和 WebSocket 请求/响应示例：`apps/pc-companion/test/local-sync-server.test.ts`。文档中的 `<ASSET_ID>`、`<DEVICE_ID>`、`<SIGNATURE>` 为占位符，不得复制某台电脑的配对码或 TLS 密钥。

## 小程序对接

小程序采用 PC 本机控制页创建的临时会话，与 Android 长期设备配对不同。入口为 `apps/pc-companion/src/wechat/WeChatGalleryService.ts`、`tools/wechat-gallery`、小程序 `lib/gallery-channel.js` 和 `pages/local-gallery`；同目录测试提供会话、加密、数据格式与传输示例。

本机控制页面仅供桌面界面使用，受页面令牌和来源校验保护；它不是开放公网 API。不要直接将控制端口代理到公网，也不要把 Android 私有配对密钥放入小程序。

iPhone 小程序原生 LIVE 保存目前搁置，普通视频下载可用。仓库保留的 LIVP/PWA、TLS/TCP、加密与图像诊断是实验材料，不表示已实现 iPhone 相册 LIVE 导入。Android LIVE 保存按厂商能力和现有回退路径处理，尚不承诺所有型号兼容。

## 在线元数据及离线模式

本地媒体同步不上传照片。当前干净安装默认启用公开服装字典和拍摄参数查询；参数查询可能发送 UID、参数 token 和校验摘要，不能把它描述成完全离线。入口为 `metadata/MetadataStartupComposition.ts`。服装补充数据保留来源和缓存，不按图标猜名称。

在本机私有数据目录创建 `metadata-resolver.json`、`metadata-dictionary-remote.json`，各写入 `{ "enabled": false }`，即可关闭对应在线查询。实际端点配置、SQLite、TLS 密钥、缓存和配对信息不提交到 Git。

## 构建与验证

- Node.js 24+：`npm ci`、`npm test`。
- Android：JDK 17、SDK 35、Build Tools 35.0.1。设置 `JAVA_HOME` 和 `ANDROID_HOME` / `ANDROID_SDK_ROOT`；执行 `npm run mobile:build`，或在 `apps/mobile` 运行 Gradle Wrapper。
- Windows：.NET 8 SDK、Bun 1.3.14 baseline 编译目标、WebView2。先构建 Android APK 放到忽略的 `release/NikkiSync/NikkiSync-Android.apk`，再运行 `apps/windows-shell/package-portable.ps1`；该脚本只打包允许列表内的运行文件和 APK，输出单 EXE。
- 小程序：微信开发者工具导入 `apps/wechat-mini-program`，使用自己的 AppID；`project.private.config.json` 是本机配置，不提交。网络限制和实际设备验收见 `docs/remote-bridge`。

回归：`npm test`、`npm run mobile:validate`、`npm run test:wechat`；Windows 为 `dotnet test apps/windows-shell.Tests`，Android 为 Gradle `:app:testDebugUnitTest`。最新验收记录为 `docs/remote-bridge/WINDOWS_AUTO_DISCOVERY_2026-10-11.md` 和 `ANDROID_ROTATION_RETURN_2026-10-10.md`。

协议或行为变更请补测试，说明实际设备验证范围。原创源码使用 MIT；第三方代码和游戏资源的权利边界见根目录 `THIRD_PARTY_NOTICES.md`。
