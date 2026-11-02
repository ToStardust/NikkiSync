# 本机暖暖照片只读开发浏览｜2026-10-02

用户明确要求：“允许，你不用这么拘谨，直接跑到能浏览本机无限暖暖照片的步骤”。因此本轮从合成诊断扩展到受控局域网真实照片开发联调。不是正式上线/审核授权，不将旧安全待验收条目静默改成PASS。

工作区 `NikkiSync-RemoteBridge`，分支 `feature/remote-bridge-foundation`。仅Remote Bridge开发工具与微信端。没有修改Live、NUAN5、原生配对协议、Windows生命周期、图库扫描核心。没有费用/域名/云服务/代理隧道，没有EXE或APK重包或合并main。当前变更仍在本地、未commit/push，保留用户已有 `tools/sample-analyzer/analyze.mjs` 改动。

## 可使用的能力

- 自动发现既有暖暖安装和隐藏GamePlayPhotos目录，无需用户设置路径；调用已有发现模块，明确禁止游戏进程探测。
- 以Node SQLite `readOnly:true`打开现有 `%LOCALAPPDATA%/NikkiSync/nikkisync.sqlite`，复用RemoteFileProvider与仓库查询，不initialize/migrate、不删库、不另建索引。
- 快照最多500张稳定普通照片，当前机器215张；Live9张不在本轮范围。每页12张，可以翻页、回第一页、点图放大。
- 外发仅随机会话内照片ID、日期、计数、重新编码的JPEG预览。没有UID、原文件名/路径、服装/相机参数、源EXIF/游戏尾部、原图下载或自动相册保存。
- 使用现有Windows System.Drawing经匿名stdin/stdout转换内存像素，长边最多960、质量82、预览最多512KiB。原图只读且限定16MiB/4000万像素，源文件大小、SHA256、前后stat均核对；只接受自动发现照片根内真实路径及已索引资源。失效/删除/变化照片跳过或显示不可用，不清库。
- 手机缓存仅存本页已完整校验的JPEG，换页/后台/退出清理自有缓存，不删除系统相册。取消后的迟到文件回调只做本地清理。清理失败或进程死亡可能留缓存，下次启动残留清扫仍待做。

## 通道与安全限制

新QR：`NikkiSyncLocalGalleryPreview` v1，只通过本机文件面板展示。随机32字节PSK、随机sessionId、明确私有Wi-Fi端口、十分钟期限、prologue绑定所有公开QR字段与固定Noise套件。拒绝其他测试/原生配对QR。不得把含PSK的QR像素/内容上传聊天、微信预览包、仓库、日志、页面data或持久化设置。

初次认证请求消费QR，整个连接可以浏览；关闭/后台后不允许相同QR重新连接，需要新码。最多1活动连接/32握手尝试；请求序号严格递增、只处理list/get、不接受任意路径/并发请求。每向4096条记录、4096明文/4112密文每条、16MiB总分帧字节、256个请求、单图512KiB、十分钟绝对期限。限额触发会关闭；不是大图断点续传、防DOS或全图库无限浏览完成版。

图片传输：认证加密头绑定请求ID/图片ID/大小/格式/SHA256 → 有序认证加密块 → 认证加密end → 手机复核全字节SHA256与JPEG边界 → 临时文件 → image组件。错误哈希、密文篡改、截断、超额头、乱序/重放不得产生预览，绝不降级明文/HTTP或跳过TLS证书。没有把TCP协议伪称HTTPS。

新增独立参考向量：Cacophony公开 `Noise_NNpsk0_25519_ChaChaPoly_BLAKE2b`，完整两次握手、handshake hash和四条双向传输密文逐字节匹配。来源 [Cacophony vectors](https://github.com/haskell-cryptography/cacophony/blob/master/vectors/cacophony.txt)，[Unlicense](https://github.com/haskell-cryptography/cacophony/blob/master/LICENSE)。只复制相关公开向量到测试，不含真实PSK；参考向量通过不等于安全审计。

**sodium-javascript仍标记WIP，当前组合没有独立审计。JS侧信道、内存完全抹除、手机性能与iPhone仍未验收。此入口仅用户授权的开发联调，不自动随EXE启动，不作为正式私有图库生产安全认可。** 微信审核、网络合法域名/协议适配的正式发布适用性未确认；不因Android文本成功宣称iOS/正式版可用。

## 验证记录

TDD：先写gallery协议/真实TCP/source三项，缺模块得到3项RED；实现后source/TCP通过。页面测试先缺页面RED；补页面后通过。额外覆盖认证后错图哈希、篡改密文、超大头、截断拒绝，以及页代次改变后连接错误可见、退出后迟到文件不会回显。图库新profile先缺createGalleryPeer RED，补实现后通过；原诊断16记录限额不变。

- `npm run test:wechat`：包含构建与14个测试文件，最终51/51 PASS，exit0；含独立完整Noise向量及Node/OpenSSL和SHA256对照、图库安全/生命周期。
- `npm test -- --runInBand`：87/87 PASS，exit0。
- `git diff --check`：exit0，仅CRLF警告。
- Node真实照片转换初次0/3因沙箱子进程受限；同一现有转换代码获提升执行后3/3成功，预览109876、87625、49940字节。没有下载新环境。
- `node tools/wechat-gallery/accept-local.mjs`（提升执行Windows转换子进程）：只读DB215张，第一页12、第二页12，前三张真实游戏照片经Node回环TCP→浏览器JS客户端解密/SHA256完整校验成功，总预览247441字节。原照片未写，媒体未外部上传。**这是同机真实媒体E2E，不是微信手机PASS。**

## 开发预览与本机服务

用户本轮授权覆盖推进浏览流程的测试代码更新。最终CLI preview退出0，包147578字节，保存在忽略的 `out/wechat-gallery-preview.png`；只上传代码与合成fixture/公共向量依赖（向量测试文件不在小程序包内），无真实照片、实际PSK、UID、本机IP。未执行正式upload/发布/审核。

已启动 `node tools/wechat-gallery/server.mjs`（提升执行）只读局域网开发服务，启动记录photoCount215、previewOnly true。当前这一轮有效期至2026-10-02 23:16:21（Asia/Hong_Kong），十分钟后关闭并尽力删除自己的私有QR。本机私有QR只在文件面板展示，未读取其像素到聊天。

手机步骤：

1. 同一Wi-Fi，微信扫描聊天中**最新浏览版预览码**打开小程序。
2. 进入“本机照片浏览（开发预览）”，点“扫描电脑浏览码”，扫描电脑本机文件面板私有QR。
3. 检查12张预览、下一页、点图放大；不把预览清晰度当原图质量。勿转发私有浏览码。

**当前待用户实机反馈。不能声称微信Android图片显示/保存/iPhone/原图下载已通过。** 新码过期或退出连接可直接在相同授权范围重启该开发服务，无需扩大到云、公网或游戏写入。

## 用户实机反馈与预览单击修复

用户明确反馈“能看到了，但是预览的时候单击就返回了，下一页倒是正常”。因此记录为：**Android微信真实照片显示、下一页：用户报告通过**，不是独立截图/抓包证明；相册保存、iPhone、原图和生产安全仍未通过。

已确认根因是开发预览层 `bindtap="closePhoto"`：单击整个图片/背景都会退出。先新增页面行为测试得到RED（viewerOpen未定义），补实现后聚焦3/3 PASS；完整 `npm run test:wechat` 新鲜52/52 PASS（含构建），`git diff --check` exit0仅CRLF警告。未修改server、图库、加密协议或用户现有analyzer文件。

修复：

- 单击预览仅切换操作栏，不清缓存、不关闭连接或返回列表。
- 操作栏提供“返回相册”，使用catchtap防止冒泡。
- 使用微信page-container（overlay=false、duration=0、关闭下滑弹层退出）承载全屏预览，通过beforeleave/afterleave同步关闭状态，供原生返回处理；不创建新页面/触发图库onHide重连。
- 换页、离开小程序、重新扫码重置viewer状态，仍保持私有缓存清理边界。
- 微信团队[page-container示例](https://github.com/wechat-miniprogram/miniprogram-demo/blob/master/miniprogram/packageComponent/pages/view/page-container/page-container.wxml)用于核对组件属性和事件；Node调用方法/模板测试不代替真实系统返回验收。

修复版CLI preview成功，包148870字节（只含测试代码/合成fixture，无真实照片、实际密钥/IP/UID），仍未发布或提交审核。原23:16会话已正常到期，修复版需要新本机浏览码。**本轮单击切换/显式返回/系统返回待手机复验。**

已启动新的同范围开发会话，photoCount215，期限至2026-10-02 23:28:20（Asia/Hong_Kong）；含PSK的QR仅请求在本机文件面板打开，不读取其像素到聊天。
