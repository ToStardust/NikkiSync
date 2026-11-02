# 小程序 App 风格 UI 第一轮｜2026-10-02

用户要求先放下上一轮预览单击的实机复验，把微信小程序 UI 优化为接近 Android App。工作区仍为 NikkiSync-RemoteBridge / feature/remote-bridge-foundation；本轮只改微信页面与对应测试，没有修改加密、TCP、PC 照片源、数据库、Live、NUAN5、原生配对或 Windows 生命周期。

## 参考与实现

阅读 AGENTS.md、GPT_HANDOFF_2026-09-04.md、M2_3_MOBILE_GALLERY_UI_REQUIREMENTS.md、本地 PhotoLayout UI_REPLICATION_HANDOFF.md 和 Android GalleryUxStyle/colors。采用 App 的 #F6F3EF 暖底、#262321 文字、#7A6F91 紫灰强调色，柔和渐变、紧凑相册和悬浮玻璃胶囊。

- 首页：相册入口为唯一主操作，使用 CSS 相机/照片框装饰，不生成暖暖/大喵人物图。旧扫码与四个诊断入口折叠在开发工具内，仍保留“非官方 / 开发预览 / 原图下载尚未开放”。
- 相册：紧凑标题、连接状态胶囊、三列方形缩略图；日期从每张卡片下移到一行本页日期范围，另显示页内序号与总数。日期未知不推测，不添加未传输的游戏版本或服装数据。
- 底栏：仅“相册 / 连接”两个真实功能，胶囊外没有纯色底座，文字强制单行；不伪造已保存、收藏或下载入口。
- 连接：在同一 Page 内由下向上打开面板，状态、重新扫码、临时码/隐私及开发安全限制集中放在这里。打开/关闭不触发页面隐藏，不关闭 socket 或清缓存。使用 page-container 接管返回，不宣称实现 Android 全手势进度的 predictive back。
- 照片预览：保留黑色全屏、轻点切换操作栏、独立返回按钮及原生返回状态同步；增加日期和简洁图像区域。本轮未扩展滑动、缩放、下载或 Live。
- 背景：仅用本页已验证 JPEG 的首张可用缓存做低透明度、固定半径柔焦氛围层，纯渐变作为回退。没有远端图片/像素取色请求，没有随机变色，没有写游戏原图；这不是 PhotoLayout 的完整 Monet palette 算法。
- 玻璃：支持 CSS backdrop-filter 时磨砂 + 浅色边框/阴影，否则高透明度 surface 回退。没有 Android AGSL 折射与 RGB 色散，顶部为短渐隐背景，而不是宣称已复刻原生渐变高斯采样层。滚动期间不动态切换 blur 半径。
- 背景图路径只来自当前验证缓存，换页/后台清空；不把二维码密钥或会话配置放进 data。底栏预留安全区和列表底部空间。

## 验证

先补 UI 合约/面板生命周期测试，得到 2 RED；实现并补分页日期/氛围图测试后，npm run test:wechat 新鲜 **54/54 PASS**（包含 TypeScript 构建和原有加密/传输回归）。git diff --check exit 0，仅 LF/CRLF 提示。

授权范围内更新开发 CLI preview：exit 0，代码包 **161821 bytes**，非秘密预览码为 out/wechat-gallery-ui-preview.png。包内不含真实照片、实际 PSK、UID、本机 IP；没有 upload/发布/审核。

本轮没有手机视觉截图、模糊性能、原生返回或真机玻璃渲染 PASS。上一轮“真实照片可看、下一页可用”仍只记为用户报告通过，不沿用为新版 UI 实机验收。

生成新十分钟本机只读浏览会话，215 张普通照片；有效期至 2026-10-02 23:47:03（Asia/Hong_Kong）。私有二维码仅在本机文件面板展示，不读取其像素或内容到聊天。服务届时自动关闭并尽力删除自己的私有 QR。

## 状态

变更仍在本地，未 commit/push/merge。保留 tools/sample-analyzer/analyze.mjs 既有修改，不动其他工作树。独立安全审计、iPhone、原图下载/保存、进程死亡清扫仍是原有未完成项，不因 UI 优化改变。

## 用户反馈：点照片无法打开｜同日修复

用户报告新版 UI 可以显示，但点击照片不再出现预览。源码发现新增 connection-sheet 后，与 viewer 同页放了两个常驻 page-container；旧 VM 测试只看 viewerOpen/data，未检查原生容器实际注册。双原生容器是本轮主要回归嫌疑，百分比图片高度亦改为明确全屏尺寸。当前没有微信真机运行日志，不能将推断写成已在设备上证实的唯一原因。

改为唯一常驻 page-container，用 popupMode 区分连接面板和 viewer，并复用返回回调。按[微信官方示例](https://github.com/wechat-miniprogram/miniprogram-demo/blob/master/miniprogram/packageComponent/pages/view/page-container/page-container.js)的模式，先在 setData 渲染回调前配置位置/尺寸/遮罩/时长，再显示；关闭期间不切换模式，后台/卸载/扫码/换页会废弃迟到打开回调。单击仍仅切换 chrome，不清缓存或关闭通道。图片使用 100vw/100vh、禁止 flex 收缩。

先补容器数量断言与异步显示/关闭/后台回调测试，RED 后补实现：页面聚焦 7/7，完整 npm run test:wechat **56/56 PASS**，git diff --check exit 0。只改微信图库页面、样式、相关测试和本记录；未修改传输/媒体读取。

修复版 CLI preview exit 0，包 **162884 bytes**，代码预览码 out/wechat-gallery-viewer-fix-preview.png；仍无真实照片、实际密钥/IP/UID，不发布/审核。**微信实机恢复预览待用户复验，不能将 Node/模板测试写成原生显示 PASS。**

复验新会话：215 张，期限至 2026-10-02 23:55:31（Asia/Hong_Kong）；私有扫码文件仅请求本机面板打开，未读像素到聊天。上一轮十分钟会话仍按原期限自动结束。
