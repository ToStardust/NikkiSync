# 小程序 Live 系统相册适配：交给 dot 的问题说明

日期：2026-10-05。用户本轮要求整理卡点，后续可行性调查由 dot 负责。本轮只更正记录和交接，不修改小程序保存实现、不上传预览。

## 目标

NikkiSync 从 Windows 电脑同步《无限暖暖》的摄影素材到手机。希望用户在微信小程序点击保存，iPhone 系统相册新增**一个真正的 LIVE 项目**：有静态封面、完整动态和声音，关闭相册重开后仍可播放。优先纯小程序完成；文件下载、静态图、普通视频、分别保存的图片与视频都不能算完成。

## 当前已做的工作

- 复用现有 PC scanner / SQLite 索引，将稳定的 JPEG 封面与 MP4 成对关联。正式图库代码已接入 LIVE 标识、完整视频播放、Live 封包接收与文件转发。
- PC 通用封装器为 JPEG 与 MOV 写入同一配对 UUID，MOV 含 `com.apple.quicktime.content.identifier` 及真实定时 `still-image-time` 元数据；封面使用源 PTS 或匹配帧 PTS。视频 stream copy，输出前核对完整视频和音频包，保留运动 / 音轨。
- `.livp` 是 ZIP 交换包，内含同名 `photo.jpg`、`photo.mov`，不是 Apple 官方相册写入 API。本机结构、完整媒体包与加密回环传输已有测试；没有 Apple PhotoKit 实机正控制，不能证明 iOS Photos 接受此候选。
- 微信通道已有独立 Live 类型，单文件上限 96 MiB，完整解密和 SHA256 校验。真实源库的最大样本曾完成本机封装与全字节回环。这不证明手机相册保存。
- 正式小程序缓存 `.livp` 后只调用 `wx.shareFileMessage` 让用户选择转发。它没有创建系统相册 Live Photo 的实现。

## 已纠正的真机事实

此前“朋友测试成功”已被用户明确撤回。微信收到 `.livp` 后不能保存到相册；另一条实际使用 QQ 闪传下载（曾简称网盘下载），结果也只是一个文件，系统相册看不到。**目前没有任何 iPhone 相册识别为 LIVE 的真机成功证据。** 具体型号、iOS / 微信版本没有记录。

现有页面的“按已验证的方法导入”文案因旧信息而残留，已标记为需要纠正，不能引用它作为成功证据。也不能据现有文件保存失败断言所有公开导入路线永远不可能。

## 当前卡点

主卡点是“收到完整素材 → 系统相册创建一个成对 LIVE 资产”。还需要把两种可能分开：

1. **封装兼容性尚未真机证实。** JPEG / MOV 元数据结构和包内容本机验证通过，尚无原生 PhotoKit 对照，仍可能存在 iOS 不接受的细节。
2. **小程序缺少已确认的成对写入入口。** 当前微信官方类型里 `wx.saveImageToPhotosAlbum` 与 `wx.saveVideoToPhotosAlbum` 各只接受一个 `filePath`；未发现 Live / pairedVideo 保存参数。`previewMedia` 只有 image/video；`openDocument` 声明的是 Office/PDF 文档类型。文件转发接口不等于相册保存接口。

已有隔离合成实验：普通 JPG、单文件 Motion JPEG、LIVP、顺序保存配对 JPG+MOV。直接 LIVP 保存与顺序保存的测试代码已经存在，但没有对应手机 LIVE 成功结果。实验页目前限制 iOS，Android 单文件路线尚未在该页面开放。不能凭 API success 回调宣布 LIVE 成功。

## 希望 dot 查清的事

- 先用原生 PhotoKit 或可靠的原生导入途径，对同一 JPEG+MOV 做一个正控制，验证现有封包是否真的可被 iPhone Photos 识别；结果用于定位格式问题与微信入口问题。
- 当前微信版本 / 基础库是否已有公开的 Live 单文件保存、成对保存、原生预览后保存或系统分享导入能力。请提供当前文档和实际相册结果，不使用虚构参数或隐藏接口。
- 如有可行的单文件格式，微信保存是否保留全部动态数据、配对标识与声音，而不是解码重存静态封面。
- 如果纯小程序公开能力无法完成，明确额外需要的系统步骤、快捷指令或原生 App，以及是否真的能完成成对资产写入。H5 播放 Live 不能作为相册写入方案。
- Android 可另测标准 Motion Photo（JPEG 尾部附 MP4），候选以 `_MP.jpg` 命名；需比较原文件直接导入与微信保存后是否保留动态字节。厂商相册识别不可推导为 iPhone LIVE。

验收统一为：系统相册仅一个 LIVE / 动态项目、完整运动及声音、重开可播放。记录型号、系统与微信版本和实际入口。只有落地文件、静态图、普通视频或两条相册项目均未完成目标。

## 代码及样本入口

工作区：`D:\GAME\InfinityNikki Launcher\InfinityNikki\X6Game\CameraPartner\NikkiSync-RemoteBridge`。当前工作区有大量已存在 UI / Live / 性能修改，不要覆盖或回滚；游戏目录保持只读。修改遵守 `AGENTS.md`，源码直接修改只用 `apply_patch`。

- 通用封装：`tools/wechat-gallery/live-export.mjs`。
- 正式小程序：`apps/wechat-mini-program/miniprogram/pages/local-gallery/index.js`、`lib/live-gallery.js`、`lib/gallery-channel.js`。
- 合成实验：`tools/wechat-live-probe/prepare.mjs`、`miniprogram/pages/live-diagnostics/index.js`、`miniprogram/lib/live-probe-save.js`（后两条均位于 `apps/wechat-mini-program/`）。
- 合成 LIVP：`out/ios-live-file-test-2026-10-04/NikkiSync-Live-Test-20261004.livp`，79,395 字节，SHA256 `c8d609bcf83a140387b100c5ee0605f951319ec4283ecaa7559669aabbfa25f8`。这是候选，未证实相册导入成功。
- 详细原始记录：`IOS_LIVE_IMPORT_PROBE_2026-10-04.md`、`LIVE_GALLERY_INTEGRATION_2026-10-05.md`（本目录）。

## 官方资料

- [微信团队官方 API 类型](https://github.com/wechat-miniprogram/api-typings/blob/master/types/wx/lib.wx.api.d.ts)：本轮读取当前 master，图片 / 视频保存接口仍为独立 filePath。微信文档网站本轮抓取失败，使用该官方自动生成类型作补证。
- [Apple：Capturing and saving Live Photos](https://developer.apple.com/documentation/avfoundation/capturing-and-saving-live-photos)：原生 PhotoKit 在一次资产创建中添加 photo + pairedVideo；不等于小程序可直接调用。
- [Apple：LivePhotosKit JS](https://developer.apple.com/documentation/LivePhotosKitJS)：网页播放能力。
- [Android：Motion photo format](https://developer.android.com/media/platform/motion-photo-format)：单文件容器、XMP 和文件命名规范。

本轮未运行新的手机验收、未更改保存功能、未发布、未发送消息给 dot；由用户转交这份说明。
