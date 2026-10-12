# Android 实际 UI 基线恢复｜2026-10-08

## 原因与来源

用户在 codex://threads/01a05e03-e4f5-77f2-8e60-af07f77761d2 指出玻璃低刷新率、预测性返回、缩放及下拉返回消失。已读取该对话并找到此前真实开发工作区：

- 源工作区：C:/Users/Stardust/Documents/NikkiSync_2026-09-22。
- 源提交：7e63720a56b9cbd4faf59e43d7b9724ea254952a。
- 0ae31dc：Photo-first full-screen viewer transitions；7e63720：gallery gestures and confirmed share previews。
- 前序 ee6e573 / 70037b4 / 1a73d20 / c43c813 等已实现 GPU 模糊、导航、底栏、顶部缩短及返回闪糊修复。
- 来源记录：docs/PHOTO_VIEWER_TRANSITION_2026-09-26.md、docs/PHOTO_VIEWER_GESTURES_SHARE_PREVIEW_2026-09-26.md、docs/UI_PARITY_ACCEPTANCE_2026-09-22.md。

当前 RemoteBridge 分支 HEAD 是较早的 2466e60，本轮之前的构建没有包含上述本地提交。0.2.2-glass 临时补的 GalleryGlassBackdrop 在 UI 线程做 1/6 位图 CPU 模糊，并限制每 80ms 一次，约 12.5 次/秒；这是用户观察到模糊滞后的明确原因。源码或测试通过不能当作此前 UI 已恢复。

## 当前工程中的恢复

- 接回 ui/chrome 原实现：ContentBackdrop、ChromeHost、ProgressiveTopBlurView、LiquidGlassDockView、PhotoLayoutDock、ChromeNavigationHost、ChromeSheetLayout、PhotoViewerPage 及相关辅助类。
- 顶部 Gaussian blur 用 RenderNode / RenderEffect，内容、效果、控件分层。取消 80ms CPU 采样，删除 GalleryGlassBackdrop / GalleryGlassSurface / GalleryTopBlur。大图显示沿用原版有界解码。
- 接回 68dp 底栏、图标与单行标题、210dp 顶部渐进遮罩，滚动/停止的模糊半径连续插值。
- 主页保留当前 bg_gallery_ambient 粉/桃/奶油渐变，不再对主页执行照片莫奈取色更新；全屏查看器沿用原版稳定深色背景。
- 图库、已保存、修图与搜索上下文使用同一全屏查看器：缩略图展开/缩回、双击/双指缩放、适屏左右切换、下拉提交与回弹；独立不变换的触摸层防止缩放反馈抖动。
- manifest enableOnBackInvokedCallback=true；接回系统预测性返回进度/取消、详情优先关闭和导航中断恢复。
- 详情白条拖动及外部关闭，已保存筛选弹层、紧凑版本/日期标题、玩家可读信息恢复原版行为。
- 接回原版 HTTP 可达性/实时连接分开判断以及握手回归，保留当前 NikkiSyncClient 的 EXIF 导出接口。

## 保留下来的新功能

不是整目录覆盖或回滚：旧工作区只读，PC、小程序及游戏文件未修改。

- 当前 ShareCardLayout / PayloadBuilder / Exporter / Preparation / ExportCoordinator / PreviewDialog：真实部件图片、两列名字、未知名隐藏、参数轨道、分页 PNG、先预览后显式保存、取消零相册写入、有界缓存保留。
- 当前 LIVE exporter、七个候选格式、旋转转码与配对资源、健康校验、厂商说明和设备测试信息保留；不沿用旧 MainActivity 的 legacy-only 厂商保存分支。
- 单张保存复用新 LIVE 保存流程，不清除无关批次选择；失败项保留。旋转控件与全屏适屏转换同步，共享一个状态，避免工具栏与详情各自累计角度。
- 原图/EXIF 设置、离线灵感库、Launcher 大喵图标、现有 Media3 依赖与 SDK35 工具链保留。
- 各厂商 LIVE 的原生相册兼容性仍需逐设备验收；这次是 UI 恢复，不增加机型认证。

## 验证与交付

- 先移植手势/导航测试，当前工程因缺失 Chrome 类观察到 RED。接入真实原实现后恢复测试。
- 旋转回调先看到旧图像角度的失败测试，调整执行顺序并统一工具栏/详情状态后通过。
- gradlew.bat --offline --no-daemon :app:testDebugUnitTest :app:stageDebugApk：BUILD SUCCESSFUL。
- JUnit XML 合计 129 tests / 0 failures / 0 errors / 0 skipped。涵盖原导航、缩放、下拉取消/提交、多指中断、预加载、详情拖动、模糊半径连续性、当前分享图和 LIVE 回归。JVM UI 测试不代替硬件帧率验收。
- mobile:validate：75 个 required 文件通过，新增必须实际接入导航/GPU 模糊/手势并保留 LIVE/EXIF 的门禁；ui-theme 4/4 通过；git diff --check 通过（既有行尾转换警告）。
- APK：release/NikkiSync/NikkiSync-Android.apk，versionCode 4 / versionName 0.2.3-ui-recovered。
- SHA-256：7A5503CC802D8BDDA2237479881C10CE76F42F653CE7A8434F270F07D16889DA；apksigner v2 verification PASS。
- ADB install -r：Success；设备查询版本一致；MainActivity 冷启动 Status ok。
- 真机检查开始时手机锁屏（Keyguard showing=true / inputRestricted=true），已请用户解锁。尚未记录本轮真实照片滑动、双指和预测性返回的实机通过结论，不宣称帧率已达到 60/120Hz。

### 0.2.4 首次看图闪退修复

0.2.3 的真机看图未通过：用户点击照片出现 NPE。AndroidRuntime 堆栈指向 cancelShareCardFrom(null) -> setShareCardBusy(null)，没有待生成任务时两个空按钮被当作同一个按钮。新增实际 MainActivity 看图入口回归先复现，再加 source == null 保护；原图、已保存及编辑版本入口全部覆盖。

- 0.2.4-viewer-fix / versionCode 5：全量 133 tests，0 failures/errors/skipped；APK SHA-256 D94C294EE48C4AD761F86AD5B579F3C3C21DE20013A4BC93891D0CE7C614D3D5。
- v2 签名验证通过，覆盖安装 Success。实机从图库点击照片打开全屏页并出现旋转/保存/分享/详情控件；新进程日志未出现 AndroidRuntime 崩溃。
- 尚未完成分享预览及双指/预测性手势/稳定帧率的实机验收，不能把静态截图或 JVM 测试当作这些项目通过。
- 后续分享性能、进度条及保存后方向一致性见 ANDROID_SHARE_PROGRESS_2026-10-08.md；交付版本以该文档为准。

改动保留在当前已有 dirty 工作区，未提交、推送、合并。未卸载、清空应用数据、重新配对或写入系统相册。之后打包必须从当前整合后的源码构建，不能只取此分支的旧 HEAD。
