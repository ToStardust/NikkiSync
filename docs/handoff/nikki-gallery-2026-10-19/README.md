# 大喵相机助手 → NikkiGallery 技术交接

交接日期：2026-10-19。目标版本：Windows 1.0.7 / build2026101903，Android 1.0.7 / versionCode31。

这份材料按本机当前实现整理，覆盖约 10 月 13 日以来的主要变化。接收方的旧版本号和提交号未知，因此不能把日期范围当作精确的代码差异基线。请以本交接的能力清单与源码路径核对实际接入情况。

完整源码：https://github.com/ToStardust/NikkiSync

固定版本：https://github.com/ToStardust/NikkiSync/tree/v1.0.7-public-beta.1

安装包与签名更新文件：https://github.com/ToStardust/NikkiSync/releases/tag/v1.0.7-public-beta.1

## 先看这些

1. `CHANGES.md`：手机、电脑和数据输出的变化。
2. `SYNC_COMPATIBILITY.md`：同一手机连接不同电脑工具时，服务端必须满足的条件。
3. `SOURCE_MAP.md`：各功能对应的源码和测试位置。
4. `ACCEPTANCE.md`：建议双方共同执行的验收步骤与已知边界。

交接 ZIP 另附协议/类型快照和独立 `metadata-adapter.mjs`。快照用于对照，完整工程构建请使用固定版本源码；适配模块只转换已经取得的同照片解码结果，不执行第三方解码器。

## 最重要的结论

- 手机同步协议仍为 v1，HTTPS、Ed25519、二维码配对、资源下载、变更日志和 WebSocket 事件模型保持兼容。
- 相对仓库内 10 月 13 日公开提交 `d4ca7d7`，协议包与数据库迁移文件没有变化；这不是对接收方现有工程版本的判断。新增拍摄参数属于元数据补全，不要求把现有扫描器替换成 NikkiSync 扫描器。
- 手机显示完整功能需要服务端实际提供原图、LIVE 资源、规范元数据、搜索/统计等接口；仅有配对和相册列表不能保证全部功能可用。
- `editor_metadata` 的编辑器参数不能替代游戏拍摄参数。应接入同一照片的解码结果，并通过 revision 通知手机刷新缓存。
- EXE 已切换到通过生产 TLS 握手回归的 Bun 1.4.1 baseline。若 NikkiGallery 使用 Electron/Node，不要求采用 Bun；需要在其实际运行环境验证 HTTPS WebSocket 握手与事件。
- NikkiGallery 源码及安装包未在本轮修改；是否需要迁移下列改动，由接收方结合自己的 SyncServer 实现决定。

## 使用与反馈

普通用户更新入口：https://pan.baidu.com/s/5bb_o2A8iJ2MR4f_hRBlPCw

电脑的签名一键更新与网盘下载是独立路径；只在网盘放入新版不会自动生成更新清单。手机仍需下载 APK 后由系统确认安装。

1.0.5 及后续公测版沿用当前安卓公测签名；其他签名的旧安装应先确认迁移方式，不能为覆盖安装直接卸载或清数据。

源码许可见仓库 LICENSE。游戏内容及第三方组件保持各自权利归属。
