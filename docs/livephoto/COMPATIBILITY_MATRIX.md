# NikkiSync Live 图兼容矩阵与代码产物

2026-10-21 更新：用户反馈华为 NAM-AL00 / 4.2.0.135 / Android API31 / App1.0.11 手动选择华为格式后可用，并明确要求自动默认。华为现在默认 huawei_legacy_tail；荣耀新增独立 honor_moving_compat 自动兼容配置，共用已有 60B 尾标布局，官方 SDK 尚未接入、荣耀真机尚未验收。显式手动覆盖保留。此项替代下文旧的默认标准/必须手动策略，不能转化为全品牌通过结论。

更新：2026-09-26。工作分支：`feature/m3-livephoto-compat-rotation`。只涉及 Live/Motion Photo；不包含参数解析、PC UI 或分享卡片改造。

## 先区分三种状态

**代码存在、容器结构通过、系统相册完整播放通过，是三个不同结论。** 本分支新增了共享封装/校验与旋转代码，但尚未完成新的 Android 构建或任何新增机型的相册验收。这里列的是厂商/格式族及机型测试策略，不是“所有型号已支持”清单。

每一条通过记录必须绑定：品牌、准确型号、地区版、系统完整版本、Android API、相册包名/版本、profile ID、Git SHA、测试源样本、0/90/180/270 度结果。不能按“同一个厂商”自动继承通过。

## 代码结构

公共包：`apps/mobile/app/src/main/java/app/nikkisync/mobile/media/live/`。

- `LivePhotoProfile`：当前候选配置、品牌初选、显式 profile ID。
- `LivePhotoExporter`：签名资源下载与 SHA-256、旋转、封面匹配、厂商 EXIF、封装、独立校验、MediaStore 发布、完整 URI 返回。
- `MotionContainer` / `MotionXmp` / `JpegSegments`：格式布局、命名空间级 XMP 合并、整段替换、最终 MPF 长度。
- `MotionContainerVerifier`：重新解析输出的边界、尾索引、关联 ID，并逐字节检查嵌入视频。
- `VivoLegacyMetadata`：旧 vivo 双文件私有元数据。
- `VideoFacts` / `CoverFrameMatcher`：实际视频 sample PTS、轨道/画幅/音轨检查、低内存封面匹配，不再用默认 30fps 猜帧号。
- `LivePhotoRotation`：图片与完整视频同步像素旋转。
- `LivePhotoControls`：照片详情中的单张旋转、格式候选选择、已保存动态状态/双文件视频保底入口。

现有 `MainActivity.saveSelected()` 已调用新 exporter；旧 `MotionPhotoSaver`、`OppoLivePhotoSaver` 等文件保留作历史参考，但不再是该入口的 Live 执行路径。不要继续向旧 writer 复制补丁。

## 厂商/格式族

| 目标 | 当前 profile / 默认行为 | 本次代码产物 | 具体机型下一步 |
|---|---|---|---|
| Google / Pixel / 其他 Android | `google_motion_v1`；未知环境默认标准候选 | JPEG + MP4，现代 Motion XMP、Container Directory、视频长度/封面 PTS；保留非实况 XMP | Google Photos 与手机自带相册分别测试；不能由标准有效推导相册支持 |
| Xiaomi / Redmi / POCO | `xiaomi_compat` | 在标准布局上加 MicroVideo 兼容字段；保留原始 MP4，明确封面时间戳 | 以用户历史成功的小米设备为回归控制组；补实际型号、HyperOS/相册版本和地区。现有成功记录只覆盖当时那一台设备 |
| OPPO | `oplus_olive`，实验候选 | Oplus XMP、UserComment、最终长度 MPF、JPEG+MP4 | 先对照 Find X7 Ultra / ColorOS 14 公开样本，再测试用户目标系统；新系统单独记录 |
| 一加 | 同 `oplus_olive`，实验候选 | 复用 Oplus 格式，不代表各地区相册相同 | ColorOS 与 OxygenOS 分开验收，版本/地区不能合并 |
| realme | 同 `oplus_olive`，实验候选 | 复用 Oplus 格式 | realme UI 目标型号单独取得原生样本并验证 |
| vivo / iQOO 旧格式 | `vivo_legacy_pair`，当前品牌初选但标实验 | 同源 JPG+MP4、共享 28 位 ID、vivo footer / MP4 uuid；两个 URI 均记录；缺视频能识别 | 要求系统相册将二者识别为同一 Live；重启、只删视频、权限撤销分别测试；不能按同名文件猜配对 |
| vivo / iQOO 新单文件 | `vivo_single_xmp`，手动选择、实验 | Google/VCamera XMP + 单文件追加 MP4；最小 UserComment 候选 | 公开参考提及 X300 Ultra 样本，不应据此划一条“X300以上全支持”的型号分界。当前未复制完整私有相机状态字符串，相册识别可能仍失败；需实机样本差分确认必需字段 |
| Samsung Galaxy / One UI 旧 SEF | `samsung_sef_legacy`，实验候选 | `MotionPhoto_Data`、0x0A30、SEFH106/SEFT；尾索引必须在 EOF；独立验证偏移 | 按 One UI 与 Gallery 版本取得原生样本；重点确认完整播放/封面/音轨。新版 mpvd/sefd 等变体尚未实现，不伪称同一 writer 覆盖 |
| 华为 Android 兼容环境 | 自动 `huawei_legacy_tail`，手动覆盖仍优先 | 60B `v6_f` / `LIVE_` 尾标；字段超长拒绝截断 | NAM-AL00 / 4.2 用户反馈手动选择后可用；完整声音、重开/重启与旋转未逐项验收。当前封面帧号 >=100 仍明确拒绝，不截断或假造封面位置；其他设备继续分别验收 |
| 荣耀 MagicOS | 自动 `honor_moving_compat`，独立于华为配置 | 共用既有 60B 尾标布局，独立 profile ID/提示/保存记录；官方 SDK 未接入 | 公开兼容实现把该布局用于 Huawei/Honor，但当前没有本项目荣耀实机结果。按型号、MagicOS、图库及地区分别验收；后续官方 SDK 接入需核验真实依赖/能力接口，不能把兼容封装标成官方方案 |
| 原生 HarmonyOS | 不属于当前 Android APK 的完成范围 | 本次只有接口/实施交接说明，无 ArkTS 应用代码 | 使用目标 HarmonyOS SDK 的动态照片资产 API，提交 IMAGE_RESOURCE 与 VIDEO_RESOURCE。原生端接入、权限、发布、播放是独立任务，不是增加 Android Saver 即完成 |

## 旋转适配（所有当前文件封装配置共用）

用户角度按显示方向顺时针累计，只允许 0/90/180/270。0 度直接使用下载的静态图与视频，不重新编码媒体内容；封装仍可能更新动态元数据。非零角度先把 JPEG 的 EXIF 显示方向应用一次，然后旋转像素并以 quality=100 重新编码；这不是数学意义的无损 JPEG 旋转。视频使用 Media3 Transformer/effect 1.8.0，在相同方向执行全片帧变换，不裁剪、不主动改帧率、不删除音轨。

`PixelRotation` 是非 no-op MatrixTransformation，避免 1.8.0 将标准直角旋转优化成仅写 muxer rotation。`setPortraitEncodingEnabled(true)` 避免以横向像素 + 方向标签代替真正竖向画面。编码器要求降分辨率/色彩降级时拒绝；输出必须是 rotation=0、正确物理宽高、同视频帧数、保留音轨、时间轴/时长在允许误差内。

当前 JPEG 色彩/HDR/复杂输入边界：宽色域或 GainMap 的非零旋转、HDR/BT.2020 视频非零旋转、HEIF 封面、多视频/多音轨、非方形像素、过大内存、超出帧数上限均明确失败，不静默输出静态图或低清副本。非零 JPEG 只迁移安全的 EXIF 字段，不声称完整保留原生不透明尾参数；原始输入和 NikkiSync 参数快照不变。

## 已保存/失败边界

`SavedPhotoStore.Record` 新增 companionUris、profileId、exportHasMotion、presentationUs、timestampSource，并兼容旧单 URI 记录。`SavedPhotoVerifier` 与 Adapter 显示 `MOTION_MISSING` / `MOTION_UNVERIFIED`，不会因为封面存在就说双文件完整。相册播放验收保持 `unknown`。

MediaStore 逐一登记本次创建的 URI；处理到的失败会补偿删除这些新 URI，不碰用户已有媒体。**跨两个媒体项并不具备真正原子事务；进程被杀时的持久事务日志/恢复尚未实现，是正式发布前的后续任务。**

当前格式选择是品牌初选 + 手动覆盖，不是完整的 OS/相册能力探测系统。还没有远程签名设备规则热更新、官方 SDK 能力探测、相册自动播放认证或低置信度封面手选 UI。必须保持这些状态与代码一致。

## 证据与参考（官方与逆向分开）

官方：
- Android Motion Photo：https://developer.android.com/media/platform/motion-photo-format
- Media3 Transformer：https://developer.android.com/media/media3/transformer/transformations
- 精确版本的旋转/转封装判断：https://github.com/androidx/media/blob/1.8.0/libraries/transformer/src/main/java/androidx/media3/transformer/TransformerUtil.java
- 精确版本 Builder/API：https://github.com/androidx/media/blob/1.8.0/libraries/transformer/src/main/java/androidx/media3/transformer/Transformer.java
- 小米动态照片 SDK（需要正式接入条件）：https://dev.mi.com/xiaomihyperos/documentation/detail?pId=2003
- 荣耀 MediaData Kit：https://developer.honor.com/cn/docs/11032/guides/introduction
- OpenHarmony 文档（实施时须再对照实际 HarmonyOS SDK）：https://github.com/openharmony/docs/blob/master/zh-cn/application-dev/media/medialibrary/photoAccessHelper-movingphoto.md

公开逆向/实现参考，不是官方承诺，不代表已对其全部代码作许可审计：
- OPPO 样本实现：https://github.com/Young-Spark/oppo-live-photo-maker
- vivo 新格式参考：https://github.com/LengxiQwQ/live-photo-box/blob/master/LivePhotoBox.Core/Services/Protocols/VivoLivePhotoProtocol.cs
- 华为尾标参考：https://github.com/LengxiQwQ/live-photo-box/blob/master/LivePhotoBox.Core/Services/Protocols/HuaweiMovingPhotoProtocol.cs
- 三星 SEF 讨论：https://exiftool.org/forum/index.php?topic=16086.0

后续复制第三方实现前先核验许可证；本分支没有下载/打包第三方 SDK 或把完整第三方实现作为依赖搬入仓库。不要收集或上传含私人内容/UID 的真实样本，优先用用户许可的非敏感测试画面。
