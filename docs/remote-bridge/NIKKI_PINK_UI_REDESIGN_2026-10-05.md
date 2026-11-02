# 三端暖暖粉 UI 改版｜2026-10-04—05

用户批准基于粉桃奶油预览直接推进 Windows、Android App、微信小程序的整体 UI 改版，并给出 `#F6BCC0` 色样。工作区为 NikkiSync-RemoteBridge / feature/remote-bridge-foundation；保留进入本轮时已有的未提交改动，没有 commit、push 或 merge。

## 视觉规范与实现

共享配色记录在 `assets/branding/ui-tokens.json`。主操作面为 `#F6BCC0`，前景为 `#62425A`；品牌边框/选中标记为 `#D780AA`，浅粉选中面为 `#FBE6ED`。页面从 `#F5DCE5` 淡粉经过 `#FAE6DF` 粉桃过渡至 `#FFF8F0` 奶油底，卡片为 `#FFFCF7`。按钮使用纯暖暖粉，去掉此前预览按钮中的蜜桃渐变。

- Windows：将真实控制页、设置页、Android/微信二维码弹窗和旧照片选择面板接入新主题。统一两条连接路径的图标底色、导航选中面、配对状态、按钮/开关与键盘焦点环；辅助字号至少 11px。沿用之前完成的布局、轮询、键盘焦点和关闭清码行为。WPF/WebView2 初始底色同步更新。
- Android：统一相册、已保存、我的、照片详情、服装区域、穿搭灵感库以及搜索界面共用的颜色/卡片资源。首页去掉重复的标题卡片，增加标题和连接文案的呼吸空间，版本分组改为轻量文字；底栏、选择保存栏增加外侧留白。主操作为粉底深玫瑰文字，普通按钮用浅粉，文字不再靠降低整个控件透明度弱化。图库与已保存缩略图按实际三列宽度自适应为正方形，选择覆盖层跟随照片尺寸；已保存日期字号提升至 11sp。
- 小程序：首页、图库、搜索筛选、空状态、选择保存、连接面板、参数/穿搭面板、查看器保存操作及开发诊断按钮统一到全局 `--nikki-*` 样式变量。手机系统导航底色同步更新；三列缩略图按可用宽度计算高度，悬浮底栏稍加宽，照片仍使用真实缓存，黑色全屏照片查看器保留。

未更改传输协议、照片扫描、数据库结构、配对身份或系统相册媒体。没有新增未实现的页面入口，没有修改游戏安装目录，没有安装到用户手机，也没有停止旧 Windows 实例。

## 验证与修正

| 检查 | 结果 |
| --- | --- |
| 修改前主工程基线 | 95/95 PASS |
| 共享配色测试 RED | 规范尚不存在时 3 项失败；实现后 3/3 PASS |
| 最终 `npm test` | 98/98 PASS，包含主题一致性与文本对比度 |
| `npm run test:wechat` | 159/159 PASS |
| 诊断按钮最终样式后的聚焦验证 | 10/10 PASS（主题、小程序项目、Live 开发页） |
| `npm run mobile:validate` | PASS，51 文件合同验证 |
| Android 单元测试 | 最终 57/57 PASS，19 个测试类，0 failures/errors |
| Android `assembleDebug` / APK 签名验证 | PASS，v2 签名有效 |
| Windows Release 测试 | 9/9 PASS |
| Windows 完整独立交付包 | PASS |
| Windows 真实页面浏览器检查 | PASS：1020/600/460/360 宽度，0 页面错误，主按钮颜色及对比度、配对弹窗、焦点/Tab/Escape、二维码清理、设置、服务离线恢复 |
| `git diff --check` | PASS，使用 `core.whitespace=cr-at-eol` |

Android 首次全量运行出现两个 `EditedMediaAccessTest` 失败，原因是调用 `android.net.Uri.parse` 的测试缺少 Android 仿真运行器；只补 Robolectric runner / SDK 33 配置，未修改媒体访问生产逻辑。新增缩略图测量测试在 SDK 35 仿真下先得到图库/已保存两项尺寸断言 RED，再添加适应宽度的 `onMeasure`；最终全量回归通过。测量测试覆盖同一 cell 在 94、132、210px 宽度之间变化，并检查选择层尺寸跟随照片。

Android 构建存在已有 SDK XML/Gradle 弃用提示；Windows .NET 构建存在 NU1900 包漏洞资料联网警告，均未造成编译错误。没有为这些提示升级项目依赖。

浏览器截图位于 `out/desktop-ui/`，来自真实桌面渲染器，但数据和二维码是合成测试输入，不是手机/WPF 实机或真实照片连接截图。本轮没有 Android/微信手机视觉或原生 WPF 实机验收。

## 交付与启动

- Windows：`release/NikkiSync-PinkUI/NikkiSync-PC.exe`。必须保留整个目录；先从托盘退出旧实例，再启动新版，否则单实例机制会激活旧程序。
- Android：`apps/mobile/app/build/outputs/apk/debug/app-debug.apk`，包名保持 `app.nikkisync.mobile`，未自动安装。
- 小程序：`apps/wechat-mini-program/` 本地源码已更新并通过回归，未发布、提交审核或生成本轮云端开发预览码。

SHA256：

```text
Windows service: 0DE1D314EEDED14F579C5E8C77A9388039D43D52FD793C1426A2F3C531EBFB9F
Windows UI DLL: 929662F5BE6C4A30DF9DA6FA149C2438939A33BBA5CE977F49A1227A5B730047
Final Android APK: D83DDADE11F33594EC9A637B2BBE969FC526A76521259FB3960C2608A7386705
```

微信 `cli preview` 的调用在执行前被自动审批拒绝：生成开发预览码需要将项目代码包发送到微信服务器，而当前用户未明确授权这次第三方上传。未绕过拒绝，没有上传发生，没有新预览码；要继续此步骤，需取得明确授权。审批不影响已完成的本地改版、测试和 EXE/APK 构建。
# 后续：用户已允许预览上传，Live 接入完成

用户本轮明确回答“允许”，微信 CLI preview 已实际成功。最终暖暖粉 + Live 版本为 `out/wechat-nikki-pink-live-preview.png`，代码包258,513字节；仅开发预览，不含照片或连接密钥。先前自动审查拒绝的记录仍是上一轮历史情况，不代表本轮仍被阻挡。

本轮 Windows目录与Android APK已重新构建，Live列表/播放/文件导出及最终哈希、验证和设备边界详见 [Live接入交接](LIVE_GALLERY_INTEGRATION_2026-10-05.md)。不要再用本文件较早的 service/APK 哈希代表这次Live构建。
