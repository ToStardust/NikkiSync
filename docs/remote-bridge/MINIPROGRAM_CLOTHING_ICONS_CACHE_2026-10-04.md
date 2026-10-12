# 小程序服装图标与分层缓存交接

日期：2026-10-04，Asia/Hong_Kong。工作区：`D:\GAME\InfinityNikki Launcher\InfinityNikki\X6Game\CameraPartner\NikkiSync-RemoteBridge`。分支：`feature/remote-bridge-foundation`。本轮只补小程序穿搭图标及所需 PC 缓存/打包支持，未提交、推送、合并、安装手机或修改游戏文件。此前工作区已有大量未提交实现，不能把所有 dirty 文件归为本轮；`tools/sample-analyzer/analyze.mjs` 的既有改动未修改。

## 用户入口与效果

使用本轮 EXE 服务和小程序开发预览：进入照片 → 参数 → 本次穿搭。每组显示 6 件，三列「缩略图＋服装名称」，可上一组/下一组；单张最多沿用 100 件规范化服装的上限。只在打开参数时加载当前组，不为整个图库预取全部图标。

优先显示具体服装图；已有字典 fallback 仅作分类图时明确标注「分类示意」，不能冒充具体服装。没有图显示「暂无图标」，请求/原生解码失败显示「暂不可用」，缺失或自动生成的“服装＋代码”名称显示「名称待解析」。本轮没有新增服装 ID 解析器，不能宣称所有未知名称都已解决。

保留相机参数；存在穿搭卡片时不再重复显示长串服装文字行。原有浏览、双指缩放、旋转、EXIF、多选下载和动效未重做。图标不写入手机系统相册。

## 缓存放置评估与实现

实测当前电脑已存在 203 个公共图标，图像文件和索引合计 8,164,780 字节（约 7.8 MiB）。APK 已使用同一公共缩略图缓存，因此复用比另外建一套/把素材塞进小程序代码包更合适。手机仅保留短期显示文件，不让每个设备重复直连公共图站。

| 层 | 放置位置 | 上限与清理 |
| --- | --- | --- |
| PC 公共原始缩略图 | 默认 `%LOCALAPPDATA%\NikkiSync\metadata-thumbnails`，沿用 AppData fallback | 图像二进制总预算 128 MiB / 2048 个 `.img`，单图 2 MiB；LRU 在新缓存写入时执行 |
| PC 小程序派生 PNG | EXE 服务进程内存 | 16 MiB / 128 项；超限淘汰最久未使用项，进程结束释放 |
| 手机显示缓存 | 小程序 `wx.env.USER_DATA_PATH` 下专属 `nikkisync-icon-时间-序号.png` | 4 MiB / 64 项；LRU，退后台、卸载页面、重新连接清理；下次启动清理异常退出的专属孤儿文件 |
| 手机穿搭清单 | 页面内存 | 最多 40 个六件分页；图库刷新/连接退出失效 |

128 MiB 指受管理 `.img` 的二进制预算，不包括 JSON 索引、正在写入的临时文件或用户自行放入的其他文件，不能宣传成整个目录的精确硬上限。既有缓存若已超预算，会在后续新写入时修剪，不是启动时全盘清空。仅处理本缓存目录内规范 SHA256 文件名的普通文件，不递归删除目录或清理照片。最近 60 秒读过的图和正在写入的图受保护；预算无空间时拒绝新缓存，不无限增长。图标可从公共数据源重新获取。

磁盘键包含规范 URL 和字典版本；读缓存核对来源、版本、MIME、大小及内容 SHA256，损坏重取。字典版本变化生成新键，旧版逐步通过 LRU 淘汰。派生 PNG 键使用 URL 候选与版本；同图并发请求合并，返回独立字节副本，避免传输清理影响缓存。连续失败有 30 秒短暂负缓存，不持续重试。

PC 下载超时 10 秒覆盖请求头及响应体；小程序图标 provider 全流程预算 15 秒，早于客户端 20 秒请求超时。单图失败返回普通失败响应，名称/参数和连接保留。共享下载可能在 provider 结束后继续到自身的 10 秒超时，不声称取消了全部后台工作。原生缩放子进程自身有 10 秒上限；晚到的转换字节会清理。

## 传输与隐私边界

复用现有同局域网 Noise 加密下载 profile，新增受授权 `outfit` / `icon` 指令。手机只提交当前快照内的照片 opaque ID 和属于该照片的图标 opaque key；不能传任意 URL、路径或服装 ID。清单不含 UID、内部服装编号、来源 URL、raw 数据和凭据。公共素材由 PC 从已有规范 metadata 缩略图候选取得，未额外向 NUAN5 请求照片参数。

PC 将公共图标解码为长边不超过 192 像素的 RGBA PNG，去除原始图标附加 metadata，再按既有 SHA256/分片校验传输，单图最多 256 KiB。PNG/JPEG 真实素材已验证；Windows GDI+ 不能解码的 WebP 等输入会尝试既有 fallback 或占位，未宣称所有格式都支持。

图标计入既有 128 MiB 会话流量与 256 次请求配额，不计入 PC 的“已发送原图”张数；10 分钟、单次连接、普通照片 500 张快照/12 张分页等边界未放宽。旧 preview profile 不允许穿搭/图标请求。新指令没有另加跨旧版本能力协商，所以本轮 EXE 服务与小程序须一起更新。

沿用公共缩略图 cache 的 HTTPS、MIME、大小及私有字面 IP 检查；本轮不是 DNS rebinding/重定向全路径 SSRF 审计，不应夸大为所有网络安全风险已排除。无需公网云图库或新增服务器。未上传真实照片、UID 或连接密钥给微信，开发预览上传仅为 231,732 字节小程序代码包。

## 实现位置

- `apps/pc-companion/src/metadata/MetadataThumbnailCache.ts`：APK/小程序共享原图缓存、预算、LRU、损坏校验、响应体超时。
- `apps/pc-companion/src/wechat/WeChatIconProvider.ts`：转换缓存、合并并发、截止时间、独立 Buffer 所有权。
- `apps/pc-companion/src/windows-app.ts` / `GalleryRuntime.d.mts`：注入同一个 cache/provider，不启第二个 Node 照片服务。
- `tools/wechat-gallery/outfit.mjs`、`source.mjs`、`server.mjs`：最小清单及受限图标协议。
- `tools/wechat-gallery/resize-icon.ps1`：Windows 原生公开图标转换；已纳入 `apps/windows-shell/package.ps1`。
- `apps/wechat-mini-program/miniprogram/lib/icon-cache.js`、`gallery-channel.js`、`pages/local-gallery/index.{js,wxml,wxss}`：会话文件缓存、严格消息验证、穿搭卡片。
- `tools/wechat-gallery/outfit.test.mjs`：新增 16 项功能/缓存/生命周期测试，纳入 `npm run test:wechat`。
- `tools/wechat-gallery/accept-outfit-local.mjs`：只读真实数据的可重复本地验收，不输出私人 ID、文件名或 URL。

## 已执行验证

TDD 记录：名称代码过滤、刷新失效、孤儿清理、派生缓存 Buffer 别名、provider 超时、并发合并、共享下载响应体超时先见 RED 后补 GREEN。最早添加缓存预算时先见配置类型 RED，不能把它宣传成所有行为均已独立运行时 RED。额外覆盖两个派生缓存上限、超时后清理及图标失败后连接仍可读取清单。

- `npm test`：**91/91 PASS**，包含既有 APK 服装图标代理及 fallback 回归。
- `npm run test:wechat`：**147/147 PASS**；穿搭聚焦 **16/16 PASS**。
- 真实只读 SQLite/既有公共图标缓存：215 张普通照片中选取一张旧版（日期推测 2.8）和一张 2.9（日期推测），两张均有已解析服装名称，Windows 原生转换输出 RGBA、尺寸 ≤192；实际 Noise 加密图标两次往返、SHA256 验证、重复命中无需再次读取/转换均 PASS。版本来自既有推测，不冒称游戏文件显式版本。
- 此实测 `externalRequests=0`，`privateMediaUploaded=false`，`gameFilesWritten=false`，`databaseReadOnly=true`，`realCacheReadOnly=true`。初次实测确实揭示 Buffer.slice 的共享内存问题，修复后重跑通过。
- `npm run pc:exe`：Bun Windows 服务与 .NET WPF publish 成功，布局含 `wechat/resize-icon.ps1`。NuGet 漏洞资料联网有 NU1900 警告，不能声称在线依赖漏洞审计通过；没有下载新的工具链。
- 新打包服务实际启动验收：私有临时数据库快照、禁用联网解析；扫描 224 assets / 215 普通照片，创建/更新/关闭微信二维码、APK 入口及共用头像验证 PASS；仅结束本轮自启的测试服务并清理临时快照，未改真实数据库。此测试不代表手机实测或所有 UI 生命周期验收。
- 微信 CLI 实际开发预览生成成功，WXML/WXSS 编译并上传纯代码；不发布、不提审。

## 交付文件指纹

文件均在当前项目文件夹，未放桌面。Windows 必须保持整个 `release/NikkiSync` 文件夹完整。

| 文件 | SHA256 |
| --- | --- |
| `release/NikkiSync/NikkiSync-PC.exe` | `F6F35C74381B175EA457445C92597E4A17E2B92454C7C515299E8687EF044E89` |
| `release/NikkiSync/NikkiSync-PC-service.exe` | `6DA1D7C93848C342404CC3A3CF8063541547E93DE15569930EA0D54221BB3EC9` |
| `release/NikkiSync/wechat/resize-icon.ps1` | `2EF5510D710E25599462BDEF0D67E728DA99EB25DD069F0662869B1CA4F12525` |
| `out/wechat-gallery-clothing-icons-preview.png` | `C8284199BA2CC23B6E8219C24F2AEDA9D1B1E41F015DD067EC3DA7F9A4113223` |

Android 源码本轮未改，不重新打包 APK；沿用此前 EXIF 版本。没有调整配对协议、NUAN5 或 Live/Motion 厂商兼容模块。

## 待手机验收（没有伪装为通过）

1. 先微信扫码 `out/wechat-gallery-clothing-icons-preview.png` 打开新开发版；再启动当前 `release/NikkiSync/NikkiSync-PC.exe` 并扫描其新连接码。预览码与照片连接码不是一回事，不转发连接码。
2. 分别打开有穿搭信息的旧照片和 2.9 照片 → 参数 → 本次穿搭，确认三列卡片、中文名称、上下滚动及下一组；折叠/展开参数、关页与切图不串图。
3. 具体服装缺图时检查「分类示意」或占位；未知名字只显示「名称待解析」，不能把分类图或编号当正确识别。
4. 同图反复打开、连续切图、退后台/新扫码、临时断网、超出一组服装、设备空间不足等实际生命周期验收。
5. 确认现有缩放、旋转、EXIF、多选下载未回退。此前微信保存到系统相册后 EXIF 保留仍是待实机项，见 `MINIPROGRAM_EXIF_LIBRARY_ROTATION_2026-10-04.md`。

本轮用户只要求服装图标，没有新的关机请求；没有重排昨夜的关机任务。
