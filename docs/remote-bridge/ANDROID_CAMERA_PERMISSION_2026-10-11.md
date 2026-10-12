# Android 首次扫码相机权限修复｜2026-10-11

用户反馈：新启动 App 准备扫码时不主动申请相机权限，多位测试者出现黑屏扫码页。

## 原因

`AndroidManifest.xml` 已声明 CAMERA，但自建 `PairQrScannerActivity` 直接在 onResume 调用 DecoratedBarcodeView.resume，没有运行时权限请求、授权回调或拒绝状态。此页面未使用自带权限管理的 CaptureActivity/CaptureManager，不能依赖扫码库代为弹窗。

Android 官方要求使用受保护资源前检查权限，并在用户进入相关功能时请求运行时权限：[Request runtime permissions](https://developer.android.com/training/permissions/requesting)。本次修复在用户进入扫码页时申请，不在一般浏览图库时申请。

这确认了代码中的权限缺口；没有所有测试者的权限状态/日志，不能断言每次黑屏都来自同一原因。

## 实现

- 首次进入扫码页，未授权时显示用途说明并自动申请 CAMERA。只有权限检查通过且页面在前台才启动预览。
- 授权成功自动继续扫码；授权回调与 onResume 并发到达不会重复启动相机。
- 拒绝后保留可见的说明与取消按钮。允许再次申请时提供“允许相机权限”；已申请且系统不再要求说明时提供“打开设置”，跳转当前 App 的权限设置。
- 保存权限申请历史，拒绝后切后台、重新打开不会自动反复请求。从设置返回或权限被撤回后重新检查权限。
- 权限请求取消/空返回不会启动相机。在后台收到授权结果延后到前台再启动；扫码完成后不再重启。
- 相机打开异常或库 cameraError 回调显示“相机暂时无法打开”及“重试相机”，提示系统相机访问开关/其他相机应用，不显示底层错误堆栈。
- 只更新扫码 Activity、版本和测试。保留配对身份、缓存、液态玻璃/顶部模糊、照片手势和已验证的 Oplus LIVE 封装；未处理 LIVE 穿搭/相机参数缺口。

版本：`0.2.16-camera-permission` / versionCode `17`，API 33/35。

## 验证与限制

- 新增首次扫码、授权前不启动、权限撤回、拒绝重试、永久拒绝设置返回、后台授权/完成后不重启、取消、重开拒绝页及相机错误恢复的 8 个 Robolectric 测试。
- 原实现针对前 6 个测试为 RED；修复后全量 Android **210 tests，0 failures / errors / skipped**。相机调用由测试 shadow 记录，权限/Activity 生命周期和页面行为通过 Robolectric 执行，不代表真实驱动验收。
- Mobile 源码合约 82 项、portable 源码合约 6 项通过。普通 Node 子进程测试受沙箱 EPERM 限制后，使用 `--test-isolation=none` 运行 portable 合约通过。
- APK v2 签名通过；证书 SHA-256 与前版相同：`89e768c8947e48a0e6d5471888a264daafd99685ea22e290fc3adca71f5d61cb`。可以保留数据覆盖安装。
- ADB 设备列表为空；未安装到手机，未完成一加/其他品牌的系统授权弹窗和实际扫码验收。无需先卸载或清除配对数据。

## 交付

- 独立 APK：`release/NikkiSync-Portable-CameraPermission/NikkiSync-0.2.16-Android.apk`，23,570,543 字节，SHA-256 `28d10ec7bdb374e001cf4edacac5d93213e5abd67dcc36c7714fef80586953e1`。规范构建输出仍为 `release/NikkiSync/NikkiSync-Android.apk`，两者 hash 一致。
- 单文件 EXE：`release/NikkiSync-Portable-CameraPermission/NikkiSync-PC.exe`，SHA-256 `e69639494b28a95d76cc86c5f119113697afd39b192d779e322237ec3cf92089`。保留 Windows 自动发现/启动功能和 Bun 1.3.14 baseline --smol。
- 实际运行新 EXE `--verify-package`，展开并核对内置 APK hash 一致，未启动后台/访问用户配置。报告 `out/embedded-apk-q9ievB/report.json`。验证时交付目录只有一个 EXE；随后加入上述独立 APK 方便单独发送，EXE 本身已经内置 APK。
- 本轮更新本地交付与公开源码，不发布新的 GitHub 二进制 Release。
