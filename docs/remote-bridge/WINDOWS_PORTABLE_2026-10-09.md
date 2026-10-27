# Windows 单 EXE 绿色测试包

用户要求：小程序 LIVE 暂停，不继续研究 iPhone 导入；按方便玩家测试的方向打包，尽可能只分发一个 EXE。

当前最新交付：`release/NikkiSync-Portable-UIGestures/NikkiSync-PC.exe` 内置 Android 0.2.10-ui-gestures / versionCode 11，修复详情重开、多选圆角、灵感库返回和短分类输入，加入主页平移切换及 512MiB 缩略图磁盘预算。文件 118,619,538 字节，SHA-256 `3AD737BED6356E3C9E0A58124FF3D071EA50ECCE2BCB184539A9D48CDD1159FD`；目录恰好一个 EXE，实际隔离展开 APK 与本轮构建一致。见 `ANDROID_UI_GESTURES_2026-10-09.md` 与 `out/ui-gestures-delivery-report.json`。下方路径及哈希为历次交付记录，玩家步骤适用于此最新 EXE。

记录灵感表单交付：`release/NikkiSync-Portable-Inspiration/NikkiSync-PC.exe` 内置 Android 0.2.9-inspiration-glass / versionCode 10，记录灵感改为液态玻璃三组输入。文件 118,614,930 字节，SHA-256 `7905C7544848ECA1B67908982A736277175ADE983AFAEA00C44567C82ABBE60F`；独立目录恰好一个 EXE，实际隔离展开后的 APK 与本次构建哈希一致。原 canonical EXE 正在运行，保留原文件。见 `ANDROID_INSPIRATION_GLASS_2026-10-09.md` 与 `out/inspiration-editor-delivery-report.json`。

Android「我的」更新包：`release/NikkiSync-Portable-MyPage/NikkiSync-PC.exe` 内置 0.2.8-my-page APK；118,612,370 字节，SHA-256 `5588F7C99401AB8EBF30357B496D93CA15CEC8CA0EB84A19546AE315F3B1F1F4`。原 canonical EXE 正在运行，未成功覆盖也未结束该进程；新包在独立目录仅一个文件。见 `ANDROID_MY_PAGE_2026-10-09.md` 与 `out/my-page-delivery-report.json`。

最新交付更新：同一路径已加入贯穿启动全过程的暖粉加载界面，修复 WebView 原生层覆盖加载条的问题。当前 EXE 118,608,274 字节，SHA-256 `04C468FFAE3149F620FFE0E4775414EF4B0A869BD8B38DBEC2682D863E08DFAF`，内置 APK 仍为 0.2.7。两次完整启动确认业务与 .NET 原生缓存均未重写；耗时定义及缓存清理例外见 `WINDOWS_STARTUP_PROGRESS_2026-10-09.md`。下方其他 EXE 哈希为历史记录。

后续更新：当前同一路径的 EXE 已内置 Android 0.2.7-photo-return，修复照片缓存接入导致返回来源丢失的问题。文件 118,120,850 字节，SHA-256 `6A7AD02730228612F049B8630678A9CCC36917193DCDC1AAA3E1C61378EE08AC`，内置 APK 校验通过。见 `ANDROID_PHOTO_RETURN_2026-10-09.md` 与 `out/photo-return-delivery-report.json`。下文记录初次 0.2.6 绿色包的实现和验收，不替代本次更新后的哈希。

## 给玩家的使用说明

交付目录 `release/NikkiSync-Portable/` 仅保留 `NikkiSync-PC.exe`。把这个文件发给测试玩家即可，不需要附带后台 EXE、DLL、视频工具或项目代码。

1. 第一次使用直接双击 EXE。测试新版之前，请先从旧版托盘菜单退出旧版。
2. 安卓玩家在电脑界面的 Android App 卡片点击「导出安卓安装包」，把 APK 发到手机安装。电脑和手机接入同一 Wi-Fi，再用 App 扫电脑端的配对码。
3. iPhone 玩家使用已有微信小程序体验入口；体验者资格仍须由小程序管理端配置。此 EXE 不会自动发布小程序。
4. 关闭窗口会留在托盘继续同步；要完全退出，使用托盘的「退出 NikkiSync」。开机启动由用户在同步设置中自行开启。

这是单文件分发、免安装主程序，并非运行时零文件。运行文件自动展开到 `%LOCALAPPDATA%\NikkiSync\portable-runtime\<payload SHA256>`；照片索引、配对信息沿用 `%LOCALAPPDATA%\NikkiSync`。WebView2 浏览器缓存固定放在该目录下的 `webview2`，不再写到 EXE 旁边。底层 .NET 原生库还会使用标准 `%TEMP%\.net` 缓存。EXE 可以放在普通文件夹或只读介质中。

.NET 8 已内置，不要求玩家另装 .NET。WebView2 Evergreen Runtime 使用电脑已有版本，未将整个浏览器打进包；缺失时主程序显示官方安装页面按钮，安装完成后重开即可。这个版本面向 Windows x64。

## 打包内容及范围

- WPF 桌面壳、.NET 运行时、WebView2 SDK/加载器。
- 当前 Bun 编译的后台服务，保持 `--smol`、原有扫描/解析/字典补全和低资源生命周期。
- 数据库迁移、预览/旋转/服装图标转换脚本、大喵图标及第三方许可证。
- 当前 Android 0.2.6 / versionCode 7 的已签名测试 APK。字节与此前安装包相同，没有重建或改变安卓 UI、手势、缓存、LIVE 和分享图逻辑。
- 不包含 FFmpeg / ffprobe，不包含 node_modules、构建缓存、实际照片、个人数据库、配对密钥、浏览器资料或 .env。

小程序原有实验源码保留，但此包不提供需要 FFmpeg 的 `.livp` 生成工具。普通照片与原始 MP4 的传输不依赖这些工具。此轮没有继续改动小程序 LIVE 页面或 iPhone 保存路线。

## 实现

新增 `apps/windows-shell/package-portable.ps1`，只从明确白名单创建全新 staging。复用已使用的发布目录会有泄露浏览器数据的风险，因此输出目录必须为空；脚本不收集旧 release 树或 AppData。

后台资源先压缩成 ZIP，附每个文件的长度与 SHA-256；作为资源内置于主程序。WPF 发布参数为 `win-x64`、`--self-contained true`、`PublishSingleFile=true`、`IncludeNativeLibrariesForSelfExtract=true`、`EnableCompressionInSingleFile=true`。发布检查拒绝遗漏的外部依赖，最终交付目录恰好一个文件。

`RuntimePayload` 使用按内容哈希命名的用户缓存、跨启动互斥锁、临时目录和原子发布。验证 ZIP 的整体哈希和每个文件的哈希，拒绝目录穿越、重复/多余文件及超限内容。已准备好的文件只校验，不再次解压；损坏缓存重新准备，旧目录保留用于诊断，不覆盖正在使用的旧二进制。没有为此新增常驻轮询。界面在准备资源时显示进度，随后显示启动状态。

原有单实例激活、同源导航/消息检查、托盘退出、隐藏窗口时 WebView 暂停均保留。导出 APK 只能由本机页面通过原生消息触发文件保存对话框，不提供任意文件读取或公开下载端点。

重新构建示例（输出目录必须为空）：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File apps/windows-shell/package-portable.ps1 -OutputDirectory release/NikkiSync-Portable-New
```

默认 APK 来源为 `release/NikkiSync/NikkiSync-Android.apk`；可用 `-AndroidApk` 指向 workspace/release 下另一份已签名 APK。编译器、NuGet 依赖只在开发机上需要。

## 验证记录

先写测试并确认 RED，再实现和运行 GREEN。覆盖安全解压、损坏修复、不重复写入、并发启动，以及本机报告有内置 APK 时才显示导出入口。

- Windows 桌面全量：21/21 PASS。
- 核心全量：122/122 PASS。
- 微信相关全量：196/196 PASS；包含既有实验回归，不能将这些测试解读为 iPhone 相册 LIVE 成功。
- 单文件打包白名单/接线：3/3 PASS。
- 真实单 EXE 的隔离验证：资源展开、WPF/WebView2 加载与脚本引擎 PASS。该电脑已经安装 WebView2；没有宣称在完全干净的新 Windows 上完成验收。
- 已校验的二次启动自检约 0.93 秒，后台文件修改时间未变化；首次资源及 WebView 验证约 4.46 秒。这是开发机的验证耗时，并非全量扫描或所有玩家机器的启动承诺。
- 从 EXE 展开的实际后台，在独立端口及私密临时数据库副本运行，扫描 224 个素材；Android/微信入口、创建/更新/结束微信连接、品牌图内容均 PASS。原数据库只读，测试副本关闭在线解析和字典请求；未上传媒体、未写手机相册。
- `git diff --check` PASS。NuGet 漏洞信息查询存在 NU1900 网络警告，不视为依赖安全审计通过。

未替换用户已安装的手机 APK，未清理配对数据，未发布小程序，未 commit/push。工作树包含此前所有未提交修改，构建来源并非仅分支 HEAD：`feature/remote-bridge-foundation` / `2466e60b3d43a707851915ce9f4ee67627a06338`。

## 参考

- [.NET 单文件分发](https://learn.microsoft.com/en-us/dotnet/core/deploying/single-file/overview)
- [WebView2 分发与运行时](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)

最终交付：`release/NikkiSync-Portable/NikkiSync-PC.exe`，118,120,338 字节（112.65 MiB），该目录仅一个文件。SHA-256：`E5DD31F5EA65DA61FE3C374CE4A50A14377B946EE085DE89BAEF6E8CEB854546`。

最终 EXE 再次通过隔离 WPF/WebView 自检，约 5.41 秒；内置资源清单共 19 个文件，后台二进制哈希与已经通过真实接口验收的版本完全相同：`969760B5DC4C0450BC39EEFC6FF71665F3A76EB14E778D7B4471CBF9CE330ED1`。报告在 `out/portable-delivery-report.json`，不会随 EXE 向玩家分发。

APK SHA-256：`F3F71C70D273DC62B45EED5DE79CB6A93324D500494A295EA6C5BE0283AC056C`。PC EXE 尚未做 Windows 代码签名，本轮未进行 Windows ARM64 或新机完整验收。
