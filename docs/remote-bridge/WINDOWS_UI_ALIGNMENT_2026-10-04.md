# Windows 界面对齐 App / 小程序｜2026-10-04

工作区：`NikkiSync-RemoteBridge`，分支：`feature/remote-bridge-foundation`。用户要求重做 Windows 端过于粗糙的 UI，和现有 App、小程序对齐。本轮改动保留在本地，未提交、推送或合并。

## 实现

- 复用 Android `colors.xml` 和小程序的 `#F6F3EF` 暖白底、`#262321` 正文、`#716B66` 次要文字、`#7A6F91` 灰紫强调色；沿用现有大喵头像。使用本地线条图标、克制的半透明卡片和渐变，字体由 Windows 系统提供。
- 首页改为“手机连接”：轻量相册素材 / 已配对设备信息，微信和 Android 两个实际入口并排展示。局域网地址、关闭到托盘说明与开机启动偏好归入“同步设置”。只显示已经实现的操作。
- 默认窗口 `1020 × 780`，最小 `600 × 600`；窄窗口转为上下排列，导航收为横向。WebView2 初始底色与页面一致。
- Android 配对生成增加等待、失败重试、关闭清码及迟到响应作废；弹窗使用模态语义、背景 inert、键盘焦点循环、Escape / 遮罩关闭与焦点恢复。微信和旧 Remote Bridge 弹窗共用同一机制，弹窗放在背景容器外。
- 每两秒读取原有桌面状态；不重叠轮询，服务不可用时保留数量并显示状态，恢复后更新。设备配对后隐藏首次配对码；设备数归零时清除“已配对”提示。开机启动开关等待原生偏好返回后才可操作。
- `DesktopPage.ts` / `DesktopPageScript.ts` / `DesktopIcons.ts` 承担展示；沿用原本控制服务器、Android 配对和微信传输 API。没有新增照片索引或修改扫描、数据库结构、元数据及游戏文件。

## 验证

| 检查 | 本轮结果 |
| --- | --- |
| 修改前桌面聚焦回归 | 10 / 10 PASS |
| 新增桌面行为测试 RED | 尚未实现 `DesktopPageScript` 时 TS2307；补实现后 4 / 4 PASS |
| `npm test` | 95 / 95 PASS |
| `npm run test:wechat` | 159 / 159 PASS |
| Windows 壳 Release 测试 | 9 / 9 PASS |
| Windows 壳 Release 构建、完整包生成 | 成功，0 编译错误；存在缓存的 NU1900 漏洞资料联网警告 |
| 真实渲染器浏览器验收 | 首次配对 / 已配对 / 设置 / 弹窗更新与关闭清码 / Tab 与 Escape / 服务失败恢复 / 设备配对状态变更 / 减少动画；1020、600、460、360 宽度无横向溢出，0 页面错误 |
| 最终服务 EXE | 私密临时数据库副本中扫描 224 份素材，微信 215 张普通照片；两个入口、微信二维码生成 / 更新 / 结束、同源头像通过 |
| 打包布局、`git diff --check` | PASS（工作区 CRLF 以 `cr-at-eol` 检查） |

浏览器检查第一次发现微信弹窗置于 inert 背景内而无法获得焦点，移动到背景外后复验通过；没有把静态 DOM 测试当作真实点击证据。验收脚本：`tools/desktop-ui/accept.mjs`，使用本机现有 Playwright / Chromium，未下载新工具。

截图位于 `out/desktop-ui/`，为真实页面渲染配合**合成状态和无效演示二维码**，不是手机或 WPF 实机截图。真实服务 EXE 验收沿用 `tools/wechat-gallery/accept-desktop-exe.mjs`，通过 `NIKKISYNC_DESKTOP_RELEASE=release/NikkiSync-DesktopUI` 指向新包；原库只读，副本禁用在线 resolver / 字典，自己的服务结束后清除经过路径校验的副本。不读二维码像素到聊天、不上传媒体、不安装手机应用。

本轮没有原生 WPF 视觉 / 手机跨设备实机验收，不改变既有手机验收状态。

## 启动与交付

当前旧 `release/NikkiSync` 程序正在运行，保留其进程、文件、快捷方式及开机启动项。新 Windows 包在 `release/NikkiSync-DesktopUI/`，入口为 `NikkiSync-PC.exe`。打包脚本新增 `-OutputDirectory`，限定目标在本工作区 `release/` 子目录，可在旧程序运行时完整构建新版。

从托盘选择“退出 NikkiSync”，再运行新目录中的入口；直接关闭旧窗口只是隐藏到托盘。仍保留应用单实例规则，旧实例未退出时点击新版会激活旧窗口。保留整个新包目录，不能只搬入口 EXE。新版正常启动后沿用同一用户的既有本地数据。

服务 EXE SHA256：`B49B3FDA69F629C0D87BC65CFFA2EB5C3BEB18490536B8B6C68337496D908ACF`。入口 EXE 为 .NET apphost，UI 与窗口定义随包内 `NikkiSync.WindowsShell.dll` 更新。
