# M2.3.1B 游戏版本日历与日期推断｜验收证据

状态：**自动化验收通过；Android 实机版本分组视觉/交互验收仍待执行。**

日期：2026-09-05

分支：

```text
feature/m2-3-1b-game-version-calendar
```

父分支：

```text
feature/m2-3-1-game-version-gallery
```

Stacked PR：

```text
#2 M2.3.1B: infer gallery game versions from cached calendar
base: feature/m2-3-1-game-version-gallery
```

## 1. 本阶段目标

M2.3.1B 只补 PC 侧的小型版本日历、缓存与推断链，不改变 Android 为每张照片联网查询的边界，也不进入 Viewer、旋转或 Live Photo 转码。

最终 summary 决策顺序：

```text
metadata.identity.gameVersion (explicit)
    > 本地缓存版本日历按可信时间推断 (inferred)
    > unknown
```

可信时间选择顺序：

```text
metadata.capture.capturedAt
    > assets.captured_at（legacy）
    > source resource birth_time
    > source resource modified_at
```

`derived_preview` / thumbnail 等派生资源时间不能用于版本推断。没有可信时间或日历无法匹配时继续返回 `unknown`。

注意：resource 的 birth/modified fallback **只用于版本归属推断**，不会偷换 API 的 `capturedAt` 字段语义。

## 2. 已实现组件

### Calendar / validation

```text
apps/pc-companion/src/game-version/GameVersionCalendar.ts
```

- 日历 boundary 按 UTC 时间比较。
- `availableAt` 必须是有效且以 `Z` 结尾的 UTC timestamp。
- manifest 的 `sourceUrls` 必须使用 HTTPS。
- 无效时间不会强制归类。

### 本地缓存

```text
apps/pc-companion/src/game-version/GameVersionCalendarStore.ts
```

- 复用现有 `app_settings`。
- 不新增数据库表。
- key：`game_version_calendar_snapshot`。
- PC runtime 重建后仍可从最后一份有效 snapshot 离线 resolve。
- 读取持久化 snapshot 时重新执行 manifest 校验；旧 schema、半损坏对象或非法 JSON 被视为 calendar unavailable，而不是让 `/v1/assets` 失败。
- runtime 遇到 unavailable cache 会按现有逻辑回退 built-in seed。
- 更新 calendar 不要求重新下载照片，也不要求重新扫描游戏媒体。

### 保守内置 seed

```text
apps/pc-companion/src/game-version/BuiltinGameVersionCalendar.ts
```

当前只内置已核实的两个版本边界：

```text
2.8 -> 2026-07-17T03:00:00.000Z
2.9 -> 2026-08-28T03:00:00.000Z
```

来源 URL 已随 manifest 保存：

```text
https://infinitynikki.infoldgames.com/en/news/559
https://infinitynikki.infoldgames.com/en/news/583
```

2.8 之前不猜版本，继续归 `unknown`。后续远程 verified calendar 可扩展历史/未来版本，不需要升级 Android APK。

### Remote provider / updater

```text
apps/pc-companion/src/game-version/RemoteJsonGameVersionCalendarProvider.ts
apps/pc-companion/src/game-version/GameVersionCalendarUpdateService.ts
apps/pc-companion/src/game-version/GameVersionCalendarRemoteConfigFile.ts
```

生产联网是显式 opt-in：

```text
APP_DATA/game-version-calendar-remote.json
```

只有配置同时满足以下条件才启用：

- `enabled: true`
- provider type = `remote-json`
- endpoint = HTTPS
- 字段类型合法

远程请求行为：

- bodyless GET；
- 支持 ETag / If-None-Match；
- 支持 Last-Modified / If-Modified-Since；
- 默认更新周期 6 小时；
- provider/manifest 校验失败或网络失败时保留上一份有效 snapshot；
- 不携带 UID、assetId、照片字节、照片 metadata envelope 或 NUAN5 decode tuple。

### Runtime / Local Sync 接线

```text
apps/pc-companion/src/runtime.ts
apps/pc-companion/src/server/LocalSyncServer.ts
apps/pc-companion/src/server/row-mappers.ts
apps/pc-companion/src/windows-app.ts
```

- 空缓存启动时装入 built-in seed。
- 已有**有效**缓存绝不被 built-in seed 覆盖。
- 无效缓存按 unavailable 处理，避免损坏 gallery API。
- runtime 把 store resolver 注入 `LocalSyncServer`。
- `/v1/assets` 在生成 `AssetSummary` 时执行 explicit > inferred > unknown。
- remote updater 属于 runtime 生命周期：`start()` 启动，`stop()` 停止。
- `windows-app.ts` 只负责读取显式本地 HTTPS opt-in 配置，不硬编码远程 endpoint。
- Android 不新增逐张联网路径。

## 3. TDD 证据

本阶段实际经历了 RED -> GREEN，而不是只补成功测试。

代表性 RED：

- `GameVersionCalendar` 尚不存在时，新 calendar 测试 TypeScript 编译失败。
- `mapAssetSummary` 尚未接受 resolver 时，测试以参数数量错误失败。
- 测试抓到“没有可信 timestamp 仍调用 resolver”会误判版本，生产代码随后修成无可信时间即保持 unknown。
- `GameVersionCalendarStore` 尚不存在时，持久化测试编译失败。
- remote provider/update service 尚不存在时，对应测试编译失败。
- remote config loader 尚不存在时，对应测试编译失败。
- runtime/server wiring RED（GitHub Actions run `33900425958`）明确失败于：
  - `LocalSyncServerConfig` 缺 `gameVersionResolver`；
  - `PcCompanionRuntimeConfig` 缺 `gameVersionCalendarRemote`；
  - runtime 缺 calendar store/updater 成员。
- PR patch review 后新增 malformed-cache RED（GitHub Actions run `33903788034`）：
  - 总计 74 tests；73 pass / 1 fail；
  - 唯一失败测试 `calendar store treats a malformed persisted snapshot as unavailable`；
  - 实际值证明旧实现会把缺少 `entries` 的坏 snapshot 原样返回。

随后只在 `GameVersionCalendarStore.manifest()` 的持久化信任边界补严格解析；没有改变 server/auth/protocol/Android 行为。

## 4. 自动化验证

### 4.1 Review hardening 后的 PC 生产代码

HEAD：

```text
f0d2f35bd774571f3820cf0edc2cbe3fc3884285
```

GitHub Actions run：

```text
33903877387
```

Windows / Node 24：

```text
npm test -- --runInBand
```

结果：

```text
tests 74
pass  74
fail  0
cancelled 0
skipped   0
```

新测试实际覆盖：

- UTC boundary resolve；
- built-in 仅保守覆盖 2.8 / 2.9；
- explicit 永远优先；
- canonical capture -> birth -> modified fallback；
- derived resource timestamp 禁止推断；
- app_settings snapshot 持久化与 runtime 重建；
- malformed persisted snapshot 视为 unavailable；
- conditional GET；
- remote failure 保留旧 snapshot；
- remote 请求无照片/UID 标识；
- non-UTC boundary 拒绝；
- explicit enabled + HTTPS 配置门槛；
- LocalSyncServer `/v1/assets` 真实返回 inferred，同时保留 explicit；
- runtime 空缓存 seed、已有有效缓存不覆盖、构造 remote updater 不触发网络。

### 4.2 Android baseline

在 review hardening 前、相同 M2.3.1B 生产接线且 Android 源码完全相同的 final-head run：

```text
HEAD d42317979b89c16970926d6f4ac0274f4b4892b8
run 33903179024
```

执行：

```text
./gradlew testDebugUnitTest assembleDebug
```

日志实际经过：

```text
:app:testDebugUnitTest
:app:assembleDebug
```

最终：

```text
BUILD SUCCESSFUL
38 actionable tasks: 38 executed
```

Review hardening 只改 PC calendar store 与其 Node 测试；文档更新后会再次触发最终 branch CI。合并前必须检查 PR 最新 HEAD 的 Node + Android 两个 job，而不能只引用旧 HEAD。

## 5. PR patch review 结论

PR #2 changed-files 范围与 M2.3.1B 一致：PC calendar/runtime/server、对应测试、交接文档与根 test script；**没有 Android UI 源码、NUAN5、M4 archive 或其他无关行为扩散。**

Review 发现的 malformed-cache blocking issue 已按上面的 RED -> GREEN 闭环修复。当前未发现第二个 blocking correctness/security 问题。

非阻塞后续优化：当前 resolver 在每张 summary 上读取本地 calendar store；这是本地 SQLite/JSON 路径，不会联网，也不会改变结果。若大图库 profiling 显示这里成为热点，可后续把已验证 manifest/calendar 做进程内缓存，不应在本次 bounded change 中无证据提前扩展。

## 6. 已知未完成项

不得把以下内容写成已经验收：

- Android 实机版本分组首页的视觉/交互验收；
- 完整历史版本日历（当前 built-in 只核实 2.8/2.9）；
- M2.3.2 full-screen viewer + metadata sheet；
- M2.3.3 非破坏旋转状态 + rotated still export；
- M2.3.4 视觉 polish / predictive back；
- M3 rotated LIVE export；
- M4.2.2B 本地游戏归档提取证明（仍受合法 archive key/config 缺失阻塞）。

## 7. 后续推荐顺序

```text
手机实机验收 M2.3.1 + M2.3.1B 版本分组首页
-> M2.3.2 full-screen viewer + metadata sheet
-> M2.3.3 still rotation state + rotated JPEG export
-> M2.3.4 visual polish / predictive back
-> M3 rotated LIVE export per vendor
```

M4.2.2B 保持冻结，除非出现合法、可记录的 CUE4Parse-compatible archive key/config 来源。禁止从进程内存获取密钥或绕过游戏保护。
