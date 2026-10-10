# 加密 TCP 合成诊断：评估版

日期2026-10-02，分支 `feature/remote-bridge-foundation`。只处理Remote Bridge，不修改Live、NUAN5、图库、Windows生命周期或原生配对安全协议。用户允许推进本机加密验证，仍要求不花钱。没有云服务/域名采购，没有真实照片传输。

## 设计和信任边界

采用上游Noise握手库而非自写加密算法：固定 `Noise_NNpsk0_25519_ChaChaPoly_BLAKE2b`，32字节随机PSK由电脑生成、仅通过电脑本地一次性QR扫码获取。握手绑定协议、地址、端口、sessionId、有效期与suite，之后双向有序认证加密，错密钥、篡改、重放/乱序失败即关闭，不自动重试其他通道。

认证只证明对方持有QR密钥；不是证书身份、硬件身份或用户实名验证。拍走QR的人同样持有能力。二维码只在本机展示，不上传聊天、仓库或预览包，不打印QR payload或key，不在页面setData/日志/URL/持久存储保留密钥。正常结束/超时清理生成的临时QR文件；异常进程死亡可能留下被Git忽略的本机文件，清理与生命周期仍需审查。

Node使用现有安全randomBytes，微信必须提供 `wx.getRandomValues` 的64字节安全随机数。缺失/格式错误拒绝连接，不用Math.random或替换全局crypto。浏览器构建禁止隐式原生随机数与WASM调用，使用显式entropy注入库的Curve25519生成函数；库原始算法不修改。纯JS后端不检查零DH结果，因此适配层增加全零共享秘密拒绝。新入口不是现有HTTPS失败后降级。

只支持固定合成文本（无媒体接口），2字节长度分帧，单帧最大4112、总接收8192、每向最多16条4096字节明文，5/10/15秒级超时且不得越过QR十分钟期限。电脑只绑定明确私有Wi-Fi、最多1活动连接/32次尝试，成功完成应用层请求后QR一次性消费；离开页面关闭连接。拒绝连接可能导致可用性受限，不宣称防DOS完成。

## 代码与依赖

- `tools/wechat-crypto-spike`：隔离package.json/package-lock，Noise适配/编译/Node工具与测试；固定noise-handshake4.2.0、sodium-javascript0.8.0、esbuild0.28.2。依赖安装使用ignore-scripts，不下载新的Node/JDK/Android SDK。
- `apps/wechat-mini-program/miniprogram/lib/noise-vendor.js`：可复现生成的浏览器CommonJS包（约100KB）；许可证和限制见同目录THIRD_PARTY.md、THIRD_PARTY_LICENSES.txt。
- `lib/encrypted-probe.js`、`pages/encrypted-diagnostics`：只调用TCP和安全随机数接口，不调用照片下载/相册保存、网络TLS跳过或云API。
- 重建：`npm ci --prefix tools/wechat-crypto-spike --ignore-scripts`，`node tools/wechat-crypto-spike/build.mjs`。普通测试使用随工程保留的生成包，不需要先重新下载评估依赖。
- 本地测试服务：`node tools/wechat-crypto-spike/server.mjs`；先取得新预览上传授权、用户打开后再启动，生成的QR含临时密钥，应通过Codex本地文件面板展示，不把QR图片放入聊天或调用图片读取工具。

## 验证与未验收

先新增4个密码评估测试并得到缺失模块RED，再新增4个client测试得到缺失模块RED，server真实TCP测试也先缺失模块RED。实现后对无原生crypto/WASM的VM测试曾发现隐式require错误，增加显式拒绝RNG适配后通过。

测试覆盖：Noise双向完成、QR密钥/上下文错配、握手篡改、OpenSSL独立ChaCha20-Poly1305解密、同会话重放/乱序/跨会话密文拒绝、低阶DH拒绝、限额、分包/合包/非法长度、无安全随机数不联网、迟到随机数取消、页面密钥不进data、真实Node回环TCP、一次性消费、未消费会话过期拒绝。

这不是库审计。sodium-javascript包自身标记WIP，尚无证据证明这一版本组合已完成独立安全审计。尚未取得独立完整Noise参考向量证据，OpenSSL AEAD互通不代替整个Noise握手向量。JS内存无法保证抹除不可变字符串/全部库内部临时副本。不接入真实照片，生产启用前需要适合的库/协议安全审查、标准向量、真实微信随机数/握手/性能验收和后续加密图片/安全保存验收。

当前尚无加密诊断的新微信preview上传授权/结果，没有微信Android加密PASS，没有iPhonePASS，没有真实照片或相册保存PASS，没有发布/提交审核/EXE或APK重打包。用户报告的明文TCP往返成功不能代替这些结果。

本轮最终命令结果：小程序及加密诊断9个测试文件合计36/36 PASS（其中本轮加密11项）；`npm test -- --runInBand` 87/87 PASS，包含TypeScript构建；`git diff --check`无错误，仅已有CRLF警告。esbuild子进程最初被沙箱spawn EPERM阻止，授权提升执行后本地生成成功。未将这些编译/Node结果写成微信实机PASS，未stage或修改用户已有的 `tools/sample-analyzer/analyze.mjs`。

## 后续：用户授权开发预览上传

用户明确答复“允许”，授权本轮加密合成诊断测试代码上传微信。已执行现有开发工具 CLI `preview`，退出码0，生成成功，包大小127924字节；预览码保存在忽略的 `out/wechat-encrypted-preview.png`。没有执行upload/发布/提交审核，包内没有真实照片、本机地址或实际会话密钥。

当前等待用户打开新预览并进入“开发测试：加密 TCP（仅合成文本）”；此时尚未启动加密诊断局域网服务或生成含密钥的私有诊断码。预览成功仍不等于微信手机加密握手、传图或保存相册通过。

## 后续：Android 加密文本用户反馈

以上等待段落是当时快照。后来经用户要求刷新同版预览，启动十分钟局域网加密服务，并仅通过本机文件面板展示含临时PSK的私有QR（未在聊天读取/展示它的像素或内容）。用户最后答复“往返成功”。记录为 **Android微信加密合成文本：用户报告成功**，没有新的独立抓包/截图证据；不代替图片、相册保存、iPhone或生产安全验收。

下一步是 `ENCRYPTED_IMAGE_PROBE_2026-10-02.md` 的固定合成图片测试，依然禁止接入真实图库。当前TCP/加密工作及本轮图片修改保留在本地工作区，尚未commit/push；不能称GitHub已同步。
