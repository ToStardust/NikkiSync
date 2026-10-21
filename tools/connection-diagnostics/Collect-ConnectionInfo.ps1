param([switch]$LibraryOnly, [string]$OutputDirectory = $PSScriptRoot)
$ErrorActionPreference = 'Stop'

function Test-Ipv4([string]$Address) {
    $parsed = $null
    if (-not [Net.IPAddress]::TryParse($Address, [ref]$parsed)) { return $false }
    if ($parsed.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { return $false }
    $bytes = $parsed.GetAddressBytes()
    return $bytes[0] -ne 0 -and $bytes[0] -ne 127 -and $bytes[0] -lt 224
}

function Get-AdapterKind([string]$Name, [string]$Description, [string]$InterfaceType) {
    if (($Name + ' ' + $Description) -match '(?i)vEthernet|Hyper-V|VMware|VirtualBox|Host-Only|WSL|Docker|Clash|Mihomo|Tailscale|WireGuard|OpenVPN|ZeroTier|Radmin|VPN|\bTUN\b|\bTAP\b') { return 'virtual/tunnel-like' }
    if ($InterfaceType -eq 'Wireless80211') { return 'Wi-Fi' }
    if ($InterfaceType -eq 'Ethernet' -or $InterfaceType -eq 'GigabitEthernet') { return 'Ethernet' }
    if ($InterfaceType -eq 'Tunnel' -or $InterfaceType -eq 'Ppp') { return 'virtual/tunnel-like' }
    return 'other'
}

function ConvertTo-SafeStatus([string]$Json) {
    try {
        $data = ConvertFrom-Json $Json
        if ($data.service -ne 'ready' -or -not (Test-Ipv4 ([string]$data.host))) { return $null }
        $port = 0
        if (-not [int]::TryParse([string]$data.port, [ref]$port) -or $port -lt 1 -or $port -gt 65535) { return $null }
        return @{Host=[string]$data.host; Port=$port}
    } catch { return $null }
}

function Get-DesktopStatus {
    $response = $null
    try {
        $request = [Net.HttpWebRequest]::Create('http://127.0.0.1:28950/api/status')
        $request.Proxy = $null; $request.AllowAutoRedirect = $false
        $request.Timeout = 1500; $request.ReadWriteTimeout = 1500
        $response = $request.GetResponse()
        $reader = New-Object IO.StreamReader($response.GetResponseStream(), [Text.Encoding]::UTF8)
        try {
            $buffer = New-Object char[] 8193
            $count = $reader.ReadBlock($buffer, 0, $buffer.Length)
            if ($count -gt 8192) { return $null }
            return ConvertTo-SafeStatus (New-Object string($buffer, 0, $count))
        } finally { $reader.Dispose() }
    } catch { return $null }
    finally { if ($null -ne $response) { $response.Dispose() } }
}

function Get-AdapterSnapshot {
    foreach ($adapter in [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
        try {
            $properties = $adapter.GetIPProperties()
            $addresses = @($properties.UnicastAddresses | Where-Object { $_.Address.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork -and $_.Address.ToString() -notmatch '^127\.' } | ForEach-Object {
                @{Address=$_.Address.ToString(); Mask=$_.IPv4Mask.ToString()}
            })
            if ($addresses.Count -eq 0) { continue }
            $gateways = @($properties.GatewayAddresses | Where-Object { $_.Address.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork } | ForEach-Object { $_.Address.ToString() })
            @{Kind=(Get-AdapterKind $adapter.Name $adapter.Description $adapter.NetworkInterfaceType.ToString()); State=$adapter.OperationalStatus.ToString(); Addresses=$addresses; Gateways=$gateways}
        } catch { }
    }
}

function Test-LocalTcp([string]$Address, [int]$Port) {
    $client = New-Object Net.Sockets.TcpClient
    $pending = $null
    try {
        $pending = $client.BeginConnect($Address, $Port, $null, $null)
        if (-not $pending.AsyncWaitHandle.WaitOne(500)) { return $false }
        $client.EndConnect($pending)
        return $client.Connected
    } catch { return $false }
    finally {
        $client.Close()
        if ($null -ne $pending) { $pending.AsyncWaitHandle.Close() }
    }
}

function Get-AssistantVersions {
    $versions = @()
    foreach ($item in @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match '^(MomoCamera|NikkiSync)' } | Select-Object -First 10)) {
        try {
            if ($item.ProcessName -match '(?i)service$') { continue }
            $version = [string]$item.MainModule.FileVersionInfo.ProductVersion
            if ($version -match '^(\d+\.\d+\.\d+(?:\.\d+)?)') { $versions += $Matches[1] }
        } catch { }
    }
    return @($versions | Sort-Object -Unique)
}

function Format-ConnectionReport($Snapshot) {
    $lines = New-Object 'Collections.Generic.List[string]'
    $lines.Add('MomoCamera connection diagnostic report v1')
    $lines.Add('Time: ' + $Snapshot.Timestamp)
    $lines.Add('OS version: ' + $Snapshot.System)
    $lines.Add('Running assistant versions: ' + (@($Snapshot.Versions) -join ', '))
    if ($null -ne $Snapshot.Status) {
        $lines.Add('Desktop status: ready')
        $lines.Add('Advertised QR endpoint: ' + $Snapshot.Status.Host + ':' + $Snapshot.Status.Port)
    } else { $lines.Add('Desktop status: unavailable (open the desktop assistant first)') }
    $lines.Add('')
    $lines.Add('Computer IPv4 adapters (names, MACs and Wi-Fi names are omitted):')
    $index = 0
    foreach ($adapter in @($Snapshot.Adapters)) {
        $index++
        $lines.Add('  Adapter #' + $index + ': ' + $adapter.Kind + ', ' + $adapter.State)
        foreach ($ip in @($adapter.Addresses)) { $lines.Add('    IPv4: ' + $ip.Address + ' / mask: ' + $ip.Mask) }
        $lines.Add('    Gateways: ' + (@($adapter.Gateways) -join ', '))
    }
    $lines.Add('')
    $lines.Add('Sync TCP listeners: ' + (@($Snapshot.Listeners) -join ', '))
    $lines.Add('Local TCP checks (from this computer only):')
    foreach ($check in @($Snapshot.Checks)) {
        $result = 'FAILED'; if ($check.Success) { $result = 'OK' }
        $lines.Add('  ' + $check.Address + ': ' + $result)
    }
    $lines.Add('')
    $lines.Add('A successful local TCP check does not prove the phone can reach the PC.')
    $lines.Add('This tool does not change firewall, VPN, adapter or routing settings.')
    $lines.Add('No photos, pairing QR/token, credentials, computer/user names or personal paths are collected.')
    return ($lines -join [Environment]::NewLine)
}

if ($LibraryOnly) { return }
$status = Get-DesktopStatus
$syncPort = 28080; if ($null -ne $status) { $syncPort = $status.Port }
$adapters = @(Get-AdapterSnapshot | Select-Object -First 24)
$listeners = @()
try { $listeners = @([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() | Where-Object { $_.Port -eq $syncPort } | ForEach-Object { $_.ToString() } | Sort-Object -Unique) } catch { }
$checks = @()
foreach ($adapter in @($adapters | Where-Object { $_.State -eq 'Up' })) {
    foreach ($ip in @($adapter.Addresses)) {
        if ($checks.Count -lt 12 -and (Test-Ipv4 $ip.Address)) { $checks += @{Address=$ip.Address; Success=(Test-LocalTcp $ip.Address $syncPort)} }
    }
}
$snapshot = @{Timestamp=[DateTimeOffset]::Now.ToString('yyyy-MM-dd HH:mm:ss zzz'); System=[Environment]::OSVersion.Version.ToString(); Versions=@(Get-AssistantVersions); Status=$status; Adapters=$adapters; Listeners=$listeners; Checks=$checks}
$report = Format-ConnectionReport $snapshot
$destination = Join-Path $OutputDirectory ('ConnectionReport-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.txt')
try {
    [IO.File]::WriteAllText($destination, $report, (New-Object Text.UTF8Encoding($true)))
    Write-Host ('Report saved: ' + [IO.Path]::GetFileName($destination))
    Write-Host 'Send this .txt file to the app developer, together with the phone Wi-Fi IP screenshot.'
} catch { Write-Host 'Could not save the report. Extract this folder to Desktop and try again.'; exit 1 }
