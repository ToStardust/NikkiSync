param([string]$Version='1.0.1',[long]$Build=2026101801,[string]$Tag='v1.0.1-public-beta.1',[string]$OutputDirectory='release\MomoCamera-PublicBeta-1.0.1-2026-10-18',[string]$BunExecutable='bun',[string]$AndroidApk,[string]$ExpectedApkSha256,[string]$Notes='新增电脑助手一键更新、签名校验及启动失败恢复；内置安卓安装包更新为1.0.1。',[string]$Quickstart='docs\remote-bridge\PUBLIC_BETA_QUICKSTART.txt',[string]$ReleaseNotesFile='docs\remote-bridge\PUBLIC_BETA_RELEASE_NOTES.txt')
$ErrorActionPreference='Stop'
if($Version -ne '1.0.1' -and (!$AndroidApk -or $ExpectedApkSha256 -notmatch '^[a-fA-F0-9]{64}$')){throw 'A new version requires an explicitly verified matching Android APK and SHA256.'}
$workspace=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$root=[IO.Path]::GetFullPath((Join-Path $workspace $OutputDirectory))
$releaseRoot=[IO.Path]::GetFullPath((Join-Path $workspace 'release'))+'\'
if(-not $root.StartsWith($releaseRoot,[StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $root)){throw 'Choose a new workspace/release directory; never overwrite a published package.'}
$apkRelative=if($AndroidApk){$AndroidApk}else{'release\MomoCamera-1.0.1-PhotoWidgets\MomoCamera-Android-1.0.1.apk'}
$apk=Join-Path $workspace $apkRelative
$expectedHash=if($ExpectedApkSha256){$ExpectedApkSha256}else{'1358C8191146370E9859E7CE41E54397F7221F634D25763061036C88C1A0E2EA'}
if((Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash -ne $expectedHash){throw 'Unexpected Android APK; inspect version and signing before packaging.'}
$pcOutput=$OutputDirectory+'-PC-Build'
& (Join-Path $workspace 'apps\windows-shell\package-portable.ps1') -OutputDirectory $pcOutput -AndroidApk $apkRelative -BunExecutable $BunExecutable -DesktopVersion $Version -DesktopBuild $Build
if($LASTEXITCODE -ne 0){throw 'Desktop build failed.'}
New-Item -ItemType Directory -Force $root | Out-Null
$exeName="MomoCamera-PC-$Version.exe"
Copy-Item -LiteralPath (Join-Path $workspace ($pcOutput+'\NikkiSync-PC.exe')) -Destination (Join-Path $root $exeName)
Copy-Item -LiteralPath $apk -Destination (Join-Path $root "MomoCamera-Android-$Version.apk")
foreach($document in @{'README.txt'=$Quickstart;'RELEASE_NOTES.txt'=$ReleaseNotesFile;'网盘与更新源说明.txt'='docs\remote-bridge\PUBLIC_BETA_DISTRIBUTION.txt'}.GetEnumerator()){
  Copy-Item -LiteralPath (Join-Path $workspace $document.Value) -Destination (Join-Path $root $document.Key)
}
$feed=Join-Path $root '维护者-更新发布文件'
& (Join-Path $PSScriptRoot 'sign-desktop-update.ps1') -Executable (Join-Path $root $exeName) -OutputDirectory $feed -Version $Version -Build $Build -DownloadUrl "https://github.com/ToStardust/NikkiSync/releases/download/$Tag/$exeName" -Notes $Notes
if($LASTEXITCODE -ne 0){throw 'Signing update manifest failed.'}
$checks=@(Get-ChildItem -LiteralPath $root -File | Sort-Object Name | ForEach-Object{((Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant())+'  '+$_.Name})
[IO.File]::WriteAllLines((Join-Path $root 'SHA256SUMS.txt'),$checks,[Text.UTF8Encoding]::new($false))
Compress-Archive -LiteralPath $root -DestinationPath ($root+'.zip') -CompressionLevel Optimal
Write-Output "Public beta folder: $root"
Write-Output "Public beta archive: $root.zip"
