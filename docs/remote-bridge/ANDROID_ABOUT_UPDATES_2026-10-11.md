# Android 关于与更新｜2026-10-11

用户要求在设置页新增“关于&更新”，显示当前版本、作者“星尘（支持粉毛拯救世界版）”、指定头像和项目 GitHub 更新地址。工作分支 `feature/remote-bridge-foundation`，修改基线 `c237146bc4af00923fb959b807e5c1cc94e07cae`。

## 实现

- “我的 → 设置 → 关于&更新”，沿用 ChromeHost、现有玻璃卡片、粉色背景、顶部 GPU 模糊和 ChromeNavigationHost 的平移预测性返回。主页仍只有 UID、图库概况、穿搭灵感库三部分。
- 当前 APK 为 `0.2.15-about` / versionCode `16`。版本信息直接来自 BuildConfig.VERSION_NAME / VERSION_CODE，以后改构建版本会自动更新展示。
- 页面显示作者名和透明头像；头像使用 FIT_CENTER，完整保留装饰框，不裁成圆形。
- 更新地址为 <https://github.com/ToStardust/NikkiSync/releases>；用发布列表避免仅有预发布版本时 `/releases/latest` 没有可用目标。另有 <https://github.com/ToStardust/NikkiSync> 项目入口。
- 未连接电脑也能查看；进入页面不主动联网，点击链接才交给外部浏览器。系统没有浏览器时复制地址到剪贴板。
- 真实导航移除时关闭页面 backdrop 并清空引用；重复点击只打开一页，返回后可以重新打开。

## 头像材料

用户附件通过内置 image_gen（默认 built-in 模式）做透明背景编辑，没有使用 CLI 或本地脚本抠图。最终项目资源：`apps/mobile/app/src/main/res/drawable-nodpi/author_avatar.png`，1254 × 1254 PNG，四周 alpha 透明，保留内部蓝色场景及粉色框饰。生成结果是 AI 图像编辑，非逐像素保真的原图蒙版。

最终提示词：

```text
Use case: background-extraction. Edit target: the supplied square avatar. Produce a clean PNG cutout of the complete decorated oval avatar, with actual transparent alpha outside its silhouette. Remove ONLY the pale yellow/cream outer square background. Keep the pink oval frame, bows, lace, ribbons, hanging ornaments, sparkle accents, existing white decorative lettering at lower left, blue interior backdrop, and the exact original character, outfit, face and pose. Preserve all interior artwork and colors; do not redraw, beautify, replace or invent details. Keep fine ribbon and lace edges intact and antialiased. Entire ornament must fit, uncropped, centered on a square transparent canvas. No added text, shadows or background.
```

## 验证

新增 AboutUpdatesPageTest 先运行旧实现，3 项均因设置没有入口而 RED；接入后 3 项 GREEN。覆盖离线版本与作者/头像展示、显式打开正确 GitHub 地址、重复点击、预测性返回取消/提交、返回设置后重新进入和顶部返回按钮。

完整回归与包体验证结果见下方交付记录。此轮未安装到手机或进行硬件 UI / 手势验收。

## 交付记录

- Android 全量 202 tests，0 failures / errors / skipped；mobile source contract 82 文件、便携包合约 6 项、git diff --check 通过。
- APK `release/NikkiSync/NikkiSync-Android.apk`，23,564,615 字节，minSdk 33 / targetSdk 35；v2 签名通过，与 0.2.14 使用相同证书，可覆盖安装保留配对与缓存。SHA-256：`7597849b34dedf393aba6607db7825cd046e142b944a06dfeb319ec2cf0e7d2a`。
- 新便携目录 `release/NikkiSync-Portable-About`，包括 `NikkiSync-PC.exe` 和单独的 `NikkiSync0.2.15-Android.apk`。EXE SHA-256：`64727f0141a1a49a97c50109ba32dc1ac70b304d51e6c4f1250d45fd48b626f6`。
- 实际 EXE `--verify-package` 隔离展开验证通过，内嵌 APK 与上述 APK 哈希完全一致，证据 `out/embedded-apk-uJ8cyb/report.json`；没有启动后台或读取/清空用户配置。Windows 保留既有自动发现及运行环境复用。
- 头像 SHA-256：`a866b23bbbd5c91a44b7ec24a5060de0b2cdc7fd675f8f5161a3901d8eb8e51c`。生成结果以此 PNG 为准，非游戏截图或用户照片样本。
- 本轮为本地新版包；此前公开的 v0.2.14 资产不覆盖。首次源码推送因头像公开范围被自动审批拦截，随后用户明确回复“允许随源码公开”，授权头像随源码上传 GitHub。源码按该授权推送到 main 与 feature/remote-bridge-foundation，二进制发布状态不能由源码 push 推断。
