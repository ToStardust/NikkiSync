$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$archivePath = Join-Path $root 'out/NikkiSync-Icons-r2-to-r3-test.zip'
$output = Join-Path $root 'out/icon-update-test-feed'
$keyPath = Join-Path $env:USERPROFILE '.momo-camera-updates/update-signing.dpapi'
$publicPath = Join-Path $root 'apps/windows-shell/Assets/update-public-key.pem'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.Security.Cryptography.ProtectedData
$zip = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
    $entry = $zip.GetEntry('update.json')
    if (!$entry -or $entry.Length -gt 4194304) { throw 'Invalid delta metadata.' }
    $reader = [IO.StreamReader]::new($entry.Open(), [Text.Encoding]::UTF8)
    try { $delta = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
} finally { $zip.Dispose() }
$file = Get-Item -LiteralPath $archivePath
$feed = [ordered]@{
    Schema = 1
    AppId = 'NikkiSync.Icons'
    BaseManifestSha256 = $delta.baseManifestSha256
    TargetManifestSha256 = $delta.targetManifestSha256
    DownloadUrl = 'https://cnb.cool/nikkisync/icon-packs/-/releases/download/icons-r3-test/NikkiSync-Icons-r2-to-r3-test.zip'
    Sha256 = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    Size = $file.Length
}
$bytes = [Text.UTF8Encoding]::new($false).GetBytes(($feed | ConvertTo-Json -Depth 4))
$rsa = [Security.Cryptography.RSA]::Create()
try {
    $secret = [Security.Cryptography.ProtectedData]::Unprotect(
        [IO.File]::ReadAllBytes($keyPath), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    $read = 0
    $rsa.ImportPkcs8PrivateKey($secret, [ref]$read)
    if ($rsa.ExportSubjectPublicKeyInfoPem().Replace("`r`n", "`n").Trim() -ne
        [IO.File]::ReadAllText($publicPath).Replace("`r`n", "`n").Trim()) {
        throw 'Signing key does not match the existing update public key.'
    }
    $signature = $rsa.SignData($bytes, [Security.Cryptography.HashAlgorithmName]::SHA256,
        [Security.Cryptography.RSASignaturePadding]::Pkcs1)
    if (!$rsa.VerifyData($bytes, $signature, [Security.Cryptography.HashAlgorithmName]::SHA256,
        [Security.Cryptography.RSASignaturePadding]::Pkcs1)) { throw 'Signature verification failed.' }
    New-Item -ItemType Directory -Force -Path $output | Out-Null
    [IO.File]::WriteAllBytes((Join-Path $output 'MomoCamera-Icons-update.json'), $bytes)
    [IO.File]::WriteAllBytes((Join-Path $output 'MomoCamera-Icons-update.json.sig'), $signature)
} finally {
    if ($secret) { [Array]::Clear($secret, 0, $secret.Length) }
    $rsa.Dispose()
}
Write-Output 'Signed icon test feed verified.'
