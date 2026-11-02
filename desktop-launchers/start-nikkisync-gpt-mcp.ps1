param(
    [switch]$CheckOnly,
    [string]$WorkspacePath = (Split-Path -Parent $PSScriptRoot),
    [string]$PythonPath = '',
    [string]$SitePackagesPath = $env:NIKKISYNC_MCP_SITE_PACKAGES,
    [string]$CloudflaredPath = ''
)

$ErrorActionPreference = 'Stop'

$workspace = $WorkspacePath
$python = if ($PythonPath) { $PythonPath } else { (Get-Command python -ErrorAction SilentlyContinue).Source }
$sitePackages = $SitePackagesPath
$cloudflared = if ($CloudflaredPath) { $CloudflaredPath } else { (Get-Command cloudflared -ErrorAction SilentlyContinue).Source }
$port = 8767

function Stop-Launcher([string]$message) {
    Write-Host ''
    Write-Host $message -ForegroundColor Red
    Read-Host 'Press Enter to close'
    exit 1
}

Write-Host 'NikkiSync - GPT MCP Launcher' -ForegroundColor Cyan
Write-Host "Workspace: $workspace"
Write-Host "Local port: $port (PhotoLayout=8765, Neon Road=8766)"
Write-Host ''

if (-not (Test-Path -LiteralPath $workspace -PathType Container)) { Stop-Launcher "Workspace not found: $workspace" }
if (-not $python -or -not (Test-Path -LiteralPath $python -PathType Leaf)) { Stop-Launcher 'Python not found. Install it on PATH or pass -PythonPath.' }
if ($sitePackages -and -not (Test-Path -LiteralPath $sitePackages -PathType Container)) { Stop-Launcher "coding-tools-mcp package directory not found: $sitePackages" }
if (-not $cloudflared -or -not (Test-Path -LiteralPath $cloudflared -PathType Leaf)) { Stop-Launcher 'cloudflared not found. Install it on PATH or pass -CloudflaredPath.' }

if ($sitePackages) { $env:PYTHONPATH = $sitePackages + ';' + $env:PYTHONPATH }
& $python -c 'import coding_tools_mcp' 2>$null
if ($LASTEXITCODE -ne 0) { Stop-Launcher 'coding-tools-mcp could not be imported by the configured Python.' }

if ($CheckOnly) {
    Write-Host 'CHECK PASSED: NikkiSync workspace, Python, coding-tools-mcp, cloudflared, and port assignment are ready.' -ForegroundColor Green
    exit 0
}

$listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
    $owner = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue
    $ownerCommand = if ($owner) { [string]$owner.CommandLine } else { '' }
    $isExpectedServer = $ownerCommand.Contains('coding_tools_mcp') -and $ownerCommand.Contains($workspace)
    if (-not $isExpectedServer) { Stop-Launcher "Port $port is already used by another process. No tunnel was opened." }
    Write-Host "The NikkiSync MCP service is already listening on port $port." -ForegroundColor Yellow
    Write-Host 'Use the temporary password shown in its existing MCP window.' -ForegroundColor Yellow
} else {
    $serverScript = @"
`$Host.UI.RawUI.WindowTitle = '[1 of 2] NikkiSync - COPY OAUTH PASSWORD'
`$env:PYTHONPATH = '$sitePackages;' + `$env:PYTHONPATH
Write-Host '========== OAUTH AUTHORIZATION PASSWORD ==========' -ForegroundColor Yellow
Write-Host 'Copy the temporary password printed by the server below.' -ForegroundColor Yellow
Write-Host 'Do not save or send this password in chat.' -ForegroundColor Yellow
Write-Host ''
& '$python' -m coding_tools_mcp --workspace '$workspace' --host 127.0.0.1 --port $port --oauth-mode --permission-mode safe --enable-view-image
Read-Host 'MCP stopped. Press Enter to close'
"@
    $serverEncoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($serverScript))
    Start-Process -FilePath 'powershell.exe' -WindowStyle Normal -ArgumentList @('-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $serverEncoded)
}

for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Seconds 1
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { break }
}
if (-not (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) { Stop-Launcher 'NikkiSync MCP did not start within 30 seconds. Check the MCP window for the error.' }

$existingTunnel = Get-CimInstance Win32_Process -Filter "Name = 'cloudflared.exe'" -ErrorAction SilentlyContinue |
    Where-Object { ([string]$_.CommandLine).Contains("tunnel --url http://127.0.0.1:$port") } |
    Select-Object -First 1
if ($existingTunnel) {
    Write-Host 'A Cloudflare tunnel for NikkiSync is already running.' -ForegroundColor Yellow
    Write-Host 'Use the public address shown in its existing tunnel window.' -ForegroundColor Yellow
} else {
    $tunnelScript = @"
`$Host.UI.RawUI.WindowTitle = '[2 of 2] NikkiSync - COPY PUBLIC URL'
Write-Host '========== PUBLIC MCP ADDRESS ==========' -ForegroundColor Green
Write-Host 'Copy the real https://...trycloudflare.com address printed below, then add /mcp.' -ForegroundColor Green
Write-Host 'Keep this window open while ChatGPT is connected.' -ForegroundColor Green
Write-Host ''
& '$cloudflared' tunnel --url http://127.0.0.1:$port
Read-Host 'Tunnel stopped. Press Enter to close'
"@
    $tunnelEncoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($tunnelScript))
    Start-Process -FilePath 'powershell.exe' -WindowStyle Normal -ArgumentList @('-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $tunnelEncoded)
}

Write-Host ''
Write-Host 'NikkiSync connection windows are ready:' -ForegroundColor Cyan
Write-Host '1. MCP window: copy the temporary OAuth authorization password.'
Write-Host '2. Tunnel window: copy the current public URL and add /mcp.'
Write-Host '3. In ChatGPT, create/update the custom connector and choose OAuth.'
Write-Host '4. Keep both windows open. Close both when the work is finished.'
Write-Host ''
Read-Host 'Press Enter to close this launcher window'
