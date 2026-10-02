# Android 微信 HTTPS 诊断准备

日期：2026-10-02。分支 `feature/remote-bridge-foundation`。
用户已选择仅同一 Wi-Fi 直传，没有域名，不允许默认媒体中继。

## 已发生的事实

- 官方微信开发者工具通过 WinGet 安装到 `D:\SOFT\WeChatDevTools`，版本 `2.02.2609231`，安装包哈希验证成功、主程序腾讯数字签名 Valid。工具窗口标记 RC，不称为稳定版验收。
- 用户本人扫码登录，并手动开启服务端口。本机 CLI 在 `127.0.0.1:14090`，`islogin` 返回 true，`open --project ...\apps\wechat-mini-program` 成功。
- 首版模拟器显示首页，调试器 0 errors、2 warnings（警告未进一步分类）。
- 用户明确授权首版测试代码包上传到微信生成开发预览；CLI preview 成功，大小 4839 字节。没有调用 upload 命令、发布或提交审核。
- 用户反馈首版已在 Android 微信打开。手机 ADB 已授权，Android 17 / 微信 8.0.72。此反馈只证明启动，不证明请求、扫码或保存。

## 本轮新增：专用诊断，不连接图库

新增 `pages/diagnostics/index`，首页入口“开发测试：局域网 HTTPS”。
只接受 `NikkiSyncLanTlsProbe` 专用二维码；现有照片 QR 不改变。
验证私有 IPv4 HTTPS、端口、测试随机 challenge 和有效期，再依次 GET：

```text
/probe/<nonce>/health
/probe/<nonce>/sample.png
```

不发送 Authorization、Remote token、UID、metadata 或请求 body，不持久化二维码，不自动重试 HTTP。
成功必须收到匹配 challenge 和具备 PNG 签名/IHDR/IEND 的合成响应；这不是相册保存验收。
失败只显示有界、去地址后的微信错误文本，不能只凭 timeout 就归因于证书。
页面卸载会中断请求并忽略迟到回调。

独立 PC 工具：`tools/wechat-lan-server.mjs`，不导入数据库、图库、resolver 或 LocalSyncServer。
合成图片为工具生成的 1×1 RGBA PNG，70 字节。只监听自动发现的私有 Wi-Fi 地址，不监听 `0.0.0.0`，不启动公网通道。
使用现有 Git OpenSSL 创建全新自签名测试证书，SAN 匹配监听 IP；不会替换 PC 配对证书、安装系统根证书或导入手机信任。
证书/私钥和测试码只输出至 Git 忽略的独立 `out/wechat-lan-probe-*` 目录。服务十分钟停止；无需删除 SQLite 或调整防火墙。防火墙若阻断，记录而不自动关闭/放行。

## 当前验证

```text
新增客户端测试先 RED：6 项因模块缺失失败。
新增服务测试先 RED：2 项因模块缺失失败。
Node 聚焦（含既有小程序测试）：18/18 PASS。
npm test -- --runInBand：87/87 PASS。
node tools/wechat-lan-server.mjs --self-test：PASS。
```

回环自检确认 Node 默认信任拒绝自签名证书（不是 hostname 错误）；只有该请求显式信任合成测试证书时，收到完全相同的 70 字节 PNG。未修改默认 TLS 校验。
沙箱内 OpenSSL 子进程最初初始化失败，正常提升执行后通过；这是执行环境限制，不是微信证书测试结果。
测试路由单元测试使用回环 HTTP 来隔离业务响应，实际工具仅提供 HTTPS，不据此声称允许 HTTP 媒体链路。

## 下一步及未完成

用户已另行明确授权更新诊断版预览；CLI preview 成功，包大小 9097 字节。未发布或提交审核。
已启动独立十分钟合成 HTTPS 服务，绑定电脑自动发现的 Wi-Fi 地址，生成专用诊断码；实际端口/IP/测试 challenge 不提交至仓库。停止/超时后二维码失效。
当前待用户重开新预览、在 Android 微信上执行专用诊断；不把监听器已启动当作手机请求已成功。
保留实际 wx.request 错误与响应证据，区分域名检查、TLS 信任、超时/防火墙、VPN/路由问题。手机此前存在 VPN 路由，不擅自改 VPN 设置。
没有微信 Android 网络 PASS、没有真实照片保存 PASS、更没有 iPhone PASS。自签名若被拒绝，不绕过；可信域名/证书路线仍需独立准备和验证。
