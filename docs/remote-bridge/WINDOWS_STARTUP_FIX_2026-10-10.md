# Windows 首次启动：游戏目录识别与错误反馈

2026-10-10，测试用户先报告 `NikkiSync service exited before the desktop UI was ready`，随后提供旧版 `startup-error.log` 截图。多次失败均为 `Infinity Nikki installation was not found`。本次案例的直接原因已确认是目录识别失败，不是已证实的 CPU 或系统组件故障。

## 修改

- 服务退出前读取 stdout/stderr 的最后输出和真实退出码。每个流最多保留 16Ki 字符；同时异步读取，避免输出堵塞；最多等 1 秒排空尾部，不因继承管道的子进程卡住错误界面。
- 不将原始异常、Bun 源码片段或私有地址写入新诊断日志。只输出允许的错误分类、中文操作建议、退出码、失败阶段、Windows/架构信息和构建标签。后台 `startup-error.log` 也改成结构化分类，不再记录完整堆栈；两个日志均只保留最新一次对应错误，不增加常驻轮询。
- 首次未找到游戏时显示“选择游戏安装文件夹”与“重试启动”。选择含 `InfinityNikki.exe` 的安装目录，通过子进程环境变量传递，不拼接 shell 参数。成功启动后复用已有 `game-install-root.txt` 持久化，后续启动自动读取。
- 子进程工作目录使用外部单 EXE 所在目录，避免快捷方式的工作目录影响“将 EXE 放在游戏目录里”的识别。移除写死的开发机 `D:` 游戏路径。
- 游戏有 `InfinityNikki.exe` 和 `X6Game` 时，即使尚未创建照片目录也认可安装。零根目录扫描明确完成，避免未解决的 Promise 导致后台以退出码 0 结束。空图库仍使用原扫描和配对界面。照片目录后续才创建时，现有零根目录 watcher 不自动添加新监视路径；重新打开 NikkiSync 会再次发现目录。
- 缺 WebView2 保留官方安装入口；其他失败也提供打开日志文件夹和重试。写日志失败则提示截图错误代码。
- 两个 Windows 打包脚本明确使用 `bun-windows-x64-baseline`、继续保留 `--smol`。这一点是兼容性改进，不能解释为已确认本次测试用户 CPU 不兼容。

本机 Bun 为 1.3.14。该版本的官方文档仍区分 AVX2 和 baseline：[固定版本 executable 文档](https://github.com/oven-sh/bun/blob/bun-v1.3.14/docs/bundler/executables.mdx)。最新网页已变化，不能用其描述替代所用版本。自动下载 baseline 提取失败后，使用 [官方 1.3.14 release](https://github.com/oven-sh/bun/releases/tag/bun-v1.3.14) 的 Windows baseline ZIP，按 release API 给出的 SHA-256 核对：`538F9C846355D9E847B2671BC00C47DA4229A0BEFB24DF3282B739770F3B475F`。在 workspace/out 保存编译器，通过 `-BunExecutable` 传入，不改全局 Bun，不改依赖版本。

## 验证

先 RED 后 GREEN：旧退出提示丢失原因的 5 个失败测试、baseline 构建目标检查、新安装无照片目录识别、零根扫描无法完成、手动目录环境传递。新增真实 PowerShell 子进程测试，覆盖大量 stdout、最终 stderr 与退出码，确认管道不会堵住。

- Windows 全量 34/34 PASS。
- PC/核心全量 125/125 PASS；打包接线 6/6 PASS，共 131/131。
- 实际单 EXE 复制到游戏目录之外的临时目录，在全新隔离 AppData/SQLite/WebView 数据里运行；只创建空测试安装标记与 X6Game，没有读取用户数据库或私人照片，关闭在线解析和两个字典 provider。
- 无照片目录的首次 WPF/WebView/HTTPS 服务和相册页面启动 PASS：约 2.76 秒；第二次约 1.44 秒。这是空图库开发机的检查，不是所有玩家机器的承诺。
- 选择目录写入缓存 PASS；二次启动 runtime 所有文件长度、哈希和修改时间完全不变。
- 实际占用桌面端口并返回 503，后台退出，错误页准确显示 `PORT_IN_USE` / 退出码 1，未把已有服务错误地视为就绪。截图已检查可读，日志不含照片或凭据。
- 内嵌 APK 的实际文件哈希与既有 0.2.10 完全一致，未修改 Android。
- `git diff --check` PASS（既有 LF/CRLF 提示）；NuGet 漏洞查询 NU1900 网络警告仍存在，不等同于安全审计通过。

证据：`out/startup-fix-PszLdZ/report.json`，错误页 `out/startup-fix-PszLdZ/port-conflict/startup-error-screen.png`。测试私有数据库和浏览器资料已清理。此次不宣称已在反馈用户的电脑上验收，也未实点其文件夹选择器；目录传递与持久化由测试和实际隔离启动确认。

## 交付

- `release/NikkiSync-Portable-StartupFix/NikkiSync-PC.exe`，目录仅此一个文件。
- 长度：118,291,858 字节。
- SHA-256：`AD1285798FE145723145FFD935110ADBA51096B46ED9B5464A95B6EC738508A5`。
- 内嵌 APK：0.2.10-ui-gestures / versionCode 11，SHA-256 `0430F4F4AB6DBD103CBA1F82964663CE18C0808BFE8B3872E7DB2005A6339D4F`。
- 构建报告：`out/portable-build-36aa70c1e8294b388aa5d9f41810c314/build-report.json`。其中原始构建目标名为 StartupFix2，验证后将同一字节文件整理到上述正式交付目录；首个未通过的探针构建移出 release 到 out，避免误发。
- 分支/HEAD：`feature/remote-bridge-foundation` / `2466e60b3d43a707851915ce9f4ee67627a06338`，包含此前和本次未提交工作树，不应从旧 HEAD 单独重建。

用户旧版临时路线：先打开电脑版游戏再启动 NikkiSync；成功后会缓存位置。新版路线：提示里点击“选择游戏安装文件夹”，选择含 `InfinityNikki.exe` 的目录，成功后记住位置。仍失败时只反馈 `startup-diagnostics.log` 或错误代码，不要发送整个 AppData。
