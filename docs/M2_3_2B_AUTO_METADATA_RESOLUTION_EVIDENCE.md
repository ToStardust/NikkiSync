# M2.3.2B 自动照片参数解析 — 验收证据

Last updated: 2026-09-06

## 结论

M2.3.2B 的 PC 端实现与自动化回归已通过：Windows Companion 默认启用 NUAN5-compatible 照片参数解析，并使用静态公开字典补充滤镜、灯光、姿势和服装名称/缩略图引用。Android 继续作为局域网消费者，不对每张照片访问公网。

当前状态：

- PASS — 默认自动照片参数解析。
- PASS — 历史图库后台 backlog 可跨过已解析记录持续推进。
- PASS — NUAN5 请求 500ms 最小间隔与 HTTP 429 最多 2 次重试。
- PASS — 静态在线字典默认启用，并支持显式关闭/自定义 HTTPS provider 覆盖。
- PASS — 精确服装 ID → 简中名称与缩略图 URL enrichment。
- PASS — Node / Windows EXE / Android 自动化验证。
- PASS — stacked diff 范围与隐私边界复核。
- PENDING — Android 详情页把 clothing thumbnail 实际渲染成图片；当前 canonical metadata 已携带 thumbnail，但 UI 仍只展示名称文字。
- PENDING — 物理 Android 设备上的最终照片参数/详情页验收。
- NOT MERGED。

## 分支与基线

实现分支：

```text
feature/m2-3-2b-auto-metadata-resolution
```

实现验证 SHA：

```text
7ebdfa5a8d03ca7d5f8b8f8d7bac0fe0b617afd1
```

stacked base：

```text
fix/pairing-lan-endpoint
```

最终代码 diff 复核时：

```text
ahead 22
behind 0
changed files 14
```

变更范围只包含 PC metadata resolver/dictionary、候选查询与对应测试；没有 Android UI production 变更，没有 rotation/export、game-version calendar 或 M4 archive 变更。

## 1. 默认 NUAN5-compatible resolver

Windows 正常启动不再要求用户预先创建 `metadata-resolver.json`。

选择规则：

1. 无本地配置 → 默认 `Nuan5CompatibleResolver`。
2. 显式 `enabled:false` → 关闭自动解析，保留诊断/紧急停用入口。
3. 其他已有自定义配置/环境变量语义继续保留。

默认请求协议仍沿用 M4.1 已验证互操作契约：

```text
POST https://nuan5.pro/api/decode-photo2
Content-Type: application/json
X-Client: SpinningMomo
```

每张照片只发送解析所需的 UID、NUAN5 tuple 与本地计算的 JPEG-prefix MD5；不发送 JPEG/MP4 源文件、缩略图、Windows 本地路径。

需要明确区分：照片 resolver 会发送该照片所属 UID；后述静态 dictionary updater 不发送 UID 或照片标识。

## 2. 历史图库 backlog 修复

原先候选查询使用固定 `LIMIT batchSize`。如果最早一批记录已经 resolved 或仍处于 retry cooldown，它们会被反复取出，导致后续历史照片永远进不了真正的 resolver 批次。

现在数据库候选查询支持 `limit + offset`，resolver service 会分页跨过：

- 已成功解析且输入/provider 未变化的记录；
- 当前仍在 retry cooldown 的记录。

同时每次 `runOnce()` 真正发出的 resolver 网络尝试仍最多为 `batchSize`，不会因为跨页而一次扫完整个图库并全部联网。

回归覆盖 `batchSize=1` 的多张历史照片，确认逐轮从第一张推进到第二、第三张。

非阻塞观察：超大图库中，周期性 run 可能需要扫描多个本地 SQLite 页来跳过已解析记录。当前没有 correctness/privacy 问题，也没有 profiling 证据要求在本 bounded change 内继续优化。

## 3. NUAN5 请求稳定性

`Nuan5CompatibleResolver` 当前默认：

```text
minimum request interval = 500 ms
HTTP 429 retry limit = 2
request timeout = 12 s
```

这只影响发送节奏，不改变已验证的 request body、response mapping、缓存与 source-media 边界。

TDD 证据：

- RED run `33984949965`: 85 tests / 83 pass / 2 fail。
  - HTTP 429 第一发直接抛错。
  - 连续请求间隔实测 0ms。
- GREEN run `33985021210`: 85/85 PASS。
  - `NUAN5 resolver retries HTTP 429 up to the configured limit`
  - `NUAN5 resolver spaces consecutive sends by the configured minimum interval`

## 4. 默认在线 metadata dictionary

PC 使用 `DefaultOnlineMetadataDictionaryProvider` 读取两份静态公开数据，然后转换为 NikkiSync 自己的 canonical dictionary。

### 相机相关字典

默认：

```text
https://nuan5.pro/assets/data/spinning-momo-camera.json
```

映射：

- `filters` → `filter`
- `lights` → `lighting`
- `poses` → `pose`
- 名称优先 `zh`，其次 `en`
- 上游 `icon` 存在时写入 `thumbnail`

该 URL、`v/d/poses/filters/lights` 结构与 6 小时缓存策略均已从当前公开 SpinningMomo interoperability source 验证。

### 服装字典

默认简中名称源：

```text
https://raw.githubusercontent.com/dastrokes/gongeo.us-nikki-tracker/master/app/locales/zh/item.json
```

只接受精确键：

```text
item.<numeric-id>.name
```

不进行模糊匹配或名称猜测。

已验证示例：

```text
1020100111 -> 馥郁时花
```

缩略图引用使用该 tracker 自身代码采用的精确 item-ID 路径：

```text
https://gongeo.us/images/items/icons/<id>.png
```

因此示例 canonical entry 可得到：

```text
kind=clothing
id=1020100111
name=馥郁时花
thumbnail=https://gongeo.us/images/items/icons/1020100111.png
```

注意：当前 Android `MetadataPresentation` 只把 clothing `name` 拼入文字摘要；thumbnail 字段已经进入 canonical metadata，但 Android 图片卡片渲染尚未做，不能把这一项标记为视觉验收通过。

## 5. dictionary 更新与缓存语义

默认 provider：

- 并行 GET camera JSON 与 clothing JSON；
- 对两份文本计算 SHA-256 combined fingerprint；
- fingerprint 未变化 → `not-modified`；
- 更新成功 → 替换 canonical dictionary snapshot 并 re-enrich 已解析照片；
- 更新失败 → 保留上一份有效 snapshot；
- 默认更新周期由既有 `MetadataDictionaryUpdateService` 保持 6 小时。

静态 dictionary updater 只获取公开 JSON，不发送 UID、asset id、照片路径、resolver tuple、JPEG/MP4 或其他每张照片数据。

## 6. Windows 默认选择与显式 opt-out

`MetadataDictionarySelection` 当前规则：

1. 无配置 → 默认 `nikkisync-default-online`。
2. `metadata-dictionary-remote.json` 只有：

```json
{"enabled": false}
```

即可完整关闭默认在线 dictionary updater。
3. 显式 `enabled:true` + 合法 HTTPS `remote-json` provider → 自定义 provider 覆盖默认 provider，interval 继续生效。
4. 无效自定义配置不会替换默认 provider。

这与照片 resolver 的显式关闭入口相互独立。

## 7. TDD 关键证据

### dictionary adapter

- 初始 adapter GREEN: run `33985582020`
  - Node 87/87 PASS
  - Windows EXE PASS
  - Android PASS

### clothing thumbnail

- RED commit `c71d095b3f12e9bdd2b509df1ee7253d4c24adf5`
- RED run `34038550505`
  - Node 87 tests / 86 pass / 1 fail
  - actual `thumbnail === undefined`
  - expected exact `https://gongeo.us/images/items/icons/1020100111.png`
- GREEN production commit `0593313dc8ee1b2a4a1fb87840e93503b0437553`
- GREEN run `34038646943`
  - Node 87/87 PASS
  - Windows EXE PASS
  - Android PASS

### Windows default dictionary selection

- RED run `34038894632`
  - Node/Windows compile fail because `MetadataDictionarySelection` did not exist.
- final GREEN run `34039015664`
  - Windows no-config default provider test PASS
  - explicit `enabled:false` test PASS
  - explicit custom HTTPS override test PASS

## 8. 最终自动化验证

实现验证 run：

```text
34039015664
```

Node job：

```text
npm test -- --runInBand
90 tests
90 pass
0 fail
0 cancelled
0 skipped
0 todo
```

Windows job：

```text
npm run pc:exe
PASS
```

并实际生成：

```text
NikkiSync-PC-service.exe
release/NikkiSync/
```

Windows pairing bundle artifact 上传成功。

Android job：

```text
./gradlew testDebugUnitTest assembleDebug
BUILD SUCCESSFUL in 2m 9s
38 actionable tasks: 38 executed
```

Android debug APK artifact 上传成功。

CI 仅保留非阻塞维护警告：`setup-java@v4` 弃用、部分 Actions Node 20 目标被平台强制以 Node 24 运行，以及 Gradle 9 兼容性 deprecation warning。这些不是 M2.3.2B correctness blocker。

## 9. Patch review

以 `fix/pairing-lan-endpoint` 为 base 检查最终实现 diff：

- metadata resolver 默认选择：scope 正确；
- backlog pagination：修复 starvation，同时保留每轮网络 attempt 上限；
- 500ms / 429 retry：不改变请求协议与响应映射；
- online dictionary：只读静态公开 JSON，精确 ID 映射；
- Windows 默认接线：运行期启动 updater，构造阶段不主动联网；
- explicit opt-out/custom provider：保留；
- Android production source：本 stacked diff 未修改；
- source media transfer：未新增；
- rotation/export/game-version/M4 archive：未混入。

未发现新的 blocking correctness/security/privacy 问题。

## 10. 后续验收

下一步优先：

1. 产出 matching Windows EXE + Android APK，在真实 Windows 游戏图库上启动。
2. 观察旧照片是否逐步获得 focal/aperture/exposure/filter/light/clothing 等参数。
3. 手机详情页确认中文服装/滤镜/灯光名称刷新正确。
4. 单独实现 Android clothing thumbnail 的视觉渲染后再做 thumbnail UI 验收。
5. 完成真实 Android 设备交互验收后，才能把 physical acceptance 标为 PASS。
