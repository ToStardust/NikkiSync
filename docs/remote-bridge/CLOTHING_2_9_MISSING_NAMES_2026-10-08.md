# 2.9 穿搭有缩略图但无名称：调查与核验补充｜2026-10-08

## 结论

这批照片缺失的名称已经缺在当前 PC 数据库和公开中文语言包中，不是 Android/小程序/分享图把已解析名称漏显示。部件 ID 与图标地址存在；图标模板独立于中文名称表，因此可以有图无名。

## 实际运行与样本范围

- 正在运行 release/NikkiSync-Reconnect/NikkiSync-PC.exe 及 runtime/NikkiSync-PC-service.exe。
- 只读打开本机数据库 %LOCALAPPDATA%/NikkiSync/nikkisync.sqlite，使用 SQLite URI mode=ro，未更新数据库或启动解析任务。
- 当前应用版本日历将 2026-08-28T03:00:00Z 起的照片推定为 2.9。按此应用日历统计，50 张照片中 43 张有穿搭，42 张缺相同的 8 个部件名。这个统计是应用日历推定，不声称每张照片都携带显式 gameVersion。
- 42 张照片中这 8 个部件均有 ID；照片元数据与字典都没有 name。没有“字典已有名称、照片没更新”的条目。
- 部件所属套装 ID 为 10419。最近样本有 16 个部件：8 个已有名称，8 个缺名。已有名称对照包括“浮金星点”“浅浅蜜糖”等。

| ID | 类别 | 当前字典名称 | 上游原始中文名称键 |
| --- | --- | --- | --- |
| 1020200419 | outerwear | NULL | 不存在 |
| 1020300419 | tops | NULL | 不存在 |
| 1020410419 | bottoms | NULL | 不存在 |
| 1020500419 | socks | NULL | 不存在 |
| 1020600419 | shoes | NULL | 不存在 |
| 1020720419 | headwear | NULL | 不存在 |
| 1020760419 | chokers | NULL | 不存在 |
| 1020940419 | pendants | NULL | 不存在 |

## 上游核验

2026-10-08 无条件 GET 公开 manifest、语言包和结构化数据库，没有上传照片、UID、原生参数或媒体内容，也未写入本地运行字典。

- manifest：https://nikki.ranaxro.com/app_api/hot_update.json
- 中文语言包：https://file-nikki.ranaxro.com/hot_update/infinity_nikki/zh-CN.bin
- 结构化数据库：https://file-nikki.ranaxro.com/hot_update/nuan5_database/v1.db
- 语言版本：c10bb28a-fd10-4276-9e21-e18a9829a6b0。
- 数据库版本：5aedda9e-1315-45c5-ab6b-42d775cd15fa。
- 当前远端经已有适配器解析得到 8707 个服装条目，8346 个有名称；两组版本与当前本地快照对应，旧本地版本尾部的 clothing-types-and-fallbacks-v4 是先前补类别/图标的适配语义标记。
- 进一步直接解包中文语言文件，检查 infinity_nikki.cloth：以上 8 个 ID 的键均不存在；infinity_nikki.cloth_outfit[10419] 也不存在。已知对照 1020810129 能直接读取“浮金星点”。排除了仅因 NikkiSync 名称字段适配错误造成缺名的可能。
- 本地 remote state 显示本日已检查并成功；fetched_at 仍是 2026-09-22 不代表更新失败，远端两组数据版本确实没有变化。

## 初次调查的处理方向

需从可核验的名称来源补齐这些 ID，或等待上游中文名称表补齐，再由 PC 字典服务重新丰富已有照片元数据并通知客户端刷新。不得根据缩略图、ID 尾号或相似服装猜名称。此次只调查并记录，不修改服装名称、运行数据库、项目功能或游戏文件。

## 用户授权后的公开来源核验

用户随后要求：本地缺名时查公开 Wiki，并在 PC 补全。2026-10-08 读取暖暖照相馆的公开接口 `https://www.nikkigallery.vip/api/v1/clothes/all`，HTTP 200，不需登录，没有上传照片、UID 或原生参数。

该接口的 `clothes` 返回精确 `gid`、`name`、`filename`、`part`；`clothes_set` 将 `clothes_gid=10419` 对应到下面全部 9 个 `item_gids`。这套为 **蹦跳计划**，另用 [BWIKI 套装页](https://wiki.biligame.com/wxnn/套装蹦跳计划) 和各部件页核对名称及类别。BWIKI 标注 CC BY-SA 4.0，补充条目保留链接和许可归属。仅记录核验所需的 ID/名称事实，不拷贝页面文章或图片。

| ID | 核验名称 | 该批照片使用 |
| --- | --- | --- |
| 1020100419 | 漫步调 | 否，顺带补齐整套头发名称 |
| 1020200419 | 绒绒抱 | 是 |
| 1020300419 | 甜心跳 | 是 |
| 1020410419 | 漫游者 | 是 |
| 1020500419 | 奶球堆 | 是 |
| 1020600419 | 蹦蹦兔 | 是 |
| 1020720419 | 兔耳糖 | 是 |
| 1020760419 | 糖渍圈 | 是 |
| 1020940419 | 抱抱出发 | 是 |

暖暖照相馆 `nikkigallery.vip` 的前端通过这个独立服装 API 获取名称，并根据 `filename` 从 `/static/img/clothes/` 取图。它与 NikkiSync 当前 `nikki-albums-public` 字典所用的 `nikki.ranaxro.com` 公开数据不是同一份表。不能仅凭前端断言其后端采用人工录入还是自动提取。

我们的名称取自语言表，图片地址按部件 ID 模板生成，另有类别图标兜底。因此有图片不等于有名称；这批 8 个 ID 在原语言包确实缺失。

## 持久补充实现

- `apps/pc-companion/src/metadata/VerifiedClothingNames.ts` 保存上述 9 个精确 ID、名称、套装归属、来源和核验日期；随 Windows 服务打包，不依赖每次联网查 Wiki。
- `%LOCALAPPDATA%/NikkiSync/metadata-dictionary-supplement.json` 可选，使用现有字典 manifest 格式；它按 kind/id 扩展内置补充。它与完整快照文件 `metadata-dictionary.json` 分开，不能用只有 9 个条目的快照替换完整 8707 条服装表。
- 字典服务在启动和每次远端快照更新时合并补充，只填缺失的 name/suitId/suitName，不改已有上游名称、类别、图片及 raw 数据。上游套装 ID 冲突时不补；用户自行修改的照片名称仍由现有丰富规则保留。
- 合并后附稳定内容摘要版本后缀，触发已有照片元数据重新丰富；重复启动不继续追加后缀，也不反复更新照片。自动更新及 HTTP 304 不会清掉已补名称。
- 此次不增加后台网页爬虫或常驻查询，后续缺名继续按公开精确 ID/套装、部件列表核对后补表；图像相似不能代替证据。

## 回归证据

- 新测试首次运行 RED：补充后的字典名称仍为 undefined，符合原缺陷。
- 定向测试 GREEN：5/5，包括启动、重启幂等、远端替换、正式名称接替、本地自定义名称保护、套装冲突保护及其他字典项/缩略图保留。
- 首次普通沙箱完整回归遭遇 EACCES 回环连接、EPERM 临时缓存改名，已在本机权限下重跑；以最终记录的结果为准。

## 备用图标字段兼容修复

第一次实际补名后，对照 SQLite 备份发现：名称及主图标正确，但原有照片的 2876 个 thumbnailFallbacks 数组被旧丰富逻辑删除。旧数据库 raw_json 实际已包含这些数组，当前 Repository 却未读回 canonical 字段，Manifest parser 也未保留 canonical 数组。已增加失败用例复现，再修复：

- Repository 从 raw_json 读取有效字符串备用地址，同时保存新 manifest 的 canonical 数组；不需要数据库迁移。
- Manifest parser 验证并保留数组，拒绝非法元素。
- 带备用地址的字典使用幂等 image-fallbacks-v1 版本标记，启动时即使远端 HTTP 304 也只重丰富一次，将旧照片的备用地址恢复。
- 定向数据库及字典测试 18/18，通过 legacy raw 数据、canonical 写入、启动恢复及重启幂等检查。

## 最终实际验收与交付

- 最终完整 `npm test`：112/112 PASS，0 失败；Windows 服务 Bun 编译及 WPF 发布成功，单入口 release layout 验证通过。NuGet 的在线漏洞信息获取警告没有阻止已缓存依赖的编译，未宣称完成漏洞扫描。
- 已更新正在使用的 `release/NikkiSync-Reconnect/runtime/NikkiSync-PC-service.exe`，并通过原 `release/NikkiSync-Reconnect/NikkiSync-PC.exe` 重启；默认 `release/NikkiSync` 也重新打包为完整单入口发布目录。Android APK 保留原文件，此轮没有安装或改写 Android。
- 两个发布位置最终服务 SHA-256：`16B2A4EA12B90544C015722377C1857C8D48916239AC0BC440EDC0E0C911781C`。
- 实际 SQLite 只读复核：42/42 张受影响照片完成，336 个缺失部件 name 及 336 个 suitName 新增；整套 9 个字典名称均正确。服装字典总数仍为 8707，有名称条目由 8346 变为 8355。
- 与更新前一致性备份逐项对照：照片服装字段只有 name/suitName 变更；全部 2876 个备用图标数组恢复并与旧值完全相同，主图标、类别、已有名称未变；9 个补充 ID 以外的完整字典记录保持一致。
- 最终版本标记：原远端版本及 `clothing-types-and-fallbacks-v4` 后附 `:local-names-4eff8a342e425e44:image-fallbacks-v1`。
- 本机 `http://127.0.0.1:28950/api/status`：service=ready，assets=224，pairedDevices=1；配对记录与备份对照未改变。日志/文档只记录统计，未输出 UID、凭据、TLS 私钥或照片内容。
- 更新前 SQLite 一致性备份、原服务可恢复副本保存在被 Git 忽略的 `out/windows-verified-names`，属于本机诊断材料，不加入公开包。
- 未做手机上的实际名称展示/新分享图验收；客户端需获取新版照片元数据，已保存的旧分享图不会被自动重绘。
