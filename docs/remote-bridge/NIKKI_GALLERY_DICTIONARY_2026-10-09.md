# 暖暖照相馆公开服装接口：PC 本地补充字典｜2026-10-09

## 用户授权与用途

用户要求将暖暖照相馆接口也接入本地。此轮为 PC 字典自动更新增加第二来源；原 Nikki Albums 主来源、已核验的本地名称补充及个人照片备注保持各自优先级。没有改游戏文件、Android UI 或小程序 UI。

公开入口：[clothes/all](https://www.nikkigallery.vip/api/v1/clothes/all)。只发匿名、无请求体的 HTTPS GET，不接触/上传 UID、照片 ID、原生参数、JPEG/视频，也不登录照相馆。图片地址根据公开 filename 组成 `https://nikkigallery.vip/static/img/clothes/<filename>`；这轮字典下载不批量下载图片。

## 实际接口核验

2026-10-09：GET HTTP 200，响应字段 clothes / clothes_set / pose / colors。clothes 共 9653 行，无重复 gid；其中 779 行 part=set 用于套装查表，适配器生成 8874 个有名称服装条目、8874 个图片地址、6806 个明确套装名。此轮不接入 pose/colors 数据。

例如 gid=1020300419、name=甜心跳、part=tops、filename=S0419T.png；clothes_set 将 suit 10419 的 item_gids 明确对应至蹦跳计划整套 9 个部件。没有根据缩略图或数字尾号猜名称、套装或星级。level 原样记在 raw.galleryLevel，不当作 rarity。

适配器版本（真实请求）：`v1-6fdfd6206d5a70e714d1ad750eaed9c9ae5a5487d459586dcb42e472cf35dc31`。服务端本次未提供 ETag / Last-Modified；第二次真实请求带 contentVersion 后，新适配器返回 not-modified。

## 更新与缓存

- `NikkiGalleryMetadataDictionaryProvider`：固定公开 HTTPS 入口，15 秒超时、8 MiB 响应上限、30000 clothes 行上限；校验 ID、重复项及套装成员，路径穿越 filename 不生成图片 URL；多个套装归属不猜首选套装。
- 新来源为 `nikki-gallery-public`，在 `PcCompanionRuntime` 中使用独立 supplement 模式的 `MetadataDictionaryUpdateService`；启动时检查，此后每 6 小时检查一次。
- SQLite app_settings 单独保存 `metadata_dictionary_supplement_cache:nikki-gallery-public` 的完整规范化快照，以及 `metadata_dictionary_remote_state:nikki-gallery-public` 的查询状态。启动先恢复缓存，断网/返回错误/格式异常继续使用旧表；缓存缺失、无效或与 contentVersion 不一致时强制完整请求。
- 如果将来接口提供 ETag / Last-Modified，会发送条件请求。当前以排序后的规范条目内容 SHA-256 判断变化；HTTP 200 但内容相同，不重写字典或照片。
- 只补主字典缺失的 name / category / thumbnail / suitId / suitName；保留主图与 thumbnailFallbacks，非服装字典项也保留。按精确 kind/id 合并，不用 8874 条补充快照替换主表。
- 已由该来源填入的字段记录 provider/version/fields/values 和公开出处。源数据更名时只刷新仍等于该来源旧值的字段；主字典正式值、本地核验补充、照片个人备注不会被覆盖。套装 ID 与主表冲突时跳过该条补充。
- 主来源更新时会再次叠加已缓存的照相馆表；失败与 HTTP 304 不丢补充。服务停止后到达的旧请求结果不再写数据库。
- 两个字典更新流程在任务结束后通知既有 RuntimeMemoryMaintenance，等事件循环安静 5 秒后回收临时数据。没有增加高频爬虫、逐照片联网或持续轮询。

## 本地配置

默认启用，随 EXE 打包。可在现有 `%LOCALAPPDATA%/NikkiSync/metadata-dictionary-remote.json` 的完整配置中控制第二来源：

```json
{
  "enabled": true,
  "provider": { "type": "nikki-albums-public", "locale": "zh-CN" },
  "gallery": { "enabled": true, "intervalMs": 21600000 }
}
```

gallery.enabled=false 仅关闭此接口更新；顶层 enabled=false 关闭两个远程字典更新。依旧允许已有缓存数据展示。此次没有写入用户的认证配置或创建新的登录信息。

## 测试与预演

- 新适配器/补充更新测试先 RED，随后 GREEN；额外内存回收回调用例也先 RED（回调次数 0），修复后 GREEN。
- 新接口专属 8 项测试：精确 ID/套装、分类和安全图片、无媒体/认证请求、内容摘要/304、失败及大小上限、分离缓存和离线重启、主表更新保留、来源更名与个人备注、歧义归属、缓存损坏、退出后的响应、配置禁用/间隔与安静期回收。
- 真实本地字典仅以只读方式取得，在内存 SQLite 合并预演：8707 → 9047 个服装条目，新增 340，已有条目补名称 305，原有名称全部保留，剩余 47 条未由本次合并补齐。不宣称所有游戏 ID 均已有名称。
- 最终部署与验收记录见下方追加内容；以实际数据库记录为准，不将内存预演写成已部署事实。

## 批量读取优化

真实缓存副本验收暴露了既有批处理重复读表：每条照片 enrichAsset 读取完整字典，随后 enrichMetadata 再读一次；即使已是最新照片，也为每条照片读表。新增失败用例：3 张照片读 6 次，预期 1 次。修复后整批共用一次快照，并复用已读取/解析的照片元数据，不再逐条重复读字典或照片行。单照片、解析器即时丰富仍保留原公开接口。

定向 16/16 GREEN；真实 224 条照片的一致副本在 Node 上做缓存重启检查，字典版本不变、重写照片 0 条，最终批量检查耗时 159 ms。这是本机副本测量，不外推其他电脑，也不宣称手机端帧率改善。

## 最终构建与实际运行验收

- `npm test` 最终 121/121 PASS，0 失败；单独 RuntimeMemoryMaintenance 测试 1/1 PASS；Bun 编译、WPF 发布及 Windows 单入口目录验证通过。NuGet 在线漏洞信息不可达产生既有 NU1900 警告，不影响缓存依赖构建，未宣称完成漏洞扫描。
- 默认 `release/NikkiSync` 已生成完整 PC 发布包；用户原运行目录 `release/NikkiSync-Reconnect/runtime/NikkiSync-PC-service.exe` 已替换并通过原 PC 入口重启。最终两处服务 SHA-256：`C065675C5386FEC8B262D9BD7CD70A1D5FE6E0A5940F4278FADDB4238248AC7B`。Android APK 未改写/安装。
- 实际 app_settings 已缓存 8874 条 `nikki-gallery-public` 服装条目，cache.providerVersion 与远程状态 contentVersion 一致。实际最后成功检查 UTC 2026-10-08T18:36:50.254Z，即香港 2026-10-09 02:36:50。
- 实际服装表 8707 → 9047 条，新增 340 个精确 ID，原条目补名 305 个，总有名称 9000 条。剩余 47 个缺名 ID **全部不在该公开接口的服装表中**，继续允许经 Wiki 核验的本地补录；不把它们猜成相似衣服。
- 与更新前一致性备份比较：所有原有字典 name/category/thumbnail 保留；所有原照片已有 name/category/thumbnail/thumbnailFallbacks/suitId/suitName 保留，2876 个备用图片数组仍在。此轮 305 个新名称均是原字典中尚未用于当前照片的条目，现有照片此次没有新增缺名部件；上一轮已补齐的蹦跳计划仍正确。
- 真实再次重启后缓存版本不变，224/224 条照片 raw.dictionary 标记及穿搭数据未变化。总资产行 223/224 完全一致；另 1 条既有失败解析资产仅 raw.resolver.lastAttemptAt 被原解析器重试更新，并非字典重写，未隐藏此差异。
- 诊断一致副本上恢复缓存不发网络请求，离线模拟 fetch 失败后仍保留名称且重写照片 0 条；实际 PC 本机状态 service=ready，assets=224，pairedDevices=1。配对数据库记录、TLS 配置与更新前备份相同。未做手机上的展示/分享图真机验收。
- 更新前真实数据库及旧服务副本、用于离线/重启验收的真实数据库一致副本保存在被 Git 忽略的 `out/windows-gallery-dictionary`；包含个人本地信息，留在本机，不加入发布目录或对外包。
- 最终服务 10 秒空闲短采样：CPU 时间增加 0.109 秒（约单核 1.09%）、工作集 231.1 MiB、私有内存 319.2 MiB；初版接入后另一段短采样为 CPU 增加 0.047 秒、私有 301.4 MiB。采样含既有扫描器/解析器/局域网服务，不能将差值当作新来源独立开销，也不宣称长期内存/CPU 上限。新接口本身是每 6 小时一次的批任务，并非持续高频请求。
