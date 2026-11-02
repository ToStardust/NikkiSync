# Android 玻璃 UI 恢复

**已被后续纠正取代。** 下文记录的是 0.2.2-glass 的临时 CPU 采样方案，没有接回真正的旧版 UI/手势，并造成用户反馈的低刷新率。当前 0.2.3-ui-recovered 已移除该方案，从另一工作区恢复 7e63720 的 GPU Chrome 和全屏查看器。当前事实见 [ANDROID_UI_BASE_RECOVERY_2026-10-08.md](ANDROID_UI_BASE_RECOVERY_2026-10-08.md)，不得再按下文的 80ms 采样实现交付。

用户 2026-10-08 明确更正：App 保留原来的液态玻璃卡片、控件和顶部模糊，仅保留当前粉色渐变背景；不能继续套用 EXE / 小程序的平面浅粉 UI。

本次改动：
- 恢复顶部圆角玻璃容器、版本组玻璃卡片、原字号/文字颜色、玻璃按钮、底部“图库 / 已保存 / 我的”导航、原选择框材质。保留尺寸自适应的方形照片修复。
- 背景继续使用 bg_gallery_ambient 的粉色/桃色/奶油渐变。
- GalleryGlassBackdrop 为每个窗口共享 1/6 尺寸的照片层采样，排除文字和玻璃面本身；照片可滚到悬浮导航后方，玻璃显示模糊后的对应区域。GalleryTopBlur 复用已有 GalleryGlassGeometry 渐隐，先模糊再遮罩，底部彻底透明。
- 照片/布局不变时不再采样；滚动时限制到最多每 80ms 一次，并安排一次尾帧刷新，不设常驻动画循环。系统相册硬件 Bitmap 使用有界 8MiB 软件副本缓存；采样异常则退回透明材质，避免 UI 崩溃。窗口关闭释放采样和缓存。
- 使用系统栏 inset，保留状态栏/底部手势区域；粉色渐变不覆盖文字。
- 照片详情、已保存/修图详情、分享预览及灵感库控件使用同一玻璃材质；分享 PNG 绘制器、分页、参数字段及 Live 封装链路保持不变。

测试：
- 先 RED：缺少玻璃采样实现；之后新增采样失败回退测试也先观察失败再修复。
- Android 全量 testDebugUnitTest 70/70 PASS，包含透明材质、照片层不采入 UI、顶部透明边、无变化时停采样、错误回退、原图库尺寸与分享图/Live 回归。
- mobile:validate PASS（57 个 required 文件）；ui-theme 4/4 PASS。跨端主题测试明确保留 Android 原文字/玻璃 UI 的例外，背景与品牌仍按批准配置。
- stageDebugApk 构建完成，apksigner v2 signature PASS。
- APK：release/NikkiSync/NikkiSync-Android.apk，versionCode 3 / versionName 0.2.2-glass。
- ADB install -r 返回 Success，手机查询确认版本，MainActivity 冷启动 Status: ok，窗口焦点为 NikkiSync。
- 已在本地查看手机首页截图：粉色渐变、玻璃卡片/按钮/导航与系统栏显示正常；当前电脑不可达，图库为空。因此此次没有“真实照片滚动模糊 / 详情面板动态效果 / FPS”实机通过结论，相关采样行为目前只有测试证据。

未修改 EXE、小程序、游戏资源、配对数据或原照片；未卸载/清空手机应用数据。当前修改仍在已有工作区，未提交或推送。
