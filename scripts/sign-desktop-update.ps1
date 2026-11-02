param(
  [switch]$InitializeSigning,
  [string]$Executable = '', [string]$OutputDirectory = '',
  [string]$Version = '1.0.1', [long]$Build = 2026101801,
  [string]$DownloadUrl = '', [string]$Notes = '大喵相机助手公测更新',
  [string]$Channel = 'public-beta'
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
try { if(-not $process.WaitForExit(15000)){ $process.Kill($true); throw 'EXE release metadata timed out.' }; if($process.ExitCode -ne 0){throw 'EXE release metadata failed.'} } finally {$process.Dispose()}
$metadata=Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
if($metadata.version -ne $Version -or $metadata.build -ne $Build){throw 'EXE and update manifest build identifiers differ.'}
$manifest = [ordered]@{ Schema=1; AppId='MomoCamera.Windows'; Version=$Version; Build=$Build; Channel=$Channel; Notes=$Notes; DownloadUrl=$DownloadUrl; Sha256=(Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash; Size=(Get-Item -LiteralPath $exe).Length }
$bytes = [Text.UTF8Encoding]::new($false).GetBytes(($manifest | ConvertTo-Json -Depth 3))
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
