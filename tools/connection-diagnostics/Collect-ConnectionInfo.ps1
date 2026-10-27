param([switch]$LibraryOnly, [string]$OutputDirectory = $PSScriptRoot, [ValidateRange(1,65535)][int]$DesktopPort=28950)
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
        $request = [Net.HttpWebRequest]::Create('http://127.0.0.1:' + $DesktopPort + '/api/status')
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

function ConvertTo-SafeProfile([string]$Value) {
    if ($Value -in @('Public','Private','Domain','NotConnected')) { return $Value }
    return 'Unknown'
}

function ConvertTo-InterfaceProfileMap($Connections) {
    $result=@{}
    foreach ($connection in $Connections) {
        $index=0
        if (-not [int]::TryParse([string]$connection.InterfaceIndex,[ref]$index) -or $index -lt 1) { continue }
        $category=[string]$connection.NetworkCategory
        if ($category -eq 'DomainAuthenticated') { $category='Domain' }
        $category=ConvertTo-SafeProfile $category
        if ($result.ContainsKey($index) -and $result[$index] -ne $category) { $category='Unknown' }
        $result[$index]=$category
    }
    return $result
}

function Get-AdapterSnapshot {
    # Read once; never export network names/IDs returned by this Windows cmdlet.
    $profileMap=@{}
    try { $profileMap=ConvertTo-InterfaceProfileMap @(Get-NetConnectionProfile -ErrorAction Stop) } catch { }
    foreach ($adapter in [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
        try {
            $properties = $adapter.GetIPProperties()
            $addresses = @($properties.UnicastAddresses | Where-Object { $_.Address.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork -and $_.Address.ToString() -notmatch '^127\.' } | ForEach-Object {
                @{Address=$_.Address.ToString(); Mask=$_.IPv4Mask.ToString()}
            })
            if ($addresses.Count -eq 0) { continue }
            $gateways = @($properties.GatewayAddresses | Where-Object { $_.Address.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork } | ForEach-Object { $_.Address.ToString() })
            $profile='Unknown'
            if ($adapter.OperationalStatus.ToString() -ne 'Up') { $profile='NotConnected' }
            else { try { $interfaceIndex=$properties.GetIPv4Properties().Index; if ($profileMap.ContainsKey($interfaceIndex)) { $profile=$profileMap[$interfaceIndex] } } catch { } }
            @{Kind=(Get-AdapterKind $adapter.Name $adapter.Description $adapter.NetworkInterfaceType.ToString()); State=$adapter.OperationalStatus.ToString(); Addresses=$addresses; Gateways=$gateways; FirewallProfile=$profile}
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

function Test-TcpPortSpec([string]$Spec, [int]$Port) {
    if ([string]::IsNullOrWhiteSpace($Spec) -or $Spec -eq '*' -or $Spec -eq 'Any') { return $true }
    foreach ($part in $Spec.Split(',')) {
        $part = $part.Trim()
        if ($part -match '^([0-9]+)-([0-9]+)$') {
            if ($Port -ge [int]$Matches[1] -and $Port -le [int]$Matches[2]) { return $true }
        } elseif ($part -match '^[0-9]+$' -and [int]$part -eq $Port) { return $true }
    }
    return $false
}

function ConvertFrom-ListenerRows($Rows, [int]$Port) {
    $owners = @()
    foreach ($row in $Rows) {
        $fields = ([string]$row).Trim() -split '\s+'
        # The state label is localized on some systems; the zero remote endpoint identifies listeners.
        if ($fields.Count -ne 5 -or $fields[0] -ne 'TCP') { continue }
        if (-not $fields[1].EndsWith(':' + $Port) -or $fields[2] -notmatch '^(0\.0\.0\.0|\[::\]):0$') { continue }
        $owner = 0
        if ([int]::TryParse($fields[4], [ref]$owner) -and $owner -gt 0) { $owners += $owner }
    }
    return @($owners | Sort-Object -Unique)
}

function Get-ListenerProgramPaths([int]$Port) {
    $process = $null
    try {
        $info = New-Object Diagnostics.ProcessStartInfo
        $info.FileName = Join-Path $env:SystemRoot 'System32\netstat.exe'
        $info.Arguments = '-ano -p tcp'; $info.UseShellExecute = $false
        $info.CreateNoWindow = $true; $info.RedirectStandardOutput = $true
        $process = [Diagnostics.Process]::Start($info)
        $reading = $process.StandardOutput.ReadToEndAsync()
        if (-not $process.WaitForExit(3000)) { $process.Kill(); return }
        if ($process.ExitCode -ne 0) { return }
        foreach ($owner in @(ConvertFrom-ListenerRows ($reading.GetAwaiter().GetResult() -split '\r?\n') $Port)) {
            try {
                $item = Get-Process -Id $owner -ErrorAction Stop
                # Used only for an exact local rule comparison. Never format or export this path.
                $path = [string]$item.MainModule.FileName
                if (-not [string]::IsNullOrWhiteSpace($path)) { $path }
            } catch { }
        }
    } catch { }
    finally { if ($null -ne $process) { $process.Dispose() } }
}

function Get-AddressScope([string]$Value) {
    if ([string]::IsNullOrWhiteSpace($Value)) { return 'Unknown' }
    if ($Value -eq '*' -or $Value -eq 'Any') { return 'Any' }
    if ($Value -eq 'LocalSubnet') { return 'LocalSubnet' }
    return 'Restricted'
}

function Get-SafeRuleScope($Rule) {
    $result=@{Action='Unknown';RemoteScope='Unknown';LocalScope='Unknown';InterfaceScope='Unknown';ServiceScope='Unknown';RemotePortScope='Unknown'}
    try {
        if ($Rule.Action -eq 0) { $result.Action='Block' } elseif ($Rule.Action -eq 1) { $result.Action='Allow' }
        $result.RemoteScope=Get-AddressScope ([string]$Rule.RemoteAddresses)
        $result.LocalScope=Get-AddressScope ([string]$Rule.LocalAddresses)
        $result.RemotePortScope=Get-AddressScope ([string]$Rule.RemotePorts)
        $result.InterfaceScope='Restricted'
        if ([string]$Rule.InterfaceTypes -eq 'All' -and @($Rule.Interfaces | Where-Object {$null -ne $_ -and [string]$_ -ne ''}).Count -eq 0) { $result.InterfaceScope='All' }
        $result.ServiceScope='Bound'; if ([string]::IsNullOrEmpty([string]$Rule.ServiceName)) { $result.ServiceScope='Any' }
    } catch { }
    return $result
}

function Read-RuleField($Rule, [string]$Name) {
    try {
        if ($Rule -is [Collections.IDictionary]) {
            if (-not $Rule.Contains($Name)) { return @{Available=$false} }
            return @{Available=$true;Value=$Rule[$Name]}
        }
        $property=$Rule.PSObject.Properties[$Name]
        if ($null -eq $property) { return @{Available=$false} }
        return @{Available=$true;Value=$property.get_Value()}
    } catch { return @{Available=$false} }
}

function Get-SafeRepairAssessment($Rule, $Rules) {
    # Fixed categories only. Names, grouping text, security descriptors and paths
    # are used in memory for comparisons and must never enter the report.
    $reasons=New-Object 'Collections.Generic.List[string]'
    $fields=@{}
    foreach ($name in @('Name','Protocol','LocalAddresses','RemoteAddresses','RemotePorts','InterfaceTypes','Interfaces','ServiceName','Grouping','EdgeTraversal','LocalAppPackageId','LocalUserAuthorizedList','RemoteUserAuthorizedList','RemoteMachineAuthorizedList','EdgeTraversalOptions')) {
        $read=Read-RuleField $Rule $name
        if (-not $read.Available) { if (-not $reasons.Contains('UnreadableRepairFields')) { $reasons.Add('UnreadableRepairFields') } }
        else { $fields[$name]=$read.Value }
    }
    $protocol='Unknown'
    if ($fields.ContainsKey('Protocol')) {
        if ([int]$fields.Protocol -eq 6) { $protocol='TCP' }
        elseif ([int]$fields.Protocol -eq 256) { $protocol='Any';$reasons.Add('ProtocolNotTcp') }
        else { $protocol='Other';$reasons.Add('ProtocolNotTcp') }
    }
    foreach ($item in @(@{Field='LocalAddresses';Reason='RestrictedLocalAddresses'},@{Field='RemoteAddresses';Reason='RestrictedRemoteAddresses'},@{Field='RemotePorts';Reason='RestrictedRemotePorts'})) {
        if ($fields.ContainsKey($item.Field) -and [string]$fields[$item.Field] -cnotin @('*','Any')) { $reasons.Add($item.Reason) }
    }
    if ($fields.ContainsKey('InterfaceTypes') -and [string]$fields.InterfaceTypes -cne 'All') { $reasons.Add('RestrictedInterfaces') }
    if ($fields.ContainsKey('Interfaces')) {
        $value=$fields.Interfaces
        $restricted=if ($value -is [Array]) { $value.Length -gt 0 } else { $null -ne $value -and $value -isnot [DBNull] -and [string]$value -ne '' }
        if ($restricted -and -not $reasons.Contains('RestrictedInterfaces')) { $reasons.Add('RestrictedInterfaces') }
    }
    if ($fields.ContainsKey('ServiceName') -and [string]$fields.ServiceName -ne '') { $reasons.Add('BoundService') }
    $grouping='Unknown'
    if ($fields.ContainsKey('Grouping')) { $grouping='None';if ([string]$fields.Grouping -ne '') { $grouping='Present';$reasons.Add('GroupedRule') } }
    foreach ($name in @('LocalAppPackageId','LocalUserAuthorizedList','RemoteUserAuthorizedList','RemoteMachineAuthorizedList')) {
        if ($fields.ContainsKey($name) -and [string]$fields[$name] -ne '' -and -not $reasons.Contains('SecurityRestriction')) { $reasons.Add('SecurityRestriction') }
    }
    if (($fields.ContainsKey('EdgeTraversal') -and [bool]$fields.EdgeTraversal) -or ($fields.ContainsKey('EdgeTraversalOptions') -and [int]$fields.EdgeTraversalOptions -ne 0)) { $reasons.Add('EdgeTraversal') }
    if ($fields.ContainsKey('Name')) {
        $identity=Get-RepairIdentity $Rule
        if ($null -eq $identity) { if (-not $reasons.Contains('UnreadableRepairFields')) { $reasons.Add('UnreadableRepairFields') } }
        else {
            $duplicates=0
            foreach ($candidate in $Rules) {
                $read=Read-RuleField $candidate 'Name'
                if ($read.Available -and [string]$read.Value -ceq [string]$fields.Name -and (Get-RepairIdentity $candidate) -ceq $identity) { $duplicates++ }
            }
            if ($duplicates -ne 1) { $reasons.Add('AmbiguousRuleIdentity') }
        }
    }
    $reasons=@($reasons | Select-Object -Unique)
    $eligibility='Candidate'
    if ($reasons.Count -gt 0) { $eligibility='Skipped' }
    return @{Protocol=$protocol;Grouping=$grouping;Eligibility=$eligibility;Reasons=$reasons}
}

function Get-RepairIdentity($Rule) {
    # Internal comparison only; mirrors the Windows repair's captured identity.
    $fields=@{}
    foreach ($name in @('Name','ApplicationName','Protocol','LocalPorts','RemotePorts','LocalAddresses','RemoteAddresses','InterfaceTypes','ServiceName','Direction','Action','Grouping','Description','EdgeTraversal','Interfaces','LocalAppPackageId','LocalUserAuthorizedList','RemoteUserAuthorizedList','RemoteMachineAuthorizedList','EdgeTraversalOptions')) {
        $read=Read-RuleField $Rule $name;if (-not $read.Available) { return $null };$fields[$name]=$read.Value
    }
    try {
        $program=[Environment]::ExpandEnvironmentVariables([string]$fields.ApplicationName)
        if ($program -match '^(?:[A-Za-z]:[\\/]|\\\\)') { $program=[IO.Path]::GetFullPath($program).ToLowerInvariant() }
        $interfaces=$fields.Interfaces
        $restricted=if ($interfaces -is [Array]) { $interfaces.Length -gt 0 } else { $null -ne $interfaces -and $interfaces -isnot [DBNull] -and [string]$interfaces -ne '' }
        foreach ($name in @('LocalAppPackageId','LocalUserAuthorizedList','RemoteUserAuthorizedList','RemoteMachineAuthorizedList')) { $restricted=$restricted -or [string]$fields[$name] -ne '' }
        $restricted=$restricted -or [int]$fields.EdgeTraversalOptions -ne 0
        $localPorts='*';$remotePorts='*';if ([int]$fields.Protocol -eq 6) { $localPorts=[string]$fields.LocalPorts;$remotePorts=[string]$fields.RemotePorts }
        return (ConvertTo-Json -Compress -InputObject @([string]$fields.Name,$program,[int]$fields.Protocol,$localPorts,$remotePorts,[string]$fields.LocalAddresses,[string]$fields.RemoteAddresses,[string]$fields.InterfaceTypes,[bool]$restricted,[string]$fields.ServiceName,[int]$fields.Direction,[int]$fields.Action,[string]$fields.Grouping,[string]$fields.Description,[bool]$fields.EdgeTraversal))
    } catch { return $null }
}

function Get-RelatedRuleCounts($Rules, $ProgramPaths, [int]$Port, [int]$Profile) {
    $counts = @{ApplicationAllow=0;ApplicationBlock=0;PortAllow=0;PortBlock=0;OtherBackendAllow=0;ApplicationScopes=@()}
    foreach ($rule in $Rules) {
        try {
            if (-not $rule.Enabled -or $rule.Direction -ne 1 -or (($rule.Profiles -band $Profile) -eq 0)) { continue }
            if ($rule.Protocol -ne 6 -and $rule.Protocol -ne 256) { continue }
            $ports = '*'; if ($rule.Protocol -eq 6) { $ports = [string]$rule.LocalPorts }
            if (-not (Test-TcpPortSpec $ports $Port)) { continue }
            $program = [Environment]::ExpandEnvironmentVariables([string]$rule.ApplicationName)
            $scope = $null
            if ($program -and @($ProgramPaths).Count -gt 0 -and @($ProgramPaths) -contains $program) { $scope = 'Application' }
            elseif (($program -eq '' -or $program -eq '*') -and $ports -ne '*' -and $ports -ne 'Any' -and $ports -ne '') { $scope = 'Port' }
            elseif ($program -match '(?i)[\\/](NikkiSync|MomoCamera)-PC-service\.exe$' -and @($ProgramPaths).Count -gt 0 -and $rule.Action -eq 1) { $counts.OtherBackendAllow++ }
            if ($null -ne $scope) {
                if ($rule.Action -eq 1) { $counts[$scope + 'Allow']++ }
                elseif ($rule.Action -eq 0) { $counts[$scope + 'Block']++ }
                if ($scope -eq 'Application' -and $counts.ApplicationScopes.Count -lt 16) {
                    $safe=Get-SafeRuleScope $rule
                    if ($rule.Action -eq 0) { $safe.Repair=Get-SafeRepairAssessment $rule $Rules }
                    $counts.ApplicationScopes += @($safe)
                }
            }
        } catch { }
    }
    return $counts
}

function Get-FirewallSnapshot([int]$Port) {
    $policy = $null
    try {
        $paths = @(Get-ListenerProgramPaths $Port)
        $policy = New-Object -ComObject HNetCfg.FwPolicy2
        $active = [int]$policy.CurrentProfileTypes
        $rulesAvailable = $false; $rules = @()
        try { $rules = @($policy.Rules); $rulesAvailable = $true } catch { }
        $profiles = @()
        foreach ($profile in @(@{Kind='Domain';Flag=1},@{Kind='Private';Flag=2},@{Kind='Public';Flag=4})) {
            if (($active -band $profile.Flag) -eq 0) { continue }
            $inbound = 'Unknown'
            $action = [int]$policy.DefaultInboundAction($profile.Flag)
            if ($action -eq 0) { $inbound = 'Block' } elseif ($action -eq 1) { $inbound = 'Allow' }
            $profiles += @{Kind=$profile.Kind;Enabled=[bool]$policy.FirewallEnabled($profile.Flag);BlockAll=[bool]$policy.BlockAllInboundTraffic($profile.Flag);DefaultInbound=$inbound;RulesAvailable=$rulesAvailable;Counts=(Get-RelatedRuleCounts $rules $paths $Port $profile.Flag)}
        }
        if ($profiles.Count -eq 0) { return @{Available=$false} }
        $modify='Unknown'
        try { $state=[int]$policy.LocalPolicyModifyState;$modify=switch($state){0{'OK'}1{'GroupPolicyOverride'}2{'InboundBlocked'}default{'Unknown'}} } catch { }
        return @{Available=$true;OwnerKnown=($paths.Count -gt 0);Profiles=$profiles;ModifyState=$modify}
    } catch { return @{Available=$false} }
    finally { if ($null -ne $policy) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($policy) } }
}

function Format-ConnectionReport($Snapshot) {
    $lines = New-Object 'Collections.Generic.List[string]'
    $lines.Add('MomoCamera connection diagnostic report v5')
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
        $lines.Add('    Windows network profile: ' + (ConvertTo-SafeProfile ([string]$adapter.FirewallProfile)))
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
    if ($null -eq $Snapshot.Firewall -or -not $Snapshot.Firewall.Available) {
        $lines.Add('Windows firewall: unavailable (not evidence that the firewall is disabled)')
    } else {
        $lines.Add('Windows firewall active profiles (read-only):')
        $ownerState = 'unavailable'; if ($Snapshot.Firewall.OwnerKnown) { $ownerState = 'identified locally; path omitted' }
        $lines.Add('  TCP listener executable: ' + $ownerState)
        $modify='Unknown';if ($Snapshot.Firewall.ModifyState -in @('OK','GroupPolicyOverride','InboundBlocked')) { $modify=$Snapshot.Firewall.ModifyState }
        $lines.Add('  Local rule modification policy: ' + $modify)
        foreach ($profile in $Snapshot.Firewall.Profiles) {
            $enabled = 'no'; if ($profile.Enabled) { $enabled = 'yes' }
            $blockAll = 'no'; if ($profile.BlockAll) { $blockAll = 'yes' }
            $lines.Add('  ' + $profile.Kind + ': enabled=' + $enabled + '; block-all=' + $blockAll + '; default-inbound=' + $profile.DefaultInbound)
            if ($profile.RulesAvailable) {
                $counts = $profile.Counts
                $lines.Add('    Related enabled inbound TCP rules: application allow=' + $counts.ApplicationAllow + '; block=' + $counts.ApplicationBlock + '; port-specific allow=' + $counts.PortAllow + '; block=' + $counts.PortBlock + '; other backend paths allow=' + $counts.OtherBackendAllow)
                $ruleIndex=0
                foreach ($scope in @($counts.ApplicationScopes)) {
                    if ($null -eq $scope) { continue }; $ruleIndex++
                    $lines.Add('    Current application rule #' + $ruleIndex + ': action=' + $scope.Action + '; remote-scope=' + $scope.RemoteScope + '; local-scope=' + $scope.LocalScope + '; interface-scope=' + $scope.InterfaceScope + '; service=' + $scope.ServiceScope + '; remote-port-scope=' + $scope.RemotePortScope)
                    if ($null -ne $scope.Repair) {
                        $assessment=$scope.Repair
                        $lines.Add('      Repair check: protocol=' + $assessment.Protocol + '; grouping=' + $assessment.Grouping + '; eligibility=' + $assessment.Eligibility + '; reasons=' + (@($assessment.Reasons) -join ','))
                    }
                }
            } else { $lines.Add('    Related rules: unavailable') }
        }
        $lines.Add('Rule counts are clues, not an effective-access verdict: address/interface/service scope, policy and other security filters may apply.')
        $lines.Add('Other backend paths may belong to older or additional installs; they do not allow the current listener executable.')
        $lines.Add('An explicit matching block can override an allow. A block on another adapter profile is not proof of a conflict on this connection.')
        $lines.Add('Repair candidates still require the desktop helper to validate its backend, current profile, permissions and encrypted backup. Candidate does not mean a repair was performed.')
    }
    $lines.Add('')
    $lines.Add('A successful local TCP check does not prove the phone can reach the PC.')
    $lines.Add('This tool does not change firewall, VPN, adapter or routing settings.')
    $lines.Add('No photos, pairing QR/token, credentials, computer/user names or personal paths are included in this report.')
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
$snapshot = @{Timestamp=[DateTimeOffset]::Now.ToString('yyyy-MM-dd HH:mm:ss zzz'); System=[Environment]::OSVersion.Version.ToString(); Versions=@(Get-AssistantVersions); Status=$status; Adapters=$adapters; Listeners=$listeners; Checks=$checks; Firewall=(Get-FirewallSnapshot $syncPort)}
$report = Format-ConnectionReport $snapshot
$destination = Join-Path $OutputDirectory ('ConnectionReport-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.txt')
try {
    [IO.File]::WriteAllText($destination, $report, (New-Object Text.UTF8Encoding($true)))
    Write-Host ('Report saved: ' + [IO.Path]::GetFileName($destination))
    Write-Host 'Send this .txt file to the app developer, together with the phone Wi-Fi IP screenshot.'
} catch { Write-Host 'Could not save the report. Extract this folder to Desktop and try again.'; exit 1 }
