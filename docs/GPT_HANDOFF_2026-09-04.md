# NikkiSync GPT 交接｜2026-09-04

这份文档是交给后续 GPT coding agent 的当前事实基线。文档中的“必须/不要”是项目工作约束；它们不替代用户在当前对话中提出的新需求。若用户的新需求与本文冲突，以用户明确要求为准，但仍要保留安全边界、测试和真实验收记录。

## 1. 项目与工作区

项目：NikkiSync，《无限暖暖》本地摄影同步 App。

本地 MCP 配置的唯一可写 workspace：

```text
D:\GAME\InfinityNikki Launcher\InfinityNikki\X6Game\CameraPartner\NikkiSync
```

GitHub 私有仓库：

```text
ToStardust/NikkiSync
```

游戏安装目录（只读调查目标，不是 MCP workspace）：

```text
D:\GAME\InfinityNikki Launcher\InfinityNikki\X6Game
```

GitHub 已用于分支、CI 和 PR 工作流；不要把游戏安装目录或任何密钥、配对凭据、OAuth 临时密码提交到仓库。游戏目录仍保持只读边界。

## 2. MCP / GitHub 是否满足后续修改

本地 MCP 设计边界仍是：**满足对 NikkiSync 项目源代码、测试和文档的读写修改；不满足直接修改游戏安装目录。**

2026-09-04 已通过桌面启动器自检：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Users\Stardust\Desktop\start-nikkisync-gpt-mcp.ps1" -CheckOnly
```

自检结果：`CHECK PASSED`。

启动器配置如下：

```text
workspace = D:\GAME\InfinityNikki Launcher\InfinityNikki\X6Game\CameraPartner\NikkiSync
local MCP port = 8767
PhotoLayout port = 8765
Neon Road port = 8766
permission mode = safe
```

`coding-tools-mcp 0.3.0` 实际暴露了 `server_info`、`read_file`、`list_dir`、`list_files`、`search_text`、`apply_patch`、`exec_command`、`view_image` 等工具。

权限含义：

- GPT 可以用 `read_file/list_files/search_text` 读取 NikkiSync workspace 内的文本，使用 `apply_patch` 修改或新增 workspace 内的代码、测试和 Markdown。
- `apply_patch` 是本地 MCP 唯一允许的直接文件修改方式；不要通过 shell 重定向、PowerShell `Set-Content`、Python 写文件等方式绕过它。
- `exec_command` 在 `safe` 模式下可运行本地构建和测试，但网络、shell 展开、内联脚本和全局临时目录写入受限；不要把它当作文件写入工具。
- 直接文件工具会拒绝 workspace 外的路径。因此 GPT 不应声称能通过这个 MCP 读取或修改 `D:\GAME\...\X6Game` 的游戏文件；游戏归档探针只能在本机有授权的执行环境中以只读方式运行。
- 不要把 MCP 改成 `dangerous`，也不要把 workspace 扩大到整个游戏目录。
- 当当前 ChatGPT 会话无法使用 developer MCP 时，可以通过已授权的私有 GitHub 仓库创建分支、修改源码、运行 GitHub Actions 并提交 PR；这不会改变游戏目录只读边界。

连接本地 MCP 后第一步仍建议调用 `server_info`，确认 workspace 和 `permission_mode=safe`。

## 3. 已完成的主线能力

这些能力已有源码和回归测试，不要重复实现或另建平行存储：

- PC 本地游戏目录自动发现、ScreenShot/Video/隐藏 `GamePlayPhotos` 资源选择、稳定文件判定、去重和删除日志。
- M1.1 Local Sync Server：配对、认证、分页、范围流、变更通知、WebSocket 事件、本地 TLS 身份持久化。
- Android Gallery MVP：扫码配对、实时刷新、多选、原图/Live 素材保存到系统相册的现有链路。
- NUAN5 resolver：发送已验证的 decode tuple、UID/token 与 MD5；不发送源照片字节。
- 元数据字典：本地 manifest、显式 opt-in 的远程 JSON provider、ETag/Last-Modified 条件更新、失败保留旧快照、本地 re-enrich、用户自定义名称优先。
- M4.2.1：服装 ID 空间与真实 `102xxxxxxxx` entity ID 对齐已确认。
- Windows Shell 单实例：第二实例通知已有实例激活并退出，不再重复启动 28950 service；自动化验证通过，桌面双开实机验收待确认。
- M2.3.1 第一纵向切片：PC summary 暴露照片游戏版本 provenance，Android 解析并按版本分组显示图库首页；自动化验证通过，手机实机 UI 验收待确认。

主工程当前 GitHub Actions 回归（Windows / Node 24）：

```text
npm test -- --runInBand
58 tests / 58 passed / 0 failed
```

Android GitHub Actions 当前验证：

```text
./gradlew testDebugUnitTest assembleDebug
BUILD SUCCESSFUL
```

## 4. 当前进行中的 M4.2.2B 状态

隔离探针位置：

```text
tools/m4-2-local-dictionary-probe/cue4parse-spike/
```

现有组件：

- `Cue4ParseProbe.sln`
- .NET 8 `Cue4ParseProbe` 项目
- CUE4Parse `1.2.2`（Apache-2.0）
- `CliArguments`：`inventory <Paks-dir> [--out <dir>]`，并保留未来 `probe` 命令入口
- `PaksDirectory`：拒绝文件系统根、验证 `Paks` 叶目录、计算文件名/大小/UTC 时间指纹、前后校验
- `ResourceClassifier`：保守标记 `.uasset/.locres/.json/lua/config` 候选，不把媒体当字典
- `Cue4ParseArchiveReader`：`GAME_InfinityNikki`、`Initialize()`、`LoadVirtualPaths()`、虚拟路径排序、归档异常封装
- `GameArchiveDirectories.Discover(X6Game-root)`：按固定顺序识别 `Content/Paks`、`Saved/Paks`、`Saved/FastPatchPaks`
- JSON inventory report 只写入探针自己的 `out/` 目录

隔离探针历史测试：10/10 通过。

真实只读验收已执行于：

```text
D:\GAME\InfinityNikki Launcher\InfinityNikki\X6Game\Content\Paks
```

指纹未改变：

```text
fileCount: 33
totalBytes: 494,904,156
sha256: 4bbbaf5bc3a14f8bb59b13bd83e4a57d4a0334475deefeb6c23852453fbcc2f5
```

CUE4Parse 能识别 33 个容器，但 `Files=0`、`UnloadedVfs=33`；采样 pak 报告 `IsEncrypted=true`、`bDecrypted=false`。没有合法 AES key/config 来源时，`LoadVirtualPaths()` 返回 0。这个结果是“归档访问状态受限”，不是“本地没有服装字典”。

额外只读盘点确认主资源还在：

```text
X6Game/Saved/Paks          603 files, 131,819,302,732 bytes
X6Game/Saved/FastPatchPaks 132 files,     990,068,693 bytes
```

不要为了得到非空结果而：读取进程内存取密钥、绕过游戏保护、把密钥写入源码/报告、暴力扫描 131 GB、复制游戏媒体，或把游戏目录加入 MCP 可写 workspace。M4.2.2B 当前状态仍是 `extraction-proof pending`。

## 5. 推荐下一步（按优先级）

### P0：保持交接、分支和环境稳定

1. GPT 接入后先读本文件、`docs/M4_2_2B_LOCAL_DICTIONARY_EXTRACTION.md`、`docs/M4_2_2_CLOTHING_ID_ALIGNMENT_EVIDENCE.md`、`docs/M2_3_MOBILE_GALLERY_UI_REQUIREMENTS.md`。
2. 本地 MCP 可用时先调用 `server_info` 确认 workspace/安全模式；GitHub 路线则确认仓库 `ToStardust/NikkiSync`、目标分支和 CI 状态。
3. 每个新行为先写失败测试，再实现；所有自动化结论必须来自实际命令或 CI 结果。
4. 游戏安装目录保持只读；不要提交密钥、配对凭据、OAuth 临时密码或游戏资源。

### P1：M2.3.1 游戏版本图库 — 第一纵向切片已完成自动化验证

当前完成范围：

- Protocol `AssetSummary` 新增：

```text
gameVersion?: string
gameVersionSource: explicit | inferred | unknown
```

- PC `mapAssetSummary()` 读取已有 `metadata.identity.gameVersion`。存在时返回 `explicit`；不存在时返回 `unknown`。
- 当前 PC **还没有**版本日历推断服务，所以不会凭日期自行制造版本；这部分必须保持为后续 bounded task。
- Android `AssetSummary` / `JsonCodec` 已能解析上述字段；旧 PC 响应缺 provenance 时安全降级为 `unknown`。
- Android 新增纯 Java `GameVersionGroups`：
  - 版本按数值段倒序，`2.10` 正确排在 `2.9` 前；
  - 未知版本组排最后；
  - 同组照片按 capture time 新到旧；
  - 只有整个版本组都来自 `inferred` 时才显示“自动推测”。
- 首页图库从旧 `GridView` 定向替换为 `RecyclerView + GridLayoutManager(3)`；版本标题跨满 3 列，照片仍保持 3 列。
- 版本标题显示版本号和照片数；未知组显示“版本未知”。
- 现有点击打开 Viewer、长按选择、LIVE 标识、批量保存以及各厂商 Live Photo 保存链路未在本切片中改写。
- RecyclerView 引入 AndroidX，因此 `apps/mobile/gradle.properties` 已启用 `android.useAndroidX=true`。

TDD / CI 证据（2026-09-05）：

- Protocol RED：新增测试先以 `TS2353` 失败，因为旧 `AssetSummary` 没有 `gameVersion`。
- Android parser RED：新增 JVM test 先因 `gameVersion()` / `gameVersionSource()` 不存在而编译失败。
- PC summary integration assertions 已覆盖显式 `2.9 -> explicit` 与无版本 `-> unknown`。
- `GameVersionGroupsTest` 覆盖 `2.10 > 2.9`、未知组最后、组内时间倒序、显式/推断 provenance 组合。
- Windows GitHub Actions：`npm test -- --runInBand` = **58/58 PASS**。
- Android GitHub Actions：`./gradlew testDebugUnitTest assembleDebug` = **BUILD SUCCESSFUL**。

当前没有完成、不得写成已完成：

- **PC cached game-version calendar / 日期推断尚未实现。** 下一步应在 PC 侧新增小型缓存版本日历和 resolver，失败时保留上一份有效缓存，不允许 Android 每张照片联网查询。
- **手机实机版本分组 UI 验收尚未执行。** 自动化构建成功不等于实际设备视觉/交互通过。
- 顶部刷新按钮、连接状态 polish、渐进模糊/液态玻璃等仍是后续 UI polish。
- 全屏 Viewer 尚未实现；当前仍是旧 Dialog。
- 非破坏旋转和 rotated still export 尚未实现。
- rotated LIVE export 尚未实现。

M2.3 推荐后续顺序：

```text
M2.3.1B PC cached version calendar + timestamp inference
-> 手机实机验收版本分组首页
-> M2.3.2 full-screen viewer + metadata sheet
-> M2.3.3 still rotation state + rotated JPEG export
-> M2.3.4 visual polish / predictive back
-> M3 rotated LIVE export per vendor
```

重点源码入口：

```text
packages/protocol/src/index.ts
apps/pc-companion/src/server/row-mappers.ts
apps/mobile/app/src/main/java/app/nikkisync/mobile/model/Models.java
apps/mobile/app/src/main/java/app/nikkisync/mobile/protocol/JsonCodec.java
apps/mobile/app/src/main/java/app/nikkisync/mobile/ui/GameVersionGroups.java
apps/mobile/app/src/main/java/app/nikkisync/mobile/ui/GalleryAdapter.java
apps/mobile/app/src/main/java/app/nikkisync/mobile/MainActivity.java
```

实施计划：

```text
docs/superpowers/plans/2026-09-05-m2-3-1-game-version-gallery.md
```

### P1：修复 PC 重复启动错误 — 已完成自动化验证

状态：**自动化验证通过；桌面双开实机验收待确认。**

用户曾看到 `NikkiSync PC 无法启动…0x800700AA`。根因是第二个桌面进程再次启动固定服务端口 28950；原桌面壳没有应用级单实例和已有实例激活机制，导致第二个进程进入重复服务启动路径。

实现结果：

- 第一次启动取得 `Local\NikkiSync.WindowsShell.Instance` 命名 mutex，并启动唯一的激活监听。
- 第二次启动检测到 mutex 后，通过 `Local\NikkiSync.WindowsShell.Activate` 命名事件通知已有实例，随后立即退出，不再创建第二个窗口或启动第二个 `NikkiSync-PC-service.exe`。
- 已有实例收到通知后恢复窗口、取消最小化并激活；托盘隐藏状态也会恢复。
- 保留已有托盘关闭语义：关闭窗口仍隐藏到托盘，显式退出时才释放 mutex 并停止服务。

改动文件：

```text
apps/windows-shell/App.xaml
apps/windows-shell/App.xaml.cs
apps/windows-shell/MainWindow.xaml.cs
apps/windows-shell/Services/SingleInstanceCoordinator.cs
apps/windows-shell.Tests/SingleInstanceCoordinatorTests.cs
```

测试与构建记录（2026-09-04）：

```text
SingleInstanceCoordinatorTests：4/4 通过
windows-shell 全量测试：9/9 通过
dotnet build apps/windows-shell/NikkiSync.WindowsShell.csproj --no-restore：0 警告，0 错误
dotnet build apps/windows-shell/NikkiSync.WindowsShell.csproj -c Release --no-restore：0 警告，0 错误
npm test -- --runInBand：57/57 通过
```

RED 证据：先运行新增测试时，4 项均因 production `SingleInstanceCoordinator` 尚不存在而失败；补实现后同一筛选测试 4/4 通过。

本轮只完成源码、测试和 Release 构建验证，未替换或发布安装包。当前仍需在可显示桌面的 Windows 环境手工验收：启动一次 PC 壳，再双击一次，确认第二次不弹错误、不启动第二个服务进程，并把已有窗口带到前台。若当前环境无法可靠操作 GUI，应保持“桌面双开实机验收待确认”，不要写成完全通过。

### P2：M4.2.2B 仅在出现合法资源配置后继续

若没有合法、公开、可文档化的 CUE4Parse 兼容配置来源，保持 pending；可以完善诊断报告和目录发现，但不要进入 clothing DataTable 记录证明。

若以后确有合法来源，验收顺序必须是：

1. archive inventory 非空；
2. 已知 `1020100111`、`1020600111`、`1020900111` 至少一个产生结构化 record provenance；
3. 再做本地 StringTable/locres 名称 join；
4. 再做 icon asset reference；
5. 最后生成现有 metadata dictionary manifest，不新建第二套字典存储。

### P3：M3 Live Photo 旋转导出

普通 JPEG 旋转可以先交付；Live Photo 必须最终同时处理 still 与 video，或旋转后重新封装为手机可识别的成对资源。不要只旋转封面却下载原方向视频。

## 6. 必须通过的验证

NikkiSync 主工程：

```powershell
npm test -- --runInBand
```

Android M2.3：

```text
apps/mobile/gradlew testDebugUnitTest assembleDebug
```

M4.2.2B 探针：

```powershell
dotnet test tools/m4-2-local-dictionary-probe/cue4parse-spike/test/Cue4ParseProbe.Tests/Cue4ParseProbe.Tests.csproj
dotnet build tools/m4-2-local-dictionary-probe/cue4parse-spike/Cue4ParseProbe.sln --no-restore
```

真实归档运行只能只读执行，输出放在：

```text
tools/m4-2-local-dictionary-probe/cue4parse-spike/out/
```

任何真实验收都必须记录：命令、输入目录、指纹、结果、是否访问网络、是否写入游戏目录。没有结构化 record provenance 时，不得把候选路径称为服装字典证据。

## 7. 交接完成标准

后续 GPT 在本项目上的工作算“环境已接入”必须同时满足：

- 本地 MCP 路线：`server_info.workspace` 等于本文第 1 节的绝对路径；GitHub 路线：确认仓库 `ToStardust/NikkiSync` 与目标分支。
- 可以读取本文和 `docs/` 下的项目文档。
- 修改仅发生在 NikkiSync 项目/仓库，不把游戏安装目录变成可写范围。
- 所有功能修改都有测试和实际命令/CI 结果。
- 真实阻断、未完成项、实体设备验收和推断不会被写成“已通过”。
