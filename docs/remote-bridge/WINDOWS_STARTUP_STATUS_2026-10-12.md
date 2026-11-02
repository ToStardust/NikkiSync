# Windows 启动等待与阶段耗时｜2026-10-12

用户先反馈 EXE 每次提示查找安装位置，后补充最近一次接近 100 秒。不能把问题仅当成文案，也不能把 HTTP 默认超时的巧合当成已确认的那次故障原因。

## 调查证据

- 本机正常 game-discovery.log：source=cached、checkedDirectories=1、elapsedMs=10，安装记录/快捷方式/固定磁盘线索均为 0。有效游戏位置已缓存，该次没有全盘重找。
- 实际缓存位置的只读组件验证：cached、1 个目录、3ms，没有启动 Windows 安装或游戏进程探针。
- 当前扫描组件只读扫描真实游戏相册：579 个资源、约 1.2GiB，5.765s，错误 0。分类累计 5.658s，稳定性检查 81ms。此测量使用 Node，不代表完整 Bun EXE 冷启动，也不能排除冷盘、安全软件或数据库的影响。
- WPF 原先使用 new HttpClient()，默认单次请求超时 100s，未显式绕过系统代理。ServiceProcessHost 在请求结束后才检查总超时，单次请求超时还会抛出取消异常并退出启动。回归测试复现这两个代码缺陷，未复现用户那次真实 100s。
- runtime 的在线字典/参数解析从后台启动，未被显式 await 为 UI 的前置下载。不能在无证据时归因网络解析。

## 修改

HttpHealthClient 的生产实例用 SocketsHttpHandler：UseProxy=false、AllowAutoRedirect=false、ConnectTimeout=500ms。每次 loopback 请求独立限时 1s，只等待响应头。连接失败或本次超时返回未就绪并重试；用户取消和总启动 deadline 继续传播。ServiceProcessHost 的原 2 分钟服务启动预算通过 linked token 打断正在等待的请求，保留 SERVICE_TIMEOUT、真实子进程退出码、输出隐私与关闭清理。

正常启动也保存 startup-timings.json，仅包含时间、构建标签、固定阶段/状态、非负有限数值。四个累计里程碑为 runtimeReadyMs、browserReadyMs、serviceReadyMs、dashboardReadyMs；相邻差值是该阶段耗时。仅在阶段切换、成功、失败或取消时写入一个覆盖文件，不新增后台轮询或常驻记录。重试清空上一次里程碑。无照片、路径、UID、地址、配对码、密钥或原始错误。

第 3 阶段从“自动查找游戏安装位置并读取相册”改为“正在同步相册并启动连接服务”。有效缓存仍会快速验证结构，失效时重找，手动选择仍是备选；没有清空或重置真实用户配置。相册索引用于发现关闭软件期间的增删，与重找安装或重新展开环境不同。

## 验证

实现前 focused tests：请求超时未重试、总超时不能打断请求，2 项失败、用户取消 1 项通过。新增限时/耗时记录 API 的测试在实现前编译失败。最终完整 Windows 42/42、portable contracts 6/6、git diff --check 通过。NuGet 漏洞索引网络不可达警告不影响已缓存依赖的测试/构建，不声称完成在线依赖安全扫描。

最终实际单 EXE 移至游戏目录外，用独立 LOCALAPPDATA、运行环境缓存与 loopback 端口，读取现有游戏路径缓存和真实相册；网络解析关闭，mDNS 关闭。两次均完成 DOM 就绪并撤掉加载遮罩，索引 224 个 ready 资产，实际缓存 source=cached：

| 累计里程碑 | 隔离数据首次启动 | 同一隔离数据再次启动 |
| --- | ---: | ---: |
| runtimeReadyMs | 983.72ms | 450.93ms |
| browserReadyMs | 1326.47ms | 782.66ms |
| serviceReadyMs | 9993.24ms | 9324.89ms |
| dashboardReadyMs | 10092.24ms | 9443.79ms |
| 游戏缓存位置校验 | 8ms | 9ms |

运行环境文件 SHA-256/mtime 均未在第二次被重写；另外实际占用端口启动保留 PORT_IN_USE / exitCode=1。成功耗时文件状态为 ready；真实用户 game-install-root.txt 字节保持不变，未触碰真实数据库、配对或正在运行的实例。测试私有数据按检查后的测试范围清理，不公开个人相册/数据库。

报告：out/startup-fix-R8oP5H/report.json。构建：out/portable-build-6861671ca8b244139fa47d9a9e790cad/build-report.json。实际嵌入 APK：out/embedded-apk-6fbnpZ/report.json。

这组数据未复现 100s，线上解析关闭且使用独立数据库，不能保证真实配置/冷盘或其他机器耗时一致。已确认修复的是请求可能长期阻塞、总预算失效和错误文案；若真实启动再次异常，比较 game-discovery.log 与 startup-timings.json 即可定位安装发现或后续阶段。没有把上述机制修复冒充用户故障已验收。

## 交付

release/NikkiSync-Portable-StartupHealth/NikkiSync-PC.exe：SHA-256 27cb49e0d4f1ecf9e71b804a696460043d67b7e5a7ec2053088768e8f548948b。

APK 保持 0.2.17-details-viewport / versionCode 18，内嵌文件 SHA-256 与原签名包一致：48705b16d5f99f0ea105a1c6136b34985a557a5e717fd1e8f464b0a9a7d390fd。未改 Android 功能或重新编译 APK，未安装手机，未新建公开二进制 Release。此前 StartupStatus 包只改标签，不作为本次性能修复交付。

复验命令：

```powershell
dotnet test apps/windows-shell.Tests/NikkiSync.WindowsShell.Tests.csproj --no-restore
node --test --test-isolation=none tools/portable-package.test.mjs
node tools/windows-performance/verify-embedded-apk.mjs release/NikkiSync-Portable-StartupHealth
node tools/windows-performance/verify-startup-fix.mjs release/NikkiSync-Portable-StartupHealth --cached-library
```

验证工具默认指向新版 StartupHealth；不加 --cached-library 则使用空的模拟安装标记，不作为真实游戏相册证据。
