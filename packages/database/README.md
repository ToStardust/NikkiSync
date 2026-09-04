# M0.17 SQLite Schema

Schema 位于 `migrations/0001_initial.sql`，代码入口位于 `src/`。运行 `npm run db:validate` 可独立执行建库、`foreign_key_check` 与 `quick_check`。

## 核心模型

- `assets`：用户看到的“摄影作品”，一条记录对应图库中的一张作品。
- `resources`：实际磁盘文件。普通照片通常 1 个 source resource；实况照片至少有 still + motion 两个 source resource。
- `resolver_candidates`：真实样本调查阶段用于持久化静态图↔视频候选匹配与评分，避免启发式结果不可追溯。
- `change_journal`：可靠增量同步日志，revision 严格单调递增。
- `paired_devices` / `device_sync_state`：一次配对、长期使用；记录每台手机确认到的 revision。

## Windows 路径约束

`source_path` 保留用户真实路径；`path_key` 必须由应用层生成规范化键：

1. `path.resolve()` 得到绝对路径；
2. `\\` 统一为 `/`；
3. Windows 下转为小写；
4. 去除末尾 `/`。

唯一性约束放在 `path_key`，不能直接依赖 SQLite 默认大小写敏感的 `source_path UNIQUE`。

## Revision 事务规则

所有会改变手机可见远程图库状态的写操作必须在一个 SQLite transaction 内：

1. `SELECT library_revision FROM library_state WHERE id=1`；
2. `next = current + 1`；
3. INSERT/UPDATE `assets.revision = next`；
4. INSERT `change_journal(revision=next, ...)`；
5. UPDATE `library_state.library_revision = next`；
6. COMMIT；
7. COMMIT 成功后再广播 WebSocket 事件。

`AssetRepository` 已按此规则把 revision、journal 与 asset 写入放在同一 `DatabaseManager.transaction()` 内。`ChangeJournalRepository.record()` 是事务内原语，不能在远程图库写路径中单独调用。

WebSocket 不是真相来源，`change_journal` 才是。客户端断线后用 `/v1/changes?after=N` 补齐。

## 原图不变原则

`source_*` resource 永不原地改写。缩略图、预览图、XMP 参数副本、模板导出物必须生成新文件；PC 同步库若要管理这些派生文件，使用 `derived_*` role 或在后续 migration 增加 export 表。
