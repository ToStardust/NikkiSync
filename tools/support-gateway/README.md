# NikkiSync 诊断反馈

Windows 的「关于 → 诊断与反馈」可导出诊断 ZIP。Android 的「我的 → 设置 → 诊断与反馈」可导出诊断 JSON。在线提交前会显示实际发送的摘要。摘要只包含应用版本、系统构建、错误代码和次数。

## 接通在线反馈

1. 在 CNB 创建独立私有仓库，例如 `nikkisync/support-feedback`。给网关使用的令牌授予这个仓库的元数据读取、Issue 写入和评论读取权限。
2. 在已有的 HTTPS 服务后运行 `node tools/support-gateway/gateway.mjs`。网关用 Node.js 24，不依赖第三方包，默认监听回环端口 8724。HTTPS 服务将 `/v1/reports` 和 `/v1/replies` 转发给网关。
3. 配置以下环境变量。

| 变量 | 值 |
| --- | --- |
| `MOMO_SUPPORT_CNB_REPO` | 私有 CNB 仓库路径 |
| `MOMO_SUPPORT_CNB_TOKEN` | 只保存在网关上的 CNB 令牌 |
| `MOMO_SUPPORT_CNB_REPLY_USER` | 有权回复的维护者 CNB 用户名 |
| `MOMO_SUPPORT_RECEIPT_SECRET` | 32 字节随机值的 Base64URL 编码。需长期保存，改变后旧回执会失效 |
| `MOMO_SUPPORT_PORT` | 可选的本地端口，默认 8724 |

4. 用环境变量 `MOMO_SUPPORT_URL` 提供网关的 HTTPS 基地址，再构建 Android 和 Windows 包。Android 也接受 Gradle 属性 `momoSupportUrl`，Windows 也接受 MSBuild 属性 `MomoSupportUrl`。未填写地址时可继续离线导出日志。

维护者在对应工单中发布以 `回复用户：` 开头的评论。手机端打开诊断页或点「查收回复」即可读取这条工单的回复。Windows 提交后可复制回执码，在手机上点「绑定电脑反馈」并粘贴。

网关发出的工单有私密标记，并在读写前检查仓库仍为私有。HTTPS 服务的访问日志应排除 Authorization 请求头。CNB 下载镜像和诊断仓库分开管理。

## Android 更新测试通道

Android 1.0.33 起从 CNB 的 `android-update-test` 发布检查签名清单。发布时使用原 Android 证书签名 APK，并运行 `pwsh -File scripts/sign-android-update.ps1 -Apk <APK> -OutputDirectory <目录>`。在该测试发布中放入 APK、`MomoCamera-Android-update.json` 和对应的 `.sig` 文件。每个版本必须提高 APK 构建号。先上传新 APK，再替换清单和签名。
