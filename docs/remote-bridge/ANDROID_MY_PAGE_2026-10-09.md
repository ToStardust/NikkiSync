# Android「我的」整理与搭配师昵称

用户要求：搭配师 UID 在最上面，能读取昵称就自动填，读不到可手填；图库概况第二、穿搭灵感库第三；缓存、同步设备及保存参数移到右上角设置。

## 当前布局

MainActivity 的「我的」只有三张卡片，固定为搭配师 UID/昵称、图库概况、穿搭灵感库。UID 来自实际照片列表，保留复制功能；图库有多个 UID 时同一张卡按各自 UID 展示，不擅自认定其中一个为本人。没有 UID 时提示同步照片，仍可填写临时昵称；它与有 UID 的档案独立，避免错误归属。

顶部右侧仅在「我的」显示「设置」。设置页使用 ChromeHost、粉色渐变背景、现有渐进顶部模糊及 ChromeNavigationHost 返回；设置入口保留设备连接状态/配对、详情缓存清理、保存拍摄参数开关。开关仍读写原 nikkisync.export/writeExif，未重置用户偏好。缓存清理不删除保存记录或手填昵称。

常用套装/散件从图库概况的「查看常用穿搭」进入，保留按名称跳转图库搜索。离开这个页面进入搜索前弹出统计页，返回时不会残留一层旧页面。主页不再主动请求这些统计；进入时读取，后续继续使用已有 revision 缓存。新页面关闭时释放自己的 ContentBackdrop。

## 昵称来源及限制

已检查当前协议及元数据类型：现有数据保证 UID，未提供可靠玩家昵称字段。不能把服装名、套装名、电脑名或提供者 raw.name 当成昵称。

StylistProfileStore 在 App 私有 SharedPreferences 中按 UID 保存昵称；手填名优先，重启仍保留，多 UID 互不串用。弹窗有填写/修改、保存、取消；留空恢复自动值。单行最长 64 字符，拒绝控制字符。

自动入口只接受读取到的照片元数据中明确的 identity.uid + identity.nickname 字符串：接在已有 cacheMetadataSnapshot 流程，不额外扫描整库或请求互联网。若未来/已有响应带此字段即可记住；缺字段、格式不符或解析失败不会猜名字，也不会清掉手填值。本轮没有从真实当前照片读取到昵称的验收，不宣称上游已支持昵称查询。

## 测试与交付

按 AGENTS 要求先观察布局/迁移测试 RED，新增昵称存储测试在缺类时 RED。进入常用穿搭再搜索的测试先复现旧页面残留两层，再修复；手填弹窗测试补充主线程队列执行后通过。

- 聚焦布局、设置、昵称、返回/搜索：7 项 PASS。
- Android 全量：165 tests，0 failures/errors/skipped；覆盖现有查看器缩放、预测性返回、照片来源动画、LIVE、分享图、保存进度和缓存。JVM 回归不代替硬件帧率或机型相册验收。
- mobile source contract：78 文件 PASS；主题 4/4、单 EXE 打包接线 5/5 PASS；APK v2 签名校验 PASS。
- APK：release/NikkiSync/NikkiSync-Android.apk，versionCode 9，versionName 0.2.8-my-page，15,665,182 字节，SHA-256 D0CD7876EF2F9319ECBC0E8CB9DE425112DFA168A844B20C1CFEEC5F35D8FB45。
- 更新绿色包：release/NikkiSync-Portable-MyPage/NikkiSync-PC.exe，118,612,370 字节，SHA-256 5588F7C99401AB8EBF30357B496D93CA15CEC8CA0EB84A19546AE315F3B1F1F4。该目录仅一个文件。实际 EXE --verify-package 展开后的 APK 与上述文件 SHA 完全相同。
- 原 release/NikkiSync-Portable/NikkiSync-PC.exe 因正在运行而不能覆盖，保留原文件。切换新版须从托盘退出旧版再启动新目录的 EXE。没有结束用户服务或改自启动注册表。
- 交付报告 out/my-page-delivery-report.json；隔离包体验证 out/portable-my-page-verification/verification.json。此轮 PC 壳逻辑未改，保留此前四阶段加载界面与缓存复用策略。

ADB 两次查询均没有设备，未安装、未清空 App/配对资料或进行真机截图。未修改小程序、PC 协议或游戏资源；未 commit/push。构建包含当前整合后的工作树，继续保留液态玻璃、顶部 GPU 模糊和照片返回来源修复。
