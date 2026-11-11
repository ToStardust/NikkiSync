#requires -Version 7.0
param(
    [Parameter(Mandatory)][string]$BasePack,
    [Parameter(Mandatory)][string]$OutputDirectory,
    [string]$TargetPack = '',
    [string]$SourceCatalog = '',
    [switch]$FetchSource,
    [string]$TargetVersion = '',
    [string]$SourceDirectory = '',
    [double]$DelaySeconds = 1.0,
    [switch]$AllowMissing,
    [string]$PreviousCatalog = '',
    [string]$PreviousSignature = '',
    [string]$ReleaseUrl = 'https://cnb.cool/nikkisync/icon-packs/-/releases/download/icons-update'
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$python = 'python'
$output = [IO.Path]::GetFullPath($OutputDirectory)
$allowed = [IO.Path]::GetFullPath((Join-Path $root 'out')) + [IO.Path]::DirectorySeparatorChar
if (!$output.StartsWith($allowed, [StringComparison]::OrdinalIgnoreCase) -or (Test-Path -LiteralPath $output)) {
    throw 'Choose a new output directory inside workspace/out.'
}
if ([bool]$PreviousCatalog -ne [bool]$PreviousSignature) {
    throw 'Previous catalog and its signature must be supplied together.'
}
if (([int][bool]$TargetPack + [int][bool]$SourceCatalog + [int][bool]$FetchSource) -ne 1) {
    throw 'Supply exactly one of TargetPack, SourceCatalog, or FetchSource.'
}
$basePath = (Resolve-Path -LiteralPath $BasePack).Path
$publicPath = Join-Path $root 'apps/windows-shell/Assets/update-public-key.pem'
$rsa = [Security.Cryptography.RSA]::Create()
try {
    $rsa.ImportFromPem([IO.File]::ReadAllText($publicPath))
    if ($PreviousCatalog) {
        $previousBytes = [IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $PreviousCatalog).Path)
        $previousSig = [IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $PreviousSignature).Path)
        if (!$rsa.VerifyData($previousBytes, $previousSig, [Security.Cryptography.HashAlgorithmName]::SHA256,
                [Security.Cryptography.RSASignaturePadding]::Pkcs1)) {
            throw 'Previous icon catalog signature is invalid.'
        }
    }
} finally { $rsa.Dispose() }

if (!$TargetPack) {
    $venv = Join-Path $root 'out/icon-update-venv'
    $venvPython = Join-Path $venv 'Scripts/python.exe'
    if (!(Test-Path -LiteralPath $venvPython)) {
        & python -m venv $venv
        if ($LASTEXITCODE -ne 0) { throw 'Unable to create icon builder Python environment.' }
    }
    & $venvPython -c 'import PIL' 2>$null
    if ($LASTEXITCODE -ne 0) {
        & $venvPython -m pip install --disable-pip-version-check -r (Join-Path $PSScriptRoot 'requirements.txt')
        if ($LASTEXITCODE -ne 0) { throw 'Unable to install the icon builder dependency.' }
    }
    $python = $venvPython
}

if ($FetchSource) {
    if (!$TargetVersion) { throw 'TargetVersion is required with FetchSource.' }
    Push-Location $root
    try {
        & npm run build
        if ($LASTEXITCODE -ne 0) { throw 'Building the public clothing catalog provider failed.' }
    } finally { Pop-Location }
    $SourceCatalog = $output + '.source.json'
    if (Test-Path -LiteralPath $SourceCatalog) { throw 'Refreshed source catalog already exists.' }
    & node (Join-Path $PSScriptRoot 'fetch-source-catalog.mjs') $SourceCatalog
    if ($LASTEXITCODE -ne 0) { throw 'Refreshing the public clothing catalog failed.' }
}
$targetPath = if ($TargetPack) { (Resolve-Path -LiteralPath $TargetPack).Path } else {
    if (!$TargetVersion) { throw 'TargetVersion is required with SourceCatalog.' }
    $generated = $output + '.full.zip'
    if (Test-Path -LiteralPath $generated) { throw 'Generated target pack already exists.' }
    $buildArgs = @((Join-Path $PSScriptRoot 'build_next_pack.py'), '--base', $basePath,
        '--catalog', (Resolve-Path -LiteralPath $SourceCatalog).Path, '--version', $TargetVersion,
        '--output', $generated, '--delay-seconds', "$DelaySeconds")
    if ($SourceDirectory) { $buildArgs += @('--source-directory', (Resolve-Path -LiteralPath $SourceDirectory).Path) }
    if ($AllowMissing) { $buildArgs += '--allow-missing' }
    & $python @buildArgs | Out-Host
    if ($LASTEXITCODE -eq 3) { Write-Output 'No new clothing IDs. Nothing to publish.'; return }
    if ($LASTEXITCODE -ne 0) { throw 'Target icon pack preparation failed.' }
    $generated
}
$argsList = @(
    (Join-Path $PSScriptRoot 'prepare_release.py'), '--base', $basePath,
    '--target', $targetPath, '--output', $output,
    '--release-url', $ReleaseUrl
)
if ($PreviousCatalog) { $argsList += @('--previous-catalog', (Resolve-Path -LiteralPath $PreviousCatalog).Path) }
& $python @argsList
if ($LASTEXITCODE -ne 0) { throw 'Icon release preparation failed.' }

Add-Type -AssemblyName System.Security.Cryptography.ProtectedData
$keyPath = Join-Path $env:USERPROFILE '.momo-camera-updates/update-signing.dpapi'
$catalogPath = Join-Path $output 'MomoCamera-Icons-catalog.json'
$signaturePath = $catalogPath + '.sig'
$catalogBytes = [IO.File]::ReadAllBytes($catalogPath)
$signer = [Security.Cryptography.RSA]::Create()
$verifier = [Security.Cryptography.RSA]::Create()
try {
    $secret = [Security.Cryptography.ProtectedData]::Unprotect(
        [IO.File]::ReadAllBytes($keyPath), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    $read = 0
    $signer.ImportPkcs8PrivateKey($secret, [ref]$read)
    $verifier.ImportFromPem([IO.File]::ReadAllText($publicPath))
    if ($signer.ExportSubjectPublicKeyInfoPem().Replace("`r`n", "`n").Trim() -ne
        [IO.File]::ReadAllText($publicPath).Replace("`r`n", "`n").Trim()) {
        throw 'Icon catalog signing key does not match the installed clients.'
    }
    $signature = $signer.SignData($catalogBytes, [Security.Cryptography.HashAlgorithmName]::SHA256,
        [Security.Cryptography.RSASignaturePadding]::Pkcs1)
    if (!$verifier.VerifyData($catalogBytes, $signature, [Security.Cryptography.HashAlgorithmName]::SHA256,
            [Security.Cryptography.RSASignaturePadding]::Pkcs1)) { throw 'Icon catalog signature verification failed.' }
    [IO.File]::WriteAllBytes($signaturePath, $signature)
} finally {
    if ($secret) { [Array]::Clear($secret, 0, $secret.Length) }
    $signer.Dispose()
    $verifier.Dispose()
}
$reportPath = Join-Path $output 'publish-report.json'
$report = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
$report | Add-Member -NotePropertyName fullPack -NotePropertyValue $targetPath
$report | Add-Member -NotePropertyName catalogSha256 -NotePropertyValue ((Get-FileHash -LiteralPath $catalogPath -Algorithm SHA256).Hash.ToLowerInvariant())
$report | Add-Member -NotePropertyName signatureSha256 -NotePropertyValue ((Get-FileHash -LiteralPath $signaturePath -Algorithm SHA256).Hash.ToLowerInvariant())
[IO.File]::WriteAllText($reportPath, ($report | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
Write-Output "Prepared and signed icon update $($report.baseVersion) -> $($report.targetVersion) ($($report.newOrChangedImages) images)."
Write-Output "Upload in order: $($report.uploadOrder -join ', ')"
