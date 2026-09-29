# NikkiSync — Codex 交接：仅 Live 图兼容与同步旋转

日期：2026-09-26（UTC+8）

## 0. 仓库与任务边界

**只操作 GitHub 私有仓库 `ToStardust/NikkiSync`，不是 Nikki MCP 指向的本机工作区。**

- 仓库：https://github.com/ToStardust/NikkiSync
- 工作分支：`feature/m3-livephoto-compat-rotation`
- Draft PR：https://github.com/ToStardust/NikkiSync/pull/9
- PR 基线：`feature/m2-3-2d-share-card`，`50e1543dd9d0b4038bf808dd497035383c46ad17`
- 首批计划提交：`95c8e36d8556c379eb45e3cb732cf1799a3f1e92`
- 封装核心提交：`c3513802dd1017f7742996bfed0d120f868ef49e`
- 旋转、界面与保存记录接入提交：`31ed0b16446cd4ddb804122041d9d720601ea79b`
- 本文与设备测试位于上述提交之后；接手时读取工作分支实际最新 HEAD，不把 `31ed0b1` 当作最终 HEAD。

用户已授权这部分代码写入 GitHub。只继续 Live/Motion Photo 的封装、播放兼容、图片与完整视频同步旋转，以及这些功能直接依赖的保存状态/测试。不要改照片参数解析、NUAN5 协议、配对安全、PC 界面、分享卡片、其他图库产品设计。不要自动合并 main、发布版本、安装设备或上传用户照片。

## 1. 获取正确基线

先 `git status` 和 `git remote -v`。已有未提交修改或另一个任务的工作区时，不做 reset/clean，不覆盖它；使用新的目录或隔离 worktree。

全新目录示例：

```sh
git clone --branch feature/m3-livephoto-compat-rotation --single-branch https://github.com/ToStardust/NikkiSync.git NikkiSync-Live
cd NikkiSync-Live
git status --short
git rev-parse HEAD
```

记录实际 HEAD。不要从 main、旧的本地 APK/EXE 输出或过时交接稿重新构建。当前任务不需要 Windows EXE 打包。

阅读顺序：

1. `AGENTS.md`
2. 本文
3. `docs/livephoto/IMPLEMENTATION_PLAN_2026-09-26.md`
4. `docs/livephoto/COMPATIBILITY_MATRIX.md`
5. `docs/livephoto/DEVICE_ACCEPTANCE.md`
6. `apps/mobile/app/src/main/java/app/nikkisync/mobile/media/live/`
7. MainActivity 的 `showViewer()`、`saveSelected()`、`refreshSavedPhotos()` 及 Saved 存储/状态。

`docs/M3_VENDOR_LIVEPHOTO_ADAPTERS.md` 已更新为新状态入口。它早期关于“vivo 永远双文件”“华为/荣耀共用裸拼接”的假设不再作为当前方案。

## 2. 已提交的代码，不要重新从零实现

### 2.1 公共封装与验证

公共包：`apps/mobile/app/src/main/java/app/nikkisync/mobile/media/live/`。

| 文件 | 当前职责 |
|---|---|
| `QuarterTurn.java` | 顺时针 90° 倍数归一化，宽高计算，Media3 角度方向转换 |
| `LivePhotoProfile.java` | 标准、小米、Oplus、vivo 旧双文件/新单文件、三星 SEF、华为旧尾标候选；荣耀与华为分开 |
| `JpegSegments.java` | 完整读取/替换 JPEG 段，保留其他数据，修正旧 writer 先输出 marker 再跳过 payload 的损坏问题 |
| `MotionXmp.java` | 按命名空间合并动态元数据，保留非动态 XMP；拒绝 DTD、外部实体和不支持的结构 |
| `MotionContainer.java` | 格式族封装；Oplus MPF 使用最终主图长度；三星 SEF 保持在文件末尾 |
| `MotionContainerVerifier.java` | 从输出重新解析定位信息、尾索引、关联 ID，并逐字节核对动态视频 |
| `VivoLegacyMetadata.java` | 旧 vivo 双文件关联 ID、图像尾数据、MP4 uuid 结构 |
| `VideoFacts.java` | 真正的视频 sample PTS、物理尺寸、方向、音轨和时间轴，不用默认 30fps 猜帧号 |
| `CoverFrameMatcher.java` | canonical 时间戳或受限内存的封面匹配；低置信度/失败不冒充时间戳 0 |

这些是文件格式候选，不是“所有手机已通过”的声明。私有协议字段与相册识别条件仍需要真实样本和设备证据。

### 2.2 Live 旋转已接入代码与 UI

`LivePhotoRotation.java` 已实现：

- 0° 使用原静态图和视频，不重新编码媒体内容；后续封装可以改变动态元数据。
- 90/180/270° 同时旋转 JPEG 和完整视频画面；用户方向为相对原显示方向顺时针。
- 图片用 ImageDecoder 先应用 EXIF 显示方向一次，再旋转像素；输出 EXIF orientation=normal。JPEG quality=100 重编码不等于数学意义无损旋转。
- 视频依赖固定版本 `androidx.media3:media3-transformer:1.8.0` 和 `media3-effect:1.8.0`。
- 非 no-op `PixelRotation` MatrixTransformation 避免 Media3 将直角旋转优化成只写 muxer rotation 标签；启用 portrait encoding，使竖图具有正确的实际像素宽高。
- 未调用裁剪、主动改帧率、删除音轨等操作；拒绝编码器的分辨率/色彩降级请求。
- 输出复查 rotation=0、目标宽高、帧数、音轨存在、时间轴与时长。声音听感/音视频同步仍需设备验收。
- Transformer 在自己的 HandlerThread/Looper 执行；超时或中断取消，等编码器确认停止后才清理临时资源。未确认停止时保留私有缓存，不能删除仍在使用的文件。

`LivePhotoControls.attach()` 已在 Live 详情页提供左右 90° 操作和格式候选选择。`MainActivity.saveSelected()` 已调用 `LivePhotoExporter.save()`；每张图角度在进入后台前分别快照，混选不共享角度，失败项保留选择与角度。

目前详情页旋转预览显示的是封面，不声称已实现内嵌实时视频旋转预览。导出路径是真正处理视频；是否能在系统相册完整播放仍须验证。

### 2.3 共同导出入口与完整媒体记录

`LivePhotoExporter.java` 负责：已配对 PC 的签名资源下载 + SHA-256、媒体准备、同步旋转、封面定位、厂商 EXIF、封装验证、MediaStore 发布。

返回结果包括主图 URI、全部独立视频 URI、profile ID、角度、封面时间戳与来源。旧品牌 Saver 文件仍在仓库中作为历史参考，但当前 MainActivity 的 Live 分支不再调用它们。不要把新增修复只写到旧路径。

`SavedPhotoStore` 兼容旧记录，增加 companionUris、sourceHasMotion、nullable exportHasMotion、profile、presentationUs、timestampSource。相册播放验证仍为 unknown。`SavedPhotoVerifier` 和 `SavedPhotoAdapter` 区分主图缺失、动态视频缺失、旧双文件记录缺少关联证据。图片还在但视频没了会显示 `LIVE 不完整`，不继续假称完整。

双文件在已保存详情中有单独播放视频的保底入口。只移除 NikkiSync 记录/解除关联，仍不删除用户系统相册媒体。

## 3. 各厂商接手方式

详见兼容矩阵；下面是执行边界，不是机型通过名单。

- **Google/Pixel/其他 Android**：标准 Motion Photo 候选，原生相册和 Google Photos 分开验收。
- **小米/Redmi/POCO**：现代 Motion XMP + MicroVideo 兼容字段。原有单台小米成功记录作为控制组；新公共封装/匹配路径必须重新做该设备回归。不要假定新实现与历史二进制完全一致。官方 SDK 未接入，取得正式接入条件后可做对照。
- **OPPO/一加/realme**：Oplus XMP + UserComment + MPF。ColorOS、OxygenOS、realme UI 以及地区版分别测。先验证修正后的 MPF 与相册识别，不靠添加随机厂商标记试错。
- **vivo/iQOO**：旧双文件和新 VCamera 单文件必须分开；品牌初选仍是标注实验的旧候选，可以手动覆盖。新单文件只有最小 UserComment 候选，没有照搬完整私有相机状态字符串，其原生识别可能仍不通过。取得样本确认必要字段，不根据营销型号直接画分界线。
- **三星**：本次只实现旧 SEF 候选；新机型的 mpvd/sefd 等变体没有完成。禁止在 SEF 尾部后随意追加其他数据，或给旧 SEF 写错误的标准视频末尾偏移。
- **华为 Android 兼容环境**：旧 60B LIVE_ 尾标仅手动实验；字段单位/版本必须用原生样本核实，当前封面帧号 >=100 明确拒绝而不截断。默认标准候选，不宣传原生支持。
- **荣耀 MagicOS**：与华为路由分离；**官方 MediaData Kit 尚未实际接入**。下一阶段核验 SDK 许可、依赖、终端能力与真实合成调用。不要写不存在的 API 或把标准 fallback 标成已接入官方 SDK。
- **原生 HarmonyOS**：**本分支没有原生 ArkTS 客户端/媒体库集成**。未来使用目标 HarmonyOS SDK 的动态照片资产接口提交 IMAGE_RESOURCE 和 VIDEO_RESOURCE；不是 Android APK 增加 Saver 就能宣称覆盖。

## 4. 已执行验证与没有执行的验证

作者环境是临时 Linux authoring sandbox，不是用户本机；有 Node/JDK/Python/ffmpeg，没有可用 Android SDK/Gradle 依赖环境。本地代码内容与提交到 GitHub 的生产代码 blob 做过一致性核对，MainActivity 的 PR 差异也已核对。

### 已实际执行

```sh
node apps/mobile/scripts/test-livephoto-core.mjs
# Live Photo core: 92 behavior checks PASS (not Android/device acceptance)

java tools/livephoto/JavaSyntaxCheck.java
# Java parse-only: 21 sources PASS; no Android typecheck performed
```

92 项检查是真正 javac --release 17 编译并执行的纯 Java 行为断言，包括 XMP 替换、JPEG 边界、MPF 长度/恶意偏移、各候选容器视频完整性、vivo 配对及旋转角度几何。曾为恶意 MPF 偏移添加测试，观察到 IndexOutOfBounds 失败后修正边界检查，再复跑通过。

21 个源文件是作者临时目录中的新增/修改源码集合；JavaSyntaxCheck 只解析语法，不解析 Android/Media3 类型。完整 checkout 扫描的文件数会更多，不要求输出仍为 21。

已生成非私人四色角测试资源，并用 ffprobe 确认 H.264 320x180、1 秒、24 帧、AAC 音轨。**GitHub 提交的是生成脚本及说明，不是二进制 JPEG/MP4，接手时需要运行脚本。**

### 未执行，不得标通过

- 当前分支完整 npm/typecheck/regression/mobile:validate。
- Android `testDebugUnitTest`、`assembleDebug`、`assembleDebugAndroidTest`。
- `connectedDebugAndroidTest`，真实 Media3 编解码/旋转输出。
- 任一新增机型的系统相册播放、原生编辑、分享接收兼容。

GitHub 已查询代码提交 `31ed0b1` 的 CI run `36228615450`：
https://github.com/ToStardust/NikkiSync/actions/runs/36228615450

返回 android 和 node-regression 均为 failure，两个 job 的 steps/logs_url 都为 null。此结果没有可用的编译步骤或日志，无法据此确定是源码错误还是运行环境/账户限制；也绝不能记为测试通过。后续文档提交产生的新 run 需要重新查询，不复用旧 run 冒充新 HEAD 结果。

## 5. Codex 第一优先级：在真实工具链完整验证

使用仓库要求的 Node 24、JDK 17、Android SDK 35 / Build Tools 35，并读取现有 Gradle 配置。不要为方便而批量升级 AndroidX、Media3、AGP 或 SDK。

仓库根目录：

```sh
npm ci
npm run typecheck
npm test
npm run mobile:validate
node apps/mobile/scripts/test-livephoto-core.mjs
java tools/livephoto/JavaSyntaxCheck.java
```

再准备设备测试资源：

```sh
python -m pip install Pillow
# 确保 ffmpeg 已安装且在 PATH；不要把缺失 ffmpeg 当成测试通过。
python tools/livephoto/generate-fixtures.py
```

然后在 `apps/mobile`：

```sh
./gradlew testDebugUnitTest assembleDebug assembleDebugAndroidTest
```

Windows 对应 `gradlew.bat`。若构建失败，先定位真实错误，做 Live 路径所需最小修复，先重跑失败项再重跑完整验证；不通过删除/弱化有效断言换取绿灯。固定 Media3 API 的实际类型解析、依赖的 compileSdk 要求、GPU 旋转方向和编码器回调必须由真正编译/设备证明，parse-only 无法证明。

在获得目标设备测试/安装授权后运行：

```sh
./gradlew connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=app.nikkisync.mobile.media.live.LivePhotoRotationInstrumentedTest
```

测试包含两组源方向：正常源，以及 JPEG EXIF90 + 视频方向90；每组分别测试用户 0/90/180/270。验证四角色块位置、物理宽高、非零输出视频方向标签为0、帧数/音轨和源文件不变。若特定编码器不支持，要记录具体设备和错误，不静默 skip。

之后按 `DEVICE_ACCEPTANCE.md` 真正进入系统相册完整播放。先小米历史设备回归，再 Oplus、vivo、三星；荣耀 SDK 和华为样本按其真实依赖推进。

## 6. 正式发布前仍需补齐的 Live 专项工作

### 必须明确的当前限制

1. **MediaStore 进程死亡恢复**：现有代码覆盖正常异常的 URI 补偿删除，但没有跨进程持久 journal。需要在创建每个 URI 后持久记录本次事务，在发布/保存记录之间可恢复；仅处理属于本应用本次事务的项，绝不清扫用户其他媒体。增加第二次 insert 失败、publish 失败、进程被杀和恢复重试测试。
2. **系统/相册能力选择**：目前是品牌初选 + 手动覆盖，不是完整机型/系统/相册版本探测。后续用已验证的配置表和官方能力查询替代盲猜，未知组合仍显示未验证。未实现远程签名规则热更新。
3. **封面低置信度**：现在明确失败，没有封面帧手选 UI。补手选时基于真实视频 sample PTS，不回退为固定0或默认30fps；保留用户原始封面，不无提示替换。
4. **厂商私有变体/官方 SDK**：现代 vivo、三星新容器、华为尾标单位都需要原生样本；荣耀和小米 SDK 需要实际接入条件。不能把文档里的路线当成已完成代码。
5. **大图/HDR 输入**：当前非零旋转拒绝宽色域/GainMap JPEG、HDR/BT.2020 视频；HEIF 封面、多视频/多音轨、非方形像素及不满足安全上限的输入也明确失败。后续增加能力时必须同步测试色彩、音轨与完整性，不先取消保护。
6. **持久保存与缓存**：媒体已发布但 Saved record 持久化失败时需 journal 恢复防重复；编码器未确认停止而遗留的私有缓存需安全恢复策略。当前普通已保存图无伴随视频也不能推导全文件动态完整性通过。

这些是状态透明的后续项，不是允许跳过本次旋转代码构建与设备验收的理由。不要扩展成整个项目重构。

## 7. 不可破坏的要求

- 原始游戏 JPEG/MP4 只读，下载 hash 验证保留，不将照片/UID/native payload 上传第三方。
- 图片和视频在同一显示坐标系旋转；不能只转封面、不能只改一个方向标签。
- 不静默裁短片段、改成30fps、删除音轨、降低分辨率、改变HDR/色域或保存成静态图后称成功。
- 静态修图继承源参数不等于具备动态资源，不能直接打 LIVE 标签。
- 失败项保留用户单张角度和选择，不把混选批量操作变成全部同角度。
- 保留小米历史样本回归；变更匹配器/XMP序列化/metadata padding 后重新验收。
- 文件结构验证、设备编解码通过、系统相册完整播放、分享保留动态分别记录。
- 不因第三方开源实现存在而宣称一个品牌所有机型通过；复制代码前核验许可。

## 8. Codex 最终必须回报

实际工作分支和最终 SHA；变更文件及 Live 专项原因；每条验证命令的结果/通过数/失败信息；设备型号、地区、系统与相册版本；每个角度的封面/视频/音轨/持久化结果；哪些候选仍实验、哪些 SDK 仍未接入。

若确实构建了 APK，列出真实路径、大小、SHA-256 与对应 Git SHA；未构建则明确未构建，不提供旧 APK 冒充。没有完整编译和目标设备通过证据时，PR #9 保持 Draft；不要自行合并 main。

## 9. 可直接使用的接手指令

> 在 GitHub 仓库 ToStardust/NikkiSync 的 feature/m3-livephoto-compat-rotation 分支继续，只处理 Live/Motion Photo。先阅读 AGENTS.md 和 docs/livephoto/CODEX_HANDOFF_2026-09-26.md，核对实际 HEAD 与 Draft PR #9。现有代码已经接入厂商封装候选、封面和完整视频同步旋转、逐张角度以及双文件保存记录，不要从 main 或旧本地目录重做。先在真实 Node/Android 工具链运行文档中的全部验证，生成测试资源并在获授权的设备运行四方向像素/音轨测试；修复真实问题后按厂商/系统/相册逐项验收。已有92项JVM通过不是Android构建或全机型通过。荣耀官方SDK、原生鸿蒙、进程死亡事务恢复等未完成项如实推进和报告，不伪造能力、不改其他业务、不自动合并或安装。
