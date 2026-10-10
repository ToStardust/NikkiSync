# Android 照片预测性返回来源修复

用户反馈：照片预览的预测性返回退化成渐隐，之前应缩回来源缩略图。

## 原因

0.2.6 的 `ImageLoader.load` 为缓存键加了电脑 serverId/TLS 身份前缀，避免跨电脑复用缩略图。`MainActivity.findThumbnail` 仍按 `assetId + ':'` 匹配普通 View tag 的开头，因此图库/搜索预览找不到源缩略图。

`PhotoViewerPage` 的缩回动画和系统预测性返回回调还在，来源为空时 `SharedImage` 将 origin 设为全屏适屏位置，按 reveal 调整 alpha，表现为渐隐。另一个边界是详情更新引起 revision/cache tag 变化，同一张照片也会被判定为来源失效。

此问题来自缓存接入时遗漏 UI 对缓存 tag 的依赖；单 EXE 打包未修改 Android 动画，也未重建前一轮 0.2.6 APK。

## 修改

- ImageLoader 为远程照片额外设置独立的 keyed tags：照片 assetId，以及电脑身份 + assetId 的稳定来源标识。
- MainActivity 用独立 assetId 定位图库/搜索照片，已保存/编辑图片继续用精确 content URI 定位。
- PhotoViewerPage 用稳定来源标识验证绑定；同照片的缓存/revision 变化不打断锚点，换电脑、换照片或来源脱离窗口仍拒绝错误锚点。
- 默认缓存 tag、电脑/TLS 隔离、revision 校验与异步下载防串图逻辑保持原实现。来源真的离屏/被回收时仍使用原版兜底。
- 预测性进度、取消回弹、按钮返回和下拉返回继续使用原来的 shared-image 动画，不改玻璃/顶部 GPU 模糊、粉色背景、缩放、LIVE 或分享图。

## 验证与交付

新增两个行为回归，先运行旧实现 RED：MainViewerEntryTest 找不到带电脑前缀的真实 ImageLoader 缩略图；PhotoViewerPageTest 在同照片 revision 更新后失去来源。实现后 GREEN，追加同 ID 换电脑、回收成另一张照片和移除视图的保护断言。

- Android 全量 JUnit：160 tests，0 failures/errors/skipped。
- `mobile:validate`：78 项源码合约 PASS；主题 4/4 PASS。
- `:app:stageDebugApk` 完成；APK v2 签名校验 PASS。
- APK：`release/NikkiSync/NikkiSync-Android.apk`，versionCode 8 / `0.2.7-photo-return`。
- APK SHA-256：`9200A6445BE526951A7C2F8754699DF97C3132AABC3A1274A1F9197FFA97325F`。
- 单 EXE 绿色包已同步更新：`release/NikkiSync-Portable/NikkiSync-PC.exe`，118,120,850 字节，SHA-256 `6A7AD02730228612F049B8630678A9CCC36917193DCDC1AAA3E1C61378EE08AC`。实际从最终 EXE 展开的 APK 与修复 APK 的 SHA-256 一致，目录仍只有一个文件。报告：`out/photo-return-delivery-report.json`。

ADB 设备列表为空，本轮尚未覆盖安装或做真机返回手势验收。没有清除手机数据或配对信息，未写系统相册，未改游戏文件。既有 SDK XML/deprecated 警告仍存在。改动保留在已有 dirty 工作树，未 commit/push。
