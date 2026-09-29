# 穿搭灵感库：本地首阶段与后续同步边界

分支：`feature/outfit-inspiration`。本文件只记录 Outfit Inspiration，不将 Live Photo、NUAN5 照片解析或现有配对协议并入本功能。

## 已实现的本地首阶段

- “我的”页可进入独立的穿搭灵感库；未连接 PC 时仍能记录、搜索和复制分享码。
- 手动粘贴，或由 Android 系统 `SEND` / `SEND_MULTIPLE` 分享文字与图片进入可编辑草稿。分享原文原样保留；单个短 token 只作可编辑建议，不声称已识别为游戏分享码。只有参考截图、暂时没有码时也可先收藏。
- 标题、备注、标签、自定义分类，以及“想尝试 / 试过了 / 已复刻 / 已归档”状态。原码和来源文字与用户字段分开存储；解析结果是另存的可替换缓存，旧快照不会因解析失败而删除。
- 参考图片从获得授权的 `content://` 来源复制到 App 私有目录，单张最多 15 MiB、每条最多 5 张；不修改来源文件，也不上传。删除收藏保留本地 tombstone，并清理其 App 私有参考图副本；不会删除系统相册或来源文件。
- 在 SDK 35 / AGP 8.7.3 分支中将 AndroidX Activity 固定为兼容的 1.10.1，未改动其他业务模块。

## 尚未实现，不得写成通过

- 分享码的官方或可信解析器、服装/染色映射、与已拍照片的解释性匹配；此阶段不调用 NUAN5 Photo Resolver，也不凭图片匹配推断玩家拥有服装。
- PC 同步、PC 搜索/复制界面、完整导出/恢复备份包。当前参考图是 App 私有副本，**不是跨设备备份**；`android:allowBackup="false"` 仍保持原有设置。
- 手机真机的系统分享、图片选择器、长期存储与视觉交互验收。JVM/Robolectric 和 APK 构建不能替代这些。

## 后续 PC 同步设计约束

手机本地条目与私有参考图是用户数据的来源。PC 功能应通过**现有已配对的本地认证连接**增加独立的 inspiration 接口，而不是新建公网同步服务，也不改变配对安全协议。PC 第一版只接收用户明确启用的本地同步，提供查看、搜索和复制码；不向游戏自动输入。

现有表保留稳定 UUID、用户原文、解析快照版本、修改时间和删除 tombstone。正式做双向/增量同步前还必须补单调的本地 revision/change log，不能仅用设备墙上时钟的 `updatedAt` 做游标。参考图应以内容哈希和大小校验，使用私有配对传输、配额与断点重试；服务端不得静默覆盖用户标题、备注、标签与分类。冲突时保留双方版本并要求用户选择，解析缓存可单独重算。发布任何同步 API 之前，先测试离线创建、重复上传幂等、断线续传、删除传播、旧客户端兼容与设备撤销权限。

## 本机验收记录

接手 HEAD：`1cf32ae191654654dd4b4328dffc212a249d2161`。Node 24 / npm 11、JDK 17、Android SDK 35 / Build Tools 35，使用本机已有工具链；没有读取游戏进程、修改游戏文件或上传私人图库。

- 修改前 `npm ci`、`npm run typecheck`、`npm test`（79/79）、`npm run mobile:validate` 均通过。
- 修改前 Android 构建被已有 `androidx.activity:activity:1.13.0` 与 SDK 35 / AGP 8.7.3 不兼容阻断；最小版本调整后 Android 编译和 `assembleDebug` 通过。
- 新增本地存储、私有图片复制、分享导入和 Activity 测试；各行为先观察 RED，再补实现。`gradlew.bat testDebugUnitTest --tests 'app.nikkisync.mobile.inspiration.*' assembleDebug`：Outfit 专项 15/15 通过，调试 APK 编译通过。
- 完整 `gradlew.bat testDebugUnitTest`：55 项中 53 通过、2 失败；失败均为原有非 Outfit 的 `EditedMediaAccessTest` 对未 mock 的 `android.net.Uri.parse` 的直接调用，本轮未修改该模块。完整套件不能标为通过。
- 修改后 `npm run typecheck`、`npm test`（79/79）、`npm run mobile:validate` 通过。
- APK：`apps/mobile/app/build/outputs/apk/debug/app-debug.apk`，14,921,059 字节，SHA-256 `E951F0498E57B6B263B72CA51524D718A7B5795260BEFBFA6C5DED5B21BBAB25`。这是本工作树构建，未向设备安装。`adb devices -l` 为空；手机分享入口与图片选择器真机验收未执行。
