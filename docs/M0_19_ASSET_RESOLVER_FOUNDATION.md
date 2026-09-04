# M0.19 AssetResolver v1

## 已完成

- `AssetResolver.resolvePhotoResources()`：按 UID + normalized stem 聚合照片资源，HighQuality 固定为 primary。
- `AssetResolver.resolveMotionCandidates()`：对 still × motion 组合评分并确定性排序。
- `AssetResolver.scoreCandidate()`：返回 `score`、`confidence`、`method`、`reasons`。
- Sample Analyzer 与未来 PC Companion 共享 `@nikkisync/core` 中的同一评分实现。
- `ResolverCandidateRepository` 持久化候选与诊断原因，评分逻辑不进入数据库层。

## v1 确定性规则

- HighQuality 与 LowQuality 只有 UID、stem 同时相同才聚合；仅同 UID 不构成候选。
- `<stem>_cover.jpeg` 与同目录 `<stem>.Mp4` 聚合为一个 `motion_photo` Asset。
- Live cover 是 still resource，MP4 是 motion resource；不要求额外 HighQuality 文件。
- 不同 UID 直接拒绝。
- 非确定性 bundle 出现不可能时间差时直接拒绝。
- 只有 UID、宽高比或视频时长而没有文件名/时间身份信号时直接拒绝。
- 同分候选按 still resource id、motion resource id 确定性排序。

## v1 辅助信号

- basename exact / contains
- filename numeric token
- UID equal / different UID penalty
- timestamp proximity / impossible time difference penalty
- aspect ratio proximity
- short motion duration

辅助信号只用于调查候选并写入 `resolver_candidates`，不能覆盖确定性拒绝规则。

## 真实素材验收

```text
扫描文件                 418
HighQuality              171
LowQuality               111
High/Low 确定性配对       111
Live cover/MP4 确定性配对   3
额外 motion 误配             0
JPEG trailing payload     336 / 336
DIY binary companion       79
```

`ASSET_RESOLVER_VERSION` 已冻结为 `1`。确定性规则可自动接受；其他启发式候选继续保存为 pending，等待更多新版本 Live 样本扩展，而不是自动接受。
