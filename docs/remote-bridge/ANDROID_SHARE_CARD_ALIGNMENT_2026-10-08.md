# Android 分享图对齐小程序与 Live 测试引导

日期：2026-10-08，Asia/Hong_Kong。分支：feature/remote-bridge-foundation。
基线 commit：2466e60b3d43a707851915ce9f4ee67627a06338。
本次修改保留在已有 dirty 工作区，未提交、推送或安装到手机。

## 分享图

Android 按小程序 2026-10-06 版的几何布局对齐：1440px 宽，两列部件图标及下方名称；未解析名与纯数值 ID 隐藏，真实 ID 仅供认证缩略图请求，不画入分享图。长名完整折行，按行高分页，每页最高 4096px，重复参数栏。

背景改为经过 SHA-256 校验的高清原图/Live 静态封面，按 EXIF 方向与远程照片的用户旋转角度绘制；不再使用模糊缩略图。已有相册照片和关联修图可离线生成，使用本地照片自身的 EXIF 方向。

十二个主要参数固定位置，缺失值显示“—”；额外真实参数仍保留。焦距 mm、光圈 f/、百分比与归一字段按小程序约定展示。仅已有展示域绘制滑块位置，不编造焦距/光圈上下限。修复旧 builder 未读取 canonical apertureSection、vignetteIntensity、bloomIntensity、bloomThreshold 的问题，同时保留旧字段别名。

透明细线面板、清晰照片背景、暖暖粉 #F6BCC0 点缀、动作/光照/滤镜类型标识。类型标识不是游戏效果缩略图。部件通过现有 pinned HTTPS + 签名 clothingThumbnail 接口串行读取并校验 SHA-256，图标缺失明确显示“图标暂缺”；不猜服装图片。独立图标磁盘缓存上限 32MiB，离线可用已缓存图标。

先生成应用临时 PNG，再显示可翻页的预览；用户点击保存当前页才创建 MediaStore 项目。PNG 保存至 Pictures/NikkiSync/Share Cards，发布成功才显示已保存，之后可以调用系统分享。关闭预览清理本次临时页，保存中已获取的页面延后至写入结束才清理。切换生成任务、关闭来源照片详情和 Activity 销毁使旧任务失效，迟到结果不复活预览。一次仅渲染一页并释放 bitmap；限制下载大小与解码尺寸，不在内存保留所有页面。

主要文件：
- apps/mobile/app/src/main/java/app/nikkisync/mobile/share/ShareCardLayout.java
- apps/mobile/app/src/main/java/app/nikkisync/mobile/share/ShareCardExporter.java
- apps/mobile/app/src/main/java/app/nikkisync/mobile/share/ShareCardPreparation.java
- apps/mobile/app/src/main/java/app/nikkisync/mobile/share/ShareCardPreviewDialog.java
- apps/mobile/app/src/main/java/app/nikkisync/mobile/share/ShareCardExportCoordinator.java
- apps/mobile/app/src/main/java/app/nikkisync/mobile/share/ShareCardPayloadBuilder.java
- apps/mobile/app/src/main/java/app/nikkisync/mobile/MainActivity.java

## Live 范围

新增各 profile 的具体格式说明，尤其 vivo 新单文件/旧双文件、三星旧式 SEF 的区别与限制。手动选择后同步更新说明。新增复制品牌、型号、Android API、系统构建、App 版本、所选 profile 与当前照片旋转角度的测试信息；相册名称/版本、地区和识别/动态/声音/关闭重开/重启结果留待实机填写。不收集序列号、SSID、配对密钥或登录信息。

本次没有新增厂商封装或相册 SDK，没有改变基于品牌的初选规则，没有新增手机相册通过记录。旧双文件与新单文件选择仍需实际系统相册验证，不能按 Android API 猜适用边界。荣耀 SDK、原生鸿蒙与现代三星变体仍是后续工作。

## 测试与交付

- 新布局及未知名测试先 RED（缺少新接口）；格式说明测试先 RED；canonical 参数测试先观察失败，再修复。
- 专项 14/14 PASS：名称与真实 ID 分离、canonical 参数、零值/单位/缺失值、100 件长名分页完整性、真实 Canvas 像素、预览与保存分离、关闭时保留保存中的页面、取消后不回调。
- :app:testDebugUnitTest 全量 66/66 PASS（0 failure/error/skipped），包括原有 Live 容器 92 项核心行为检查。
- mobile:validate PASS，54 个所需文件；相关 git diff --check PASS。
- :app:stageDebugApk 完成；同时生成 debug APK 并更新用户安装副本，避免 release 继续提供旧包。
- apksigner verify：v2 signature PASS。aapt：package app.nikkisync.mobile，versionCode 2，versionName 0.2.1-share-card，minSdk 33，targetSdk 35。
- 两个 APK SHA-256 相同：B79110D1672D96A279C9CE5DE6E70F3914D6AEFB347E6B5F08DCA4F43393D311。

交付 APK：release/NikkiSync/NikkiSync-Android.apk。
构建 APK：apps/mobile/app/build/outputs/apk/debug/app-debug.apk。
真实绘制代码输出的合成示例：apps/mobile/app/build/outputs/share-card-preview.png。示例图标、名称与背景均为合成数据，不是用户照片或手机截图。

复现：设置现有 JDK 17 / Android SDK 35，进入 apps/mobile，执行：

```text
gradlew.bat --offline --no-daemon :app:testDebugUnitTest :app:stageDebugApk
node scripts/validate-m2.mjs
```

仍需手机验收：真实部件缩略图、原图 EXIF/用户旋转、Live 封面、离线本地/修图、长搭配多页、相册保存及系统分享、生成时关闭详情、保存时关闭预览。每个目标机型的原生 LIVE 识别与完整播放独立验收；本次不把单测或构建成功当作实机通过。
