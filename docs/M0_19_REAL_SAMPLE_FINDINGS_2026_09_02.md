# M0.19 Real Sample Findings — 2026-09-02

## 自动发现

从游戏安装目录祖先零配置发现：

```text
X6Game/Saved/GamePlayPhotos       原始摄影图库（隐藏目录，优先）
└─ <UID>/
   ├─ NikkiPhotos_HighQuality
   ├─ NikkiPhotos_LowQuality
   └─ Videos

X6Game/ScreenShot                 导出副本（fallback）
X6Game/Video                      导出视频副本（fallback）
```

不得要求用户手动设置以上目录。PC Companion 应缓存自动发现的安装根，并在缓存失效时从便携目录祖先或运行中的 `InfinityNikki.exe` 重新发现。

## 样本统计

- 媒体文件：339（336 JPEG + 3 MP4）
- HighQuality：171
- LowQuality：111
- 其他伴随 `.bin` 文件：79；全部位于 DIY 树，不作为照片或 Live motion resource
- High/Low 同 UID、同文件名确定性配对：111 组
- 全部 336 张 JPEG 都有 EOI 后 trailing payload
- 未发现标准 EXIF、Adobe XMP、Google Motion Photo XMP 或 NikkiGallery XMP marker
- 3 个 `Videos` 项目均为同目录、同 stem MP4 + `_cover.jpeg`，Resolver v1 confidence 为 1

## Source 优先级结论

- 外层 `Video` 的 3 个 MP4 与隐藏图库中的 MP4 SHA-256 完全一致，是重复副本。
- 外层 `ScreenShot` 有 38 个文件名可与 HighQuality 对应，但没有一个 SHA-256 相同，且尾部 metadata 已被移除。
- 因此原图同步必须以隐藏 `GamePlayPhotos` 为 source of truth，不能用外层 `ScreenShot` 替代。

## Resolver v1 结果

- 111 组 High/Low 确定性配对。
- 3 组 Live cover/MP4 确定性配对。
- 没有产生额外 motion 候选。
- 336 个 trailing payload 均已记录长度、SHA-256、十六进制/ASCII 前缀和编码提示。
- 当前 payload 高可打印比例符合编码/加密文本特征，但尚未解密为 `InfinityPhotoMetadata`。

完整 Analyzer v2 报告输出在本地 `sample-report/resolver-v1-2026-09-02/`，不纳入源码版本控制。
