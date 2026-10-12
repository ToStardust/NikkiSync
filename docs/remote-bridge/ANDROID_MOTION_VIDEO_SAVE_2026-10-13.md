# 动态照片保存选择与旋转视频｜2026-10-13

用户要求：动态照片预览旋转后，保存视频应采用旋转后的方向；点击保存先选择“实况照片”或“视频”。此前详情页“保存原视频”专用于 Ace 2V 的同机画质对照，因此明确忽略预览角度。现在统一用户入口，保留零角度无编码导出作为可用的原视频路径。

## 实现

- 动态照片预览的保存，以及含动态照片的多选保存，打开现有 ChromeSheetLayout 的紧凑液态玻璃底部选项：实况照片、视频、取消。复用 ChromeNavigationHost 的返回/关闭与 GPU 背景，不新增原生白色大弹框。
- 实况照片继续走现有 LivePhotoExporter 和用户选择的厂商格式；视频调用 MotionVideoSaver。混选时，普通图片仍沿原图路径保存。取消仅关闭选项，保留照片预览，不开始下载。
- 开始保存时在 UI 线程固定客户端、照片列表、每个 asset 的旋转角度和 LIVE 格式，后台不读取可能继续变化的旋转 Map。保存后保持预览方向，与后续分享图一致。
- 视频只下载 source_motion，不下载 JPEG。0° 委托 OriginalVideoSaver 原有流式原字节、长度、SHA-256 和相册读回验证路径。
- 非零角度先流式下载到本次私有缓存目录，核对电脑资源记录、响应 SHA-256 和实际长度，再调用 LivePhotoRotation.rotateVideoOnly。新方法复用现有 PixelRotation/Media3 1.8.0 的后台 Looper、编码器停止确认与 VideoFacts 校验：目标全分辨率、角度实际写入画面、帧数/时间轴/时长/音轨符合原视频。拒绝不支持的 HDR/色域和编码器降级。
- 从旋转输出文件发布独立 video/mp4 到 Movies/NikkiSync，不从 source.mp4 再次复制。文件名含 rotated_角度，避免误以为仍是原视频。下载、旋转、相册写入和核对都有进度。
- 新视频先 IS_PENDING=1；流式写入并读回核对长度/SHA-256 后才发布。下载损坏、编码失败、取消、相册校验或发布失败均不报告完成，并撤销本次新建条目。只有编码器确认停止才清理私有工作目录，避免在活跃写入时删除文件。
- 独立视频不写 SavedPhotoStore 的图片/LIVE 记录，不把“保存为视频”误判为“实况照片已保存”。普通图片和实况记录仍保留原来的记录与参数缓存刷新。

非零角度沿用现有 H.264 物理旋转编码与默认编码器码率，不承诺编码无损；没有新增强制分辨率、帧率或剪辑。0° 原字节保存不变，Ace 2V 已反馈通过的 Oplus 容器写法没有改动。真实设备的旋转后编码/相册播放需另行验收，不能用 JVM 中的替身当作播放成功。

## 验证

先新增回归，观察到编译失败明确缺少 MotionVideoSaver 实现，再实现该路径。针对性测试通过后运行完整回归：

- Android testDebugUnitTest：223 tests，0 failures/errors/skipped。
- MainViewerEntryTest：LIVE 保存双选项、取消保留预览、视频/实况未连接时反馈、普通图片不显示视频选择，以及混选统一入口。
- OriginalVideoSaverTest：原有完整下载/写入补偿 7 项，以及新视频路径 7 项：0° 不调用编码器，90°/180°/270° 发布替身的旋转结果而非源字节，损坏源不进入编码，编码失败清理缓存，相册读回损坏撤销。新测试使用合成字节、HTTPS 和 MediaStore 替身，不是真实 MP4 编码或手机网络验收。
- 新增两个真实设备 instrumented 方法：独立视频四方向，以及源文件已有旋转标签时仅应用一次。核对四色角实际像素、分辨率、帧数/音轨/时长、源文件不变；compileDebugAndroidTestJavaWithJavac 成功，未在手机运行。样本仍由 tools/livephoto/generate-fixtures.py 生成，不能用私人物料。
- mobile source contracts：82；portable contracts：6；theme：4；git diff --check 通过。
- assembleDebug / stageDebugApk 成功，APK 签名通过且证书与旧版相同，minSdk 33 / targetSdk 35。

构建命令（本机 JDK/SDK 路径不属于产品配置）：

```powershell
cd apps/mobile
./gradlew.bat --offline --no-daemon :app:testDebugUnitTest :app:assembleDebug :app:stageDebugApk :app:compileDebugAndroidTestJavaWithJavac
```

版本：0.2.18-motion-video / versionCode 19。

APK SHA-256：ccbee0028328015ad3cfc3319ba9c3288cb442487d56fc16c47ddd37a557c332。

签名证书 SHA-256：89e768c8947e48a0e6d5471888a264daafd99685ea22e290fc3adca71f5d61cb。

交付目录：release/NikkiSync-Portable-MotionVideo，包含新版单 EXE 和独立 NikkiSync-0.2.18-Android.apk。PC 行为保留前轮启动检查短超时、缓存与安全诊断；小程序 LIVE 仍搁置，本轮没有修改它。

实际单 EXE 的 --verify-package 校验通过，解出的 APK 与独立 0.2.18 包的 SHA-256 完全一致。报告：out/embedded-apk-w3as9C/report.json；构建：out/portable-build-7d380c105ec448c186915308406352df/build-report.json。EXE SHA-256：904442b3a4306c85640abe9d64d4eef1e0f57ba51fc2d4d393310824b3a36d38。嵌入验证未启动后台或修改用户 AppData。

未安装或操作手机，未创建新的公开二进制 Release。代码按已授权的开源源码同步范围提交与推送；二进制和本机诊断产物不进源码仓库。
