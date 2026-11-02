# Windows 发布包只展示一个启动入口

日期：2026-10-05。用户授权采用“后台程序换图标并收进子文件夹”的交付方式。

## 结果

最新 Windows 包：`release/NikkiSync-PinkUI-Clean/`。

```text
NikkiSync-PC.exe                    用户启动入口，保留大喵图标
NikkiSync.WindowsShell.dll          桌面壳依赖及其余 WPF/WebView2 文件
runtime/
  NikkiSync-PC-service.exe          灰色齿轮图标，主程序自动隐藏启动
  migrations/0001_initial.sql
  branding/momo-camera.png
  wechat/
    resize-preview.ps1
    rotate-png.ps1
    resize-icon.ps1
    THIRD_PARTY.md
    THIRD_PARTY_LICENSES.txt
    media/                         FFmpeg、ffprobe 和发行许可证
```

两个进程仍分别承担桌面壳和后台功能，不做嵌入解压或重新实现后台。`ServiceProcessHost` 从主程序目录的固定 `runtime` 路径启动服务，保留隐藏启动、健康检查、启动失败清理和退出结束子进程。所有后台资源一并移入 runtime，因此沿用基于后台 EXE 位置的资源定位，不依赖用户从哪个工作目录打开主程序。

`package.ps1` 的默认产物也采用新布局；验证发布目录根只能有 `NikkiSync-PC.exe` 一个 EXE。重建旧布局时只移除根目录中旧的 `NikkiSync-PC-service.exe`，不递归清理旧目录或删除用户其他文件。本次另建 Clean 目录，未覆盖用户正在运行的旧包，未改变开机启动项、快捷方式、正式数据库或游戏媒体。

灰色齿轮 ICO 由 `scripts/build-service-icon.ps1` 的几何图形生成，7 个尺寸；Bun 编译时嵌入后台 EXE。主程序图标保留。交付时必须保留整个目录；用户仅打开主程序。测试新版前先退出旧版托盘，否则单实例机制会激活旧版。

## 验证

- 先新增启动路径及停止子进程行为测试，旧实现 RED（仍从根目录启动服务）；修改后相关测试 2/2 PASS。
- Windows 桌面壳全量测试 10/10 PASS。
- `npm run build` PASS；首次受沙箱子进程限制 EPERM，获准后重跑成功。
- 新包 Bun 编译、.NET publish、发布布局验证 PASS；根目录仅一个 EXE。
- 从编译后的两个 EXE 提取图标，32×32 图标 1024 个像素不同，确认实际嵌入的图标不同。
- `accept-desktop-exe.mjs` 在新 runtime 路径启动真实后台 EXE，使用正式数据库的私密临时快照，确认扫描 224 个素材、微信图库 224 项、Android 入口、生成/更新/结束微信连接、品牌图一致。测试副本关闭在线解析器；源库只读，游戏文件未写，媒体未上传。没有宣称 WPF 实机点击或手机保存验收。
- `git diff --check` PASS（已有 CRLF 提示不属于错误）。NuGet 漏洞信息网络请求警告仍存在，不宣称依赖安全审计通过。

SHA256：

| 文件 | SHA256 |
| --- | --- |
| NikkiSync-PC.exe | F6F35C74381B175EA457445C92597E4A17E2B92454C7C515299E8687EF044E89 |
| NikkiSync.WindowsShell.dll | 74F82E19386A2683571ACB3A0FF2C9042EF95B053C772A2ECEDD57571BF9D084 |
| runtime/NikkiSync-PC-service.exe | 7584A3B5ED7663DEA29FAC368CD24B57013BC87A4A25BC921A822725FC6BF934 |

旧 PinkUI 包的路径与哈希仍是前轮历史记录；使用此新目录检查单一入口布局。没有 commit、push 或发布。
