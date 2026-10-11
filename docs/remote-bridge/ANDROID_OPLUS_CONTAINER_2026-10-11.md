# Ace 2V LIVE 对照结果与 Oplus 容器修正

工作分支：`feature/remote-bridge-foundation`，修改基线 `fe3e706`。反馈对象是远程测试者的一加 Ace 2V，未旋转；用户按照上一轮同机对照请求反馈“原视频正常、LIVE 卡顿”。这支持继续调查 LIVE 格式与相册播放路径，不能证明视频解码能力不足，也不能据此认定某个字段是卡顿原因。

## 远程复测反馈（2026-10-11）

用户随后提供系统 `16.0.5`、相册 `16.50.8`，并在新版交付后转述：“修改后那个用户的 live 照片就不会卡了”，明确要求将该 APK 打包入 EXE 并允许公开上传。版本字符串按原话记录，没有据此推断完整构建号、Android API、地区版、相册包名或版本码。

本次可记录为这位 Ace 2V 测试者的**未旋转 LIVE 流畅度回归通过（用户转述）**。没有独立的清晰度改善、音轨、重新索引/重启、90/180/270 度或其他机型结果；手机相机原生 LIVE 对照也未提供。不能确认到底是哪一项字段/布局变更起了作用。

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

## 交付与剩余验证

公开交付目录 `release/NikkiSync-0.2.14-Public` 包含单文件 EXE、同版独立 APK 和 `SHA256SUMS.txt`。程序内容与已测试的 OplusContainer 包相同，没有重编译/变更版本；再次通过实际 EXE 提取校验，报告 `out/embedded-apk-p6XUg2/report.json`。公开发布说明见 [v0.2.14](../releases/v0.2.14.md)。

更新旧版本后需要**重新保存 LIVE**，旧导出文件不会自动改变。本次该测试者的卡顿反馈已解除；清晰度和其他播放/旋转条件仍待分别验证，不把单个流畅度反馈扩展为所有 Oplus 设备完整适配。
