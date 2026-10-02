# 大喵相机助手：开发工程接入

用户提供的公开 AppID：`wx1bfaa26659e0401b`。日期：2026-10-02。
分支：`feature/remote-bridge-foundation`。没有修改其他功能模块。

工程目录：`apps/wechat-mini-program`。在微信开发者工具中导入此目录，不是整个 NikkiSync 仓库；源码目录由 `miniprogramRoot` 指向 `miniprogram/`。
配置依据微信官方示例：https://github.com/wechat-miniprogram/miniprogram-demo/blob/master/project.config.json 。

目前只有项目配置与开发准备首页，不是可用的照片客户端。没有创建 AppSecret、上传密钥、云环境或公网服务；没有上传代码、提交审核或发布。个人开发工具配置不进入 Git。
保留 `urlCheck: true`，没有关闭域名或证书校验。PC 自签名证书不能因为二维码携带指纹就视为微信已信任。

验证：先执行配置/首页测试，因文件缺失得到 2 项失败；创建工程后重新执行：

```powershell
node --test --test-isolation=none tools/wechat-project.test.mjs
```

此测试只证明静态配置和文件完整性，不代表微信开发工具编译、扫码、iPhone 下载或发布验收。

下一步先确定并验证微信支持的局域网网络/证书信任方案，再实现扫码、授权范围内的列表/预览/保存。沿用 PHASE1_PC_UI_PROGRESS_2026-10-02.md 的安全边界；若需要新增域名、服务器或媒体中继，另行获得授权。

## 同日继续：安全扫码准备页

实现 `lib/remote-qr.js` 与首页“扫描电脑二维码”入口：

- 仅接受 PC Remote Bridge v1 JSON，最大 4096 字符。
- 检查 sessionId/token 格式、SHA256 指纹格式、严格 UTC 日期、10 分钟会话有效期（最多容忍 1 分钟时钟偏差）。
- 仅接受规范私有 IPv4 HTTPS 地址；拒绝公网、回环、域名、URL 凭据、路径、查询、片段、非法端口和非规范 IP。
- 识别成功只显示非敏感电脑地址和有效期，**不等于建立连接**。
- 未完成传输信任模型前，不调用 wx.request/downloadFile，不保存 token/sessionId，不放入 setData、路由参数、日志或持久化存储。指纹格式检查不是证书身份验证。
- 取消/失败清空上次信息；页面卸载后忽略迟到回调；回前台发现过期时清空地址。

验证记录：

```text
新增扫码行为测试：先 RED，7 项因 production 模块缺失失败。
npm run test:wechat：10/10 PASS（包括真实 PC RemoteSessionStore 生成 QR 的协议回归）。
npm test -- --runInBand：87/87 PASS。
```

测试在 Node 中运行纯解析器与模拟 wx/Page 回调；PC QR 为本地新建合成测试会话，不包含真实照片/UID。不是微信运行时编译或真机扫码验证，没有上传任何照片或凭据。没有重新打包 EXE/APK，因为本轮不改变它们。

### 网络方案仍是阻断项

本轮尝试读取微信官方 network/wx.request/wx.scanCode 文档，网页读取工具返回不可读取错误，不能称为完成最新版微信规则核验。搜索可见的腾讯小程序平台参考不是微信正式版真机验收的替代品。
PC 当前是私有 IPv4 + 本地证书；没有已验证的微信证书绑定/自定义 CA 入口。不通过关闭 TLS/域名校验或降级 HTTP 来绕过。

候选下一步（均未部署、未承诺可用）：

1. 域名 + 公共 CA 证书 + 私网直连：保持媒体只在局域网传输，但需要明确域名归属、证书私钥生命周期、DNS/路由兼容性、小程序后台允许规则及实际 iPhone 验证。当前 QR v1 仅支持私有 IP，不能偷偷放宽成任意域名。
2. 临时加密桥接/中继：涉及公网传输与基础设施，即使不落盘也会经过第三方，必须取得单独授权并另做安全设计。

未检测到常见 Program Files 目录/卸载注册表中的微信开发者工具，但这不证明整机没有便携安装。未自动下载或安装。下一轮应先查明用户现有工具位置再考虑安装。
