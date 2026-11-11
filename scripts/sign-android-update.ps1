#requires -Version 7.0
param(
    [Parameter(Mandatory)][string]$Apk,
    [Parameter(Mandatory)][string]$OutputDirectory,
    [ValidateLength(0,2000)][string]$Notes = ''
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$file = Get-Item -LiteralPath $Apk
$output = [IO.Path]::GetFullPath($OutputDirectory)
if (!$output.StartsWith($root + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) {
    throw 'Feed output must stay inside the workspace.'
}
$apkName = [regex]::Match($file.Name,'^MomoCamera-Android-([0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4})\.apk$')
if ($file.PSIsContainer -or !$apkName.Success -or
    $file.Length -lt 1 -or $file.Length -gt 200MB) { throw 'Invalid Android update APK.' }
$version = $apkName.Groups[1].Value
$env:JAVA_HOME = Join-Path $env:USERPROFILE '.jdks/jbr-17.0.14'
$buildTools = Join-Path $env:LOCALAPPDATA 'Android/Sdk/build-tools/35.0.1'
$signed = & (Join-Path $buildTools 'apksigner.bat') verify --print-certs $file.FullName
if ($LASTEXITCODE -ne 0 -or $signed -notcontains 'Signer #1 certificate SHA-256 digest: acaebeb600159243dd0df7cb70275848a71a21c2f1051e3a16086ec8adbfe5fb') {
    throw 'APK does not use the existing Android release identity.'
}
$metadata = & (Join-Path $buildTools 'aapt2.exe') dump badging $file.FullName
if ($LASTEXITCODE -ne 0) { throw 'Could not read APK metadata.' }
$package = [regex]::Match(($metadata -join "`n"), "(?m)^package: name='app\.nikkisync\.mobile' versionCode='([1-9][0-9]{0,9})' versionName='([0-9.]+)'")
if (!$package.Success -or $package.Groups[2].Value -ne $version) { throw 'APK version or application ID does not match.' }
$feed = [ordered]@{
    Schema = 1
    AppId = 'app.nikkisync.mobile'
    Version = $version
    VersionCode = [int]$package.Groups[1].Value
    DownloadUrl = "https://cnb.cool/nikkisync/icon-packs/-/releases/download/android-update-test/$($file.Name)"
    Sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    Size = $file.Length
    Notes = $Notes
}
$bytes = [Text.UTF8Encoding]::new($false).GetBytes(($feed | ConvertTo-Json))
Add-Type -AssemblyName System.Security.Cryptography.ProtectedData
$keyPath = Join-Path $env:USERPROFILE '.momo-camera-updates/update-signing.dpapi'
$publicPath = Join-Path $root 'apps/windows-shell/Assets/update-public-key.pem'
$rsa = [Security.Cryptography.RSA]::Create()
try {
    $secret = [Security.Cryptography.ProtectedData]::Unprotect(
        [IO.File]::ReadAllBytes($keyPath), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    $read = 0
    $rsa.ImportPkcs8PrivateKey($secret, [ref]$read)
    if ($rsa.ExportSubjectPublicKeyInfoPem().Replace("`r`n","`n").Trim() -ne
        [IO.File]::ReadAllText($publicPath).Replace("`r`n","`n").Trim()) { throw 'Update key mismatch.' }
    $signature = $rsa.SignData($bytes,[Security.Cryptography.HashAlgorithmName]::SHA256,
        [Security.Cryptography.RSASignaturePadding]::Pkcs1)
    if (!$rsa.VerifyData($bytes,$signature,[Security.Cryptography.HashAlgorithmName]::SHA256,
        [Security.Cryptography.RSASignaturePadding]::Pkcs1)) { throw 'Update signature verification failed.' }
    New-Item -ItemType Directory -Force -Path $output | Out-Null
    [IO.File]::WriteAllBytes((Join-Path $output 'MomoCamera-Android-update.json'),$bytes)
    [IO.File]::WriteAllBytes((Join-Path $output 'MomoCamera-Android-update.json.sig'),$signature)
} finally {
    if ($secret) { [Array]::Clear($secret,0,$secret.Length) }
    $rsa.Dispose()
}
Write-Output "Verified signed Android feed for $version ($($feed.VersionCode))"
