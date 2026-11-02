# 加密合成图片 → 预览 → 确认保存：评估版

仅Remote Bridge，分支 `feature/remote-bridge-foundation`，实际工作区 `NikkiSync-RemoteBridge`。不接入真实照片、UID、数据库、游戏文件，不修改Live/NUAN5/配对安全协议/Windows生命周期。无云、无域名采购、无费用。

## 范围与边界

新增独立QR类型 `NikkiSyncEncryptedImageProbe` v1，不接受文本测试码。沿用现有Noise NNpsk0握手，prologue绑定图片协议、私有地址、端口、sessionId和到期时间。双方仅交换固定请求 `NS-IMAGE-PROBE/1` 和固定图片包；没有文件路径/图库/任意媒体读取入口。

图片是本地生成的96×96四象限RGB PNG（粉/紫/绿/蓝色组合），不是暖暖、大喵或玩家照片，不是成品画质样例。一个小图片包完整放在一条有序认证加密记录内，仍保持4096明文、4112密文、8192总接收和16记录限额，不为这轮测试提高限额。大图分块、流式落盘、断点恢复均未实现。

解密后对固定协议头、尺寸和PNG全字节与已知fixture逐字节比对。篡改、错图、截断、不完整响应均不得生成预览；这里的完整性证明仅适用于固定fixture，不声称已实现任意照片的哈希/格式校验。测试独立inflate PNG，核对尺寸、每个像素与每块CRC。

小程序把验证后的PNG写进自己的 `wx.env.USER_DATA_PATH`，文件名由客户端生成，不接收远程路径。使用本地image组件预览；只有图片load成功且用户点击“确认保存测试图到相册”才调用saveImageToPhotosAlbum。成功只在API success时提示，拒绝授权/写入失败提示“未保存”，不自动打开设置。取消/卸载清理本次自有缓存，不删除相册。若用户在保存中离开页面，输入缓存保留至保存回调再清理。迟到文件写入回调清理自己的路径，不显示已退出页面的图片。

退出/取消清理为尽力而为；unlink失败、进程死亡/强杀可能留下非私人的合成PNG缓存，尚未实现下次启动残留清扫。JS密钥内存、Noise完整参考向量、WIP依赖审计等限制仍见 `ENCRYPTED_TCP_PROBE_2026-10-02.md`，没有因测试图片成功而解除。**不得因此开启真实照片传输。**

## 操作流程（新代码包上传需用户单独授权）

1. 上传新开发预览仅含代码与固定合成fixture，不含本机IP、实际PSK、私人照片、UID、凭据；不publish/upload正式版本或提交审核。
2. 用户打开预览，进入“开发测试：加密合成图片（预览后确认保存）”。
3. 然后运行 `node tools/wechat-crypto-spike/server.mjs --image`，明确只绑定唯一私有Wi-Fi、随机端口、十分钟有效、成功请求一次性消费。
4. 日志只输出QR本机文件路径和非敏感到期/模式信息。QR包含临时PSK，只通过本机文件面板展示，不能读取像素至聊天、打出payload/PSK或加入仓库/预览包。
5. 手机扫描该私有QR，核对四色预览；先试取消（相册不应新增），换新码再点保存，用户手工核对系统相册图像。授权拒绝、返回/后台、重复/过期码也需实机验证。

官方API定义复核：微信团队维护的 [api-typings](https://github.com/wechat-miniprogram/api-typings/blob/master/types/wx/lib.wx.api.d.ts) 中WriteFileOption接受ArrayBuffer，SaveImageToPhotosAlbumOption要求本地filePath。类型/Node测试不代替手机API可用性、相册权限或小程序发布资质验收。

## TDD 与当前状态

先新增图片协议/传输/页面4测试，因缺模块与页面得到4/4 RED；增加真实Node回环图片测试得到1项RED（旧server拒绝新QR）。实现后通过。随后新增预览load前不保存和保存中退出生命周期测试得到2项RED，补修复后聚焦8/8 PASS（图片6项 + server2项）。

主工程 `npm test -- --runInBand` 新鲜87/87 PASS。最终 `npm run test:wechat` 包含TypeScript构建与10个微信测试文件，新鲜43/43 PASS，exit 0；`git diff --check` exit 0，仅CRLF提示。未改用户的 `tools/sample-analyzer/analyze.mjs`，不stage它。上述结果均不是微信手机实机PASS。

当前状态：源码/Node链路已实现；新图片代码包尚未获本次上传授权，尚未生成新微信预览；未启动图片LAN服务。**Android微信图片预览/保存待验收、iPhone待验收、真实照片未启用、生产安全未通过。** 修改尚未commit/push，无自动合并main，无EXE/APK重打包。

## 后续状态（用户扩展授权）

上述为上一轮快照。用户本轮明确允许上传，并要求直接推进到浏览本机暖暖照片。四色图片开发预览已成功上传（134507字节），没有媒体/实际PSK/IP/UID进入包。未启动四色LAN服务、没有四色图片保存的手机验收结果。

随后在用户扩展任务下实现了**单独的局域网只读真实照片开发浏览入口**，不是依据四色测试自动解除安全限制。具体边界、独立Noise向量、新鲜测试和真实照片同机链路证据见 `LOCAL_GALLERY_PREVIEW_2026-10-02.md`。正式生产、安全审计、iPhone、原图保存依然未完成。
