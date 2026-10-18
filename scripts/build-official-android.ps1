param([switch]$InitializeSigning, [string]$OutputDirectory = '', [switch]$StoreSubmission, [string]$SigningDirectory = '')
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$androidBuild = Get-Content -LiteralPath (Join-Path $root 'apps\mobile\app\build.gradle.kts') -Raw
$versionMatch = [regex]::Match($androidBuild, 'versionName\s*=\s*"([0-9]+\.[0-9]+\.[0-9]+)"')
if (!$versionMatch.Success) { throw 'Android versionName must be a numeric release version.' }
$outputVersion = $versionMatch.Groups[1].Value
if (!$OutputDirectory) { $OutputDirectory = "release\MomoCamera-$outputVersion" }
$privateDirectory = if($SigningDirectory){[IO.Path]::GetFullPath($SigningDirectory)}else{Join-Path $env:USERPROFILE '.momo-camera-signing'}
$store = Join-Path $privateDirectory 'momo-camera-release.jks'
$settings = Join-Path $privateDirectory 'signing.json'
$jdk = Join-Path $env:USERPROFILE '.jdks\jbr-17.0.14'
Add-Type -AssemblyName System.Security
if ($InitializeSigning) {
    if ((Test-Path -LiteralPath $store) -or (Test-Path -LiteralPath $settings)) { throw 'Signing already exists; preserve the existing identity.' }
    New-Item -ItemType Directory -Path $privateDirectory -Force | Out-Null
    $bytes = New-Object byte[] 48
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $password = [Convert]::ToBase64String($bytes)
    $protected = [Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($password), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
    # DPAPI binds the password to this Windows account; never put the key or password in the release folder.
    @{ alias='momo-camera'; encryptedPassword=[Convert]::ToBase64String($protected); protection='Windows DPAPI CurrentUser' } | ConvertTo-Json | Set-Content -LiteralPath $settings -Encoding UTF8
    $env:MOMO_KEYTOOL_PASSWORD = $password
    try {
        & (Join-Path $jdk 'bin\keytool.exe') -genkeypair -keystore $store -storetype JKS -alias momo-camera -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=Momo Camera Developer,O=Momo Camera,C=CN' -storepass:env MOMO_KEYTOOL_PASSWORD -keypass:env MOMO_KEYTOOL_PASSWORD
        if ($LASTEXITCODE -ne 0) { throw 'Signing key generation failed; inspect the private signing directory before retrying.' }
    } finally { Remove-Item Env:MOMO_KEYTOOL_PASSWORD -ErrorAction SilentlyContinue; $password=$null }
}
if (!(Test-Path -LiteralPath $store) -or !(Test-Path -LiteralPath $settings)) { throw 'Run with -InitializeSigning once, then preserve the private signing directory.' }
$config = Get-Content -LiteralPath $settings -Raw | ConvertFrom-Json
$plain = [Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($config.encryptedPassword), $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
$env:MOMO_RELEASE_STORE_PASSWORD = [Text.Encoding]::UTF8.GetString($plain)
$env:MOMO_RELEASE_STORE_FILE = $store
$env:MOMO_RELEASE_KEY_ALIAS = $config.alias
$env:JAVA_HOME = $jdk
$env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk'
if (![IO.Path]::IsPathRooted($OutputDirectory)) { $OutputDirectory = Join-Path $root $OutputDirectory }
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
if (!$OutputDirectory.StartsWith($root + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Release output must stay inside the workspace.' }
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
Push-Location (Join-Path $root 'apps\mobile')
try {
    $storeMode = if($StoreSubmission){'true'}else{'false'}
    & .\gradlew.bat :app:assembleRelease :app:bundleRelease "-PmomoStoreSubmission=$storeMode" --console=plain
    if ($LASTEXITCODE -ne 0) { throw 'Official Android build failed.' }
    Copy-Item -LiteralPath 'app\build\outputs\apk\release\app-release.apk' -Destination (Join-Path $OutputDirectory "MomoCamera-Android-$outputVersion.apk")
    Copy-Item -LiteralPath 'app\build\outputs\bundle\release\app-release.aab' -Destination (Join-Path $OutputDirectory "MomoCamera-Android-$outputVersion.aab")
    $certificate = Join-Path $OutputDirectory 'momo-camera-release-public.cer'
    & (Join-Path $jdk 'bin\keytool.exe') -exportcert -alias $config.alias -keystore $store -storepass:env MOMO_RELEASE_STORE_PASSWORD -file $certificate
    if ($LASTEXITCODE -ne 0) { throw 'Public certificate export failed.' }
    Write-Output "Official APK, AAB and public certificate: $OutputDirectory"
    Write-Output "Private signing key remains in $privateDirectory; keep a separate secure backup before publishing."
} finally {
    Pop-Location
    [Array]::Clear($plain,0,$plain.Length)
    Remove-Item Env:MOMO_RELEASE_STORE_PASSWORD,Env:MOMO_RELEASE_STORE_FILE,Env:MOMO_RELEASE_KEY_ALIAS -ErrorAction SilentlyContinue
}
