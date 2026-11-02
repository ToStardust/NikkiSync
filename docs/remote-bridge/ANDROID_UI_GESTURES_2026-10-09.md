# Android 详情重开、主页滑动和灵感库返回修复

本轮处理用户的四个 bug、主页左右滑动平移切换、底栏粉色遮罩及缓存容量评估。继续保留现有 GPU 液态玻璃、渐进顶部模糊、粉色背景、照片缩放/来源返回、LIVE、分享图、进度条及详情持久缓存。

## 修复内容

- 预览详情关闭后不能再次打开：旧 sheet 仍挂在已经移出导航树的 layer 中，getParent() 非空导致入口误判仍打开。现在由真实导航关闭回调清空同一 sheet 的引用，完成按钮绑定当次 sheet；完成按钮、预测性返回提交、外部点击关闭后都可再次打开。预测性取消保留当前详情。
- 多选边框圆角：复用原选中材质，圆角统一取照片的 gallery_cell_radius（14dp），与照片使用相同边界，开启相同轮廓裁切；不再使用选中 chip 的 18dp 圆角。
- 灵感库返回：从 MainActivity 打开 InspirationPage，推入现有 ChromeNavigationHost，返回进度平移露出原来的「我的」，取消恢复库页，提交只移除库页。保留主页面对象、滚动及 UID 状态。原 InspirationActivity 只作外部 Android 分享的入口，复用同一页面/表单；关闭后释放 GPU backdrop、关闭数据库并结束 IO 队列，不清库或配对。
- 新增分类：短表单明确使用 ChromeSheetLayout.wrapContentForm()，输入框约 52dp、清晰浅色填充/边框、主题文字及提示色；不再固定铺满 400dp。长记录表单和照片详情原有高度/拖动不受影响，键盘仍先预留 footer。
- 主页左右滑动：新增 HomeTabPager，直接平移原来的图库、已保存、我的三个页面，跟手拖动，松手提交或回弹。点击底栏也平移，alpha 始终为 1，没有截图或交叉渐变。保留列表、滚动与选择状态；垂直滑动、双指、取消、边缘系统返回、尺寸变化及快速切换均有回归。
- 处理 RecyclerView 停止惯性滚动时在 DOWN 提前要求禁止拦截的情况：先确认横/竖方向，明确的垂直、双指和系统边缘输入仍交给子视图；首次水平拦截即更新位移，不丢开始的一帧。
- 底栏删除主题色 Ripple foreground；移动指示器改成中性半透明白色细边，底栏玻璃继续由原 LiquidGlassDockView 采样。没有把 GPU 玻璃替换成粉色贴片。

记录灵感继续只有代码、分类、状态三个输入组，不添加标题或代码解析/散件缩略图功能；旧隐藏字段/原文与快照失效逻辑沿用前轮。

## 缓存评估

用户看到的 32MiB 是穿搭/参数 JSON 的详情内容预算，最多 5000 条，并非照片缩略图。原 UI 缩略图磁盘预算为 256MiB，分享图图标还有独立 32MiB 预算。详情仍保留 32MiB；缓存清理按钮仍明确清理可重读详情，不删除用户照片/灵感。

通过已授权手机 run-as + du 只读文件占用汇总，没有读取图片、个人元数据或密钥。当前 thumbnail-cache-v1 的 440 个 .img 文件共约 256.93MiB，平均分配空间 597.95KiB，P95 3216KiB、最大 6928KiB。这里包含照片及共享部件图标，不能声称是 440 张照片的纯样本。

按当前混合平均估算，600 个文件约 350.36MiB，因此提高缩略图磁盘预算到 512MiB 合理，给照片及部件缓存留下余量。单个高清预览文件可能数 MiB，512MiB 不保证任何 600 张照片永久全部保留，也没有将此估算当成纯照片实测。若以后需要严格保留固定张数，应另行设计缩略图压缩及预览分层，不能无条件扩大 RAM。

本轮只把 ImageLoader 的磁盘预算改为 512MiB，按需增长，超额仍按较早使用的文件淘汰；不预分配、不预下载整库、不新增常驻定时器。原位图 RAM 缓存仍为堆上限六分之一且最多 96MiB；显示解码仍限制最长边 1280。保存/分享高清原图走独立路径，原图质量不受本次预算调整影响。

## 测试与交付

先写测试复现 RED：33 项聚焦中 7 项失败，分别覆盖用户四个 bug、粉色按压层、横滑入口和缓存容量。另补列表停止惯性滚动吞横滑的 RED 后修复。实际可滚动测试内容、动态面板布局均正确建立，不把缺少布局的测试夹具当成产品 bug。

- 聚焦 UI、输入法布局、图片缓存回归 40 项 PASS。
- Android 全量 182 tests，0 failures/errors/skipped；包括现有照片来源动画、缩放、LIVE、分享图、缓存与保存功能。
- mobile source contract 81 文件 PASS，主题 4/4、单 EXE 接线 5/5 PASS；git diff --check PASS。
- APK：release/NikkiSync/NikkiSync-Android.apk，versionCode 11 / 0.2.10-ui-gestures，15,681,886 字节，v2 签名验证通过。
- APK SHA-256：0430F4F4AB6DBD103CBA1F82964663CE18C0808BFE8B3872E7DB2005A6339D4F。
- ADB install -r 输出 Success，已查询手机包版本一致。Xiaomi / Android 17；保留应用数据，未卸载、清库、重配对或写入系统相册。
- 手机检查时锁屏，本轮未执行真机触摸、输入法视觉或硬件帧率验收。自动化回归与安装成功不等于真机动画验收。
- 单 EXE：release/NikkiSync-Portable-UIGestures/NikkiSync-PC.exe，118,619,538 字节，目录只有一个文件。
- EXE SHA-256：3AD737BED6356E3C9E0A58124FF3D071EA50ECCE2BCB184539A9D48CDD1159FD。
- 实际 EXE --verify-package 隔离展开成功，内置 APK SHA 与本次 APK 相同；不访问个人数据库或启动正式同步。PC 壳逻辑未改，沿用启动进度与缓存复用。
- 报告：out/ui-gestures-delivery-report.json 与 out/portable-ui-gestures-verification/verification.json。

独立版本目录保留旧交付文件，不结束正在运行的 PC 程序；切换新 EXE 前从旧版托盘退出。构建来自 feature/remote-bridge-foundation / 2466e60b3d43a707851915ce9f4ee67627a06338 加整合后的未提交工作树；未修改小程序、PC 协议或游戏资源，未 commit/push。
