# 源码与测试位置

路径均相对固定版本仓库根目录。

| 功能 | 主要位置 |
| --- | --- |
| 协议/DTO/路由 | `packages/protocol/src/index.ts`、`packages/core/src/types.ts` |
| 参数归一化/同照片补缺/字典 | `packages/core/src/decoded-metadata.ts`、`packages/core/src/metadata-dictionary.ts` |
| Gallery转换入口 | `integrations/nikki-gallery/metadata-adapter.ts` |
| 旧缓存字段补全 | `apps/pc-companion/src/metadata/CachedDecodedMetadataService.ts` |
| 标准详情/内部字段过滤 | `apps/pc-companion/src/server/row-mappers.ts` |
| API、资源及EXIF导出 | `apps/pc-companion/src/server/LocalSyncServer.ts` |
| 版本日历/英文名 | `apps/pc-companion/src/server/GameVersionCalendar.ts`、`GameVersionUpdateService.ts`、`GameVersionEnglishNames.ts`，`assets/game-version-names.json` |
| mDNS/实时事件 | `apps/pc-companion/src/server/MdnsAdvertiser.ts`、`WebSocketHub.ts` |
| 手机发现/连接 | `apps/mobile/app/src/main/java/app/nikkisync/mobile/net/NsdDiscovery.java`、`RealtimeWebSocket.java`、`ConnectionState.java`、`ConnectionFailure.java`，以及 `MainActivity.java` |
| LIVE导出与容器 | `apps/mobile/app/src/main/java/app/nikkisync/mobile/media/live/LivePhotoExporter.java`、`MotionContainer.java` |
| 动态预览 | 同目录 `MotionPreviewLoader.java`、`MotionPreviewFile.java`、`MotionPreviewCache.java`；`ui/chrome/LivePhotoPlayback.java`、`PhotoViewerPage.java` |
| 本地清晰图/EXIF | `media/SavedPhotoDecoder.java`、`PhotoExif.java`、`EditedPhotoExif.java` |
| 本地关联与快照 | `storage/EditedVariantStore.java`、`SavedMetadataSnapshotStore.java` |
| 组件 | `widget/PhotoAlbumWidgetProvider.java`、`WidePhotoAlbumWidgetProvider.java` |
| 分享图 | `share/ShareCardPreparation.java`、`ShareCardPreviewDialog.java` |
| 电脑签名更新 | `apps/windows-shell/Services/DesktopUpdates.cs`、`UpdateInstaller.cs`、`UpdateWindow.cs` |
| 关于/网盘入口 | `apps/pc-companion/src/desktop/DesktopPage.ts`、`DesktopPageScript.ts`，`apps/windows-shell/Services/DesktopProjectLinks.cs` |

重点测试：

- `apps/pc-companion/test/local-sync-server.test.ts`：配对、认证、范围下载、变更事件，以及生产TLS实时握手。
- `apps/pc-companion/test/mdns-advertiser.test.ts`：拒绝响应循环、热点切换后地址刷新。
- `apps/pc-companion/test/game-version-update.test.ts`：版本边界、缓存、同版本热修日期、revision失效。
- `packages/core/test/decoded-metadata.test.ts`：两种解码映射、精确ID合并、缺字段保留。
- `apps/mobile/app/src/test/java/app/nikkisync/mobile/net/`：发现重试、旧网络回调、心跳、连接状态和错误分类。
- `apps/mobile/app/src/test/java/app/nikkisync/mobile/` 下的 `livephoto`、`media`、`ui`、`share` 等测试：容器边界、预览首帧、缓存、手势、清晰图、修图与分享。
- `apps/windows-shell.Tests/DesktopUpdateTests.cs`：签名、下载校验、替换及失败回滚。

构建顺序：先生成 core/protocol/database，再编译PC，再打包GalleryRuntime。Windows单EXE用Bun1.4.1或更新版本，并选择Windows x64 baseline目标；项目中的两个Windows打包脚本会阻止已知旧运行时。不要仅从普通Node测试通过推断最终EXE实时同步可用。
