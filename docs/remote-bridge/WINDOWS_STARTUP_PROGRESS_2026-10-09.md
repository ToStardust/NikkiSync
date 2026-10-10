# Windows 启动加载与每日自启动缓存

用户要求：解压后的长时间黑屏也有进度显示；确认完整单 EXE 每日自启动是否重复展开环境。

## 交付

`release/NikkiSync-Portable/NikkiSync-PC.exe` 已更新，目录仍仅此一个文件。新版测试前从旧版托盘退出，再打开此文件，避免单实例机制唤醒旧版。

- EXE：118,608,274 字节，SHA-256 `04C468FFAE3149F620FFE0E4775414EF4B0A869BD8B38DBEC2682D863E08DFAF`。
- 内置 APK 保持 Android 0.2.7-photo-return，SHA-256 `9200A6445BE526951A7C2F8754699DF97C3132AABC3A1274A1F9197FFA97325F`；实际展开文件与现有发布 APK 完全一致。
- 后台服务字节保持上一轮已验收版本，SHA-256 `969760B5DC4C0450BC39EEFC6FF71665F3A76EB14E778D7B4471CBF9CE330ED1`。
- 最终报告 `out/startup-progress-delivery-report.json`。本轮 staging 的初次 build-report 早于高清加载图及诊断隔离修正，最终文件哈希以交付报告为准。

## 加载界面

暖粉渐变、高清大喵品牌图、进度条和等待秒数贯穿四个阶段：检查/准备运行文件、初始化显示组件、启动服务/检查相册、打开电脑主页。解压使用按文件字节计算的真实进度；无法测量完成比例的后续阶段使用动态进度条，不伪造扫描百分比。

标准 WPF WebView2 的原生 HWND 会覆盖 WPF 同级覆盖层，调整 Z-index 不能可靠解决。初始 WebView 保持 Collapsed，窗口恢复也受 StartupPageGate 限制。仅在预期本地主页导航成功、DOM 完整且存在实际 dashboard 标题节点后显示浏览器并关闭加载层；about:blank、其他端口或页面不能提前结束加载。页面加载失败/超时进入错误界面。隐藏 WebView 时不等待 requestAnimationFrame，避免后台/最小化启动永远等不到帧回调。

等待计时器仅在加载过程中每秒刷新一次，成功、失败或退出时停止。后台 WebView 暂停/恢复、同源导航/消息限制、托盘关闭与显式退出保留。

## 每日自启动

同一个包、同一 Windows 用户、缓存完好时，每天复用 `%LOCALAPPDATA%\NikkiSync\portable-runtime\<payload SHA256>`。启动检查现有文件长度与 SHA-256，校验通过直接使用，既不重新解压也不重写服务/APK。运行文件更新导致 payload 哈希改变、缓存删除或损坏时才重新准备；仅桌面壳改动且内置 payload 相同时仍可复用业务缓存。

.NET 原生依赖另有 `%TEMP%\.net` 缓存，正常也复用；系统/清理工具删除它后，下次会重新展开这一部分。单文件中压缩的托管程序集每次启动仍须解压到内存，这是进程初始化，不是将整个业务环境重新写入磁盘。原生宿主加载发生在 WPF 窗口创建前，当前加载 UI 从窗口创建后开始显示。

相册索引、配对资料和浏览器资料独立保存在用户目录。每次启动仍会启动服务并检查素材变化；这解释了有缓存后仍需等待，不代表重复展开。当前开机启动走同一个普通 EXE 入口，因此采用同一缓存策略；本轮未改注册表自启动项，也未做 Windows 重新登录实测。

## 验证与耗时边界

先写失败测试并确认 RED，再实现 GREEN。Windows 全量 26/26、打包/接线 5/5 PASS；git diff --check PASS。NuGet 漏洞信息查询有既有 NU1900 网络警告，不视为依赖安全审计通过。

最终单 EXE 用 `tools/windows-performance/verify-portable-startup.mjs` 实际启动两次，走真实 MainWindow、WebView2、服务、相册检查、主页导航与正常退出。使用只读打开正式库后生成的私密测试副本、独立回环端口和缓存，关闭在线元数据解析、两种远程字典及 mDNS。Windows 特殊目录 API 不服从 LOCALAPPDATA 环境覆盖，因此诊断 WebView profile 显式放入私密目录。未激活用户已有进程、写正式库、上传照片或操作手机。

| 项目 | 首次/全新测试缓存 | 第二次/复用同一缓存 |
| --- | ---: | ---: |
| 从窗口加载至运行文件就绪 | 0.956 秒 | 0.432 秒 |
| 显示组件初始化阶段 | 0.369 秒 | 0.326 秒 |
| 服务启动及相册检查阶段 | 8.839 秒 | 8.671 秒 |
| 主页加载阶段 | 0.095 秒 | 0.083 秒 |
| 从窗口加载至主页就绪 | 10.260 秒 | 9.512 秒 |
| 测试进程总时间（包括原生宿主初始化和正常退出） | 12.981 秒 | 11.008 秒 |

业务运行文件与 .NET 原生缓存均逐文件检查长度、SHA-256 和修改时间，第二次全部相同，未重新展开/重写。真实后台启动已被这次主页验收覆盖；后台 API 功能沿用此前同哈希版本的验收，未重复声称新的手机或跨机型验收。

证据：`out/portable-startup-ynilSc/report.json`、`out/portable-startup-ynilSc/startup-verification.json`。截图 `out/portable-startup-ynilSc/startup-screen.png` 是真实启动期间 WPF 加载层的离屏渲染，含动态进度条；不是手绘效果图或原生 HWND 的整屏截图。诊断数据库/浏览器资料测试结束后已清除，测试缓存与报告仅在 out，不进入分发包。

上述时间只代表开发机本次隔离验收，线上解析、其他素材规模、新 Windows 和其他磁盘会有差异；没有声称完成实际开机启动或所有电脑流畅度验收。

分支 `feature/remote-bridge-foundation`，HEAD `2466e60b3d43a707851915ce9f4ee67627a06338`；构建包含当前未提交工作树，不仅是 HEAD。未 commit/push，未改安卓/小程序源码或继续小程序 LIVE。

依据：[Microsoft WPF WebView2 airspace](https://learn.microsoft.com/en-us/microsoft-edge/webview2/platforms/wpf)、[.NET 单文件原生缓存和托管压缩](https://learn.microsoft.com/en-us/dotnet/core/deploying/single-file/overview)。
