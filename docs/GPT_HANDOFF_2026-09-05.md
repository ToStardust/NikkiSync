# NikkiSync GPT 交接｜2026-09-05

这份文档是 2026-09-05 起的最新事实基线。未在本文改写的历史调查、M4.2.2B 归档证据与安全边界继续参考 `docs/GPT_HANDOFF_2026-09-04.md`；若两者对当前实现状态有冲突，以本文为准。

## 1. 项目 / 仓库 / 安全边界

项目：NikkiSync，《无限暖暖》本地摄影同步 App。

私有仓库：

```text
ToStardust/NikkiSync
```

本地 NikkiSync workspace：

```text
D:\GAME\InfinityNikki Launcher\InfinityNikki\X6Game\CameraPartner\NikkiSync
```

游戏安装目录继续保持只读：

```text
D:\GAME\InfinityNikki Launcher\InfinityNikki\X6Game
```

不要扩大可写 workspace 到游戏目录；不要从进程内存取得 archive key；不要绕过游戏保护；不要提交密钥、配对凭据、OAuth 临时密码或游戏资源。

新生产行为继续遵循：失败测试 -> focused test -> 相关全量回归 -> 记录真实证据。不要把自动化构建成功写成实机视觉/设备兼容验收。

## 2. 当前 GitHub 分支关系

M2.3.1 parent：

```text
feature/m2-3-1-game-version-gallery
```

对应 PR：

```text
#1 M2.3.1: add game-version gallery grouping
base: main
```

M2.3.1B 当前分支：

```text
feature/m2-3-1b-game-version-calendar
```

M2.3.1B 必须作为 stacked PR 指向 M2.3.1 parent；不要直接把这一分支的完整堆叠 diff 当成独立 main PR，也不要自动 merge。

## 3. 当前主线已完成能力

已有并应复用，不要重复造平行实现：

- PC 游戏目录自动发现、ScreenShot/Video/隐藏 GamePlayPhotos 资源选择、稳定文件判定、去重与删除日志。
- M1.1 Local Sync Server：配对、认证、分页、Range、journal、WebSocket、本地 TLS 身份。
- Android Gallery MVP：扫码配对、实时刷新、多选、原图/Live 保存与现有厂商适配。
- NUAN5 resolver：发送已验证 decode tuple、UID/token、MD5；不发送源照片字节。
- Metadata dictionary：本地 manifest、显式 opt-in remote JSON、ETag/Last-Modified、失败保留快照、local re-enrich、用户覆盖优先。
- M4.2.1：NUAN5 clothes IDs 已确认属于真实 `102xxxxxxxx` Infinity Nikki entity ID 空间。
- Windows Shell 单实例：第二实例只激活已有实例，不再重复启动固定 28950 service；自动化已验证，桌面双开实机验收仍待确认。
- M2.3.1：Protocol / PC summary / Android 已支持 `gameVersion` + `gameVersionSource`，Android 首页按版本分组，semantic version 数值排序，unknown 最后，inferred-only group 显示“自动推测”。
- **M2.3.1B：PC cached game-version calendar + timestamp inference 已完成自动化验收。**

## 4. M2.3.1B 当前事实

完整证据：

```text
docs/M2_3_1B_GAME_VERSION_CALENDAR_EVIDENCE.md
```

### 4.1 Summary 决策

```text
metadata.identity.gameVersion (explicit)
    > cached calendar inference (inferred)
    > unknown
```

可信时间顺序：

```text
metadata.capture.capturedAt
    > assets.captured_at
    > source resource birth_time
    > source resource modified_at
```

派生 preview / thumbnail 时间不参与推断。无可信时间或日历无匹配时保持 unknown。

Resource fallback 只用于版本推断；不会把 birth/modified 偷换成 API 的 `capturedAt`。

### 4.2 Calendar / cache

主要入口：

```text
apps/pc-companion/src/game-version/GameVersionCalendar.ts
apps/pc-companion/src/game-version/GameVersionCalendarStore.ts
apps/pc-companion/src/game-version/BuiltinGameVersionCalendar.ts
```

- snapshot 复用 `app_settings`，不新增 DB table。
- PC 重启后可继续使用最后一份有效 snapshot 离线推断。
- 空缓存 runtime 会装入 built-in seed。
- 已有缓存绝不被 built-in seed 覆盖。
- built-in 目前只保守覆盖官方已核实的 2.8 / 2.9：

```text
2.8 -> 2026-07-17T03:00:00.000Z
2.9 -> 2026-08-28T03:00:00.000Z
```

2.8 之前继续 unknown，不能为了填满分组而猜历史版本。

### 4.3 Remote calendar

入口：

```text
apps/pc-companion/src/game-version/RemoteJsonGameVersionCalendarProvider.ts
apps/pc-companion/src/game-version/GameVersionCalendarUpdateService.ts
apps/pc-companion/src/game-version/GameVersionCalendarRemoteConfigFile.ts
```

生产联网只有本地配置显式满足以下条件才启用：

```text
APP_DATA/game-version-calendar-remote.json
enabled: true
provider.type: remote-json
provider.endpoint: HTTPS
```

行为：bodyless GET；ETag/Last-Modified 条件请求；默认 6h；失败保留上一份有效 snapshot；不发送 UID、assetId、照片字节、metadata envelope 或 NUAN5 tuple。

Android 不做逐张版本联网查询。未来新版本可仅更新 PC 侧小型 calendar JSON，而不要求升级 Android APK。

### 4.4 Runtime / server wiring

入口：

```text
apps/pc-companion/src/runtime.ts
apps/pc-companion/src/server/LocalSyncServer.ts
apps/pc-companion/src/server/row-mappers.ts
apps/pc-companion/src/windows-app.ts
```

- runtime owns calendar store/updater lifecycle。
- LocalSyncServer 只接受可选 resolver，并在 `/v1/assets` summary mapping 使用。
- explicit metadata 不会被 calendar 覆盖。
- windows-app 只读取显式本地 opt-in config，不硬编码 remote endpoint。

## 5. 自动化验收基线

M2.3.1B 最终生产代码验证 HEAD（文档提交前）：

```text
f788b5c989d33b820c046045334836205d2ffbff
```

GitHub Actions run：

```text
33902625997
```

Windows / Node 24：

```text
npm test -- --runInBand
73 tests / 73 passed / 0 failed
```

Android：

```text
./gradlew testDebugUnitTest assembleDebug
:app:testDebugUnitTest
:app:assembleDebug
BUILD SUCCESSFUL
38 actionable tasks: 38 executed
```

文档 commit 会触发新的 CI；在创建/更新最终 PR 或声称最终 HEAD 全绿前，必须再次检查最新 HEAD 的 workflow，而不能只引用上述旧 HEAD。

当前非阻塞 CI maintenance warning：`actions/setup-java@v4` 已被上游标记 deprecated；这是 workflow maintenance，不属于 M2.3.1B 业务范围。

## 6. 实机仍待验收

以下内容不能因为 CI 通过就写成已经完成：

- Android 实机版本分组首页的视觉/交互表现；
- “自动推测”标签在真实照片库中的实际分组结果；
- Windows Shell 桌面双开激活体验；
- 各厂商 rotated LIVE export（尚未实现）。

## 7. 后续开发顺序

M2.3 推荐顺序更新为：

```text
先做手机实机验收 M2.3.1 + M2.3.1B 版本分组首页
-> M2.3.2 full-screen viewer + metadata sheet
-> M2.3.3 still rotation state + rotated JPEG export
-> M2.3.4 visual polish / predictive back
-> M3 rotated LIVE export per vendor
```

若用户直接要求继续开发而暂时不做实机验收，可以进入 M2.3.2，但必须保留“版本分组实机验收 pending”状态，不得自动视为验收通过。

## 8. M4.2.2B 继续冻结

M4.2.2B 本地字典归档探针仍是：

```text
investigation-complete / extraction-proof pending
```

真实 Content/Paks 容器可识别但受加密阻塞；没有合法、可记录的 CUE4Parse-compatible key/config 来源时不要继续暴力扫描，不要读取进程内存，不要绕过保护，不要把游戏安装目录变为可写。

相关文档继续参考：

```text
docs/M4_2_2B_LOCAL_DICTIONARY_EXTRACTION.md
docs/M4_2_2_CLOTHING_ID_ALIGNMENT_EVIDENCE.md
```

## 9. 后续 GPT / Codex 接手检查清单

1. 先读本文件。
2. M2.3 移动端工作再读 `docs/M2_3_MOBILE_GALLERY_UI_REQUIREMENTS.md`。
3. M2.3.1B 证据读 `docs/M2_3_1B_GAME_VERSION_CALENDAR_EVIDENCE.md`。
4. 确认 GitHub branch/PR base，避免把 stacked branch 误当 main 独立分支。
5. 新行为继续 TDD；最终结论来自实际 CI/本地命令，不从代码推测。
6. 不自动 merge PR。
