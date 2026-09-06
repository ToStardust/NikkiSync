# GPT Handoff — 2026-09-06

本文件是 NikkiSync 当前优先交接入口。未在这里改动的历史调查、M2.3.1/M2.3.1B、M2.3.2、M2.3.3 与其他既有约束继续参考 `docs/GPT_HANDOFF_2026-09-05.md` 及对应 evidence 文档。

## 1. 当前仓库 / 分支

Repository:

```text
ToStardust/NikkiSync
```

当前工作分支：

```text
feature/m2-3-2b-auto-metadata-resolution
```

stacked base：

```text
fix/pairing-lan-endpoint
```

该 base 自己对应 open PR #5，base 为 `feature/m2-3-3-static-rotation-export`。

M2.3.2B 当前不要直接以 `main` 或 M2.3.3 作为 review base；应保持 stack 在 `fix/pairing-lan-endpoint` 上，以得到干净的 metadata-only diff。

代码实现验证 SHA：

```text
7ebdfa5a8d03ca7d5f8b8f8d7bac0fe0b617afd1
```

验证 run：

```text
34039015664
```

## 2. M2.3.2B 当前结论

目标：PC 自动解析无限暖暖照片参数并在本地缓存；Android 继续只消费 PC LAN API，不为每张照片直接访问公网。

当前：

- PASS — Windows 无配置默认启用 NUAN5-compatible resolver。
- PASS — `metadata-resolver.json` 显式 `enabled:false` 仍可关闭。
- PASS — 历史照片 backlog 不再被最早的 resolved/cooldown 批次饿死。
- PASS — 每轮真正 resolver 网络 attempt 仍最多 `batchSize`。
- PASS — NUAN5 请求默认 500ms 最小间隔。
- PASS — HTTP 429 最多重试 2 次。
- PASS — 默认在线 metadata dictionary 已接入 Windows 启动。
- PASS — filter / lighting / pose 名称与 icon enrichment。
- PASS — 精确 clothing ID → 简中名称。
- PASS — 精确 clothing ID → `https://gongeo.us/images/items/icons/<id>.png` thumbnail 引用。
- PASS — Node / Windows EXE / Android 自动化回归。
- PASS — stacked patch review，无 blocking correctness/privacy 问题。
- PENDING — Android clothing thumbnail 视觉渲染；当前只保存 canonical thumbnail 字段，详情页仍只显示名称文字。
- PENDING — physical Android 最终照片参数/详情页验收。
- NOT MERGED。

详细证据：

```text
docs/M2_3_2B_AUTO_METADATA_RESOLUTION_EVIDENCE.md
```

## 3. 默认照片 resolver

Windows selection：

```text
no config -> Nuan5CompatibleResolver
enabled:false -> disabled
```

默认 endpoint：

```text
https://nuan5.pro/api/decode-photo2
```

当前公开互操作 request 只发送：

- UID；
- NUAN5 encoded tuple；
- 本地 JPEG-prefix MD5。

不会上传：

- JPEG/MP4 源文件；
- thumbnail；
- Windows 路径。

不要把 dictionary updater 的“无 UID”描述误套到 photo resolver：photo resolver 本身需要并会发送 UID。

## 4. Backlog 规则

`AssetRepository.listMetadataResolutionCandidates(limit, offset)` 已支持 offset。

`MetadataResolverService.runOnce()` 会分页跳过：

- 已 resolved 且 resolver input/provider 未变的照片；
- 仍处 retry cooldown 的照片。

但每轮真正调用 `resolver.resolve()` 的数量仍不超过 `batchSize`。

不要回退成固定第一批 `LIMIT batchSize`，否则历史照片会再次 starvation。

非阻塞观察：超大图库周期运行时可能扫描多个本地 SQLite 页。没有 profiling 证据前不要扩大当前 bounded change 做复杂索引/队列重构。

## 5. NUAN5 pacing / retry

`Nuan5CompatibleResolver` 默认：

```text
minRequestIntervalMs = 500
maxRateLimitRetries = 2
timeoutMs = 12000
```

TDD：

- RED `33984949965`: 85 / 83 pass / 2 fail。
- GREEN `33985021210`: 85/85。

不要删除 pacing/retry，也不要改变已经验证的 request tuple、`X-Client: SpinningMomo` 或 response mapping，除非先有新的协议证据与失败测试。

## 6. 默认在线 dictionary

Provider：

```text
DefaultOnlineMetadataDictionaryProvider
```

相机字典：

```text
https://nuan5.pro/assets/data/spinning-momo-camera.json
```

服装简中名称：

```text
https://raw.githubusercontent.com/dastrokes/gongeo.us-nikki-tracker/master/app/locales/zh/item.json
```

服装 thumbnail：

```text
https://gongeo.us/images/items/icons/<id>.png
```

服装映射必须继续只认：

```text
item.<numeric-id>.name
```

禁止改成名称模糊匹配或搜索猜测。

已验证示例：

```text
1020100111 -> 馥郁时花
```

provider 对两份 source text 计算 SHA-256 combined fingerprint；未变化返回 `not-modified`。更新失败由既有 update service 保留上一份有效 cache。

该 updater 只拉静态公开 JSON，不发送 UID、asset id、路径或照片媒体。

## 7. Windows dictionary selection

默认：

```text
no config -> nikkisync-default-online
```

完整关闭：

```json
{"enabled": false}
```

文件：

```text
%LOCALAPPDATA%\NikkiSync\metadata-dictionary-remote.json
```

合法 `enabled:true` + HTTPS `remote-json` provider 会覆盖默认 provider，并保留自定义 interval。

无效 custom config 当前视为无可用 override，因此继续走 packaged default。不要把无效 JSON 当作 silent opt-out。

## 8. Android 当前展示边界

Core dictionary enrichment 已支持 generic `thumbnail` 字段，clothing enrichment 会把 thumbnail 写入 canonical metadata。

但是 Android `MetadataPresentation` 当前只读取 clothing `name` 生成文字摘要，例如：

```text
服装 14 件 · 馥郁时花、...
```

Android 尚未把每件 clothing thumbnail 渲染成卡片/图片。

因此必须区分：

```text
thumbnail data availability = PASS
thumbnail Android visual UI = PENDING
```

不要错误宣称“服装缩略图已经在手机详情页显示”。

## 9. 最终自动化证据

Run：

```text
34039015664
```

Node：

```text
npm test -- --runInBand
90 tests
90 pass
0 fail
```

Windows：

```text
npm run pc:exe
PASS
```

实际 staged：

```text
release/NikkiSync/NikkiSync-PC-service.exe
```

Windows artifact 上传成功。

Android：

```text
./gradlew testDebugUnitTest assembleDebug
BUILD SUCCESSFUL in 2m 9s
38 actionable tasks: 38 executed
```

Android debug APK artifact 上传成功。

维护警告非 blocker：

- `actions/setup-java@v4` deprecated；
- Actions Node20 target 被平台强制 Node24；
- Gradle 9 deprecation warning。

## 10. Patch review

相对：

```text
fix/pairing-lan-endpoint...feature/m2-3-2b-auto-metadata-resolution
```

代码验证阶段：

```text
ahead 22
behind 0
14 changed files
```

范围：

- PC metadata resolver/dictionary；
- Windows startup selection；
- metadata resolution candidate pagination；
- tests/root test enumeration。

没有混入：

- Android production UI；
- rotation/export；
- game-version calendar；
- M4 archive extraction。

未发现 blocking correctness/security/privacy issue。

## 11. 下一步

如果继续推进 M2.3.2B：

1. 保持 physical-device acceptance 仍为 pending。
2. 优先做 matching Windows EXE + Android APK 的真实图库验收：确认旧照片会逐步得到相机参数和中文 metadata 名称。
3. 若要继续缩略图 UX，另开 bounded Android UI change：把 `dressing.clothes[].thumbnail` 以轻量可滚动卡片展示；必须有加载失败 fallback，不能让图片 CDN 失败阻塞详情页文本。
4. 完成真实手机验收后再更新 evidence。

如果 M2.3.2B 进入 review/merge：

- 保持 stacked PR base 为 `fix/pairing-lan-endpoint`；
- 不要自动 merge；
- 先确认 parent PR #5 的状态；
- merge 前重新检查 latest head CI。

## 12. 其他安全边界

M4.2.2B encrypted VFS extraction 仍与此工作无关：

```text
investigation-complete / extraction-proof pending
```

继续禁止：

- 从进程内存取 key；
- 绕过保护；
- 131GB mass scan；
- 写入游戏安装目录。

游戏安装保持 read-only。
