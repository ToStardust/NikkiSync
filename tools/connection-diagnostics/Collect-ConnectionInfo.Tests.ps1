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
Write-Output 'PASS: address validation, virtual hints, safe status, report allowlist'
