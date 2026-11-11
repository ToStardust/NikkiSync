#requires -Version 7.0
param(
    [Parameter(Mandatory)][string]$PreparedDirectory,
    [string]$ReleaseUrl = 'https://cnb.cool/nikkisync/icon-packs/-/releases/download/icons-update'
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$prepared = (Resolve-Path -LiteralPath $PreparedDirectory).Path
$report = Get-Content -LiteralPath (Join-Path $prepared 'publish-report.json') -Raw | ConvertFrom-Json
$url = [Uri]$ReleaseUrl
if ($url.Scheme -ne 'https' -or $url.Host -ne 'cnb.cool' -or
    !$url.AbsolutePath.EndsWith('/icons-update') -or $url.Query -or $url.Fragment) {
    throw 'The public verification URL must be the fixed CNB icons-update release.'
}
$download = Join-Path $root ('out/icon-public-verify-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $download | Out-Null
foreach ($name in @($report.uploadOrder)) {
    if ($name -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,180}$') { throw 'Invalid release asset name.' }
    $target = Join-Path $download $name
    $status = & curl.exe --noproxy '*' --location --fail --silent --show-error --output $target --write-out '%{http_code}' ($ReleaseUrl.TrimEnd('/') + '/' + $name)
    if ($LASTEXITCODE -ne 0 -or $status -ne '200') { throw "Public download failed for $name." }
    $localHash = (Get-FileHash -LiteralPath (Join-Path $prepared $name) -Algorithm SHA256).Hash
    $remoteHash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
    if ($localHash -ne $remoteHash) { throw "Public download differs from the signed artifact: $name" }
}
$publicKey = Join-Path $root 'apps/windows-shell/Assets/update-public-key.pem'
$rsa = [Security.Cryptography.RSA]::Create()
try {
    $rsa.ImportFromPem([IO.File]::ReadAllText($publicKey))
    $catalog = [IO.File]::ReadAllBytes((Join-Path $download 'MomoCamera-Icons-catalog.json'))
    $signature = [IO.File]::ReadAllBytes((Join-Path $download 'MomoCamera-Icons-catalog.json.sig'))
    if (!$rsa.VerifyData($catalog, $signature, [Security.Cryptography.HashAlgorithmName]::SHA256,
            [Security.Cryptography.RSASignaturePadding]::Pkcs1)) { throw 'Public icon catalog signature is invalid.' }
} finally { $rsa.Dispose() }
Write-Output "Verified anonymous CNB downloads: $(@($report.uploadOrder).Count) assets."
Write-Output "Target icon manifest: $($report.targetManifestSha256)"
