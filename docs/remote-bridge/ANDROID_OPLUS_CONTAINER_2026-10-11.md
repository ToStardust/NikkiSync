# Ace 2V LIVE 对照结果与 Oplus 容器修正

工作分支：`feature/remote-bridge-foundation`，修改基线 `fe3e706`。反馈对象是远程测试者的一加 Ace 2V，未旋转；用户按照上一轮同机对照请求反馈“原视频正常、LIVE 卡顿”。这支持继续调查 LIVE 格式与相册播放路径，不能证明视频解码能力不足，也不能据此认定某个字段是卡顿原因。

## 格式依据与实际修改

公开逆向实现 [oppo-live-photo-maker 的固定版本 muxer](https://github.com/Young-Spark/oppo-live-photo-maker/blob/3d020598789e8eebb0fa042b993ea03e4d21c2f9/src/oppo_live_photo/muxer.py#L175) 给出了 `MotionPhotoPrimaryPresentationTimestampUs` 和显式零填充媒体目录。其许可证为 [MIT](https://github.com/Young-Spark/oppo-live-photo-maker/blob/3d020598789e8eebb0fa042b993ea03e4d21c2f9/LICENSE)，查阅日期 2026-10-11。这是公开格式参考，非 Oplus 官方规范；其 README 的测试机为 Find X7 Ultra / ColorOS 14，不能作为 Ace 2V 验收。代码仍在 NikkiSync 原有 writer/verifier 中实现，没有增加外部工具或 SDK。

- 仅 `oplus_olive` 补 `OpCamera:MotionPhotoPrimaryPresentationTimestampUs`，与 Google 字段使用同一个实际封面 sample PTS，不硬写 0 或猜帧率。
- Oplus Primary 项显式 `Length=0, Padding=0`，MotionPhoto 项显式 `Length=完整视频字节数, Padding=0`。
- Oplus 导出副本去除 JPEG EOI 后的旧尾数据，使完整 MP4 紧接 EOI。保留 JPEG 的 EXIF、ICC、非动态 XMP 和压缩图像数据；源文件与独立参数快照不变。其他 profile 仍保留原有尾数据并计入 padding。
- 独立 verifier 增加私有时间戳/视频长度一致性、重复/缺失字段、目录零字段、物理 EOI 起点和最终 MPF 长度校验。完整 MP4 仍逐字节核对。
- 当前 APK 无旋转时不转码、不降清晰度、不截短、不改帧率/音轨。非零旋转路径未修改。

保留 0.2.13 的“详情 → 保存原视频”对照入口及原来的配对、玻璃 UI、手势、缓存。PC 自动发现保持现有实现。

## 验证记录

- 先加入行为回归再运行：旧实现因 Oplus 私有封面时间戳缺失失败，预期 500000、实际空。
- 修正后公共 LIVE core 108 项检查通过，覆盖所有 profile；新增带尾 JPEG、压缩像素/源文件/完整视频不变，以及时间戳缺失、冲突、重复、私有长度错误、目录错误和夹入尾数据的拒绝。
- 实际本机 4K 样本复核 `out/live-quality-oplus-20261011/quality-report.json`：源 JPEG 尾数据 860 字节，成品视频间隙 0、padding 0；原视频/提取视频均为 75,697,325 字节，SHA-256 `e5dedb5eefb2acb11a98380c0961ed02f6e7e6c837cf758007bb007aaf5bc475`。JPEG 压缩图像和原文件哈希未变。样本仅留本机忽略目录，没有提交/上传。
- 这次本机工具只验证容器层，不包含 Android 厂商 EXIF 写入、实际 MediaStore 或相册播放；也不是测试者文件。
- 完整 Android 回归 199 项通过，0 failures / errors / skipped；公共 core 108 项作为其中一个 JUnit 测试运行。mobile:validate 82 文件、便携包合约 6 项、git diff --check 通过。
- APK `0.2.14-oplus-container` / versionCode 15，minSdk 33 / targetSdk 35，21,729,994 字节，SHA-256 `9D6BCA0B81C720A4EF064DE0FE1DD3509EA288FABF1F43900A85C5619E9B22AC`。v2 签名通过，签名证书与 0.2.13 相同，可保留配对/缓存覆盖安装。
- 匹配便携目录 `release/NikkiSync-Portable-OplusContainer` 内有单文件 `NikkiSync-PC.exe` 与独立 `NikkiSync-Android.apk`；EXE 为 120,563,602 字节，SHA-256 `9BC9CB4C8D930F34716C87381F97E556F85B1F4C3AFE3E33505765555AC37375`。实际 EXE 的 `--verify-package` 验证内嵌 APK 与独立 APK 完全一致，证据 `out/embedded-apk-R3WQfi/report.json`；没有启动后台或读取用户 AppData。PC 功能没有改动，此次手机复测无需替换已正常工作的电脑端。

## 测试者复测方式与缺失证据

覆盖安装新 APK，然后将**同一张照片重新保存为 LIVE**，在 Ace 2V 自带相册播放新文件，并与已有“保存原视频”对照。旧文件不会因更新 APK 自动改变。仍卡顿时需要记录 ColorOS 完整版本、系统相册版本、手机相机原生 LIVE 是否流畅，再比较获授权的非私人原生/导出 LIVE 文件；目前这些证据缺失。

容器修正已经完成，**Ace 2V 的清晰度/流畅度验收仍未完成**。不把字段对齐、JVM 测试或本机 4K 文件一致性称为该手机已修复。
