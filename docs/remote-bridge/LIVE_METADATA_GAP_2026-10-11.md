# LIVE 详情与分享图无参数调查｜2026-10-11

用户明确反馈：App 的 LIVE 详情没有静态照片那样的穿搭，生成分享图也没有穿搭与相机参数。此前“LIVE 可以沿封面读取”的回答只反映代码会尝试读取，不代表真实 LIVE 格式已经适配。

## 已确认的实际现状

- 只读本机运行数据库：224 个非删除资产中，9 个 motion_photo 全部没有 raw.nativeParamToken、相机焦距或穿搭；200 个普通 photo 已解析成功并同时有相机/穿搭。另有 13 个普通照片解析失败、2 个没有原始参数。没有修改数据库。
- 9 个原始 LIVE JPEG 封面均在最后 JPEG EOI 之后附加 860 字节。结构为 `%PAPERGAMES% + 792 字符 Base64 数据 + %PAPERGAMES% + 44 字符 Base64 尾段`。未打印 UID、实际数据、尾段或私人路径。
- 9 个对应 MP4 也存在成对 `%PAPERGAMES%` 分隔符，参数段为 704 字符 Base64、尾段 44 字符。原视频并非普通摄影 JPEG 的尾格式。
- ResourceClassifier 的 nativePhotoEnvelope 当前只识别 JPEG 的两个 FFD9 分隔符与普通/2.9 的尾段，无法识别上述 LIVE 格式，因此入库时丢失这条解析入口。不是 App 根据 hasMotion 主动过滤了穿搭，也不是重启缓存导致丢失。
- ScanReconciler 只保留扫描器已识别的 nativeParam 字段；MetadataResolverService 要求 UID 与 token；NUAN5 适配器目前按普通 decode-photo2 返回的 focal/apeture/clothes 等字段映射。App 详情和 ShareCardPayloadBuilder 共用 PC 提供的 canonical metadata，所以两处会一起为空。

## 公开格式依据与限制

核查了固定版本的公开源码：

- [暖暖相册 视频原始结构](https://github.com/RanAxro/nikki_albums/blob/82ed642d3b1941e7b2bb191ef1ac32315770af96/rust/src/nuan5_params/nuan5_structs/video_custom_data.rs)：VideoCoverData 为 RoleID、CreateTime 与 videoCustomData；VideoRecordData 为录像时间、帧率、分辨率、时长、编码质量、文件路径等。该结构未定义普通摄影的 CameraParams 或穿搭。
- [暖暖相册 参数类型与分隔符](https://github.com/RanAxro/nikki_albums/blob/82ed642d3b1941e7b2bb191ef1ac32315770af96/rust/src/nuan5_params/decode.rs)：VIDEO_FLAG 是 `%PAPERGAMES%`，但 Video / VideoCover 的 MediaParamType / 映射仍为注释状态。
- [SpinningMomo 现有普通摄影 tuple](https://github.com/ChanIok/SpinningMomo/blob/main/src/extensions/infinity_nikki/photo_extract/scan.cpp)：普通摄影通过两个 FFD9 取段与计算 MD5。不能未经验证便将 LIVE 的不同边界当成这一协议发给上游。

这些证据支持“当前确实未适配 LIVE 参数”，并提示 LIVE 数据可能只含录像信息；**不能据此断言所有版本 LIVE 都绝不含穿搭/相机数据**。尤其不能把视频帧率/分辨率当作游戏摄影的焦距、光圈或曝光。

## 离线探针记录（未成功）

只在本机忽略目录下载并使用 NikkiGallery 固定提交 `3b0b1c9f9dbcf479b6a606f597e2ca68f2b88634` 的 MIT 原生库，SHA-256 `3f0d88a2510106ff8e66a4730a77ef9f7ffc27c89411f81fa223cc3e1170e601`，ABI 1。未加入依赖或发行包。只给库传入本机内存字节，不请求网络、不写原媒体。

9 个封面的 UID / 公共相机模式及额外零角色诊断探针都未产生可解析 JSON；1 张已解析的普通照片作阳性对照，UID 模式输出包含 CameraParams 标记且约 99.96% 为 ASCII，但严格 JSON 解析仍失败（上游使用扩展 nuan5 JSON 语法）。因此，这个探针**不构成成功原生解码验收，更不能把“没有字段”当成字段不存在**。底层 status=0 也不等于结果可展示。

实验仅保留于 `out/live-metadata-audit-20261011`（忽略、不提交），记录只有结构与状态，没有解密值。9 个 LIVE 与静态对照的源文件读取前后 SHA 均一致。没有新 APK、没有 PC 解析逻辑修改、没有清空配对/缓存或上传样本。

## 后续决策

已询问用户，同一张 LIVE 在暖暖照相馆/暖暖相册是否能显示相机和穿搭，以确定是否有已验证的 LIVE decoder 可对接。若对方能显示，需要核查真实返回字段、数据来源及协议，再适配到 canonical metadata；若实际源数据没有这些字段，需要明确能力限制，或者让用户明确关联一张对应的静态摄影图。不按时间接近、同穿搭、缩略图相似自动套用其他照片的相机参数。

分享图和详情的布局本身没有修复这个缺口的能力；本次不能宣称已恢复 LIVE 参数功能。
