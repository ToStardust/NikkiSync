param([switch]$VerifyOnly)

$workspace = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$release = Join-Path $workspace 'release\NikkiSync'
$desktopHost = Join-Path $release 'NikkiSync-PC.exe'
$service = Join-Path $release 'NikkiSync-PC-service.exe'
$migration = Join-Path $release 'migrations\0001_initial.sql'

function Assert-ReleaseLayout {
  foreach ($path in @($desktopHost, $service, $migration)) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing release file: $path" }
  }
  if ((Resolve-Path -LiteralPath $desktopHost).Path -eq (Resolve-Path -LiteralPath $service).Path) { throw 'Desktop host and service must be separate executables.' }
}

if ($VerifyOnly) { Assert-ReleaseLayout; Write-Output 'NikkiSync Windows release layout verified.'; exit 0 }

New-Item -ItemType Directory -Force $release | Out-Null
New-Item -ItemType Directory -Force (Join-Path $release 'migrations') | Out-Null
Push-Location (Join-Path $workspace 'apps\pc-companion')
try {
  bun build --compile --target=bun-windows-x64 --windows-hide-console --windows-title=NikkiSyncPCService --windows-description=InfinityNikkiPhotoSyncService --outfile $service src/windows-app.ts
  if ($LASTEXITCODE -ne 0) { throw 'Bun service compilation failed.' }
} finally { Pop-Location }

dotnet publish (Join-Path $PSScriptRoot 'NikkiSync.WindowsShell.csproj') -c Release -o $release
if ($LASTEXITCODE -ne 0) { throw 'WPF desktop host publish failed.' }
$publishedHost = Join-Path $release 'NikkiSync.WindowsShell.exe'
if (-not (Test-Path -LiteralPath $publishedHost -PathType Leaf)) { throw "Published desktop host is missing: $publishedHost" }
Move-Item -LiteralPath $publishedHost -Destination $desktopHost -Force
Copy-Item -LiteralPath (Join-Path $workspace 'packages\database\migrations\0001_initial.sql') -Destination $migration -Force
Assert-ReleaseLayout
Write-Output "NikkiSync Windows release staged at $release"
