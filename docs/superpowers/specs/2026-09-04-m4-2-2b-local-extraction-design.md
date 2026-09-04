# M4.2.2B 本地服装字典提取设计

**状态：** 已确认设计，待实现计划。  
**范围：** B-1 独立只读 archive-aware inventory/probe；不在本阶段把提取器嵌入 PC 发布包。

## 目标

从用户本地安装的 Infinity Nikki `X6Game/Content/Paks`（当前为 `2816` IoStore/pak 资源）中，建立可复现的证据链，证明至少一个已知 10 位服装 entity ID 可映射到真实的 Unreal 游戏记录。最终字典目标为：

```text
102xxxxxxxx
  -> canonical name
  -> slot/category
  -> rarity
  -> icon asset reference
```

本阶段仅交付到“成功挂载、资源清单、候选表定位、目标 ID 记录证据”。名称本地化、图标解码、完整 manifest 生成属于后续 B-2 至 B-5。

## 非目标与安全边界

- 只读访问指定游戏安装目录；不解密、替换、删除或写入游戏文件。
- 不扫描或上传游戏照片、UID、NUAN5 tuple、MD5、账号数据或媒体字节。
- 不调用 NUAN5，也不改变现有远程 resolver/dictionary 的 opt-in 配置。
- 不把 .NET SDK 或 CUE4Parse runtime 加入 NikkiSync 正式 PC 发布依赖。
- 不复制 GPL 项目代码。采用 CUE4Parse-compatible、Apache-2.0 许可边界的独立 helper。

## 方案

创建一个独立 .NET 8 控制台 helper，位于：

```text
tools/m4-2-local-dictionary-probe/cue4parse-spike/
```

输入为明确指定的 Paks 根目录；没有默认自动探测，也不接受磁盘根目录。helper 使用 Infinity Nikki 兼容的 archive reader 挂载 IoStore/pak 资源，输出 JSON 报告到 helper 自身的 `out/` 目录（该目录不纳入最终字典或发布包）。

### 命令边界

```text
inventory <Paks-directory>
probe <Paks-directory> <entity-id> [...]
```

`inventory` 列出归一化的包内路径和推断资源类别，重点筛选 DataTable、StringTable、locres、配置/JSON/Lua 候选。`probe` 在已挂载、已反序列化的资源结构中寻找给定 entity ID 的键/字段引用，并输出最小上下文证据。

helper 不输出媒体原始内容；报告中的字符串和路径仅限于支撑候选定位所需的元数据。

## 数据流

```text
X6Game/Content/Paks (read-only)
        ↓
CUE4Parse-compatible helper mount
        ↓
package/resource inventory JSON
        ↓
candidate structured/localization assets
        ↓
target-ID probe evidence JSON
        ↓
人工审查与后续 B-2 record/localization join
```

本阶段不直接写 SQLite，不调用 `MetadataDictionaryService`，避免在尚未证明字段语义前污染正式字典。

## 成功判定

1. helper 能只读挂载当前本地 `2816` 资源，或输出足以定位缺失 AES/key/profile 的明确诊断。
2. inventory 报告能列出至少一个可供进一步检查的结构化数据、本地化或配置候选资源，而不依赖原始字节碰撞。
3. `probe` 对已知 ID（至少优先检查 `1020100111`、`1020600111`、`1020900111`）输出真实游戏资源中的同一记录键或关联字段。
4. 报告保留 archive 路径、对象/记录路径、字段名与原始值，作为后续 name/slot/rarity/icon join 的 provenance。

## 失败处理

- archive mount 遇到加密、IoStore 格式或 game-profile 缺口时，报告必须包含发生位置与所需能力；不退回到 naive ASCII/u32 grep。
- 若只能发现随机二进制命中、不能关联真实结构化记录，则该结果为“无证据”，不能猜测 slot/category。
- 若当前公开 reader 不支持该版本，评估 UEExtractor 的只读人工证据路径；这仍不改变正式发布包的技术边界。

## 验证

- 自动化：CLI 参数验证、路径边界、报告 schema、已保存 fixture 的解析测试。
- 手工：对用户本地指定 Paks 目录运行 inventory/probe，记录只读运行前后文件元数据不变，并审查报告中的目标 ID 证据。
- 回归：NikkiSync 既有 `npm test` 不因 helper 或调研产物改变行为。

## 后续阶段

- **B-2**：在至少两个不同 slot 的真实记录上建立 ID→record proof。
- **B-3**：以记录的本地化 key 加入 StringTable/locres，解析用户选择语言的名称。
- **B-4**：存储 icon Unreal asset reference，不在本阶段做图像转码/缓存。
- **B-5**：生成现有 `MetadataDictionaryService` manifest、SQLite 原子替换与本地 re-enrich。
