# NikkiSync 桌面一键同步

## 用途

桌面快捷方式 `NikkiSync 一键同步` 用于把 GitHub 私有仓库 `ToStardust/NikkiSync` 的 `main` 分支安全同步到本机工作区：

`D:\GAME\InfinityNikki Launcher\InfinityNikki\X6Game\CameraPartner\NikkiSync`

## 安全规则

- 只允许同步 `main` 分支。
- 同步前检查本地未提交修改；发现修改时停止，不覆盖文件。
- 本地有未推送提交，或本地与远程分叉时停止，避免自动制造冲突。
- 使用 `git fetch` 后再执行 `git merge --ff-only`，只接受可安全快进的更新。
- 同步脚本不会上传本地文件，也不会修改 GitHub 上的内容。

## 使用方式

双击桌面上的 `NikkiSync 一键同步`。脚本会弹出同步结果；如果发现本地修改或分支冲突，会明确提示并停止。

## 脚本位置

实现脚本位于：

`desktop-launchers/NikkiSync-OneClick-Sync.ps1`
