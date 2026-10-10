# iPhone 微信 Live 保存实验｜电脑封装 + 小程序一键保存

## 用户目标与当前状态

用户要求：完全在小程序中一键保存到 iPhone 系统相册，并成为可播放 Live Photo；不接受额外 App、快捷指令、手工导入、GIF 或普通视频作为替代。允许先实验电脑端封装再发送；已确认有 iPhone 可扫码。

本轮是 **合成素材的 bounded feasibility probe**，不是完整 Live 产品发布。电脑生成封装候选，小程序只调用公开保存接口，真实相册结果待用户验收。不把“文件有正确标识”或“微信 success 回调”当成系统 LIVE 已通过。

工作区：`D:\GAME\InfinityNikki Launcher\InfinityNikki\X6Game\CameraPartner\NikkiSync-RemoteBridge`。
分支：`feature/remote-bridge-foundation`；HEAD `2466e60b3d43a707851915ce9f4ee67627a06338`；本轮修改未提交/推送，不切回 main。

**现有发布 EXE/APK 没有替换。本实验封装器目前在电脑的隔离 Node 工具中，不应宣称已集成成品 EXE。** 如果 iPhone 证明某条公开保存路径可行，再把通用封装器接入现有 EXE 的单一照片服务与原 Live 资源关联；不会要求用户最终运行第二个 Node 服务。

## 电脑端候选与证据

`tools/wechat-live-probe/prepare.mjs` 复用已安装 FFmpeg / ffprobe 8.1.1，不下载工具；只生成 320×180、24 fps、48 帧、2 秒 H.264/AAC 合成动态测试图。不是游戏照片、暖暖/大喵 AI 图或私人样本。

固定输出目录由本机 `mkdtemp` 在 `out/` 下创建；不接受照片路径或自定义源文件。生成：

| 文件 | 用途 |
| --- | --- |
| `baseline.jpg` | 普通图片保存/授权对照 |
| `paired.jpg` | Apple MakerNote `0x0011` 配对标识，原 JPEG 编码不变 |
| `paired.mov` | 同一 UUID 的 movie-level `moov/meta`；真正 `mebx` 定时元数据轨道，`still-image-time` int8 样本在 1 秒 |
| `motion.jpg` | 标准/旧兼容 Motion XMP + 完整 MP4 的单文件候选 |
| `paired.livp` | JPG+MOV 的无压缩 ZIP 交换包候选；**不是 Apple 官方相册导入 API** |

每次生成 fresh UUID，避免不同测试批次重复身份干扰；同批 LIVP 与双文件仍共享资源，因此两个方式之间需要用户手动清除本次测试项目，不能自动删除相册。

MOV 只接受生成器的 moov-last 两秒视频+音频输入，不重排原媒体偏移，不凭字符串插入伪造定时轨道。新增一段自包含 mdat 与 metadata track；没有外部文件引用。实际 ffprobe 检查：48 视频帧、AAC、2 秒、3 个 metadata samples，keyframe sample PTS=1 秒。修改前后视频/音频每包 SHA256、PTS、duration 完全一致；JPEG 仅新增 APP1，剩余字节逐字节相同。

独立格式写入基于 Apple QTFF 与 ExifTool 字段描述，无复制第三方软件代码/模板媒体。**尚未用 Apple PhotoKit 做正控制导入，尚未证实 iPhone Photos 接受候选。** 实验 writer 仅支持固定小型 SDR 合成输入，不可拿来批量处理真实游戏 Live。

## 加密局域网边界

`tools/wechat-live-probe/server.mjs` / `lib/live-probe.js` 使用独立 QR type `NikkiSyncLiveImportProbe` v1，沿用已有 Noise NNpsk0 算法与 download peer，而不是改现有相册协议。

- 唯一私有 Wi-Fi IPv4、随机端口、10 分钟码、单次连接 claim、最多 32 次未认证尝试；不支持公网、任意路径、其他 QR、额外命令或任何图库/数据库访问。
- 只接收固定 `NS-LIVE-PROBE/1` 请求，返回严格顺序的 5 个合成资源；每个 ≤512 KiB，总 TCP ≤2 MiB，接收最多 20 秒；既有4096明文/4112密文记录上限不变。
- 完整认证解密、大小、序列、SHA256 与基本格式头检查后才交付文件。失败/取消擦除持有的字节，不降级明文。
- QR 含临时 PSK，只打开本机文件面板；不得读像素到聊天、打印 JSON、上传微信或纳入 Git。日志仅打印输出路径、到期与非敏感状态。
- 合成资源通过加密 LAN 发到手机，**不放进上传微信的预览包**；没有真实照片、UID、本机地址、PSK 进入预览。

JS 密钥内存和已有 Noise 依赖审计限制并未因这个测试解除。本实验不作为生产安全审计通过。

## 小程序保存与生命周期

新增 `pages/live-diagnostics/index`，只在首页折叠的开发工具里显示；普通图库仍显示“Live 尚未开放”。不改普通浏览/下载、Android Live、NUAN5、PC 配对与 Windows Shell 生命周期。

校验完缓存后先显示图片和 MOV 播放器。用户自己选择下面方式，再点击一次“测试所选保存方式”：

1. 普通 JPG → `wx.saveImageToPhotosAlbum`（权限对照）。
2. Motion JPEG → 同一个公开图片保存接口（期待是否仅静态）。
3. LIVP → 同一个公开图片保存接口，保留真实 `.livp` 扩展名（可能拒绝）；不伪装扩展名、不调用隐藏 API。
4. 配对 JPG+MOV → 按顺序调用图片保存与视频保存接口；一个用户点击、最多两条相册项目；**没有平台原子配对接口的承诺**。

只传官方支持的 filePath/success/fail 参数，没有虚构 pairedVideo/livePhoto 参数。拒绝/异常不算保存；第二次写入失败显示部分失败，不删除先存的图片。回调成功仍是 `live=unverified`，不能自动添加“已支持 iPhone Live”状态。

文件名在小程序私有目录生成；JPG/MOV 共用 basename。不保留 QR 密钥在 Page.data，不使用远程提供的文件路径。由于全是非私人且总量受限的合成素材，暂时切到系统相册/权限框时保留缓存，方便回到页面做其余测试。退出页面清理；保存中的输入固定到平台回调后再清理；迟到写入、旧任务回调不能覆盖新任务。重开时只清理精确的自有测试前缀，不碰其他文件或正在使用的资源。微信进程强杀下没有相册事务回滚/结果 journal，不能虚称原子保存。

非 iOS 设备不执行这组保存验收。页面不上传设备身份或结果；用户只需反馈系统/微信版本与相册观察。

## 实际验证（2026-10-04）

TDD：先封装器 2 项缺模块 RED；传输/保存 7 项 RED；页面 4 项 RED；再新增后台保留和 fresh identity 2 项实际 RED，补实现后 GREEN。测试运行最初普通 Node test isolation 被沙箱 EPERM 拦截，改用项目既有 `--test-isolation=none` 后才取得代码 RED，不把权限错误当代码失败。

- `npm run test:wechat-live` 等价的四文件命令：**14/14 PASS**，包含实际 FFmpeg/ffprobe、认证 TCP 回环、错误 hash/密文/长度/顺序/截断、重复码、保存失败/重复回调/退出和后台。
- `npm run test:wechat`：TypeScript/PC runtime build 成功，**159/159 PASS**。
- 主工程同一完整 Node test 清单：**91/91 PASS**（没有修改 PC 业务源代码）。
- `git diff --check`：exit 0，仅已有 CRLF 提示。
- 微信 CLI `preview`：成功，纯代码包 **249,200 字节**，AppID `wx1bfaa26659e0401b`；`out/wechat-live-import-preview.png`。未运行正式 upload、发布或提审。

未执行：iPhone 保存、系统 Photos LIVE 播放、关闭重开/音轨/持久化。所有文件 manifest 和页面均保持 `unverified`。没重打包 EXE/APK、没安装手机、没改真实 SQLite/游戏文件、没 commit/push/merge。

本轮已实际启动一次 LAN 服务：`out/wechat-live-probe-vlREjO/`，合成传输总量 248,531 字节。私密连接码到期 `2026-10-04T12:46:57.106Z`（香港时间20:46:57），到期自动关监听并删除本次 QR；合成文件/非敏感 manifest 保留供核验，不写真实数据库。`open_in_codex` 返回 queued，不声称面板已经可见；交付链接可手动打开。预览码 SHA256 `763630E5B74E97D150CFB7AA05518C810BDDE8DADBAF26414AFD934FB5D9AD23`。没有把私密码像素或 PSK 读入聊天。

## iPhone 测试顺序

1. 微信扫码 `out/wechat-live-import-preview.png` 打开本轮开发版（不是旧的服装图标预览）。
2. 与电脑连接同一 Wi-Fi；打开首页“开发工具 → iPhone Live 保存 · 合成素材实验”。
3. 电脑启动 `npm run wechat:live-probe`（本轮由 Codex代为启动），把日志中的 `private-live-probe-qr.png` 仅在电脑文件面板显示。
4. 手机点击接收，扫描独立私密连接码；检查图片与 2 秒动态视频/声音。
5. 先试 1 验证系统权限；再 2/3/4。每项完成后查看系统相册并报告：失败提示 / 静态图 / 普通视频 / 两条独立项目 / 一条真正 LIVE。方式3/4之间清理本次合成项目，排除同标识重复导入。
6. 只有 **单一 LIVE、完整运动与声音、关闭相册重开仍可播放** 才记通过。通过还需记录 iPhone型号（不记录序列号）、iOS完整版本、微信版本、测试方法、manifest SHA 与输出格式；不由 Android、小程序播放器或 success 回调代替。

所有候选失败时，应报告这些具体公开 API/候选在这台系统上的结果；缺 Apple 正控制时也不能武断宣布“所有封装永远不可能”。更换封装或整合 EXE并不能自动获得 iOS 相册配对写入能力。不要把一个静态封面+普通视频包装成最终一键 Live 功能。

## 资料

- [微信官方 API 类型](https://github.com/wechat-miniprogram/api-typings/blob/master/types/wx/lib.wx.api.d.ts)：SaveImageToPhotosAlbumOption/SaveVideoToPhotosAlbumOption 是独立 filePath，未发现 Live 配对保存声明。
- [Apple：Capturing and saving Live Photos](https://developer.apple.com/documentation/avfoundation/capturing-and-saving-live-photos)：原生 PhotoKit 对 photo+pairedVideo 的资产创建；不能直接从小程序调用。
- [Apple：Timed metadata sample descriptions](https://developer.apple.com/documentation/quicktime-file-format/timed_metadata_sample_descriptions)、[Timed metadata sample data format](https://developer.apple.com/documentation/quicktime-file-format/timed_metadata_sample_data_format)；结构详情经 Apple 官方 JSON文档复核。
- [ExifTool Apple字段定义](https://github.com/exiftool/exiftool/blob/master/lib/Image/ExifTool/Apple.pm)：MakerNote ContentIdentifier 0x0011。

第三方生成器采用的 track/元数据位置存在不同变体；未下载其媒体/拷贝源码，不能用其宣传代替本项目 Apple 导入或微信真机证据。

## 2026-10-04 继续｜朋友跨网络，改为单文件交付

用户澄清 iPhone 由不在同一 Wi-Fi 的朋友协助。最初同意准备内置合成素材体验版，随后明确改为“直接做好一个封包好的文件，我直接发给朋友”。当前以单文件交付为准；停止体验版方案。本次没有修改小程序源码、没有上传微信、没有设置体验版或添加成员。朋友微信号问题不再需要回答。

交付：`out/ios-live-file-test-2026-10-04/NikkiSync-Live-Test-20261004.livp`，79,395 字节；只含彩色动态测试画面和合成音，不含真实照片、UID、地址、密钥或任何连接二维码。复制自本轮已生成的 `out/wechat-live-probe-vlREjO/paired.livp`，没有重新编码媒体。

SHA256：`c8d609bcf83a140387b100c5ee0605f951319ec4283ecaa7559669aabbfa25f8`。

本次真实检查：

- 通过 .NET ZIP reader 在内存只读解包：恰好 `probe.jpg` / `probe.mov` 两个安全叶路径；分别 10,886 / 68,299 字节，SHA256 与生成 manifest 完全一致。
- 对实际交付包内 MOV 的源文件执行现有 ffprobe：H.264、320×180、24 fps、48 帧；AAC 音轨；2 秒；3 个 `mebx` 样本；content identifier 为 `25771FB9-7363-4E48-B9D6-9CCCEB47D41F`，与 JPEG 配对。
- `node --test --test-isolation=none tools/wechat-live-probe/package.test.mjs`：2/2 PASS；`npm run test:wechat-live`：14/14 PASS。普通沙箱调用 FFmpeg 首次返回 EPERM，使用获批准的现有本机工具链后才得到上述真实通过记录。
- 没有访问游戏/私人图库、没有发给朋友或任何第三方。发送由用户执行。没有修改或替换 EXE/APK，未提交/推送。

**这只是 LIVP 封装候选，不是已证实能从微信文件直接导入 iPhone 的格式。** [Apple 官方导出说明](https://support.apple.com/guide/photos/export-photos-videos-slideshows-and-memories-pht6e157c5f/mac) 将原始 Live Photo 描述为静态图片与视频两个文件；本项目的 ZIP 包装不等于获得系统成对导入能力。Apple PhotoKit 正控制仍未执行。

用户以微信“文件”发送 `.livp`，不要以聊天照片/视频重压缩发送，也不要改后缀。朋友尝试打开；仅当系统提供保存到相册入口才继续。若只能存到“文件”、无法打开或保存被拒绝，反馈该提示截图即可，不要求安装转换 App/快捷指令，不把格式拒绝说成网络失败。系统相册里只有一个 LIVE 项目、长按有完整运动和声音、关闭重开仍能播放才算该导入路径通过；静态图/普通视频/两个项目均不算。

此测试不再依赖同一 Wi-Fi，也不开放 PC 的公网端口，但**不验证小程序一键保存、跨网浏览私人图库或正式 EXE 通用 Live 封装**。所有设备接受状态保持 `unverified`。

## 2026-10-05｜用户撤回相册成功说法

用户最初回答测试可以，随后明确澄清：微信收到文件后不能保存到相册；曾说的其他途径实际是 QQ 闪传下载（中间称作网盘下载），也只得到文件，系统相册中看不到。用户明确表示此前说法不对。因此没有系统相册 LIVE 成功证据，不能把微信转发、QQ 下载或文件落地算作 Live 相册适配通过。Apple PhotoKit 正控制导入仍未完成，尚需区分封装是否被 iOS 接受与小程序是否具有相应写入入口。用户将可行性调查交给 dot，说明见 `MINIPROGRAM_LIVE_DOT_HANDOFF_2026-10-05.md`。
