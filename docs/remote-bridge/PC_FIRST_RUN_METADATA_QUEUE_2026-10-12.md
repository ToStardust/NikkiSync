# 普通照片首次解析队列修复与诊断

## 报告与边界

OPPO 测试用户连接自己的电脑，首次使用时普通照片也完全没有穿搭区域，非仅缩略图缺少名字。相机参数是否为空尚无独立确认。电脑端目前没有查看穿搭的页面，不能要求通过该页面对比。手机品牌本身不足以定位问题。

已确认并修复下述队列缺陷，尚未取得这位测试用户的新包诊断和实际验收。本机数据、合成测试和打包通过不能证明她的故障已解决。LIVE 参数解码缺口仍独立存在，参见 LIVE_METADATA_GAP_2026-10-11.md。

## 已确认缺陷与修复

原候选查询每次按发现时间只取开头 12 项。服务跳过缓存成功项和冷却中的失败项后，会认为这一轮已完成，后续照片无法被访问。

现在以发现时间和 assetId 为游标继续遍历，每轮最多发起 12 次解析，默认最多访问 128 个候选项。已成功且输入未变的照片不重复联网；失败项到重试时间再试。完整遍历后记录自身更新产生的最终图库 revision，空闲轮次不重复查询候选项。扫描器、字典或其他操作在请求期间改变 revision 时，放弃旧游标，重新检查较早的输入。

全新安装默认启用现有解析器，显式 enabled:false 仍受尊重。没有数据库迁移，没有 Android UI/缓存/配对或 LIVE 导出改动。现有详情缓存依据新的照片 revision 失效。

## 脱敏诊断

正常 Windows 数据目录生成 metadata-status.json：启动、扫描完成及真实解析工作完成时更新；revision 不变时不重写。只输出统计、解析器是否启用和允许的错误分类计数，不输出 UID、assetId、路径、原图、原始参数包、MD5、地址、令牌或错误原文。读取失败时不写含原始数据的回退日志。

- ordinaryPhotos：未删除的普通照片数；motionPhotos 单独统计 LIVE。
- withNativeToken：有 UID 和原生 token 的普通照片数。
- withCompleteEnvelope：同时有 payload 和 JPEG-prefix MD5 字段的数量，只表示存在，不代表内容有效。
- resolved / failed：具有基本输入且已保存对应状态的数量，不等于调度器完整的指纹/版本有效性校验。
- pending：withNativeToken 减去已保存成功/失败状态，不能当作准确的队列 ETA。
- withOutfit / withCamera：已有非空穿搭数组/相机对象的数量；成功状态不保证穿搭非空。
- failureCategories：networkOrTimeout、http、sourceRejected、incompleteEnvelope、invalidResponse 或 other。按现有错误信息允许模式分类，不能代替具体原因确认。

withNativeToken/withCompleteEnvelope 很少或为零时检查扫描来源和参数格式；大量失败时先查分类指向的网络、服务拒绝或参数问题；withOutfit 大于零但手机仍不显示时，再查手机详情请求、缓存和显示链路。报告只覆盖当前扫描的图库。

## 给测试用户的步骤

1. 退出电脑端窗口和托盘，用新 EXE 重新打开。沿用现有数据目录，不用卸载 App 或清空缓存。
2. 电脑保持联网，等待后台解析；耗时取决于照片数量和网络。手机刷新图库后重新打开一张普通照片详情。
3. 若仍无穿搭，按 Win+R，输入 `%LOCALAPPDATA%\NikkiSync` 并回车，打开 metadata-status.json，提供文本即可。不要发送整个数据目录、SQLite 数据库、.env、配对信息或照片。

## 验证与交付

- 首批成功、首批失败冷却、请求期间较早输入改变的新增测试在修复前失败，修复后通过。
- 完整 PC/core 136/136；额外配置 7/7、单文件包合同 6/6 通过。
- 300 个缓存成功项验证每轮访问有界、每页不超过 12，无重复联网，遍历结束后空闲不查询。
- 实际打包的 Bun 1.3.14 baseline 与内存数据库合成运行：25 张照片的成功批次为 12、12、1、0，25 张均有模拟穿搭/相机。这不是实际接口或测试用户照片验收。
- 本机现有数据库只读统计：215 张普通照片，213 张有完整输入字段，200 张已成功且有穿搭/相机，13 张已保存服务拒绝失败，9 张 LIVE。本机情况不能解释测试用户电脑。
- git diff --check 通过。
- 新单文件包：release/NikkiSync-Portable-MetadataQueue/NikkiSync-PC.exe。
- EXE SHA-256：c609f11c13392f8c1d179aa4abb63e006336ded8baf94ec469b026cac9303c49。
- APK 保持 0.2.16-camera-permission / versionCode 17；SHA-256：28d10ec7bdb374e001cf4edacac5d93213e5abd67dcc36c7714fef80586953e1。
- 实际 EXE 的 --verify-package 通过，只有一个 EXE，解出的 APK 与当前签名包哈希一致，用户配置未触碰。报告：out/embedded-apk-JEJdno/report.json。

没有在 OPPO 测试用户电脑/手机上验收，没有新增公开二进制 Release。本轮交付是本地 EXE 和源代码修复。
