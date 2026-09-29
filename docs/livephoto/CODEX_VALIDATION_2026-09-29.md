# M3 Live Photo 本机验证记录（2026-09-29）

范围仅为 Draft PR #9 的 Live/Motion Photo。工作分支 `feature/m3-livephoto-compat-rotation`，接手基线 `b1de1b8edb8eec99815f104eab0820d2b3afdead`；没有从 `main` 或旧本机目录重建。本记录对应基线加本次 Live 修复，具体交付提交以分支最新 HEAD 为准。没有安装到设备、上传照片或合并 PR。

## 工具链与实际结果

- Windows，Node `v24.16.0` / npm `11.13.0`；本机 JDK 17、Android SDK 35 / Build Tools 35、Gradle wrapper 8.13、ffmpeg 8.1.1、Python 3.12 + Pillow 12.3，未另行下载 Android 工具链。
- `npm ci`：通过，38 个包；`npm run typecheck`：通过；`npm test`：79/79 通过；`npm run mobile:validate`：通过，51 个文件。
- `node apps/mobile/scripts/test-livephoto-core.mjs`：92 项纯 Java 行为检查通过；`java tools/livephoto/JavaSyntaxCheck.java`：81 个 Java 源文件语法解析通过。这两项不能替代 Android 编译/设备验收。
- `python tools/livephoto/generate-fixtures.py`：生成非私人四色角 JPEG 与带音轨 MP4；`ffprobe -count_frames`：H.264 320×180、24 帧、1.000 秒；AAC 音轨、1.000 秒。生成的二进制仅用于本地测试，不纳入 Git。
- `gradlew.bat testDebugUnitTest assembleDebug assembleDebugAndroidTest` 首次在 AAR metadata 失败：`androidx.activity:activity:1.13.0` 要求 SDK 36 / 较新 AGP，与分支固定的 SDK 35 / AGP 8.7.3 不兼容。最小修复为 Activity 1.10.1，并同步源契约断言；没有升级整套 SDK/AGP/Media3。修复后 `assembleDebug assembleDebugAndroidTest` 通过，是真实 Android 类型检查和 APK 构建。
- 完整 `gradlew.bat testDebugUnitTest`：47 项中 45 通过、2 失败；失败均在非 Live 的 `EditedMediaAccessTest`，因该测试直接调用未由 Robolectric runner 提供实现的 `android.net.Uri.parse`。遵守本次边界，未修改这组业务/测试，也不把完整套件记为通过。报告在 `apps/mobile/app/build/reports/tests/testDebugUnitTest/index.html`。
- 聚焦 `gradlew.bat testDebugUnitTest --tests 'app.nikkisync.mobile.media.live.*' --tests 'app.nikkisync.mobile.storage.SavedLivePhotoRecordTest'`：11/11 通过（Live 核心 1、发布 journal 7、双文件记录 3）。
- `adb devices -l`：无设备。因此 `connectedDebugAndroidTest` **未执行**，四方向真实像素、编码器视频方向/帧数/音轨/时长、用户设备上的相册播放及进程杀死恢复均**未验证**。APK 构建成功不等于这些通过。

## 本次 Live 专项修改

1. 为 SDK 35 构建修正 AndroidX Activity 版本；这是运行 Live 仪器测试的直接构建前提。Photo Picker 源契约不变。
2. 增加 `LivePublishJournal`：在每个 MediaStore 插入之前持久化不可预测的文件名/路径意图，插入后立即持久化 URI；已发布但未写入 Saved record 的事务在下次启动恢复。只查找本应用拥有、名称和路径精确匹配的资源；有持久 Saved record 的主 URI 不删除。处理中的删除失败会保留收据以供下次重试。
3. Live exporter 与 `MainActivity.saveSelected()` 接通 journal；保存记录成功后才清除收据。`SavedPhotoStore.containsDurableUri()` 对损坏的记录拒绝据此删除相册媒体。单元测试覆盖第二项创建失败、发布失败、插入与 URI 回执之间进程死亡的模拟、记录成功但收据未清、删除失败后重试、损坏记录、同名歧义时拒绝删除。

这些是 JVM/模拟层证据。真正的 MediaStore 待发布条目查询、OEM 实现差异与进程杀死时序仍需获授权设备测试；跨图片和视频两个 collection 仍不是系统级原子事务。Android 官方将 `IS_PENDING` 定义为插入中的媒体，并提供包含 pending 项的查询方式；实际设备表现必须再验证：<https://developer.android.com/reference/android/provider/MediaStore>、<https://developer.android.com/reference/android/provider/MediaStore.MediaColumns>。

## 产物（本分支源代码构建，未安装）

| 文件 | 字节 | SHA-256 |
|---|---:|---|
| `apps/mobile/app/build/outputs/apk/debug/app-debug.apk` | 14,806,755 | `40D3CCE7282E7DA724286C2A05E32EDE1E64B14FE60F3A135E83895DDB0B7E95` |
| `apps/mobile/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk` | 830,501 | `80C0A38F062C5B56AABB3BDCF8B743F9D15B3D7617601AE8BEC1C94ACE809465` |

## 未完成的设备/厂商验收

在用户明确授权指定设备安装两个调试 APK 后，按 `DEVICE_ACCEPTANCE.md` 先跑 `LivePhotoRotationInstrumentedTest`：原方向 0 与 EXIF/video 90 各测 0/90/180/270，核对四角色块、像素宽高、视频 rotation=0、24 帧、AAC 与 1 秒时长、源文件不变。再做 MediaStore 插入/发布/记录之间杀进程与重启重试，以及系统相册完整播放、音画同步、持久化。每个品牌/型号/地区/系统/相册版本独立记录。

小米历史成功设备尚未用新路径回归；Oplus、vivo 新单文件、三星新版、华为旧尾标仍为未认证格式候选。荣耀官方 MediaData Kit 未接入，原生 HarmonyOS 不在此 Android APK 内。PR #9 应保持 Draft，不能据此发布全机型兼容结论。
