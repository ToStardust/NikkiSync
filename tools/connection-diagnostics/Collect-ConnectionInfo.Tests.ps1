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
$profileMap=ConvertTo-InterfaceProfileMap @(
    @{InterfaceIndex=7;NetworkCategory='Public';Name='secret-network'},
    @{InterfaceIndex=9;NetworkCategory='Private'},
    @{InterfaceIndex=10;NetworkCategory='DomainAuthenticated'},
    @{InterfaceIndex=11;NetworkCategory='secret-network'},
    @{InterfaceIndex=12;NetworkCategory='Private'},@{InterfaceIndex=12;NetworkCategory='Public'}
)
Assert-True ($profileMap[7] -eq 'Public' -and $profileMap[9] -eq 'Private' -and $profileMap[10] -eq 'Domain') 'Associate profiles with their own interface, not the global active profile mask'
Assert-True ($profileMap[11] -eq 'Unknown' -and $profileMap[12] -eq 'Unknown') 'Unknown and ambiguous profile data cannot imply Public or Private'
$scopedRule=@{Enabled=$true;Direction=1;Protocol=6;Profiles=4;Action=0;ApplicationName=$program;LocalPorts='*';RemoteAddresses='*';LocalAddresses='*';RemotePorts='*';InterfaceTypes='All';Interfaces=$null;ServiceName='';Name='Private Person'}
$scopeCounts=Get-RelatedRuleCounts @($scopedRule) @($program) 28080 4
Assert-True ($scopeCounts.ApplicationScopes.Count -eq 1 -and $scopeCounts.ApplicationScopes[0].RemoteScope -eq 'Any') 'Summarize scope for the exact current listener executable'
$scopedRule.RemoteAddresses='10.9.8.7';$scopedRule.LocalAddresses='10.9.8.8';$scopedRule.ServiceName='secret-service';$scopedRule.Interfaces=@('secret-interface')
$restricted=Get-RelatedRuleCounts @($scopedRule) @($program) 28080 4
Assert-True ($restricted.ApplicationScopes[0].RemoteScope -eq 'Restricted' -and $restricted.ApplicationScopes[0].ServiceScope -eq 'Bound' -and $restricted.ApplicationScopes[0].InterfaceScope -eq 'Restricted') 'Do not mistake a scoped rule for an unrestricted conflict'
$snapshot.Adapters[0].FirewallProfile=$profileMap[7]
$snapshot.Firewall=@{Available=$true;OwnerKnown=$true;Profiles=@(@{Kind='Public';Enabled=$true;BlockAll=$false;DefaultInbound='Block';RulesAvailable=$true;Counts=$restricted})}
$report=Format-ConnectionReport $snapshot
Assert-True ($report.Contains('Windows network profile: Public') -and $report.Contains('action=Block; remote-scope=Restricted')) 'Report the per-adapter profile and sanitized rule scope'
foreach($private in @('Private Person','secret-network','secret-service','secret-interface','10.9.8.7','10.9.8.8',$program)){Assert-True (-not $report.Contains($private)) 'New scope diagnostics must not leak names, rule addresses or paths'}
$snapshot.Adapters[0].FirewallProfile='secret-network'
Assert-True ((Format-ConnectionReport $snapshot).Contains('Windows network profile: Unknown')) 'Profile output uses a fixed allowlist'
$collectorSource=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'Collect-ConnectionInfo.ps1') -Raw
Assert-True ($collectorSource -notmatch '(?i)\b(Set|Remove|Disable|Enable|New)-Net(Firewall|Connection|Adapter|Route)|\.Rules\.(Add|Remove)\s*\(') 'Diagnostics must not mutate network or firewall rules'
function New-RepairFixture {
    return @{Enabled=$true;Direction=1;Protocol=6;Profiles=4;Action=0;ApplicationName=$program;LocalPorts='*';RemoteAddresses='*';LocalAddresses='*';RemotePorts='*';InterfaceTypes='All';Interfaces=$null;ServiceName='';Name='private-rule-name';Description='';Grouping='';EdgeTraversal=$false;LocalAppPackageId='';LocalUserAuthorizedList='';RemoteUserAuthorizedList='';RemoteMachineAuthorizedList='';EdgeTraversalOptions=0}
}
$simple=New-RepairFixture
$assessment=Get-SafeRepairAssessment $simple @($simple)
Assert-True ($assessment.Eligibility -eq 'Candidate' -and $assessment.Reasons.Count -eq 0) 'Ordinary TCP block is a candidate, without claiming repair happened'
$allProtocol=New-RepairFixture;$allProtocol.Protocol=256
$assessment=Get-SafeRepairAssessment $allProtocol @($allProtocol)
Assert-True ($assessment.Protocol -eq 'Any' -and $assessment.Reasons -contains 'ProtocolNotTcp') 'Explain why all-protocol rules are not repaired as TCP-only blocks'
$grouped=New-RepairFixture;$grouped.Grouping='secret-network'
$assessment=Get-SafeRepairAssessment $grouped @($grouped)
Assert-True ($assessment.Grouping -eq 'Present' -and $assessment.Reasons -contains 'GroupedRule') 'Explain grouped rule without exposing its group name'
$secured=New-RepairFixture;$secured.RemoteMachineAuthorizedList='private-security-descriptor'
$assessment=Get-SafeRepairAssessment $secured @($secured)
Assert-True ($assessment.Reasons -contains 'SecurityRestriction') 'Surface advanced restrictions hidden from v3'
$unreadable=New-RepairFixture;$unreadable.Remove('LocalAppPackageId')
$assessment=Get-SafeRepairAssessment $unreadable @($unreadable)
Assert-True ($assessment.Reasons -contains 'UnreadableRepairFields') 'Unreadable fields cannot be reported as safe empty settings'
$duplicate=New-RepairFixture
$assessment=Get-SafeRepairAssessment $simple @($simple,$duplicate)
Assert-True ($assessment.Reasons -contains 'AmbiguousRuleIdentity') 'Identical rules remain ambiguous'
$udp=New-RepairFixture;$udp.Protocol=17
$otherProgram=New-RepairFixture;$otherProgram.ApplicationName='C:\other\tool.exe'
$assessment=Get-SafeRepairAssessment $simple @($simple,$udp,$otherProgram)
Assert-True ($assessment.Eligibility -eq 'Candidate') 'Same friendly name with different protocol/program matches the corrected production filter'
$otherProfile=New-RepairFixture;$otherProfile.Profiles=2
Assert-True ((Get-SafeRepairAssessment $simple @($simple,$otherProfile)).Reasons -contains 'AmbiguousRuleIdentity') 'Profiles are mutable and cannot disambiguate otherwise identical rules'
$differentCase=New-RepairFixture;$differentCase.Name='PRIVATE-RULE-NAME'
$assessment=Get-SafeRepairAssessment $simple @($simple,$differentCase)
Assert-True ($assessment.Eligibility -eq 'Candidate') 'Duplicate name comparison matches production ordinal case-sensitive behavior'
$edge=New-RepairFixture;$edge.EdgeTraversalOptions=1
Assert-True ((Get-SafeRepairAssessment $edge @($edge)).Reasons -contains 'EdgeTraversal') 'Explain edge traversal restriction'
$interfaces=New-RepairFixture;$interfaces.Interfaces=@($null)
Assert-True ((Get-SafeRepairAssessment $interfaces @($interfaces)).Reasons -contains 'RestrictedInterfaces') 'Any nonempty interface array matches the production conservative filter'
$unreadableObject=[PSCustomObject](New-RepairFixture)
$unreadableObject.PSObject.Properties.Remove('LocalUserAuthorizedList')
$unreadableObject | Add-Member ScriptProperty LocalUserAuthorizedList {throw 'private-getter-error'}
Assert-True ((Get-SafeRepairAssessment $unreadableObject @($unreadableObject)).Reasons -contains 'UnreadableRepairFields') 'Actual throwing getters stay private and uncertain'
$scopeCounts=Get-RelatedRuleCounts @($allProtocol,$grouped,$secured,$unreadable,$edge) @($program) 28080 4
Assert-True ($scopeCounts.ApplicationBlock -eq 5 -and $scopeCounts.ApplicationScopes.Count -eq 5) 'Retain all detected conflicts and explain each separately'
$snapshot.Firewall=@{Available=$true;OwnerKnown=$true;ModifyState='OK';Profiles=@(@{Kind='Public';Enabled=$true;BlockAll=$false;DefaultInbound='Block';RulesAvailable=$true;Counts=$scopeCounts})}
$report=Format-ConnectionReport $snapshot
Assert-True ($report.Contains('diagnostic report v5') -and $report.Contains('Local rule modification policy: OK') -and $report.Contains('ProtocolNotTcp') -and $report.Contains('GroupedRule') -and $report.Contains('SecurityRestriction') -and $report.Contains('UnreadableRepairFields')) 'v5 exports actionable fixed skip categories'
foreach ($private in @('private-rule-name','private-security-descriptor','private-getter-error','Private Person','secret-network',$program)) {Assert-True (-not $report.Contains($private)) 'Repair assessment must not leak rule identities or raw errors'}
$snapshot.Firewall.ModifyState='private-policy-error'
Assert-True ((Format-ConnectionReport $snapshot).Contains('Local rule modification policy: Unknown')) 'Policy state output is allowlisted'
Write-Output 'PASS: address validation, safe status, listener owners, adapter profiles, repair skip categories and read-only privacy'
