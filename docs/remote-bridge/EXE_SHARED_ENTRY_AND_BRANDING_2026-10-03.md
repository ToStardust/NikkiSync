# EXE 统一 PC 入口与大喵共同图标

日期：2026-10-03（Asia/Hong_Kong）。工作区：`NikkiSync-RemoteBridge`，分支：`feature/remote-bridge-foundation`。本次没有从 main 或旧目录重做、没有提交/推送/合并。

## 用户目标与实现

EXE 为微信小程序及 APK 的共同 PC 入口，负责检测游戏照片、管理连接、发送照片及已有参数；EXE/APK 图标与当前小程序一致。

- 沿用 `PcCompanionRuntime` 的安装目录自动发现、扫描/watch、同一个 SQLite、metadata resolver/dictionary 与 APK 的 TLS/配对/原图传输。没有新增平行索引、要求用户配置游戏路径或删除现有数据库。
- EXE 首页区分 **Android App** 与 **微信小程序**。Android 原有配对码不变；微信按钮生成专用 `NikkiSyncLocalGalleryDownload` 二维码，不能互相混用。
- 微信 TCP/Noise 服务已编译进 `NikkiSync-PC-service.exe`，由现有 WPF 壳启动的同一个服务进程持有。用户不需要另开 Node、npm、终端或开发服务器。
- 只有点击“微信下载照片”才开启监听/照片快照；打开 EXE 本身不自动开放微信图库。可生成新连接二维码、查看等待/连接/断开/过期状态及发送数量、结束连接。取消或关闭控制页、服务退出、会话到期都会停止或作废连接。
- 首页每两秒刷新扫描照片数、配对设备数。微信“已发送原图”仅表示完成通道发送，不等于手机已经成功保存相册。
- 微信快照复用扫描器的已发现照片根及当前数据库，不重新探测游戏进程、不访问未入库任意路径。最多 500 张普通 JPEG/PNG，当前机器 215 张；Live 暂不开放。新拍照片继续由现有 watcher 入库，微信需生成新连接码获取新的照片/metadata 快照，不声称现有快照实时增量更新。

## 网络和参数边界

目前只支持同一局域网；没有云存储、收费基础设施、隧道、外网访问、微信正式发布或 iPhone 验收。保留原开发加密通道的单连接/十分钟/单文件 16 MiB/会话 128 MiB/256 请求等限制，没有关闭 TLS/域名校验或降级为明文。

新本机控制 API `/api/wechat/*` 使用仅本机页面持有的随机 token、Host/Origin/Sec-Fetch-Site 检查。状态不返回 key、二维码 SVG、原路径或原始 metadata。私密二维码只在 PC 页面展示，不进日志、仓库、开发预览上传包或聊天。

微信参数来自现有 canonical metadata 的玩家可读投影；原图传输保留完整原文件及尾部。未解析参数/服装不猜、不伪造。不能保证微信/系统相册保存后保留游戏自定义尾部。NUAN5 与公开字典沿用原 EXE 配置和此前用户授权，本轮没有更改其策略。

JS 加密依赖仍标记 WIP、未经独立安全审计；整合 EXE 不等于解除这条安全待验收。入口明确写“开发测试”，不宣称正式生产安全、微信审核或 iOS 全兼容。

## 实图验证发现并修复的 Bun 兼容问题

Node 实图回环通过后，Bun 首次失败：6,363,595 字节原图被分帧接收器拒绝。诊断确认单次 TCP 回调合并到 325,006 字节，旧代码把网络事件整体当作有界缓冲，超过 262,144 就拒绝；这不是原图字节或照片格式问题。

先新增“大事件含 100 个有效帧、拆分头、非法长度、会话总量上限”测试得到 RED，再修复 `createGalleryDecoder`：逐个读取完整帧，只保留未完成头/当前帧，内部缓存最多 **4114 字节**。密文单帧仍最多 4112、会话总量不变、错误帧失败关闭，不通过放宽密码/大小规则掩盖错误。

修复同步用于 MiniProgram 和 EXE 内嵌同源模块。运行时 bundle 内嵌客户端模块，不在用户机器读取源码树；预览转换脚本随 release 放在 `wechat/resize-preview.ps1`，只使用匿名 stdin/stdout 和隐藏子进程。

## 图标

找到此前保存的 `out/avatar-momo/momo-camera-512.png`，复用无文字主版，未 AI 生成或重绘大喵。共同源图落在 `assets/branding/momo-camera.png`，SHA256：`9BC0A0D0BCD670F3DA05791E5F851AEC1C4CBBA142D0F8A5097F657DA95F47E0`。

- Windows：7 个尺寸的 ICO，应用 PE、窗口、托盘统一来源；PC 页面也显示同一头像。
- Android：各密度 legacy PNG、带安全边距的 adaptive 前景及背景，Manifest 的 icon/roundIcon 均接入。
- 角色权利仍归其权利人，公开素材不是第三方应用商标授权；本产品是非官方玩家工具，正式公开发布前需确认许可。来源和再生成脚本见 `assets/branding/README.md`。

## 新鲜验证结果

1. `npm run test:wechat`：**73/73 PASS**。新增 EXE 控制 token/状态/关闭、内嵌运行时、启动取消/更新生命周期、PC 面板取消竞态、共同图标和大 TCP 事件测试。入口/服务最初 3 项 RED，图标最初 RED，TCP 合并事件最初 RED，均补 GREEN。
2. `npm test -- --runInBand`：**87/87 PASS**，包括扫描、APK 既有配对与文件接口、元数据和原 Remote Bridge 回归。
3. `dotnet test apps/windows-shell.Tests/NikkiSync.WindowsShell.Tests.csproj -c Release --no-restore`：**9/9 PASS**。NU1900 表示在线 NuGet 漏洞信息不可取得，不把它称为依赖安全审计通过。
4. `npm run mobile:validate`：源码合同通过。现有 JDK17 / SDK35 / Gradle8.13，离线 `:app:assembleDebug` **BUILD SUCCESSFUL**，生成 APK；apksigner v2 签名验证通过，aapt 包名及 adaptive icon 验证通过。没有额外下载 Android 环境、没有安装手机。
5. 完整 `:app:testDebugUnitTest`：**55 项中 53 通过、2 失败**。`EditedMediaAccessTest` 两个现有测试调用 `android.net.Uri.parse` 报 `Method parse ... not mocked`，发生在业务方法执行前；这两个测试与业务实现没有在本轮修改。没有略过后把整套 JVM 报成绿色，也没有擅自改“关联修图”业务。
6. `node tools/wechat-gallery/accept-desktop-exe.mjs`：启动真实最终 `NikkiSync-PC-service.exe`，在现有 SQLite 的私密临时副本上验证扫描 224 个素材、微信 215 张普通照片、Android/微信两个入口、二维码生成/更新/结束、共同头像字节一致。源库只读 VACUUM INTO 快照，测试副本中禁用 NUAN5/公开字典，结束后停止自己启动的进程并清理经过目标路径验证的测试副本。未触碰原库、游戏照片或已有服务进程。
7. `accept-integrated-transfer.mjs` 在 Node、Bun 以及 **独立编译 Windows EXE** 各执行一次以上：3 张真实照片的预览、原图、metadata 成功；原图共 **15,977,443 字节**全字节相同；3 张有已有参数，PC 发送计数及结束监听验证通过。原数据库只读、源照片未写、媒体只经 127.0.0.1，不上云。独立 EXE 无须读取 MiniProgram 源码或安装 Node。
8. 微信 CLI 开发预览成功，176,864 字节，仅代码，不含照片/UID/IP/PSK；保存为 `out/wechat-gallery-integrated-preview.png`，未发布/提审。此前相对工程路径报 code19，使用绝对工程路径重试成功，不能凭 CLI exit0 把带 error 的第一次当成功。

手机实机验收按用户要求暂停；实际 WPF 视觉/双开、Android 微信跨设备原图保存与缩放、iPhone、系统相册尾部保留、进程死亡缓存/批次恢复仍不在本轮 PASS 范围。

## 本地交付

目录：本工作区 `release/NikkiSync/`。入口：`NikkiSync-PC.exe`，手机包：`NikkiSync-Android.apk`（debug、未安装）。没有覆盖旧安装位置、改桌面快捷方式、改开机启动项、改防火墙或推 GitHub。

必须保留整个目录，包括服务 EXE、WPF/WebView2 DLL、migrations、branding 与 wechat 目录；不能只搬主 EXE。第三方许可证和开发安全说明随包置于 `wechat/`。

```text
NikkiSync-PC.exe
F6F35C74381B175EA457445C92597E4A17E2B92454C7C515299E8687EF044E89

NikkiSync-PC-service.exe
01BF33C3F9FBB2CBBD1DB173ED9675CA9F0418471D6F4333097B090B0F5A3BB2

NikkiSync-Android.apk
29C90B0BA9451970A7DA25D71260B93A63DD88068424DABB980012CE608E0839
```

依赖锁已离线更新，root 固定 esbuild 0.28.2；构建可复现时从 root 安装 workspace 依赖，不依赖本机孤立工具目录。`build-wechat-runtime.mjs` 为生成步骤，source/dist runtime bundle 均为被忽略的构建输出，手工代码只修改原模块和类型/controller。离线 npm 的“0 vulnerabilities”不代表新鲜联网安全审计。

当前所有源码与记录仍在本地、未 commit/push。保留用户既有 `tools/sample-analyzer/analyze.mjs` 修改，其他工作树/Live/NUAN5/原 APK 安全配对/Windows 单实例生命周期不改动。

## 后续更新：2026-10-04

小程序已补切图、跨页多选、放大加载原图及同连接刷新；本文件“新照片必须生成新码”是前轮历史状态。最终 service 已重新打包，更新后的预览码、哈希、87 项微信回归与边界见 [MINIPROGRAM_GALLERY_COMPLETION_2026-10-04.md](MINIPROGRAM_GALLERY_COMPLETION_2026-10-04.md)。手机/安全待验收仍不自动变为 PASS。
