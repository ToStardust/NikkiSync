param(
    [Parameter(Mandatory=$true)][string]$AndroidApk,
    [string]$DesktopVersion = '1.0.31',
    [Parameter(Mandatory=$true)][long]$DesktopBuild,
    [Parameter(Mandatory=$true)][string]$OutputDirectory
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$releaseRoot = [IO.Path]::GetFullPath((Join-Path $root 'release'))
$delivery = [IO.Path]::GetFullPath((Join-Path $root $OutputDirectory))
if (!$delivery.StartsWith($releaseRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Delivery must stay inside workspace/release.' }
if (Test-Path -LiteralPath $delivery) { throw 'Choose a new delivery directory.' }
$apk = [IO.Path]::GetFullPath((Join-Path $root $AndroidApk))
if (!$apk.StartsWith($releaseRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or !(Test-Path -LiteralPath $apk -PathType Leaf)) { throw 'Use an existing signed release APK.' }
$appOutput = "release/MomoCamera-PC-$DesktopVersion-AppOnly-$DesktopBuild"
$compatibleBuild = $DesktopBuild + 1
$compatibleOutput = "release/MomoCamera-PC-$DesktopVersion-AppAndMiniProgram-$compatibleBuild"
Push-Location $root
try {
    & ./apps/windows-shell/package-portable.ps1 -OutputDirectory $appOutput -AndroidApk $AndroidApk -DesktopVersion $DesktopVersion -DesktopBuild $DesktopBuild -ClientEdition AppOnly
    & ./apps/windows-shell/package-portable.ps1 -OutputDirectory $compatibleOutput -AndroidApk $AndroidApk -DesktopVersion $DesktopVersion -DesktopBuild $compatibleBuild -ClientEdition AppAndMiniProgram -IncludeWeChatMotionTools
    New-Item -ItemType Directory -Path $delivery | Out-Null
    Copy-Item -LiteralPath (Join-Path $root "$appOutput/NikkiSync-PC.exe") -Destination (Join-Path $delivery "（电脑端-仅需APP的）大喵相机助手_$DesktopVersion.exe")
    Copy-Item -LiteralPath (Join-Path $root "$compatibleOutput/NikkiSync-PC.exe") -Destination (Join-Path $delivery "（电脑端-兼容小程序和APP）大喵相机助手_$DesktopVersion.exe")
    Copy-Item -LiteralPath $apk -Destination (Join-Path $delivery "（安卓端）大喵相机助手_$DesktopVersion.apk")
    $utf8 = [Text.UTF8Encoding]::new($false)
    $notes = @"
大喵相机助手 $DesktopVersion 客户端分版测试包

（电脑端-仅需APP的）：使用安卓 App 时选择，轻量版不提供微信小程序连接。
（电脑端-兼容小程序和APP）：使用微信小程序时选择，也支持安卓 App；包含小程序视频旋转工具。
（安卓端）：安装在安卓手机上，可连接上述任一电脑端。

两个电脑端二选一。先从托盘退出旧助手，再打开选定的新 EXE。安卓版可覆盖安装。
两种电脑端沿用相同的配对记录、扫描目录、同步账号设置与待删除记录；切换不清空数据。
仅 APP 构建 $DesktopBuild；兼容版构建 $compatibleBuild。安卓端为同一份签名安装包，可与任一电脑端配套使用。
已包含滑动多选、版本分组全选及前次合并修复。小程序图标缓存优化需配合新版小程序，现有体验版不会自动更新。
"@
    [IO.File]::WriteAllText((Join-Path $delivery '使用说明.txt'), $notes, $utf8)
    $files = @(Get-ChildItem -LiteralPath $delivery -File | Sort-Object Name)
    $hashes = foreach ($file in $files) { '{0}  {1}' -f (Get-FileHash -LiteralPath $file.FullName).Hash.ToLowerInvariant(), $file.Name }
    [IO.File]::WriteAllLines((Join-Path $delivery 'SHA256SUMS.txt'), [string[]]$hashes, $utf8)
    Get-ChildItem -LiteralPath $delivery -File | ForEach-Object { [pscustomobject]@{ name=$_.Name; bytes=$_.Length; sha256=(Get-FileHash -LiteralPath $_.FullName).Hash.ToLowerInvariant() } } | ConvertTo-Json
} finally { Pop-Location }
