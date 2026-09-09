# M4.2.8.1 本机真实照片结构诊断

本报告只记录本机真实 `GamePlayPhotos` 样本的结构信息，不记录 UID 目录、完整 token、参数 payload 或媒体字节。

诊断工具：`tools/sample-analyzer/metadata-tail-structure.mjs`，只读取每个文件末尾最多 64 KiB。

## 样本对比

| 样本 | 文件大小 | 末尾 64 KiB 内 FFD9（相对 EOF） | 最后 FFD9 后 | 两个最后 FFD9 之间 |
| --- | ---: | --- | --- | --- |
| `2026_04_20_17_27_36_7957678.jpeg`（旧版，当前已识别） | 4,581,151 | `-50,396`, `-46` | 44 bytes，standard Base64，SHA-256 `498bbfe9da9aa5ed999916b58efa8be6a05db0cc27373166867baefdc9a30112` | 50,348 bytes，standard Base64，SHA-256 `e56651e458dee6becb196ec2abd82702c0281db0f85d8eb192db6c3b1c36da21` |
| `2026_09_04_22_41_32_1934604.jpeg`（2.9，修复前未识别） | 2,383,918 | `-52,519`, `-57` | 55 bytes，printable-other，SHA-256 `b4e50e16219fb8a72e9a60565a73b396cfb69c2f1bca11fd3f695247ed12f134` | 52,460 bytes，standard Base64，SHA-256 `880513a50099f0459259181b25f55be47eaa2224973a8bd014dd076b28abd0a0` |

两份真实样本的共同结构：最后两个 `FFD9` 之间是可打印的标准 Base64 参数段；最后一个 `FFD9` 后的前 44 bytes 都是标准 Base64 且解码为 32 bytes。

实际差异：

- 旧版 EOF 尾部为 `FFD9 + 44-byte token`，总尾长 46 bytes。
- 2.9 EOF 尾部为 `FFD9 + 44-byte token + [V2] + 7 位数字`，总尾长 57 bytes。
- 因此 2.9 不能再用“从 EOF 固定回退 46 bytes”定位最终分隔符；真实 `[V2]N` 后缀中的 `N` 是 NUAN5 的 hash window，MD5 应取最终分隔符 `FFD9` 之前的最后 `N` bytes（本样本为 `N=2,383,250`）。

## 修复后真实重扫

- 既有 SQLite 保留，资产数 `181 → 181`。
- `assetsCreated=0`，`assetsDeleted=0`，`assetsUpdated=49`。
- 含 native token 的资产 `127 → 176`；含 payload 和本地 MD5 的资产均为 `176`。
- 上述旧版和 2.9 样本重扫后均为 token 长度 44、payload 存在、MD5 存在。

## NUAN5 / dictionary E2E

- 旧版样本真实解析成功：相机参数 + 14 件服装。
- 2.9 样本真实解析成功：相机参数 + 光照参数 + 16 件服装。
- 公开服装字典 bodyless GET 成功更新；不包含照片 UID、token、payload 或媒体字节。
- 现有图库 resolver 重跑最终为 `164 resolved / 12 failed`。12 个失败均为 NUAN5 返回“没有发现可用的元数据”，不是网络或扫描失败。
- NUAN5 resolver 增加了串行请求节流，默认间隔 1 秒，避免服务端 0.5 秒/IP 限制触发批处理 429。
