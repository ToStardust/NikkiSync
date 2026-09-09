# NikkiSync Codex Build Handoff — 2026-09-09

## 0. 任务目标

用户电脑上的 NikkiSync 本地副本已经很久没有更新。不要在旧目录上直接继续开发或打包。

请从 GitHub 私有仓库重新拉取当前最新开发分支，完成验证、必要的最小修复、Windows EXE 与 Android APK 打包，然后把最终可安装/可运行产物整理到一个明确的输出目录交给用户。

仓库：`https://github.com/ToStardust/NikkiSync`

**当前必须使用的分支：**

```text
feature/m4-2-8-clothing-detail
```

编写本交接时该分支 HEAD：

```text
ccdc9fa31be0bfcbc8818eddb1c81ee50d67d93e
```

`main` 仍停在 M4.2.7，不要从 main 直接打包。

---

## 1. 获取代码：必须使用全新 checkout

优先创建一个新的目录，例如：

```powershell
$target = Join-Path $env:USERPROFILE 'Documents\NikkiSync_2026-09-09'
git clone https://github.com/ToStardust/NikkiSync.git $target
Set-Location $target
git fetch origin --prune
git checkout feature/m4-2-8-clothing-detail
git reset --hard origin/feature/m4-2-8-clothing-detail
git status
git rev-parse HEAD
```

不要把电脑上很久没更新的旧 NikkiSync 项目目录当作 source of truth，也不要把旧目录中的 `node_modules`、`dist`、Gradle build 输出或 release 二进制复制进新 checkout。

若 HEAD 已经比上面的 `ccdc9fa...` 更新，使用远端该 feature 分支的最新 HEAD，并记录实际 SHA。

---

## 2. 开工前必须阅读

按顺序读取：

```text
AGENTS.md
docs/GPT_HANDOFF_2026-09-04.md
docs/M4_2_7_PUBLIC_CLOTHING_DICTIONARY.md
docs/M4_2_8_CLOTHING_DETAIL_THUMBNAIL_PROXY.md
THIRD_PARTY_NOTICES.md
```

其中 `docs/M4_2_8_CLOTHING_DETAIL_THUMBNAIL_PROXY.md` 是本次打包版本最重要的状态说明。

---

## 3. 当前功能状态

### 已有稳定主线

- PC 为照片 source of truth，扫描 Infinity Nikki 照片目录并写 SQLite。
- Android 与 PC QR 配对、固定 TLS 指纹、Ed25519 签名请求、mDNS、WebSocket 同步链已有实现。
- 照片浏览、原图保存、厂商 Live/Motion Photo 适配已有实现。
- 普通照片旋转功能此前已实机确认正常。
- NUAN5-compatible resolver 已实现，照片原生参数 payload/token 不会通过 LAN API 下发。
- Metadata resolver pipeline 已支持多 provider、优先级和 fallback。
- Metadata dictionary 已支持远程热更新和 re-enrich。

### M4.2.7 — 真实服装字典

已加入 `NikkiAlbumsMetadataDictionaryProvider`：

- 公开热更新数据可把 `102xxxxxxxx` clothing ID 映射为本地化名称、部位/category、缩略图 URL。
- 数据源是显式 opt-in，不会自动启用。
- 不上传 UID、照片、token、payload 或照片派生 hash。
- 当前没有可信的 rarity 字段，因此不要猜稀有度。

### M4.2.8 — 当前 feature 分支新增

目标是 Android 照片详情直接显示真实服装信息，并由 PC 代理/缓存服装图标。

已经写入的代码包括：

- `apps/pc-companion/src/metadata/MetadataThumbnailCache.ts`
- `apps/pc-companion/src/server/LocalSyncServer.ts` 新增签名路由：
  - `GET|HEAD /v1/assets/:assetId/clothing/:clothingId/thumbnail`
- `apps/pc-companion/src/windows-app.ts` 和 `dev-server.ts` 接入 PC 缩略图缓存。
- `apps/mobile/app/src/main/java/app/nikkisync/mobile/MainActivity.java`
  - 照片详情改为可滚动；
  - 显示 `穿搭 · N 件`；
  - 每件显示名称、中文部位、10 位 ID、可选缩略图。
- `apps/mobile/app/src/main/java/app/nikkisync/mobile/media/ImageLoader.java`
  - 通过已配对 PC 加载 clothing thumbnail，不直接访问第三方图床。
- `apps/mobile/app/src/main/java/app/nikkisync/mobile/net/NikkiSyncClient.java`
  - clothing thumbnail route 客户端调用。
- Protocol v1 增加 additive route builder，不提升协议主版本。

安全边界：

- 手机端不能传任意 URL 给 PC 代理。
- PC 必须先确认 clothing ID 确实存在于目标照片的 `dressing.clothes`。
- 上游缩略图只允许 HTTPS。
- 默认只接受 PNG/JPEG/WebP，单图默认最大 2 MiB、10 秒超时。
- 拒绝 localhost、`.local`、私网字面 IP 和 URL credentials 等明显本地目标。
- 缩略图失败必须只降级图标，不能影响照片详情文字、相机参数编辑或原图保存。

---

## 4. 本次 Codex 的首要任务：先验证，再打包

当前 feature 分支是在 GitHub-only 环境写入的，**此前没有真实执行本地 typecheck/test/Gradle build**。不要把“已有测试文件”误认为“测试已通过”。

从全新 checkout 开始：

```powershell
npm ci
npm run typecheck
npm test -- --runInBand
npm run mobile:validate
```

如果其中任何一步失败：

1. 先定位真正的编译/测试问题；
2. 只做与 M4.2.8 构建或既有回归直接相关的最小修复；
3. 不重新设计整个项目；
4. 每次修复后重新跑 focused test，再跑上述完整验证；
5. 保持现有隐私/安全边界；
6. 不要为了让测试过而删除或弱化有效测试。

如果修复了 feature 分支代码，保留清晰 commit；如已配置 GitHub push 权限，可推回 `feature/m4-2-8-clothing-detail`，但**不要自动 merge 到 main**。

---

## 5. Android 构建

根脚本：

```powershell
npm run mobile:build
```

实际脚本：

```text
apps/mobile/scripts/build-android.ps1
```

标准 APK 输出：

```text
apps/mobile/app/build/outputs/apk/debug/app-debug.apk
```

该脚本会额外执行：

- APK signature verification；
- package id `app.nikkisync.mobile` 校验；
- 输出 APK SHA256。

### 如果硬编码的本机 JDK/Android SDK 路径已经过期

不要因此改业务代码。先自动发现本机现有工具链。

构建脚本接受：

```powershell
- JavaHome
- AndroidSdk
- GradleBat
```

可以直接调用：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\apps\mobile\scripts\build-android.ps1 `
  -JavaHome '<实际 JDK17/JBR17 路径>' `
  -AndroidSdk '<实际 Android SDK 路径>' `
  -GradleBat '<实际 Gradle/gradlew.bat 路径>'
```

要求仍然是 JDK 17、Android SDK 35 / Build Tools 35.x 和可用 Gradle。

**不要自动安装 APK 到手机**，除非用户另外明确要求。

---

## 6. Windows EXE 构建

根脚本：

```powershell
npm run pc:exe
```

其内部调用：

```text
apps/windows-shell/package.ps1
```

Windows 打包需要：

- Bun（用于把 `windows-app.ts` 编译为 consoleless Windows service EXE）；
- .NET SDK / WPF publish 环境；
- Node/npm 已完成 monorepo build。

最终 Windows release 目录：

```text
release/NikkiSync/
```

必须至少存在：

```text
release/NikkiSync/NikkiSync-PC.exe
release/NikkiSync/NikkiSync-PC-service.exe
release/NikkiSync/migrations/0001_initial.sql
```

不要只给用户 `NikkiSync-PC.exe` 而漏掉同目录 service/migrations；桌面壳与 service 是两个独立 executable。

可额外运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\apps\windows-shell\package.ps1 -VerifyOnly
```

验证 release layout。

---

## 7. 推荐最终打包动作

当且仅当 typecheck、Node tests、mobile validate 已通过后：

```powershell
npm run release:bundle
```

该脚本会构建 Android + Windows，并把 Android APK复制到：

```text
release/NikkiSync/NikkiSync-Android.apk
```

最终用户需要拿到完整的：

```text
release/NikkiSync/
  NikkiSync-PC.exe
  NikkiSync-PC-service.exe
  NikkiSync-Android.apk
  migrations/
    0001_initial.sql
  ...WPF publish 所需的其它文件（如有）
```

建议另外复制到：

```powershell
$out = Join-Path $env:USERPROFILE 'Desktop\NikkiSync_M4.2.8_build'
```

不要删除 `release/NikkiSync` 原始输出。

---

## 8. 最终交付前必须记录

向用户汇报：

1. 实际 checkout 分支；
2. 实际最终 commit SHA；
3. `npm run typecheck` 结果；
4. `npm test -- --runInBand` 结果（通过数/失败数）；
5. `npm run mobile:validate` 结果；
6. Android build 是否通过；
7. APK 路径、文件大小、SHA256；
8. Windows package 是否通过；
9. `NikkiSync-PC.exe`、`NikkiSync-PC-service.exe` 路径；
10. Windows release layout verify 结果；
11. 如果 M4.2.8 为了构建做了修复，列出 commit 和修改文件；
12. 尚未完成的实机验收项目。

### 当前仍属于实机验收项

即便自动构建全绿，也不要伪称下列项目已验收，除非本次真的连接并测试：

- 已解析照片在 Android 详情页真实显示服装名称/部位/ID；
- 至少一个服装缩略图通过 PC proxy/cache 成功显示；
- 禁止上游图标访问时详情页仍能正常显示文字；
- PC/Android 在真实局域网重新配对并正常浏览照片。

---

## 9. 不要做的事情

- 不要从旧电脑目录继续打包，除非只是作为只读参考。
- 不要切回 main 后把 M4.2.8 丢掉。
- 不要绕过加密游戏归档保护或读取进程内存找 archive key。
- 不要上传源照片到第三方 metadata/dictionary provider。
- 不要让 Android 直接信任/访问第三方服装图床。
- 不要猜 clothing rarity。
- 不要为了快速交付拿旧 APK/EXE 冒充当前 feature 分支构建。
- 不要在验证失败时仍声称“当前版本已打包成功”。

---

## 10. 本次任务完成定义

最理想结果：

```text
fresh clone
→ checkout feature/m4-2-8-clothing-detail
→ npm ci
→ typecheck PASS
→ full tests PASS
→ mobile:validate PASS
→ Android APK build + signature/package verification PASS
→ Windows WPF host + Bun service package PASS
→ release layout verify PASS
→ 把完整 release/NikkiSync 交给用户
```

如果遇到构建错误，优先修复并完成以上链路；只有在确实受本机缺失 SDK/工具链/权限阻塞时，才停止并明确报告缺失项及已完成到哪一步。