# 小程序普通照片：预览、缩放、多选原图与参数

日期：2026-10-03。分支：`feature/remote-bridge-foundation`。

用户要求先推进功能，暂停手机实机测试。本记录只报告代码、自动化和本机回环结果；不把这些结果当成微信真机或 iPhone 相册验收。

## 已实现

- 全屏预览，原生 movable-view 双指缩放（1–6 倍）与拖动。每次打开重建视图以重置位置；缩放、拖动结束不误触单击切换工具栏。
- 长按进入多选、单张勾选、全选当前页，以及多选状态下独立预览。当前页最多 12 张；有选中项时禁止翻页，避免无提示丢失选择。
- 显式点击保存后申请相册权限，串行下载原图、校验、写入自己的临时文件，再调用微信保存相册接口。只有相册成功回调才记为已保存；失败项保留选中供重试。
- 预览内提供保存原图及参数按钮。参数来自 PC 现有 SQLite 中的 canonical metadata，只展示玩家可读的相机、滤镜、光照、地点、服装和版本字段。未解析服装明确显示尚未解析，不以内部代码伪装名称。
- 后台、退出与取消时停止后续请求；正在进行的原生写入或保存持有输入直至回调，再清理本功能自己的临时文件。不会删除系统相册照片。

## 原图与参数的边界

预览仍是用于浏览的缩小图（最长边 960），双指放大并不自动加载原图。保存路径独立请求完整原文件，不能回退为保存预览图。

PC 原图读取不解码、不重编码、不剥离 EXIF 或游戏尾部；发送前校验既有索引哈希和文件状态，手机收到全部内容且 SHA256 一致后才释放给保存流程。因此传输到微信临时文件之前的原始字节能够保持一致，包括游戏自定义尾部。

完整原文件也可能包含原有 EXIF、UID 和游戏自定义参数；本功能只通过用户主动开启的加密局域网连接发送到自己的手机，不另行上传云服务，不在 UI 暴露 UID、NUAN5 tuple、密钥或路径。

不能保证微信或手机系统相册最终保留游戏自定义尾部/EXIF。参数面板独立读取 PC 已解析结果，不依赖系统相册再解析。没有新增 NUAN5 请求、修改 resolver、猜测参数、更新字典或写入图库数据库。原有 metadata 不完整时仍如实显示缺失状态。

## 有界开发协议

- 新二维码类型：`NikkiSyncLocalGalleryDownload`；旧 `NikkiSyncLocalGalleryPreview` 仍只能列表/预览，不能请求原图或参数。
- 使用单独的 Noise 下载 profile，绑定二维码上下文；不扩大旧诊断/预览 profile 的限制。密文记录上限 32768，明文每帧最多 4096 字节。
- 单张普通 JPEG/PNG 原图最多 16 MiB，会话接收预算 128 MiB；会话最多 256 个请求，绝对有效期 10 分钟，单连接/单次领取。
- 完整原图头、分块和结束记录均受认证，最终校验 SHA256。损坏、截断、超限、类型错配和非法 metadata 字段失败关闭，不转 HTTP 或明文。
- PC 数据库只读打开；照片仅限经过路径 jail、哈希和快照检查的索引条目。Live/Motion 不在本次功能范围。
- 仍是开发用局域网工具，没有自动接入 Windows EXE 的正式远程入口；JS 加密实现尚未独立安全审计，不声称生产安全验收。

## 验证证据

先补失败测试，再实现：原图/元数据协议和源读取最初 3 项 RED，保存/UI 最初 4 项 RED，手势及选择丢失最初 2 项 RED；修复后均 GREEN。

- `npm run test:wechat`：66/66 PASS，包含独立 Noise 向量、真实 TCP、原图损坏/超限/截断拒绝、中文 metadata、保存权限/取消/原生回调、页面选择和手势回归。
- `npm test -- --runInBand`：87/87 PASS。此为 Node 主回归，不等于 Android 构建或设备测试。
- `node tools/wechat-gallery/accept-download-local.mjs`：真实现有索引 215 张中选取 3 张普通照片，仅在 127.0.0.1 执行加密传输；总原图 15,977,443 字节，全字节一致（包括原文件尾部）。3 张均返回既有参数，3 张有相机字段，3 张有服装名称字段。数据库只读，不落地原图，不上传媒体，不输出参数值/UID。
- `git diff --check`：通过（现有 LF/CRLF 提示不属于 whitespace 错误）。
- 微信开发者工具 CLI 开发预览生成成功：代码包 179,122 字节，二维码位于 `out/wechat-gallery-download-preview.png`。只上传小程序代码，不含图库、私密会话二维码、UID、密钥或本机 IP；未发布、未提审。

本轮未启动新局域网照片服务、未生成新的私密连接二维码、未安装设备软件。手机测试按用户要求暂停。

## 明确待验收/待实现

- Android 微信真实 pinch/pan、全屏打开、后台取消、相册权限、保存后的像素尺寸/方向与系统相册表现。
- iPhone 微信、系统相册与自定义尾部保留情况，均未验收。
- 预览放大后的高清加载、跨页多选、Live、超过 16 MiB 原图，不在本次完成范围。
- 进程死亡后的临时文件清理、持久化批次恢复尚未实现；当前是正常生命周期回调清理，不能称为进程死亡恢复。
- JS 原图缓冲与写文件副本的真实手机内存/性能、安全审计、会话预算耗尽及长时间使用体验仍需验收。

## 工作区交接

实现集中在 `apps/wechat-mini-program/miniprogram/pages/local-gallery/`、`lib/gallery-channel.js`、`lib/original-save.js`、`tools/wechat-gallery/` 与显式 crypto 下载 profile；相关测试已进入 `test:wechat`。

当前修改留在本地工作区，尚未提交/推送。历史开发文件和此前 UI 修改一并保留；用户原有的 `tools/sample-analyzer/analyze.mjs` 修改未触碰。其他工作树、图库核心、游戏资源、Live、配对安全协议、Windows Shell 生命周期均未改动。

原生 API 参考：[官方 movable-view 示例](https://github.com/wechat-miniprogram/miniprogram-demo/blob/master/miniprogram/packageComponent/pages/view/movable-view/movable-view.wxml)，[微信官方 API 类型声明](https://github.com/wechat-miniprogram/api-typings/blob/master/types/wx/lib.wx.api.d.ts)。

## 同日后续：EXE 入口已接入

用户随后要求 EXE 统一服务小程序与 APK，并统一图标；已完成本地实现与打包。本文“尚未接入 EXE”描述的是前一轮历史状态；最新实现、Bun TCP 合并事件修复、73 项微信回归、真实 EXE 及实图证据、APK 2 项既有测试失败详见 [EXE_SHARED_ENTRY_AND_BRANDING_2026-10-03.md](EXE_SHARED_ENTRY_AND_BRANDING_2026-10-03.md)。安全/真机待验收并未自动变成 PASS。
