# EXIF 导出、版本检索与小程序旋转保存

后续服装图标与新版交付见 [MINIPROGRAM_CLOTHING_ICONS_CACHE_2026-10-04.md](MINIPROGRAM_CLOTHING_ICONS_CACHE_2026-10-04.md)，包含更新后的 EXE/开发预览码及缓存方案；下文保留本轮 EXIF 验证历史。

日期：2026-10-04，Asia/Hong_Kong。工作区：`D:\GAME\InfinityNikki Launcher\InfinityNikki\X6Game\CameraPartner\NikkiSync-RemoteBridge`。分支：`feature/remote-bridge-foundation`。本轮源码和交付包保留本地，未提交、推送、合并或安装手机。

用户要求直接实现，并将手机/微信相册验收留到明天。本轮实际运行了自动测试、真实旧照片/2.9 照片本地导出及原生解码验收，不把手机待验收项标为 PASS。

## 已实现

### 1. 保存副本时写入原生 JPEG EXIF

功能放在“保存”链路，不在扫描器修改游戏原图，也不建立另一份源图库。小程序“连接电脑”面板和 Android“我的”页都有“保存时附带拍摄参数”开关，默认开启，关闭且方向不变时仍保存字节一致的原图。

| EXIF 字段 | 内容/来源 |
| --- | --- |
| Make | `Momo Camera`，大喵相机的英文品牌 |
| Model | `Infinity Nikki` |
| Software | `NikkiSync` |
| FNumber | 有效、正数的游戏 `camera.apertureSection` |
| FocalLength | 有效、正数的游戏 `camera.focalLength`，不推算 35mm 等效焦距 |
| Orientation | 保留原方向/镜像，再合成用户的 0/90/180/270° 旋转 |
| DateTimeOriginal / OffsetTimeOriginal | 仅已有 canonical capture 时间；UTC 与 `+00:00`，不采用发现时间伪造拍摄时间 |
| ImageDescription | 明确注明虚拟游戏摄影，补充白名单游戏参数、已解析的服装/滤镜/地点名称 |

这些是游戏虚拟相机参数，不宣称来自真实硬件镜头。游戏 exposure 的物理单位尚未确证，所以不填 ExposureTime、ISO、ExposureBiasValue，也不把对比度/饱和度游戏滑杆直接当 EXIF 标准枚举。新增标签不包含 UID、内部服装 ID、路径、token 或 raw payload。标准字段用途参考 [Android 官方 ExifInterface 文档](https://developer.android.com/reference/androidx/exifinterface/media/ExifInterface)。

JPEG 只合并 EXIF APP1，不重新压缩，保留原 ICC、其他元数据及 SOS 后编码画面/尾部字节。原文件和 SQLite 不改写。注意：**保留的原 JPEG 尾部可能本来就有游戏私有信息，本轮没有把导出副本宣传成去标识化/公开分享安全文件**；新增标签的白名单不等于清除全部既有元数据。带参数副本的 SHA256/MD5 会与原图不同，传输校验使用副本 hash，不能拿它替换 scanner/NUAN5 的源 hash。

PC 复用既有源路径约束/源 hash 校验，新增 authenticated Noise `export` 指令；APK 复用既有 TLS/签名认证的 `/v1/assets/:assetId/resources/:resourceId/export?exif=true&rotation=90` 路由。返回副本 hash 和选项，客户端下载完成验证后才交给系统相册。普通 JPEG 的 APK 保存不会再二次旋转。没有修改 Live/Motion 保存器、安全配对或 NUAN5 resolver。

PNG 暂不写入 EXIF：方向为零保持原字节；旋转以 Windows 原生解码、旋转后无损 PNG 编码，保留渲染像素和 alpha，不保证其他 PNG 文本/附加块完全保留。高位深 PNG 不静默降精度，拒绝该旋转导出。当前仅普通静态照片，不延伸为 Live 兼容完成。

### 2. 小程序版本分组、搜索和组合筛选

图库按版本分组，数字版本排序（2.10 在 2.9 前），组内按照片日期倒序；显示“日期推测”与“版本未知”，不把推测标成游戏内明确版本。

优先使用已有显式版本，否则复用 PC 已有版本日历按源照片日期推测。本轮没有新增联网查询日期或猜 2.9 尾部格式。复制/修改文件时间可能影响推测；无可靠日期保留未知。

搜索服装名称、版本、日期及已解析的滤镜/地点名称，可与版本、起止日期组合。查询在**整个已授权快照**执行，不只搜索当前 12 张；手机日期按当地时区匹配。未解析服装不能靠猜 ID 生成名称。换筛选、跨页仍保留选择，空结果也能取消已选照片。

范围仍是既有最多 500 张普通照片快照，12 张分页，不宣称无限全库检索。此轮新搜索/筛选 UI 在小程序；APK 原有版本分组与服装搜索保留，没有另行重写它的图库 UI。

### 3. 小程序旋转预览与保存一致

预览提供顺时针 90° 和还原，缩略图/预览采用相同会话角度。每张照片独立保存角度，切图重置原生缩放，不把 native scale 反复写回；跨页、筛选和同会话刷新保留角度。批次开始时冻结各照片角度，下载/写相册中不允许改角度。

JPEG 副本的 EXIF 方向基于原方向合成，包括镜像；PNG 实际旋转像素。微信是否正确解释并保留 Orientation 仍必须明天测试，不用 Windows 结果代替微信结果。

角度目前仅连接会话内保存，重新扫码/新连接不持久化；会话照片 ID 本来就是私有盐生成的不透明 ID。强杀恢复尚未实现，不声称它已有。

## 本轮 fresh 验证

- 初始新增 EXIF/browse 测试 10 项 RED，生产实现后 GREEN；协议/UI/save 初始 5 项 RED 后 GREEN。Android 接入静态约束与 authenticated HTTP 导出路由分别取得 RED 再补 GREEN。
- 复查后修复 malformed 显式版本类型导致崩溃、空筛选结果不能取消选择及 PNG 错误显示 EXIF 文案。新增拒绝副本错误 hash/角度/EXIF 标志/身份字段/冒充原图，关闭 EXIF 的原图路径，以及原生 PNG 三个非零方向 RGBA 指纹验证。最后补高位深 PNG 解码前必须拒绝的 RED，再在原生解码前检查 PNG IHDR、位深与像素数取得 GREEN，避免解码器先降精度后逃过检查。
- 最终 `npm run test:wechat`：**131/131 PASS**。
- `npm test -- --runInBand`：**88/88 PASS**；含真实 authenticated HTTP 路由的源文件变更拒绝、选项约束、原图保持及副本 hash 测试。
- `node tools/wechat-gallery/accept-exif-local.mjs`：只读现有 SQLite、GamePlayPhotos，快照 215 张；选取真实旧照片（日期推测 2.8）与真实 2.9 照片（日期推测 2.9），与 GamePlayPhotos 索引 digest 对齐。两张各 0/90/180/270° 共 8 次实际 Noise loopback 导出，Windows 原生能读取 Make/Model/FNumber/FocalLength，解码后方向/尺寸/64 点 RGBA 指纹与原图按指定角度转换一致；JPEG SOS 及尾部逐字节相同，重读源 hash 不变。没有输出样本路径、UID、私密连接码，也没有落地/上传媒体。
- Android `testDebugUnitTest` 实际执行 55 项：**53 PASS，2 FAIL**，均为已有 `EditedMediaAccessTest.successfulGrantIsReported` / `grantFailureStillReturnsLinkableMediaInfo` 的 Robolectric 问题。本轮不修改无关修图关联业务，不把 Android 单测全绿作为结论。单独 `assembleDebug --offline --no-daemon`：**BUILD SUCCESSFUL**，真实 JDK/Android SDK，没有下载新工具链。APK 的 apksigner v2 验签通过，未安装设备。
- `npm run pc:exe` 成功，包含新导出 runtime 与 `wechat/rotate-png.ps1`；release layout VerifyOnly 通过。NU1900 表示 NuGet 在线漏洞信息获取失败，不算安全审计通过。
- `node tools/wechat-gallery/accept-desktop-exe.mjs`：实际新打包服务在源库的私有临时副本上启动，扫描 224 个素材、215 张微信普通照片；Android/微信入口、连接码生成/更新/结束及头像一致通过。测试副本禁用在线 resolver，原库只读；已结束测试进程并清理经过绝对路径约束检查的临时副本，没有停止用户进程。
- 微信 CLI `preview` 成功：纯代码包 **222,517 字节**，AppID `wx1bfaa26659e0401b`，未发布/提审；新二维码 `out/wechat-gallery-exif-preview.png`。本轮未上传真实媒体、UID、配对密钥、本机地址。
- `git diff --check` 通过。源工作区既有脏改动保留，`tools/sample-analyzer/analyze.mjs` 没有被本轮覆盖。

## 明天使用的最新交付

整个目录：`release/NikkiSync/`。先运行里面的 `NikkiSync-PC.exe`，不能只复制一个壳 EXE 而继续用旧 service。APK：`release/NikkiSync/NikkiSync-Android.apk`，debug 开发构建。

| 文件 | SHA256 |
| --- | --- |
| NikkiSync-PC.exe | `F6F35C74381B175EA457445C92597E4A17E2B92454C7C515299E8687EF044E89` |
| NikkiSync-PC-service.exe | `59CBF3754C86F6E70C3F27E31B91A0E49FEA647447ABFBF173071E2B4F0E03DB` |
| NikkiSync-Android.apk | `A045D27E511A8DB5FC9C97391F0650CA22402C3C7336D8173D45928D86EC40CA` |

微信用 `out/wechat-gallery-exif-preview.png` 打开新版开发版，再扫描新版 EXE 生成的临时照片连接码。开发预览码不含照片连接密钥，与 PC 私密连接码用途不同。新小程序和 APK 的导出功能需要新 EXE；旧下载服务不支持新 browse/export 时失败关闭，不绕过/静默降级。旧预览 profile 的权限保持不变。

仍同局域网、普通 JPEG/PNG、每图 16 MiB、会话 128 MiB/256 请求/10 分钟/单次领取，最多选 100 张但不保证一次会话预算能下载 100 张。缩放高清原图也消耗预算。没有公网桥、付费云、修改防火墙或启动项。

## 明天手机/系统相册验收（全部待验收）

1. 新 EXE、新小程序、新 APK；连接同 Wi-Fi。先用真实旧照片与真实 2.9 照片分别确认已有参数面板及服装名称可读。
2. JPEG 打开“保存时附带拍摄参数”，保存两代样本；系统相册查看厂商 Momo Camera、型号、光圈、焦距、方向与原像素尺寸。系统相册不展示不等于文件无 EXIF；必要时只在手机/PC 本地读回保存文件的标准标签，区分“微信去掉标签”和“相册不展示”。确认之前不要写“微信保留 EXIF PASS”。
3. 两代样本逐张验证 0/90/180/270°：预览、单张保存、混合角度多选保存一致；关闭 EXIF 时非零旋转仍保留方向标签，零角度保存原图。PNG 单独确认方向/alpha，不期待 EXIF。
4. 按服装、版本、日期组合搜索，含第 12/13 张分页、跨页选择、零结果取消选择、刷新后保留筛选、未知版本；核对日期推测提示。
5. 拒绝相册权限、过期、预算耗尽、下载中停止/后台、切图缩放：不得误报保存成功、反复缩放、错图或自动上传媒体。iPhone 尚未验收，不能用 Android 通过代替。

## 关机安排

按本轮用户明确要求：完成交付后安排一次正常关机，同时已设置 **2026-10-04 04:00 +08:00** 的一次性备用任务 `NikkiSync-BackupShutdown-20261004-0400`。

完成关机任务 `NikkiSync-CompletionShutdown-20261004-0300` 已注册并读回确认：**2026-10-04 03:02:30 +08:00**；备用任务读回仍为 **04:00**。

两任务动作 `C:\Windows\System32\shutdown.exe /s /t 0`，不带 `/f`；`StartWhenAvailable=false`、`WakeToRun=false`，不在下次开机补执行，不强制丢弃未保存应用。“已设置”不等于在关机前能够证明电源已经关闭；若未保存应用阻止关机，不会擅自改成强制关闭。
