# NikkiGallery 拍摄参数适配

此模块把 NikkiGallery 的 `decrypt:decodeFile` / `decodeFileParams` 返回结果转成 NikkiSync 手机已经读取的元数据结构，不执行 DLL、不读取照片，也不更换扫描器。

构建独立 ESM 模块：

```powershell
node_modules/.bin/esbuild.cmd integrations/nikki-gallery/metadata-adapter.ts --bundle --platform=node --format=esm --outfile=integrations/nikki-gallery/dist/metadata-adapter.mjs
```

在 **NikkiGallery 的源码**中接入，而不是修改手机。示例中函数/字段路径应按作者实际工程调整：

```ts
import { toNikkiSyncMetadata } from './metadata-adapter.mjs'

// 必须是同一张照片的本地解码结果。复用当前解码服务的 UID、文件白名单、大小限制和队列。
const decoded = await decodeFileParams(row.file_path, albumType, row.account_uid)
const metadata = toNikkiSyncMetadata({
  decoded,
  uid: row.account_uid,
  capturedAt: row.modified_at,
  existing: cachedCanonicalMetadata,
  dictionary: mergedDictionaryManifest
})
```

`mergedDictionaryManifest` 为已有 NikkiSync 标准字典：主来源的服装/滤镜/光照条目，加照相馆 `clothes/all` 中精确 `gid/posename` 的动作条目。字典 kind 是 `clothing/filter/lighting/pose/location`，不能根据数字尾号或相似照片猜名称。服装的 canonical category 由精确 ID 字典补充；本地 decoder 的 `clothType` 保留，但不直接当作另一套字典的类型码。

接入点和必要行为：

1. 当前 SyncReadRepository 的 `buildPhotoMetadata` 仅使用 `editor_metadata` 并返回 `camera: {}`。应改为从照片本地解码结果/标准元数据缓存构建参数；编辑器 LUT/水印配置是另一种数据，不能代替游戏拍摄参数。
2. 缓存按照片身份、文件变化、decoder 版本、字典版本失效；解码使用现有队列，不让所有分页请求重复执行 DLL。失败保留旧的已验证缓存，不制造空参数或复用其他照片的穿搭。
3. 参数/名称变化分配该照片的新 revision 并进入 change journal/WS，以便手机已有的详情缓存自动更新。`hasMetadata` 必须反映标准元数据实际可用状态，而不是仅检查 `editor_metadata`。
4. 将 `metadata` 放到已有 AssetDetail 的 `asset.metadata`。核心结构是 `camera`、`pose`、`filter`、`lighting`、`dressing`、`photography`、`nikki`、`interactions`、`location`。失败时返回已有缓存或缺省状态，不能宣称解码成功。
5. 合并只补缺失字段，已有个人参数和名称优先。数组保留原成员，只在精确相同 ID 的条目上补字段；空列表保留。两个 backend 的服务身份/TLS/配对状态仍独立。

测试应使用同一照片对比动作、滤镜、光照的 ID/名称/强度，服装 ID/名称/类别/图片，以及真实动态照片。此轮不解决她安装包中独立的搜索空结果、统计空列表、缩略图不可用、元数据写入拒绝和 mDNS 缺口。

本轮提供转换代码和实际 bundle，没有修改 NikkiGallery 安装包，也没有把其 DLL 打包到 NikkiSync。需要对应源码和作者构建流程才能完成她的 EXE 接入。NikkiSync 原在线解析的行为和关闭选项仍然保留。
