# NikkiSync GPT 交接｜2026-09-04

这份文档是交给后续 GPT coding agent 的当前事实基线。文档中的“必须/不要”是项目工作约束；它们不替代用户在当前对话中提出的新需求。若用户的新需求与本文冲突，以用户明确要求为准，但仍要保留安全边界、测试和真实验收记录。

## 1. 项目与工作区

项目：NikkiSync，《无限暖暖》本地摄影同步 App。

MCP 配置的唯一可写 workspace：

```text
D:\GAME\InfinityNikki Launcher\InfinityNikki\X6Game\CameraPartner\NikkiSync
```

游戏安装目录（只读调查目标，不是 MCP workspace）：

```text
D:\GAME\InfinityNikki Launcher\InfinityNikki\X6Game
```

当前目录没有 `.git`，不要假设可以提交 commit、创建分支或回滚历史。所有改动都直接保留在 workspace，交接以文档和测试结果为准。

## 2. MCP 是否满足后续修改

结论：**满足对 NikkiSync 项目源代码、测试和文档的读写修改；不满足直接修改游戏安装目录。**

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

启动方式：双击桌面的 `start-nikkisync-gpt-mcp.cmd`。它会打开 MCP 窗口和 Cloudflare tunnel 窗口；按窗口提示把本次临时 OAuth 密码和当前公网 URL 配到 ChatGPT 自定义连接器。密码只在本机窗口和授权流程中使用，不要写进对话、文档、日志或代码。8767 已与另外两个项目区分，三个 MCP 可以同时运行。

`coding-tools-mcp 0.3.0` 实际暴露了 `server_info`、`read_file`、`list_dir`、`list_files`、`search_text`、`apply_patch`、`exec_command`、`view_image` 等工具。

权限含义：

- GPT 可以用 `read_file/list_files/search_text` 读取 NikkiSync workspace 内的文本，使用 `apply_patch` 修改或新增 workspace 内的代码、测试和 Markdown。
- `apply_patch` 是唯一允许的直接文件修改方式；不要通过 shell 重定向、PowerShell `Set-Content`、Python 写文件等方式绕过它。
- `exec_command` 在 `safe` 模式下可运行本地构建和测试，但网络、shell 展开、内联脚本和全局临时目录写入受限；不要把它当作文件写入工具。
- 直接文件工具会拒绝 workspace 外的路径。因此 GPT 不应声称能通过这个 MCP 读取或修改 `D:\GAME\...\X6Game` 的游戏文件；游戏归档探针只能在本机有授权的执行环境中以只读方式运行。
- 不要把 MCP 改成 `dangerous`，也不要把 workspace 扩大到整个游戏目录。这样会破坏项目与游戏文件的写入边界。

连接后第一步建议调用 `server_info`，确认返回的 workspace 正是上面的 NikkiSync 路径、`permission_mode` 为 `safe`，并确认没有连接到 PhotoLayout 或 Neon Road 的端口。

## 3. 已完成的主线能力

这些能力已有源码和回归测试，不要重复实现或另建平行存储：

- PC 本地游戏目录自动发现、ScreenShot/Video/隐藏 `GamePlayPhotos` 资源选择、稳定文件判定、去重和删除日志。
- M1.1 Local Sync Server：配对、认证、分页、范围流、变更通知、WebSocket 事件、本地 TLS 身份持久化。
- Android Gallery MVP：扫码配对、实时刷新、多选、原图/Live 素材保存到系统相册的现有链路。
- NUAN5 resolver：发送已验证的 decode tuple、UID/token 与 MD5；不发送源照片字节。
- 元数据字典：本地 manifest、显式 opt-in 的远程 JSON provider、ETag/Last-Modified 条件更新、失败保留旧快照、本地 re-enrich、用户自定义名称优先。
- M4.2.1：服装 ID 空间与真实 `102xxxxxxxx` entity ID 对齐已确认。

主工程最近一次回归：`npm test -- --runInBand`，57/57 通过。

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

隔离探针测试：10/10 通过。

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

### P0：先保持交接和环境稳定

1. GPT 接入后先读本文件、`docs/M4_2_2B_LOCAL_DICTIONARY_EXTRACTION.md`、`docs/M4_2_2_CLOTHING_ID_ALIGNMENT_EVIDENCE.md`、`docs/M2_3_MOBILE_GALLERY_UI_REQUIREMENTS.md`。
2. 调用 `server_info`，确认 workspace/端口/安全模式。
3. 先运行已有测试，再修改；每个新行为先写一个会失败的测试。
4. 继续使用 `apply_patch`，不要通过 shell 改文件。

### P1：推进手机端 M2.3 UI（当前最适合继续开发）

目标是让首页从“只能看照片和下载”升级为可用的图库：

- 首页按游戏版本号分组；优先使用照片已有 `identity.gameVersion`，否则用捕获日期匹配本地缓存的版本日历；不得为每张照片实时联网查询。
- 分组标题显示版本号和照片数量，未知版本进入“未识别版本”。
- 照片查看页支持非破坏性 90°/180°/270° 旋转预览，并让普通照片下载使用选择后的方向。
- 保留 Live Photo 的 still/video 成对资源标识；当前可以先完成 UI 和数据模型，但不要假装已经完成旋转后的 Live 导出。
- 状态栏持续展示连接状态、最近同步时间和扫描到的照片数量。

重点源码入口：

```text
apps/mobile/app/src/main/java/app/nikkisync/mobile/MainActivity.java
apps/mobile/app/src/main/java/app/nikkisync/mobile/GalleryAdapter.java
```

UI 参考与要求：

```text
docs/M2_3_MOBILE_GALLERY_UI_REQUIREMENTS.md
docs/UI_REPLICATION_HANDOFF.md（如存在于项目文档副本）
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

在实机验收完成前，推荐继续推进手机端 `M2.3.1`：按游戏版本号分组的相册首页与普通照片旋转预览/下载数据模型；Live Photo 旋转导出仍留到 M3，不能只旋转封面而保留原方向视频。

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

- `server_info.workspace` 等于本文第 1 节的绝对路径；
- 可以读取本文和 `docs/` 下的项目文档；
- 可以用 `apply_patch` 在 NikkiSync workspace 内新增/修改一个测试或 Markdown（先 dry-run 或用户明确授权）；
- 不声称可以写入游戏安装目录；
- 所有功能修改都有测试和实际命令结果；
- 真实阻断、未完成项和推断不会被写成“已通过”。


## 2026-09-20｜M2.4.3 已保存修图关联（源码已实现，完整构建验收受 CI runner 阻塞）

### 产品目标

用户从 NikkiSync 保存原图后，可能继续在 Lightroom、Snapseed、系统相册等工具中修图。M2.4.3 在现有“已保存”页中增加 **手动关联修图**：

```text
同一 source assetId
├─ 原始保存图（可有多条历史 re-save）
├─ 修图版 1
├─ 修图版 2
└─ 修图版 N
```

用户从某条原始保存记录进入 **关联修图**，使用 Android 系统多选照片选择器选择一张或多张修图。所有修图和原始保存图在“已保存”页按同一 source `assetId` 连续显示；修图缩略图标记“修图”。

明确边界：

- 第一版只做用户手动关联，不做自动相似图匹配。
- 修图文件不写入游戏参数、不修改字节、不上传 PC。
- 同一 URI 再次关联到同一 source 是幂等操作，保留第一次 `linkedAt`。
- 同一 URI 已属于另一个 source 时拒绝静默迁移。
- 解除关联只移除 NikkiSync 本地关系，绝不删除系统相册媒体。
- LIVE source 可以关联普通修图 JPEG/HEIC；不能因此把修图版宣称为可播放 LIVE。

### 设计与计划

设计：
`docs/superpowers/specs/2026-09-19-saved-photo-edited-variants-design.md`

设计提交：
`dac98c8c11b24d6088e2789fd535ff2b1f10f65e`

实现计划：
`docs/superpowers/plans/2026-09-19-saved-photo-edited-variants.md`

计划最终提交：
`9dae589e1cf3b34d8c5f4c489d4e6f5bab0795f4`

### 已实现源码

新增：

- `storage/EditedVariantStore.java`
  - SQLite：`nikkisync-edited-variants.db`
  - 一 source 多修图
  - same-source duplicate 幂等
  - cross-source URI conflict
  - 单条 unlink
- `storage/SavedMetadataSnapshotStore.java`
  - SQLite：`nikkisync-saved-metadata.db`
  - 保存最后一次 canonical metadata
  - PC 离线时供“已保存”详情读取
  - 在线刷新失败不清空旧快照
- `storage/SavedPhotoGroups.java`
  - 原图 + 修图按 `assetId` 分组
  - 原图永远先于修图
  - 最近保存排序使用组内最新 activity
  - 拍摄时间排序保持整组连续
- `storage/EditedMediaAccess.java`
  - Android Photo Picker URI 元信息
  - 尝试 `takePersistableUriPermission`
  - 不申请全图库读取权限
- `ui/SavedMetadataText.java`
  - 复用 canonical 相机 / 滤镜 / 光照 / 穿搭文本
  - 离线快照也能使用
- 新增 5 组 Android 单元测试源码：
  - `EditedVariantStoreTest`
  - `SavedMetadataSnapshotStoreTest`
  - `SavedPhotoGroupsTest`
  - `EditedMediaAccessTest`
  - `SavedMetadataTextTest`

修改：

- `SavedPhotoAdapter`
  - full-width source group header
  - 同一 source 原图与修图连续展示
  - 修图 badge
- `SavedPhotoVerifier`
  - 原图与修图 URI 共用 health verification
  - inaccessible URI 只标记状态，不删除记录
- `MainActivity`
  - 改为 `ComponentActivity`
  - 注册 `PickMultipleVisualMedia`
  - 原始 Saved 详情增加“关联修图”
  - 修图详情支持在线参数 / 离线快照
  - “查看原始保存图”
  - 当前 source 可用时“查看源照片”
  - “解除关联”
  - 原图成功保存和源详情成功加载时刷新参数快照
  - Activity 销毁时先停止后台 Executor，再关闭新增 SQLite stores
- `app/build.gradle.kts`
  - `androidx.activity:activity:1.13.0`
  - Robolectric test dependency
- `validate-m2.mjs`
  - M2.4.3 静态合同
  - 允许新的 `SavedPhotoGroups.select` 替代旧的直接 `SavedPhotoCollection.select`
  - metadata 文案验证改为检查共享 `SavedMetadataText`

### 关键提交

实现过程中的主要生产提交：

- `430593f2e2e453ad236c781614a4df810f7caa76` — edited variant store
- `f57eac9efb4d49bdcad0216abedc52d68bd19cc9` — Saved source groups
- `ae7659e85f27925136673af2ff8e40348d75e25b` — edited URI access
- `a7791ecd692c26778adea1e2f5557bf4c5001b03` — system multi-photo picker registration
- `d72ee37eec0b5ea647ea9454f814f983555a8abc` — grouped Saved adapter
- `57121f1553cbdfd44d7c0da65cc254f79d296edd` — edited media health
- `9e1a5c743f1289ed7bdec0d8bbb6e7bf24742d0a` — group projection into Saved page
- `1ce856a0884f51fadb9db8340b10e8d8ee3423fb` — link/detail/unlink/offline snapshot UI
- `0d13921fc24a3e1a187a2b43a3769cc3574f3362` — safe background/store shutdown order
- `c03bd7e00e0bafba1a9da7db4b7cad508779f0aa` — use Java-valid `PickMultipleVisualMedia(maxItems)` constructor with system photo-picker limit

TDD RED commits include:

- `88b77578a2a8714337f127869893e1a5da000847`
- `253a0e0453d400a4db037452d0524732dc14f614`
- `bfca21d1e20b2ff6b3f52978da87fe2a50624f3a`
- `bbcb761cff5c88a71f16e0816c7114f4908f65dd`
- `1cc9151151125b33a81a3d03d9f66a2f2a2e56b8`
- `52228edcea50ea7861fb27befdeecc5d03880eed`
- lifecycle RED：`c4e1b2e60a0214ba4200c0549dd4700eb24344c8`
- Photo Picker Java constructor RED：`0bc262402ae5e6e7ad0ce2e40b489b8bd84eb4a7`

### 当前验证事实

已在当前开发会话直接做过、不依赖 runner 的检查：

- 对涉及本轮修改文件的 `validate-m2.mjs` 断言进行了静态重放：65 条相关断言，0 条失败；一个已有 multiline assertion 无法被简化重放器解析，但其目标代码仍存在。
- 修改 Java 文件括号结构检查为平衡状态。
- 未发现重复 import。
- 未发现 `ContentResolver.delete` / `getContentResolver().delete` 媒体删除路径。
- lifecycle shutdown-order RED 条件在生产修复前为 false，修复后为 true。
- Photo Picker Java API 复核确认 `PickMultipleVisualMedia` 的 public constructor 需要 `int maxItems`；源码已改为 `MediaStore.getPickImagesMaxLimit()`，对应静态断言修复前 false、修复后 true。
- `EditedVariantStoreTest` 与 `SavedMetadataSnapshotStoreTest` 已增加每用例后的 SQLite helper close，避免测试间数据库连接污染。

**不要把以上静态检查写成 Android 编译通过。**

### GitHub Actions 阻塞

当前 hosted Actions 没有实际分配 runner。最近运行中：

- `android`：`runner_id=0`、`steps=[]`
- `node-regression`：`runner_id=0`、`steps=[]`

因此当前 HEAD 尚未取得以下新鲜证据：

- `npm run mobile:validate` 实际命令成功
- `npm test` 成功
- `./gradlew testDebugUnitTest` 成功
- `assembleDebug` 成功
- 新 APK 构建成功
- 真机 Photo Picker / URI 长期访问 / 离线参数 / 解除关联验收

不要把“workflow conclusion=failure”误写成源码测试失败：这几次 workflow 根本没有开始任何 step。

最新无 runner 的运行：`35457735779`（head `bd4c6a7c1f9cb5407394f57c6524782244490c60`），`android` 与 `node-regression` 均为 `runner_id=0`、0 steps。

此前 Android workflow 还曾遇到 `android-actions/setup-android@v3` 请求已移除的 SDK `tools` 包。工作流现在显式只请求 `platform-tools`，但由于当前 runner 未分配，这一修正也尚未获得新的 Actions 运行证明。

### 下一步验收

一旦有可执行 Android 构建环境：

```powershell
npm run mobile:validate
npm test
cd apps/mobile
./gradlew testDebugUnitTest assembleDebug
```

然后在 Android 13+ 真机验收：

1. 打开一条已有“已保存”原图。
2. 点“关联修图”，一次选择至少 2 张图片。
3. 返回后确认原图 + 多张修图在同一 source 组连续显示。
4. 强杀并重开 App，确认关联仍存在。
5. 关闭 PC，确认已有快照的修图仍显示源参数。
6. 重连 PC，确认参数可刷新且源照片入口可用。
7. 再次选择相同修图，确认不新增重复记录。
8. 尝试把已属于另一 source 的 URI 再关联，确认拒绝静默移动。
9. 删除系统相册中的原始保存图，确认修图关联仍存在。
10. 在修图详情点“解除关联”，确认系统相册文件仍存在。
11. LIVE source 关联 flattened JPEG 时，只显示为“修图”，不宣称为 LIVE Motion Photo。
