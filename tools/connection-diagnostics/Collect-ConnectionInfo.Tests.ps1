$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Collect-ConnectionInfo.ps1') -LibraryOnly
function Assert-True($value, [string]$message) { if (-not $value) { throw $message } }
Assert-True (Test-Ipv4 '172.25.9.238') 'Legitimate 172 LAN must remain valid'
Assert-True (-not (Test-Ipv4 '10.1.2.3/token=secret')) 'Reject a URL instead of an address'
Assert-True (-not (Test-Ipv4 '127.0.0.1')) 'Reject loopback as a QR host'
Assert-True ((Get-AdapterKind 'vEthernet (Default Switch)' 'Hyper-V Virtual Ethernet Adapter' 'Ethernet') -eq 'virtual/tunnel-like') 'Recognize a retained virtual adapter'
Assert-True ((Get-AdapterKind 'custom' 'Intel wireless' 'Wireless80211') -eq 'Wi-Fi') 'Identify Wi-Fi by interface type'
$valid = ConvertTo-SafeStatus '{"service":"ready","host":"10.1.4.35","port":28080,"token":"never-export"}'
Assert-True ($valid.Host -eq '10.1.4.35' -and $valid.Port -eq 28080) 'Read advertised host from real desktop status'
Assert-True ($null -eq (ConvertTo-SafeStatus '{"service":"ready","host":"https://remote.example/?token=secret","port":28080}')) 'Do not follow a supplied URL'
$snapshot = @{
    Timestamp='fixture'; System='fixture'; Versions=@('1.0.10'); Status=$valid
    Adapters=@(@{ Kind='Wi-Fi'; State='Up'; Addresses=@(@{Address='10.1.4.35';Mask='255.255.255.0'}); Gateways=@('10.1.4.1'); Description='Private Person'; SSID='secret-network' })
    Listeners=@('0.0.0.0:28080'); Checks=@(@{ Address='10.1.4.35'; Success=$true }); RawError='password=secret'; UserName='Private Person'
}
$report = Format-ConnectionReport $snapshot
Assert-True ($report.Contains('10.1.4.35') -and $report.Contains('255.255.255.0')) 'IP and mask are useful evidence'
foreach ($private in @('never-export','Private Person','secret-network','password=secret')) { Assert-True (-not $report.Contains($private)) "Private field leaked: $private" }
Assert-True (Test-TcpPortSpec '28000-28100,443' 28080) 'Recognize a TCP port range'
Assert-True (-not (Test-TcpPortSpec '443,8080' 28080)) 'Exclude unrelated TCP ports'
$program = 'C:\Users\Private Person\runtime\current\NikkiSync-PC-service.exe'
$rules = @(
    @{Enabled=$true;Direction=1;Protocol=6;Profiles=2;Action=1;ApplicationName=$program;LocalPorts='28080'},
    @{Enabled=$true;Direction=1;Protocol=6;Profiles=4;Action=0;ApplicationName=$program;LocalPorts='*'},
    @{Enabled=$true;Direction=1;Protocol=6;Profiles=4;Action=1;ApplicationName='C:\Users\Private Person\runtime\old\NikkiSync-PC-service.exe';LocalPorts='*'},
    @{Enabled=$true;Direction=1;Protocol=6;Profiles=4;Action=1;ApplicationName='';LocalPorts='28080'},
    @{Enabled=$true;Direction=1;Protocol=6;Profiles=4;Action=1;ApplicationName=$program;LocalPorts='443'},
    @{Enabled=$false;Direction=1;Protocol=6;Profiles=4;Action=1;ApplicationName=$program;LocalPorts='28080'},
    @{Enabled=$true;Direction=2;Protocol=6;Profiles=4;Action=1;ApplicationName=$program;LocalPorts='28080'},
    @{Enabled=$true;Direction=1;Protocol=17;Profiles=4;Action=1;ApplicationName=$program;LocalPorts='28080'}
)
$publicCounts = Get-RelatedRuleCounts $rules @($program) 28080 4
Assert-True ($publicCounts.ApplicationAllow -eq 0 -and $publicCounts.ApplicationBlock -eq 1) 'Do not mistake Private/disabled/outbound/UDP/other-port rules for a current Public exception'
Assert-True ($publicCounts.PortAllow -eq 1 -and $publicCounts.OtherBackendAllow -eq 1) 'Distinguish port-wide rules and obsolete backend paths'
$privateCounts = Get-RelatedRuleCounts $rules @($program) 28080 2
Assert-True ($privateCounts.ApplicationAllow -eq 1 -and $privateCounts.ApplicationBlock -eq 0) 'Evaluate each profile separately'
$owners = @(ConvertFrom-ListenerRows @(' TCP 0.0.0.0:28080 0.0.0.0:0 LISTENING 1234',' TCP [::]:28080 [::]:0 LISTENING 1234',' TCP 10.1.4.35:28080 10.1.4.1:9999 ESTABLISHED 5678',' TCP 0.0.0.0:443 0.0.0.0:0 LISTENING 9999') 28080)
Assert-True ($owners.Count -eq 1 -and $owners[0] -eq 1234) 'Associate only listening socket owners, deduplicating IPv4/IPv6'
$snapshot.Firewall = @{ Available=$true; OwnerKnown=$true; Profiles=@(@{Kind='Public';Enabled=$true;BlockAll=$false;DefaultInbound='Block';RulesAvailable=$true;Counts=$publicCounts;ApplicationName=$program;Name='secret-network'}) }
$report = Format-ConnectionReport $snapshot
Assert-True ($report.Contains('Public: enabled=yes; block-all=no; default-inbound=Block') -and $report.Contains('application allow=0; block=1')) 'Report actionable firewall evidence'
foreach ($private in @('never-export','Private Person','secret-network','password=secret','NikkiSync-PC-service.exe')) { Assert-True (-not $report.Contains($private)) "Firewall private field leaked: $private" }
$snapshot.Firewall = @{Available=$false}
Assert-True ((Format-ConnectionReport $snapshot).Contains('Windows firewall: unavailable')) 'An inaccessible firewall must not be described as disabled or open'
Write-Output 'PASS: address validation, safe status, private-field allowlist, listener owners, firewall profiles and rule scopes'
