# Android 旋转照片返回裁切修复

用户截图：预览已旋转的照片，系统预测性返回时出现斜边加水平/垂直切口，照片被裁成多边形。当前整合工作树的 `PhotoViewerPage.SharedImage` 在变换 Canvas 前，用屏幕坐标插值矩形执行 `clipPath`，随后才旋转照片。静止的裁切框与旋转的照片不在同一坐标系，这是直接原因；本轮不回退到早期 UI 或渐隐返回。

## 修复

- 保留来源身份检查、来源中心到适屏中心的移动、缩放插值，以及图片到原缩略图的旋转动画。
- 裁切区域在图片自身坐标中插值：来源端是原 CENTER_CROP 区域，适屏端是完整图片。先平移/旋转/缩放 Canvas，再裁切，使四个圆角与照片一起旋转。
- 圆角半径除以当前缩放，保持既有屏幕视觉大小；未旋转照片的屏幕矩形及缩放行为保持一致。
- 来源已离屏/回收时保留兜底渐隐，但显示完整适屏照片并保持当前角度，不再向一个无效来源方向转动并裁切。
- 未改玻璃卡片、顶部 GPU 模糊、粉色背景、双指缩放、下拉返回、LIVE/EXIF、分享图、缓存和旋转状态存储。不新增 CPU 截图或位图动画层。照片超出全屏 View 边界时仍受正常视口边界限制。

生产行为变化局限于 `PhotoViewerPage.SharedImage.onDraw`。APK 版本更新为 versionCode 12 / `0.2.11-rotation-return`。

## 测试

新增 `PhotoViewerRotationReturnTest`，Robolectric SDK 35 + native Skia 渲染实际 SharedImage Canvas，不只断言状态或源码顺序。旧实现先 RED：90°、reveal 0.25 的角落采样点 (249,524) 本应是照片颜色，却透明；来源离屏兜底测试也失败。修复后 GREEN。

- 横图/竖图各覆盖 0°/90°/180°/270°，reveal 0.25/0.5/0.75/1，逐帧采样四角，共 128 个像素检查。
- 返回取消后保持 270°，照片不透明且恢复完整预览；reveal 0 缩回来源缩略图，提交仅移除当前照片页。
- 来源离屏时完整旋转照片的四角保留，适屏区域之外透明。
- PhotoViewerPage 和 ChromeNavigationHost 既有详情、来源防串图、下拉/多指取消、翻页和缩放回归通过。
- Android 全量：185 tests，0 failures / errors / skipped；`:app:stageDebugApk` 完成。
- Mobile 源码合约：81 项 PASS；主题 4/4、单 EXE 打包接线 6/6 PASS。
- APK v2 签名校验 PASS，实际 aapt 版本查询为 12 / 0.2.11-rotation-return。
- 新单 EXE 实际 `--verify-package` 展开并核对内嵌 APK 与修复 APK SHA-256 相同；目录恰好一个 EXE，未触及用户 AppData。
- `git diff --check` PASS，保留既有 SDK XML / deprecated / CRLF 提示。

两次授权 ADB 查询均没有设备。本轮没有覆盖安装或实机系统手势/GPU 帧率验收；native Skia 单元测试不等于手机硬件验收。没有卸载、清除数据、重新配对或写入系统相册。

## 交付

APK：`release/NikkiSync/NikkiSync-Android.apk`，15,682,150 字节，SHA-256 `613523E0869E2D5AD062C4424DD20F5F0F2CA3BA6842CAC1107D172526F55854`。

单 EXE：`release/NikkiSync-Portable-RotationReturn/NikkiSync-PC.exe`，118,291,858 字节，SHA-256 `1BF8720CA4692590D8F49BBF95245D0A617B1CF00F148B7E89A381C05467694D`。保留 Windows 2026-10-10 首次启动/手动游戏目录选择/安全日志修复及 baseline --smol 后台，只更新内嵌 Android 包。

构建报告：`out/portable-build-7b98e9b9cd254cd291f725fd53687955/build-report.json`。实际内嵌 APK 验证：`out/embedded-apk-3b0qg8/report.json`，使用新增 `tools/windows-performance/verify-embedded-apk.mjs`。前版 APK 只备份在 out，没有删除既有可用 EXE。

分支/HEAD 仍为 `feature/remote-bridge-foundation` / `2466e60b3d43a707851915ce9f4ee67627a06338`。当前完整 dirty 工作树含先进 UI 和历轮修复，不可单独从旧 HEAD 构建。没有 commit/push。
