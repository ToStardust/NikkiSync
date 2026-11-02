# Live 正式图库接入与暖暖粉成品更新

工作区 NikkiSync-RemoteBridge；分支 `feature/remote-bridge-foundation`；基准 HEAD `2466e60b3d43a707851915ce9f4ee67627a06338`。本轮修改未提交、推送或合并，保留已有工作区改动。

## 用户授权与设备证据

用户明确允许上传新版小程序开发预览，并要求将刚刚的 Live 功能接好。先前用户回答“是的 这个测试是可以的”，但在 2026-10-05 明确撤回：微信收到 `.livp` 后无法保存到相册；实际使用的是 QQ 闪传下载，结果只是文件，系统相册中看不到。因此撤销“合成封包导入成功”的记录，**目前没有 iPhone 系统相册识别为 LIVE 的真机成功证据**。没有设备版本、单一 LIVE 项目、运动/声音或重开播放验收。封装结构及本机传输通过不能替代相册验收。

## 实现

- EXE 复用 scanner 的 canonical 数据库，将完整、ready/stable 的 JPEG 封面 + MP4 关联资源接入同一个微信相册，不增加扫描器、数据库或公网服务。只接受发现的照片/动态根目录内文件，读前复核 canonical path、大小、mtime、inode 和 scanner SHA256。独立 RemoteFileProvider 仍只授权普通照片。
- 小程序列表显示 LIVE；全屏查看接入完整视频或回到封面。Live 导出为 `.livp`，准备完成后由用户另点“转发 .livp 文件”选择微信接收目标。**转发成功不计为相册保存成功，当前没有已验证的系统相册导入方式**；没有调用隐藏接口、伪造扩展名、或自动替用户发送文件。现有页面文案仍残留“按已验证的方法导入”，该文案依据已被用户撤回，不能作为适配成功证据，后续需纠正。
- 混选含 Live 时明确要求逐张导出，不静默保存封面为成功。Live 在小程序保留原方向；隐藏普通照片旋转按钮，App 已有同步封面/视频旋转继续使用。
- 临时 MP4/LIVP 只用本应用精确文件前缀；切图、退出、迟到写入清理，转发框持有文件到真实平台回调后再清理。取消不报成功。进程死亡后的平台转发事务仍不能保证恢复。
- Android 既有格式选择、同步旋转、保存记录与视频伴随 URI 路径保留；Live 控件也改为共享暖暖粉资源。

## 通用封包

`tools/wechat-gallery/live-export.mjs` 已进入 EXE 内置 GalleryRuntime，和隔离的两秒合成 probe 分开。

接受当前安全范围内的 H.264/HEVC、单视频轨、至多一音轨，60 秒/3600 帧上限。优先使用合法源 presentation PTS；缺失时解码缩略帧与封面匹配实际 sample PTS，不能可靠匹配则失败，不固定假设 30fps/0秒/1秒。生成 fresh 配对 UUID，JPEG Apple MakerNote 与 MOV content identifier 一致，MOV 有真实 mebx 定时 still-image-time 轨。

MOV 使用 stream copy，不裁剪、不重新编码。每次封装在输出前检查所有视频/音频 packet 的 SHA256、数量、PTS/DTS/时长、编码、尺寸、色彩字段、音轨配置与显示方向；变化则拒绝。JPEG 保留图像编码和现有 EXIF/ICC，使用白名单游戏参数补充标准 EXIF，并移除游戏 JPEG EOI 后参数尾部。ZIP 恰好同名 `photo.jpg` / `photo.mov` 两个叶路径。

Windows 目录随包包含本机现有 FFmpeg 8.1.1 的 `ffmpeg.exe` / `ffprobe.exe`、原 LICENSE/README，不下载新工具；已通过显式随包路径运行封包器，不依赖 PATH。当前是本地开发构建，未执行正式对外发布。

## 独立传输规格

真实库最大动态视频 76,653,197 字节，旧单图16MiB不足。新增 prologue 绑定的 `NikkiSyncLocalGalleryLive` 类型：单 Live 文件96MiB，帧明文4096字节/密文4112字节保持，最多131072记录、每方向512MiB、256请求、十分钟期限、单次 claim。Live 请求最多八分钟，仍受连接期限控制。

旧 diagnostic/preview/download 的记录、哈希、单图16MiB和会话额度未修改。新增专用 `sha256Live`，普通原图仍用 `sha256Original`。不把规格扩大记为独立安全审计通过；大文件微信内存、原生播放器和真实手机性能待验收。

## 验证记录

- TDD：最初通用封包/源索引3项 RED，客户端/缓存/页面4项 RED，独立大文件规格2项 RED，补实现后 GREEN；非两秒无声旋转样本也实际生成并检查显示矩阵。没有把 FFmpeg 元数据未写成功的假样本记为方向通过，改用实际 `display_rotation` 生成后验证。
- 最终 Live 专项 **11/11 PASS**：通用封包、完整音视频 packet、无声40帧/1.6秒/90度源方向、文件和路径隔离、canonical索引、17MiB真实Noise回环、错误哈希/签名/大小/类型/身份字段拒绝、转发与缓存生命周期、混选保护。已纳入标准 `test:wechat`，同时保留 `test:wechat-live-gallery` 独立入口。
- 微信原有完整回归 **159/159 PASS**；并入新增11项后再次运行标准 `npm run test:wechat`，最终 **170/170 PASS**，0失败/跳过。
- `npm test` **99/99 PASS**；`mobile:validate` **51文件 PASS**。
- Android `testDebugUnitTest` **57/57 PASS**（0 failure/0 error），`assembleDebug`成功，实际 APK v2 签名验证通过。
- 真实只读源库：**224张 / 9个Live关联资源**均可列出。对最大76,653,197字节视频通用封包，得到77,600,690字节LIVP，经真实Noise TCP本机回环后全字节一致。SHA256 `a55d23a50e25f84998090f70f16134748ab982544e18a8fe4499a26b016570a0`。实际导出音视频包校验通过，没有上传媒体或改写游戏/原库。
- 新 EXE 真实 service 使用临时数据库副本启动：扫描224资产、微信224张、两个入口、二维码生成/更新/结束、头像通过；仅测试副本禁用在线解析，旧运行实例未停止。原库只读。
- 内置 GalleryRuntime + 随包媒体工具显式路径：合成封包79,558字节，实际通过。
- `git diff --check`通过，仅已有 CRLF提示。构建的 NU1900 是在线漏洞信息无法读取，不宣称依赖安全审计通过。

## 本轮交付

- Windows：`release/NikkiSync-PinkUI/NikkiSync-PC.exe`；保留整个目录（含 service、wechat/media、migrations、branding）。service SHA256 `D6FB3B18266A31A71ADB19280705C4BC9B08786013472640E4C62B3CBBFD537A`；UI DLL `929662F5BE6C4A30DF9DA6FA149C2438939A33BBA5CE977F49A1227A5B730047`。
- APK：`apps/mobile/app/build/outputs/apk/debug/app-debug.apk`；SHA256 `0FA812F2BA0FD8A2CF2CB0DBE3984B4CB11277DDEA9B5F1A4F3F07EB989D613A`。未安装手机。
- 最终微信预览：`out/wechat-nikki-pink-live-preview.png`，CLI preview成功，代码包**258,513字节**，AppID `wx1bfaa26659e0401b`；不含私人照片、UID、PSK、电脑地址或私密连接码。未正式upload/发布/提审。
- 本机真实Live样包：`out/live-integration-2026-10-05/NikkiSync-Real-Live.livp`，只本机保存；未自动转发第三方。

先退出托盘旧版再运行新版 EXE（已有单实例会激活旧进程），手机先打开本轮预览，再扫描新版电脑生成的私密连接码。开发预览码与电脑连接码用途不同。

未执行本轮微信真机播放/文件转发/真实游戏LIVE导入、全厂商系统相册验收、WPF窗口或APK手机视觉验收。文件结构与 PC 本机传输有证据；先前合成导入成功说法已撤回，实际手机相册保存仍未通过。下一步问题说明见 `MINIPROGRAM_LIVE_DOT_HANDOFF_2026-10-05.md`。

公开资料：[微信官方文件转发类型](https://github.com/wechat-miniprogram/api-typings/blob/master/types/wx/lib.wx.api.d.ts)（filePath/fileName）；[FFmpeg display_rotation 与 stream copy](https://ffmpeg.org/ffmpeg.html)；原 Apple 封包依据见 `IOS_LIVE_IMPORT_PROBE_2026-10-04.md`。
