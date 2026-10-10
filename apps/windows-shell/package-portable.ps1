param([string]$OutputDirectory = 'release\NikkiSync-Portable', [string]$AndroidApk = 'release\NikkiSync\NikkiSync-Android.apk', [string]$BunExecutable = 'bun')

$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if ($BunExecutable -ne 'bun') { $BunExecutable = (Resolve-Path -LiteralPath $BunExecutable).Path }
$releaseRoot = [IO.Path]::GetFullPath((Join-Path $workspace 'release'))
$release = [IO.Path]::GetFullPath((Join-Path $workspace $OutputDirectory))
if (-not $release.StartsWith($releaseRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Output must be inside workspace/release.' }
if ((Test-Path -LiteralPath $release) -and @(Get-ChildItem -LiteralPath $release -Force).Count -gt 0) { throw 'Choose a new empty output directory; used releases can contain private browser data.' }
$apk = [IO.Path]::GetFullPath((Join-Path $workspace $AndroidApk))
if (-not $apk.StartsWith($releaseRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $apk -PathType Leaf)) { throw 'An existing signed release APK is required.' }
# Clean allowlisted staging only. Never copy a release tree, AppData, browser profile or game data.
$build = Join-Path $workspace ('out\portable-build-' + [Guid]::NewGuid().ToString('N'))
$payload = Join-Path $build 'payload'
$published = Join-Path $build 'published'
New-Item -ItemType Directory -Force $payload | Out-Null
New-Item -ItemType Directory -Force (Join-Path $payload 'runtime') | Out-Null
Push-Location $workspace
try {
  npm run build
  if ($LASTEXITCODE -ne 0) { throw 'Project build failed.' }
  dotnet restore (Join-Path $PSScriptRoot 'NikkiSync.WindowsShell.csproj') -r win-x64 -p:SelfContained=true -p:PublishSingleFile=true
  if ($LASTEXITCODE -ne 0) { throw 'Runtime dependency restore failed.' }
  & (Join-Path $workspace 'scripts\build-service-icon.ps1')
  Push-Location (Join-Path $workspace 'apps\pc-companion')
  try {
    & $BunExecutable build --compile --compile-exec-argv="--smol" --target=bun-windows-x64-baseline --windows-hide-console --windows-icon (Join-Path $PSScriptRoot 'Assets\service.ico') --windows-title=NikkiSyncPCService --windows-description=InfinityNikkiPhotoSyncBackgroundService --outfile (Join-Path $payload 'runtime\NikkiSync-PC-service.exe') src/windows-app.ts
    if ($LASTEXITCODE -ne 0) { throw 'Service compilation failed.' }
  } finally { Pop-Location }
  $sources = [ordered]@{
    'runtime/migrations/0001_initial.sql' = 'packages\database\migrations\0001_initial.sql'
    'runtime/wechat/resize-preview.ps1' = 'tools\wechat-gallery\resize-preview.ps1'
    'runtime/wechat/rotate-png.ps1' = 'tools\wechat-gallery\rotate-png.ps1'
    'runtime/wechat/resize-icon.ps1' = 'tools\wechat-gallery\resize-icon.ps1'
    'runtime/wechat/THIRD_PARTY_LICENSES.txt' = 'apps\wechat-mini-program\miniprogram\lib\THIRD_PARTY_LICENSES.txt'
    'runtime/wechat/THIRD_PARTY.md' = 'apps\wechat-mini-program\miniprogram\lib\THIRD_PARTY.md'
    'runtime/branding/momo-camera.png' = 'assets\branding\momo-camera.png'
    'runtime/PORTABLE_NOTICES.md' = 'apps\windows-shell\PORTABLE_NOTICES.md'
    'runtime/licenses/BUN-LICENSE.md' = 'assets\licenses\BUN-LICENSE.md'
    'runtime/licenses/qrcode-LICENSE' = 'node_modules\qrcode\license'
    'runtime/licenses/dijkstrajs-LICENSE' = 'node_modules\dijkstrajs\LICENSE.md'
    'runtime/licenses/pngjs-LICENSE' = 'node_modules\pngjs\LICENSE'
  }
  foreach ($entry in $sources.GetEnumerator()) {
    $destination = Join-Path $payload $entry.Key
    New-Item -ItemType Directory -Force (Split-Path -Parent $destination) | Out-Null
    Copy-Item -LiteralPath (Join-Path $workspace $entry.Value) -Destination $destination
  }
  Copy-Item -LiteralPath $apk -Destination (Join-Path $payload 'runtime\NikkiSync-Android.apk')
  $assets = Get-Content (Join-Path $PSScriptRoot 'obj\project.assets.json') -Raw | ConvertFrom-Json
  $packageRoots = @($assets.packageFolders.PSObject.Properties.Name)
  $downloads = @($assets.project.frameworks.PSObject.Properties.Value.downloadDependencies)
  foreach ($dependency in $downloads | Where-Object { $_.name -match '^Microsoft\.(NETCore|WindowsDesktop)\.App\.Runtime\.win-x64$' }) {
    $version = $dependency.version.Trim('[', ']') -split ',' | Select-Object -First 1
    $relativePackage = $dependency.name.ToLowerInvariant() + '\' + $version.Trim()
    $directory = @($packageRoots | ForEach-Object { Join-Path $_ $relativePackage } | Where-Object { Test-Path -LiteralPath $_ -PathType Container }) | Select-Object -First 1
    if (-not $directory) { throw 'Missing runtime license source.' }
    foreach ($notice in Get-ChildItem -LiteralPath $directory -File | Where-Object Name -Match '^(LICENSE|THIRD-PARTY-NOTICES)') {
      Copy-Item -LiteralPath $notice.FullName -Destination (Join-Path $payload ('runtime\licenses\' + $dependency.name + '-' + $notice.Name))
    }
  }
  $webviewPackage = $assets.libraries.PSObject.Properties.Name | Where-Object { $_ -like 'Microsoft.Web.WebView2/*' } | Select-Object -First 1
  $webviewDirectory = @($packageRoots | ForEach-Object { Join-Path $_ $webviewPackage.ToLowerInvariant().Replace('/', '\') } | Where-Object { Test-Path -LiteralPath $_ -PathType Container }) | Select-Object -First 1
  foreach ($name in @('LICENSE.txt', 'NOTICE.txt')) {
    Copy-Item -LiteralPath (Join-Path $webviewDirectory $name) -Destination (Join-Path $payload ('runtime\licenses\WebView2-' + $name))
  }
  Add-Type -AssemblyName System.IO.Compression
  $files = @(Get-ChildItem -LiteralPath (Join-Path $payload 'runtime') -File -Recurse | Sort-Object FullName)
  $manifestFiles = @()
  $archivePath = Join-Path $payload 'runtime.zip'
  $zipStream = [IO.File]::Open($archivePath, [IO.FileMode]::CreateNew)
  $zip = New-Object IO.Compression.ZipArchive($zipStream, [IO.Compression.ZipArchiveMode]::Create)
  try {
    foreach ($file in $files) {
      $relative = $file.FullName.Substring($payload.Length + 1).Replace('\', '/')
      $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
      $manifestFiles += @{ Path = $relative; Length = $file.Length; Sha256 = $hash }
      $entry = $zip.CreateEntry($relative, [IO.Compression.CompressionLevel]::Optimal)
      $input = [IO.File]::OpenRead($file.FullName)
      $output = $entry.Open()
      try { $input.CopyTo($output) } finally { $input.Dispose(); $output.Dispose() }
    }
  } finally { $zip.Dispose(); $zipStream.Dispose() }
  $manifest = @{ ArchiveSha256 = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash; Files = $manifestFiles }
  [IO.File]::WriteAllText((Join-Path $payload 'runtime.json'), ($manifest | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))
  dotnet publish (Join-Path $PSScriptRoot 'NikkiSync.WindowsShell.csproj') --no-restore -c Release -r win-x64 --self-contained true -o $published -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:EnableCompressionInSingleFile=true -p:DebugType=None -p:DebugSymbols=false "-p:PortablePayloadDirectory=$payload"
  if ($LASTEXITCODE -ne 0) { throw 'Self-contained host publish failed.' }
  $hostExe = Join-Path $published 'NikkiSync.WindowsShell.exe'
  if (-not (Test-Path -LiteralPath $hostExe -PathType Leaf)) { throw 'Missing published host.' }
  $looseFiles = @(Get-ChildItem -LiteralPath $published -File -Recurse | Where-Object { $_.FullName -ne $hostExe -and $_.Extension -ne '.xml' })
  if ($looseFiles.Count) { throw ('Unbundled dependency: ' + ($looseFiles.Name -join ', ')) }
  New-Item -ItemType Directory -Force $release | Out-Null
  $final = Join-Path $release 'NikkiSync-PC.exe'
  Copy-Item -LiteralPath $hostExe -Destination $final
  if (@(Get-ChildItem -LiteralPath $release -Force).Count -ne 1) { throw 'Portable output must contain exactly one file.' }
  [IO.File]::WriteAllText((Join-Path $build 'build-report.json'), (@{ executable = $final; bytes = (Get-Item -LiteralPath $final).Length; sha256 = (Get-FileHash -LiteralPath $final).Hash; androidSha256 = (Get-FileHash -LiteralPath $apk).Hash; manifest = $manifest } | ConvertTo-Json -Depth 8))
  Write-Output "Portable executable: $final"
  Write-Output "Build report: $build\build-report.json"
} finally { Pop-Location }
