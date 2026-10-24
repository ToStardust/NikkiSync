param([switch]$VerifyOnly, [string]$OutputDirectory, [string]$BunExecutable='bun')

$ErrorActionPreference = 'Stop'

$workspace = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$releaseRoot = [System.IO.Path]::GetFullPath((Join-Path $workspace 'release'))
$release = if ($OutputDirectory) {
  [System.IO.Path]::GetFullPath((Join-Path $workspace $OutputDirectory))
} else { Join-Path $releaseRoot 'NikkiSync' }
if (-not $release.StartsWith($releaseRoot + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'Release output must be a subdirectory of this workspace release directory.'
}
$desktopHost = Join-Path $release 'NikkiSync-PC.exe'
$runtime = Join-Path $release 'runtime'
$service = Join-Path $runtime 'NikkiSync-PC-service.exe'
$migration = Join-Path $runtime 'migrations\0001_initial.sql'
$wechatPreview = Join-Path $runtime 'wechat\resize-preview.ps1'
$wechatRotation = Join-Path $runtime 'wechat\rotate-png.ps1'
$wechatIcons = Join-Path $runtime 'wechat\resize-icon.ps1'
$brandImage = Join-Path $runtime 'branding\momo-camera.png'
$liveTools = Join-Path $runtime 'wechat\media'
$serviceIcon = Join-Path $PSScriptRoot 'Assets\service.ico'

function Assert-ReleaseLayout {
  foreach ($path in @($desktopHost, $service, $migration, $wechatPreview, $wechatRotation, $wechatIcons, $brandImage, (Join-Path $liveTools 'ffmpeg.exe'), (Join-Path $liveTools 'ffprobe.exe'), (Join-Path $liveTools 'LICENSE'))) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing release file: $path" }
  }
  if ((Resolve-Path -LiteralPath $desktopHost).Path -eq (Resolve-Path -LiteralPath $service).Path) { throw 'Desktop host and service must be separate executables.' }
  $entrypoints = @(Get-ChildItem -LiteralPath $release -File -Filter '*.exe')
  if ($entrypoints.Count -ne 1 -or $entrypoints[0].Name -ne 'NikkiSync-PC.exe') { throw 'The release root must have exactly one user-facing executable: NikkiSync-PC.exe.' }
}

if ($VerifyOnly) { Assert-ReleaseLayout; Write-Output 'NikkiSync Windows release layout verified.'; exit 0 }
$pinnedBun = Join-Path $workspace 'out\bun-baseline-1.4.1\bun-windows-x64-baseline\bun.exe'
if ($BunExecutable -eq 'bun' -and (Test-Path -LiteralPath $pinnedBun)) { $BunExecutable = $pinnedBun }
if ($BunExecutable -ne 'bun') { $BunExecutable = (Resolve-Path -LiteralPath $BunExecutable).Path }
$bunVersion = (& $BunExecutable --version).Trim()
if ($LASTEXITCODE -ne 0 -or [version]($bunVersion.Split('-')[0]) -lt [version]'1.4.1') { throw 'Bun 1.4.1 or newer is required for working HTTPS realtime upgrades. Use the baseline Windows runtime.' }

New-Item -ItemType Directory -Force $release | Out-Null
New-Item -ItemType Directory -Force (Join-Path $runtime 'migrations') | Out-Null
& (Join-Path $workspace 'scripts\build-service-icon.ps1')
Push-Location (Join-Path $workspace 'apps\pc-companion')
try {
  $compilerRuntime = @()
  if ($BunExecutable -ne 'bun') { $compilerRuntime = @("--compile-executable-path=$BunExecutable") }
  & $BunExecutable build --compile --compile-exec-argv="--smol" --target=bun-windows-x64-baseline @compilerRuntime --windows-hide-console --windows-icon $serviceIcon --windows-title=NikkiSyncPCService --windows-description=InfinityNikkiPhotoSyncBackgroundService --outfile $service src/windows-app.ts
  if ($LASTEXITCODE -ne 0) { throw 'Bun service compilation failed.' }
} finally { Pop-Location }

dotnet publish (Join-Path $PSScriptRoot 'NikkiSync.WindowsShell.csproj') -c Release -o $release
if ($LASTEXITCODE -ne 0) { throw 'WPF desktop host publish failed.' }
$publishedHost = Join-Path $release 'NikkiSync.WindowsShell.exe'
if (-not (Test-Path -LiteralPath $publishedHost -PathType Leaf)) { throw "Published desktop host is missing: $publishedHost" }
Move-Item -LiteralPath $publishedHost -Destination $desktopHost -Force
Copy-Item -LiteralPath (Join-Path $workspace 'packages\database\migrations\0001_initial.sql') -Destination $migration -Force
New-Item -ItemType Directory -Force (Join-Path $runtime 'wechat') | Out-Null
Copy-Item -LiteralPath (Join-Path $workspace 'tools\wechat-gallery\resize-preview.ps1') -Destination $wechatPreview -Force
Copy-Item -LiteralPath (Join-Path $workspace 'tools\wechat-gallery\rotate-png.ps1') -Destination $wechatRotation -Force
Copy-Item -LiteralPath (Join-Path $workspace 'tools\wechat-gallery\resize-icon.ps1') -Destination $wechatIcons -Force
Copy-Item -LiteralPath (Join-Path $workspace 'apps\wechat-mini-program\miniprogram\lib\THIRD_PARTY_LICENSES.txt') -Destination (Join-Path $runtime 'wechat\THIRD_PARTY_LICENSES.txt') -Force
Copy-Item -LiteralPath (Join-Path $workspace 'apps\wechat-mini-program\miniprogram\lib\THIRD_PARTY.md') -Destination (Join-Path $runtime 'wechat\THIRD_PARTY.md') -Force
New-Item -ItemType Directory -Force (Join-Path $runtime 'branding') | Out-Null
Copy-Item -LiteralPath (Join-Path $workspace 'assets\branding\momo-camera.png') -Destination $brandImage -Force
New-Item -ItemType Directory -Force (Join-Path $runtime 'legal') | Out-Null
foreach($document in @('PRIVACY_POLICY.md','USER_AGREEMENT.md','PERMISSIONS_DATA.md','SDK_SERVICES.md')) {
  Copy-Item -LiteralPath (Join-Path $workspace ('docs\store-submission\'+$document)) -Destination (Join-Path $runtime ('legal\'+$document)) -Force
}
New-Item -ItemType Directory -Force $liveTools | Out-Null
$liveFfmpeg = (Get-Command ffmpeg -CommandType Application -ErrorAction Stop).Source
$liveFfprobe = (Get-Command ffprobe -CommandType Application -ErrorAction Stop).Source
$liveDistribution = Split-Path -Parent (Split-Path -Parent $liveFfmpeg)
Copy-Item -LiteralPath $liveFfmpeg -Destination (Join-Path $liveTools 'ffmpeg.exe') -Force
Copy-Item -LiteralPath $liveFfprobe -Destination (Join-Path $liveTools 'ffprobe.exe') -Force
Copy-Item -LiteralPath (Join-Path $liveDistribution 'LICENSE') -Destination (Join-Path $liveTools 'LICENSE') -Force
Copy-Item -LiteralPath (Join-Path $liveDistribution 'README.txt') -Destination (Join-Path $liveTools 'README.txt') -Force
# Remove only the obsolete service executable when rebuilding an older layout.
# Other files in an existing release directory are preserved.
$legacyService = Join-Path $release 'NikkiSync-PC-service.exe'
if (Test-Path -LiteralPath $legacyService -PathType Leaf) { Remove-Item -LiteralPath $legacyService }
Assert-ReleaseLayout
Write-Output "NikkiSync Windows release staged at $release"
