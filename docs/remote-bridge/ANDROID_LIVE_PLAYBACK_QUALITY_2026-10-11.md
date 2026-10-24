# 一加 Ace 2V LIVE 播放画质调查

2026-10-13 保存入口更新：原“保存原视频”的同机对照入口已由统一的“保存为：实况照片 / 视频”代替。视频现在应用预览旋转角度，0° 仍逐字节保留电脑原始 MP4。下文入口描述为历史调查记录；当前行为和验收边界见 [动态照片视频保存](ANDROID_MOTION_VIDEO_SAVE_2026-10-13.md)。

## 反馈与结论边界

更新：用户提供测试者系统 `16.0.5`、相册 `16.50.8`，随后反馈 0.2.14 修改后“LIVE 不会卡了”，并允许公开上传。该测试者的未旋转流畅度回归可按用户转述记录为通过；清晰度、重启、音轨和其他角度未取得新反馈。以下调查过程保留为历史，最新结论见 [Oplus 容器对齐记录](ANDROID_OPLUS_CONTAINER_2026-10-11.md)。

反馈来自远程的一加 Ace 2V 测试者，用户明确说明不是自己手机。扫码已恢复；测试者认为保存后的 LIVE 比电脑游戏原视频模糊、有抽帧感，且保存前没有在 NikkiSync 旋转。随后按照同机对照请求反馈“原视频正常、LIVE 卡顿”，问题范围缩小到 LIVE 封装或相册的动态播放路径。未取得测试者的原 MP4、保存后的 LIVE 文件、系统/相册完整版本或播放日志，仍不能确认具体原因或记为播放已修复。后续封装修正见 [Oplus 容器对齐记录](ANDROID_OPLUS_CONTAINER_2026-10-11.md)。

当前 `MainActivity.savePhotos` 使用 `LivePhotoExporter`，不是历史 OppoLivePhotoSaver。`AssetDetail.motionResource()` 选择 PC 提供的完整 `source_motion`；PC 资源接口返回源文件，没有手机专用低清视频。`LivePhotoRotation.rotate(...,0,...)` 返回原 JPEG/MP4；`MotionContainer` 对原 MP4 进行字节复制；`MotionContainerVerifier` 在发布前逐字节核对嵌入的视频。零角度不会经过 Media3 编码，不会主动改变码率、分辨率、帧数或时间戳。

非零角度的视频会重新编码，目前使用 Media3 默认码率；这是独立的质量风险，但不能用它解释这次明确未旋转的反馈。本轮没有改动这条编码路径。Media3 1.8.0 的实现见：

- https://github.com/androidx/media/blob/1.8.0/libraries/transformer/src/main/java/androidx/media3/transformer/VideoSampleExporter.java
- https://github.com/androidx/media/blob/1.8.0/libraries/transformer/src/main/java/androidx/media3/transformer/DefaultEncoderFactory.java

相册动态照片播放路径、缩略预览或手机视频解码能力均是待验证的可能因素，不是确认的一加缺陷。电脑播放与手机播放的视觉差异本身不足以区分这些因素。

## 已执行的本地文件核对

只读核对本机游戏媒体，不修改游戏、用户默认配置或远程测试者设备。此处是本机控制样本，不代表测试者原文件。

- 本机 8 个游戏 MP4：均为 H.264 / 3840×2160，约 23 或 30 fps，视频码率约 10.7–78.6 Mbps。
- 对其中 75,697,325 字节样本，实际运行当前 `MotionContainer` 的 Oplus writer 和独立 verifier，从成品提取嵌入的 MP4。
- 原视频和提取视频 SHA-256 均为 `e5dedb5eefb2acb11a98380c0961ed02f6e7e6c837cf758007bb007aaf5bc475`。
- ffprobe：H.264、3840×2160、标称 30 fps、232 帧、7.700000 秒、78,643,394 bps，与源文件一致。
- JPEG 从 SOS 到 EOI 的压缩图像数据一致；输入 JPEG/MP4 的前后哈希一致。
- 证据：工作区 `out/live-quality-4k-20261011-b/quality-report.json`。输出媒体含本机玩家内容，仅留本机被忽略的 out，不分发、不提交。

工具 `tools/livephoto/VerifyUnrotatedQuality.java` 可重复进行容器层核对。它要求传入从 ffprobe 读取的实际视频样本 PTS、帧序号、帧数和时长，不猜 30 fps。该控制测试使用第 0 个样本的 PTS，只验证封装保真，不声称经过 Android 封面匹配、厂商 EXIF 写入、MediaStore 或原生相册验收。这个工具的成品不能作为相册适配成功样本。

## 新增同机对照入口

LIVE 照片的预览 → 详情新增“保存原视频”，沿用现有玻璃按钮和界面：

- 保存完整源 MP4 到 `Movies/NikkiSync`，保持电脑视频的原始方向，不应用预览旋转；不编码、不裁剪、不修改帧率。
- 继续使用现有签名 HTTPS / pinned TLS 资源接口，不新增网络协议、服务器或权限。
- 显示下载与核对进度；校对资源记录、响应 SHA-256 和字节长度，再读回实际相册文件检查哈希。
- 仅全部校验通过后清除 `IS_PENDING`；下载损坏、截断、相册写入改变、发布失败和中断会撤销本次新增视频。
- 不将这个独立视频登记成“已保存 LIVE”，不覆盖旧照片、不改变照片方向或 LIVE 格式。

测试者覆盖安装后，用同一照片、同一手机相册分别播放 LIVE 与“保存原视频”的独立 MP4：

1. MP4 清晰流畅、LIVE 模糊卡顿：优先调查该系统/相册的动态照片播放路径；需要取得原生 LIVE 对照及导出文件，不能假设修改一个私有标记即可解决。
2. 两者都卡顿：继续用另一播放器对比，调查该源视频的编码/码率/解码表现。
3. MP4 与电脑源文件哈希不一致：先排查下载与写入；新版会在发布前拒绝此结果。

保持原画质路径作为对照。未增加自动压缩、强制 1080p/30fps 或转码“兼容模式”。随后依据固定提交的公开 Oplus 实现补齐元数据和零填充布局，属于格式兼容修正，播放结果需要测试者复测。

## 验证与交付

- 新增真实预览 → 详情 → 原视频按钮回归，普通照片不出现该入口；未连接电脑时能正确阻止保存。
- 原视频保存 7 项测试：逐字节一致、测量进度与发布时机、网络损坏、截断、相册写入改变、缺失/变化哈希、发布失败与取消补偿。测试用 Robolectric MediaStore provider 和 HTTPS 字节流替身；不是实际手机网络/存储验收。
- 原视频、预览和既有 LIVE 容器的针对性测试共 15 项通过；完整 Android 199 项通过，0 failures / errors / skipped。
- mobile:validate 82 文件、便携包合约 6 项、git diff --check 通过。
- APK 为 `0.2.13-live-video` / versionCode 14，minSdk 33 / targetSdk 35，21,728,518 字节；SHA-256 `6052A0C50CAC8CE5994FCB7503F1E54588533170A8C50B61E8240DF0757B50DE`。
- APK v2 签名通过，与上一版的证书 SHA-256 一致，可保留配对与缓存覆盖安装。
- 便携目录 `release/NikkiSync-Portable-LiveVideo` 包含 `NikkiSync-PC.exe` 与用户要求的独立 `NikkiSync-Android.apk`。实际 EXE `--verify-package` 校验的内置 APK 与独立 APK 哈希一致，未启动后台或触及 AppData；报告在 `out/embedded-apk-wJpONT/report.json`。EXE SHA-256 为 `e6a257ba294808c4070f0b68f6be5b4c482eaa25dc50564d89440c3b8e858d73`，Windows 自动发现与之前功能保留。本轮 PC 端只随包更新 APK，测试者无需为这次手机对照替换正在工作的 PC 端。

没有连接测试者手机；该轮 ADB 无连接设备，未安装或操作用户手机。后续已收到“原视频正常、LIVE 卡顿”的同机对比反馈，但没有实况文件或机型播放验收；不能把新增对照入口称为已经修复 LIVE 播放。
