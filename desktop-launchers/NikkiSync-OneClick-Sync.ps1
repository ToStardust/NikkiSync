$ErrorActionPreference = 'Stop'

$repo = 'D:\GAME\InfinityNikki Launcher\InfinityNikki\X6Game\CameraPartner\NikkiSync'
$git = (Get-Command git.exe -ErrorAction SilentlyContinue).Source

Add-Type -AssemblyName System.Windows.Forms

function Show-Message {
    param(
        [string]$Title,
        [string]$Message,
        [System.Windows.Forms.MessageBoxIcon]$Icon = [System.Windows.Forms.MessageBoxIcon]::Information
    )

    [System.Windows.Forms.MessageBox]::Show(
        $Message,
        $Title,
        [System.Windows.Forms.MessageBoxButtons]::OK,
        $Icon
    ) | Out-Null
}

function Join-Output {
    param([object[]]$Lines)

    $text = ($Lines | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
    if ($text.Length -gt 1600) {
        return $text.Substring($text.Length - 1600)
    }
    return $text
}

try {
    if (-not $git) {
        throw '找不到 Git。请先安装 Git for Windows。'
    }

    if (-not (Test-Path -LiteralPath $repo -PathType Container)) {
        throw "找不到 NikkiSync 工作区：$repo"
    }

    $branch = ((& $git -C $repo rev-parse --abbrev-ref HEAD 2>&1) -join '').Trim()
    if ($LASTEXITCODE -ne 0) {
        throw '当前目录不是有效的 Git 仓库。'
    }
    if ($branch -ne 'main') {
        throw "当前分支是 $branch。为避免改错分支，一键同步只允许更新 main。"
    }

    $localChanges = @(& $git -C $repo status --porcelain=v1 2>&1)
    if ($LASTEXITCODE -ne 0) {
        throw (Join-Output $localChanges)
    }
    if ($localChanges.Count -gt 0) {
        $details = Join-Output $localChanges
        Show-Message 'NikkiSync 未执行同步' "检测到本地有未提交修改。\n\n为保护你的文件，本次没有拉取 GitHub 修改。\n\n$details" ([System.Windows.Forms.MessageBoxIcon]::Warning)
        exit 2
    }

    $fetchOutput = @(& $git -C $repo fetch origin main --prune 2>&1)
    if ($LASTEXITCODE -ne 0) {
        throw "无法连接 GitHub。\n\n$(Join-Output $fetchOutput)"
    }

    $remoteHead = ((& $git -C $repo rev-parse origin/main 2>&1) -join '').Trim()
    if ($LASTEXITCODE -ne 0 -or -not $remoteHead) {
        throw '找不到 GitHub 上的 origin/main 分支。'
    }

    $behind = [int]((( & $git -C $repo rev-list --count "HEAD..origin/main" 2>&1) -join '').Trim())
    if ($LASTEXITCODE -ne 0) {
        throw '无法读取 GitHub 提交状态。'
    }

    $ahead = [int]((( & $git -C $repo rev-list --count "origin/main..HEAD" 2>&1) -join '').Trim())
    if ($LASTEXITCODE -ne 0) {
        throw '无法读取本地提交状态。'
    }

    if ($ahead -gt 0 -and $behind -gt 0) {
        throw "本地和 GitHub 各有未合并提交（本地 $ahead 个，GitHub $behind 个）。请先人工处理分支，未执行同步。"
    }
    if ($ahead -gt 0) {
        Show-Message 'NikkiSync 未执行同步' "本地有 $ahead 个尚未推送到 GitHub 的提交。\n\n为保护本地历史，本次没有拉取远程修改。" ([System.Windows.Forms.MessageBoxIcon]::Warning)
        exit 2
    }
    if ($behind -eq 0) {
        Show-Message 'NikkiSync 已是最新' '本地工作区已经与 GitHub 的 main 分支同步，无需更新。'
        exit 0
    }

    $pullOutput = @(& $git -C $repo merge --ff-only origin/main 2>&1)
    if ($LASTEXITCODE -ne 0) {
        throw "自动同步失败，未覆盖本地文件。\n\n$(Join-Output $pullOutput)"
    }

    $newHead = ((& $git -C $repo rev-parse --short HEAD 2>&1) -join '').Trim()
    Show-Message 'NikkiSync 同步完成' "已从 GitHub 拉取 $behind 个提交。\n\n当前版本：$newHead\n工作区：$repo"
}
catch {
    Show-Message 'NikkiSync 同步失败' $_.Exception.Message ([System.Windows.Forms.MessageBoxIcon]::Error)
    exit 1
}
