param(
  [switch]$InitializeSigning,
  [string]$Executable = '', [string]$OutputDirectory = '',
  [string]$Version = '1.0.1', [long]$Build = 2026101801,
  [string]$DownloadUrl = '', [string]$Notes = '大喵相机助手公测更新',
  [string]$Channel = 'public-beta', [string[]]$BaseExecutable = @(), [switch]$LegacyManifest
)
$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$keyDirectory = Join-Path $env:USERPROFILE '.momo-camera-updates'
$keyPath = Join-Path $keyDirectory 'update-signing.dpapi'
$publicPath = Join-Path $workspace 'apps\windows-shell\Assets\update-public-key.pem'
Add-Type -AssemblyName System.Security.Cryptography.ProtectedData
if ($InitializeSigning) {
  if ((Test-Path -LiteralPath $keyPath) -or (Test-Path -LiteralPath $publicPath)) { throw 'Update signing identity already exists. Restore the original private key; never rotate the public key of distributed clients.' }
  New-Item -ItemType Directory -Force $keyDirectory | Out-Null
  $rsa = [Security.Cryptography.RSA]::Create(3072)
  try {
    $secret = $rsa.ExportPkcs8PrivateKey()
    $protected = [Security.Cryptography.ProtectedData]::Protect($secret, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    [IO.File]::WriteAllBytes($keyPath, $protected)
    # Generated PUBLIC build artifact only. The private key never enters the project.
    [IO.File]::WriteAllText($publicPath, $rsa.ExportSubjectPublicKeyInfoPem(), [Text.UTF8Encoding]::new($false))
  } finally { if ($secret) { [Array]::Clear($secret, 0, $secret.Length) }; $rsa.Dispose() }
  Write-Output 'Update signing initialized. Public key exported; private key protected for this Windows user.'
  exit
}
if (-not (Test-Path -LiteralPath $keyPath)) { throw 'Initialize update signing once before building the first public beta.' }
$exe = (Resolve-Path -LiteralPath $Executable).Path
$output = [IO.Path]::GetFullPath($OutputDirectory)
$releaseRoot = [IO.Path]::GetFullPath((Join-Path $workspace 'release')) + '\'
if (-not $exe.StartsWith($releaseRoot, [StringComparison]::OrdinalIgnoreCase) -or -not $output.StartsWith($releaseRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Update artifacts must be inside workspace/release.' }
if (([Uri]$DownloadUrl).Scheme -ne 'https' -or $Build -lt 1 -or $Channel -notin @('public-beta','stable')) { throw 'Invalid update release metadata.' }
$info = [Diagnostics.FileVersionInfo]::GetVersionInfo($exe)
if ($info.ProductVersion.Split('+')[0] -ne $Version) { throw 'EXE and update manifest versions differ.' }
New-Item -ItemType Directory -Force $output | Out-Null
$metadataPath = Join-Path $output 'release-metadata.json'
$describe = [Diagnostics.ProcessStartInfo]::new($exe)
$describe.UseShellExecute=$false; $describe.CreateNoWindow=$true
$describe.ArgumentList.Add('--release-info'); $describe.ArgumentList.Add($metadataPath)
$process=[Diagnostics.Process]::Start($describe)
try { if(-not $process.WaitForExit(120000)){ $process.Kill($true); throw 'EXE release metadata timed out.' }; if($process.ExitCode -ne 0){throw 'EXE release metadata failed.'} } finally {$process.Dispose()}
$metadata=Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
if($metadata.version -ne $Version -or $metadata.build -ne $Build){throw 'EXE and update manifest build identifiers differ.'}
$manifest = [ordered]@{ Schema=$(if ($LegacyManifest) { 1 } else { 2 }); AppId='MomoCamera.Windows'; Version=$Version; Build=$Build; Channel=$Channel; Notes=$Notes; DownloadUrl=$DownloadUrl; Sha256=(Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash; Size=(Get-Item -LiteralPath $exe).Length }
if (-not $LegacyManifest) { $manifest.Deltas = @() }
if ($LegacyManifest -and $BaseExecutable.Count -gt 0) { throw 'Legacy manifest cannot advertise delta patches.' }
if ($BaseExecutable.Count -gt 8) { throw 'At most eight base executables are supported.' }
$seenBuilds = [Collections.Generic.HashSet[long]]::new()
$deltas = [Collections.Generic.List[object]]::new()
foreach ($baseInput in $BaseExecutable) {
  $base = (Resolve-Path -LiteralPath $baseInput).Path
  if (-not $base.StartsWith($releaseRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Base EXE must be inside workspace/release.' }
  $baseMetadataPath = Join-Path $output ("base-release-metadata-$($deltas.Count).json")
  $baseInfo = [Diagnostics.ProcessStartInfo]::new($base)
  $baseInfo.UseShellExecute=$false; $baseInfo.CreateNoWindow=$true
  $baseInfo.ArgumentList.Add('--release-info'); $baseInfo.ArgumentList.Add($baseMetadataPath)
  $baseProcess=[Diagnostics.Process]::Start($baseInfo)
  try { if(-not $baseProcess.WaitForExit(120000)){ $baseProcess.Kill($true); throw 'Base EXE release metadata timed out.' }; if($baseProcess.ExitCode -ne 0){throw 'Base EXE release metadata failed.'} } finally {$baseProcess.Dispose()}
  $baseMetadata=Get-Content -LiteralPath $baseMetadataPath -Raw | ConvertFrom-Json
  if ([long]$baseMetadata.build -ge $Build) { throw 'Base build must be older than target build.' }
  if (-not $seenBuilds.Add([long]$baseMetadata.build)) { throw 'Duplicate base build.' }
  $tool = Join-Path $workspace 'assets\tools\xdelta3\xdelta3.exe'
  if ((Get-FileHash -LiteralPath $tool -Algorithm SHA256).Hash -ne '732980D52F9220DC81817CCDD0C295EADCE8A0048A24C2A771A73F791AC824E9') { throw 'Unreviewed xdelta3 executable.' }
  $patchName = "MomoCamera-Windows-from-$($baseMetadata.build)-to-$Build.xdelta3"
  $patch = Join-Path $output $patchName
  & $tool -e -s $base $exe $patch
  if ($LASTEXITCODE -ne 0) { throw 'xdelta3 patch creation failed.' }
  $patchSize = (Get-Item -LiteralPath $patch).Length
  if ($patchSize -ge [math]::Floor($manifest.Size * 0.9)) {
    Remove-Item -LiteralPath $patch
    Write-Output 'Patch omitted because it saves less than 10% versus the full EXE.'
  } else {
    $reconstructed = Join-Path $output 'reconstructed-test.exe'
    try {
      & $tool -d -s $base $patch $reconstructed
      if ($LASTEXITCODE -ne 0 -or (Get-FileHash -LiteralPath $reconstructed -Algorithm SHA256).Hash -ne $manifest.Sha256) { throw 'Patch round-trip did not reproduce the exact target EXE.' }
    } finally { if (Test-Path -LiteralPath $reconstructed) { Remove-Item -LiteralPath $reconstructed } }
    $patchUrl = [Uri]::new([Uri]$DownloadUrl, [Uri]::EscapeDataString($patchName)).AbsoluteUri
    $deltas.Add([ordered]@{ BaseBuild=[long]$baseMetadata.build; BaseSha256=(Get-FileHash -LiteralPath $base -Algorithm SHA256).Hash; DownloadUrl=$patchUrl; Sha256=(Get-FileHash -LiteralPath $patch -Algorithm SHA256).Hash; Size=$patchSize; Algorithm='xdelta3-vcdiff' })
    Write-Output "Verified exact patch: $patchSize bytes, from build $($baseMetadata.build)."
  }
}
if (-not $LegacyManifest) { $manifest.Deltas = $deltas.ToArray() }
$bytes = [Text.UTF8Encoding]::new($false).GetBytes(($manifest | ConvertTo-Json -Depth 5))
$rsa = [Security.Cryptography.RSA]::Create()
try {
  $secret = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($keyPath), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  $read = 0; $rsa.ImportPkcs8PrivateKey($secret, [ref]$read)
  if ($rsa.ExportSubjectPublicKeyInfoPem().Replace("`r`n","`n").Trim() -ne [IO.File]::ReadAllText($publicPath).Replace("`r`n","`n").Trim()) { throw 'Update signing key does not match the embedded public key.' }
  $signature = $rsa.SignData($bytes, [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)
  [IO.File]::WriteAllBytes((Join-Path $output 'MomoCamera-Windows-update.json'), $bytes)
  [IO.File]::WriteAllBytes((Join-Path $output 'MomoCamera-Windows-update.json.sig'), $signature)
} finally { if ($secret) { [Array]::Clear($secret, 0, $secret.Length) }; $rsa.Dispose() }
Write-Output 'Signed update manifest and detached signature created.'
