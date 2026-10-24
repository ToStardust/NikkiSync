param([Parameter(Mandatory)][string]$Executable,[Parameter(Mandatory)][string]$Backend,[switch]$SameNameFixture)
$ErrorActionPreference='Stop'
$principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Use an already elevated acceptance token; do not display a test UAC prompt.'}
$workspace=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$exe=(Resolve-Path -LiteralPath $Executable).Path
$source=(Resolve-Path -LiteralPath $Backend).Path
if(-not $exe.StartsWith((Join-Path $workspace 'release')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Use a delivered workspace release EXE.'}
$connection=Get-NetConnectionProfile | Where-Object {$_.NetworkCategory -in @('Public','Private')} | Select-Object -First 1
if($null -eq $connection){throw 'No unmanaged local profile for acceptance.'}
$hostAddress=(Get-NetIPAddress -InterfaceIndex $connection.InterfaceIndex -AddressFamily IPv4 | Where-Object {$_.IPAddress -notmatch '^(127\.|169\.254\.)'} | Select-Object -First 1).IPAddress
if(-not $hostAddress){throw 'No local IPv4 for acceptance.'}
$profile=if($connection.NetworkCategory -eq 'Public'){4}else{2}
$directory=Join-Path $workspace ('out/network-conflict-1.0.15/roundtrip space 中文-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $directory | Out-Null
$fixture=Join-Path $directory 'NikkiSync-PC-service.exe'
Copy-Item -LiteralPath $source -Destination $fixture
$canonical=[IO.Path]::GetFullPath($fixture).ToLowerInvariant()
$identity=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($canonical+"`n28080"))).Substring(0,24)
$allowName='MomoCamera-LAN-TCP-'+$identity
$journalPath=Join-Path ([Environment]::GetFolderPath('CommonApplicationData')) ('MomoCamera-NetworkRepair-v1/'+$allowName+'.bin')
if(Test-Path -LiteralPath $journalPath){throw 'Unexpected journal collision.'}
$prefix='MomoConflictAcceptance-'+[Guid]::NewGuid().ToString('N')
$primary=$prefix+'-block';$sentinel=$prefix+'-other-app';$otherPort=$prefix+'-other-port';$complex=$prefix+'-complex';$udpId=$prefix+'-same-name-udp'
$policy=New-Object -ComObject HNetCfg.FwPolicy2
$created=[Collections.Generic.List[string]]::new()
function Find-Rule([string]$Name){
    $matches=@($policy.Rules | Where-Object {$_.Name -ceq $Name -and $_.Protocol -eq 6})
    if($matches.Count -gt 1){throw 'Ambiguous test TCP rule.'};if($matches.Count -eq 1){return $matches[0]};return $null
}
foreach($name in @($primary,$sentinel,$otherPort,$complex,$allowName)){if($null -ne (Find-Rule $name)){throw 'Unexpected rule collision.'}}
$udpCreated=$false
function Snapshot-Udp {
    $r=Get-NetFirewallRule -Name $udpId -ErrorAction Stop
    $app=$r | Get-NetFirewallApplicationFilter
    $port=$r | Get-NetFirewallPortFilter
    return (@{Name=$r.Name;DisplayName=$r.DisplayName;Enabled=[string]$r.Enabled;Profiles=[string]$r.Profile;Action=[string]$r.Action;Direction=[string]$r.Direction;Program=$app.Program;Protocol=$port.Protocol;LocalPort=$port.LocalPort;RemotePort=$port.RemotePort}|ConvertTo-Json -Compress)
}
function Add-Fixture([string]$Name,[string]$Program,[string]$Ports='*',[string]$Remote='*'){
    $rule=New-Object -ComObject HNetCfg.FWRule
    $rule.Name=$Name;$rule.ApplicationName=$Program;$rule.Direction=1;$rule.Action=0;$rule.Protocol=6
    $rule.LocalPorts=$Ports;$rule.RemotePorts='*';$rule.LocalAddresses='*';$rule.RemoteAddresses=$Remote
    $rule.InterfaceTypes='All';$rule.Profiles=[int]::MaxValue;$rule.Enabled=$true;$rule.EdgeTraversal=$false
    $policy.Rules.Add($rule);$created.Add($Name)
}
function Snapshot([string]$Name){
    $r=Find-Rule $Name;if($null -eq $r){throw 'Missing fixture rule'}
    return (@{Name=$r.Name;Program=$r.ApplicationName;Enabled=$r.Enabled;Profiles=$r.Profiles;Protocol=$r.Protocol;LocalPorts=$r.LocalPorts;RemotePorts=$r.RemotePorts;LocalAddresses=$r.LocalAddresses;RemoteAddresses=$r.RemoteAddresses;Interfaces=$r.InterfaceTypes;Direction=$r.Direction;Action=$r.Action;Grouping=$r.Grouping;Description=$r.Description;EdgeTraversal=$r.EdgeTraversal}|ConvertTo-Json -Compress)
}
function Invoke-Helper([string[]]$Arguments){
    $info=[Diagnostics.ProcessStartInfo]::new($exe);$info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.WorkingDirectory=Split-Path -Parent $exe
    foreach($argument in $Arguments){$info.ArgumentList.Add($argument)}
    $child=[Diagnostics.Process]::Start($info)
    try{if(-not $child.WaitForExit(30000)){throw 'Packaged helper timed out'};return $child.ExitCode}finally{$child.Dispose()}
}
function Repair([string]$Operation){return Invoke-Helper @('--repair-network',$fixture,'28080',$hostAddress,$Operation)}
try{
    Add-Fixture $primary $canonical
    Add-Fixture $sentinel ($canonical+'.other')
    Add-Fixture $otherPort $canonical '443'
    if($SameNameFixture){
        if(Get-NetFirewallRule -Name $udpId -ErrorAction SilentlyContinue){throw 'Unexpected UDP fixture collision.'}
        New-NetFirewallRule -Name $udpId -DisplayName $primary -Program $canonical -Direction Inbound -Action Block -Protocol UDP -Profile Any -Enabled True -ErrorAction Stop | Out-Null
        $udpCreated=$true
        $udpBefore=Snapshot-Udp
        if(@($policy.Rules | Where-Object {$_.Name -ceq $primary}).Count -ne 2){throw 'Native same-friendly-name fixture was not created.'}
    }
    $original=Snapshot $primary;$otherBefore=Snapshot $sentinel;$portBefore=Snapshot $otherPort
    $badOperation=Invoke-Helper @('--repair-network',$fixture,'28080',$hostAddress,'arbitrary')
    $badPort=Invoke-Helper @('--repair-network',$fixture,'0',$hostAddress,'repair')
    $badHost=Invoke-Helper @('--repair-network',$fixture,'28080','203.0.113.77','repair')
    if($badOperation -ne 3 -or $badPort -ne 3 -or $badHost -ne 411 -or (Snapshot $primary) -ne $original -or $null -ne (Find-Rule $allowName)){throw 'Invalid arguments changed a rule or returned the wrong result.'}
    $first=Repair 'repair'
    $changed=Find-Rule $primary
    if($first -ne 410 -or $changed.Profiles -ne (7 -band (-bnot $profile)) -or -not $changed.Enabled){throw ('Packaged repair failed: '+$first)}
    $allow=Find-Rule $allowName
    if($null -eq $allow -or $allow.Action -ne 1 -or $allow.RemoteAddresses -ne 'LocalSubnet' -or $allow.ApplicationName -ne $canonical -or $allow.LocalPorts -ne '28080' -or $allow.Profiles -ne 6){throw 'Narrow Allow rule did not match.'}
    if((Snapshot $sentinel) -ne $otherBefore -or (Snapshot $otherPort) -ne $portBefore){throw 'Unrelated fixture was changed.'}
    if($SameNameFixture -and (Snapshot-Udp) -ne $udpBefore){throw 'Same-name UDP rule was changed.'}
    $bytes=[IO.File]::ReadAllBytes($journalPath)
    if([Text.Encoding]::UTF8.GetString($bytes).Contains($canonical)){throw 'Repair backup was not encrypted.'}
    $second=Repair 'repair';if($second -ne 417){throw ('Repeat was not idempotent: '+$second)}
    $restored=Repair 'restore';if($restored -ne 414 -or (Snapshot $primary) -ne $original){throw ('Original not restored exactly: '+$restored)}
    if($SameNameFixture -and (Snapshot-Udp) -ne $udpBefore){throw 'Undo changed the same-name UDP rule.'}
    $none=Repair 'restore';if($none -ne 416){throw 'Empty recovery was not safe.'}
    # The complicated rule must survive both repair and undo unchanged.
    Add-Fixture $complex $canonical '*' '10.0.0.0/8'
    $complexBefore=Snapshot $complex
    $skipped=Repair 'repair';if($skipped -ne 413 -or (Snapshot $complex) -ne $complexBefore){throw 'Complex rule was not skipped.'}
    $undo=Repair 'restore';if($undo -ne 414 -or (Snapshot $primary) -ne $original -or (Snapshot $complex) -ne $complexBefore){throw 'Complex-rule case failed undo.'}
    if((Snapshot $sentinel) -ne $otherBefore -or (Snapshot $otherPort) -ne $portBefore){throw 'Unrelated rules changed after undo.'}
    if($SameNameFixture -and (Snapshot-Udp) -ne $udpBefore){throw 'Same-name UDP rule changed during a later case.'}
    $report=@{actualDeliveredHelper=$true;actualLocalProfileVerified=$true;allProfilesSentinelSupported=$true;domainPreserved=$true;exactBackendPortOnly=$true;otherProgramAndPortUntouched=$true;sameFriendlyNameTcpUdpVerified=[bool]$SameNameFixture;encryptedJournal=$true;idempotent=$true;restoreExact=$true;complexRuleSkipped=$true;invalidArgumentsRejected=$true;alreadyElevatedToken=$true;userUacPromptTested=$false;remotePhoneTestPending=$true;exitCodes=@($badOperation,$badPort,$badHost,$first,$second,$restored,$none,$skipped,$undo)}
    [IO.File]::WriteAllText((Join-Path $directory 'verification.json'),($report|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
    Write-Output ($report|ConvertTo-Json -Compress)
    Write-Output ('Report: '+[IO.Path]::GetRelativePath($workspace,(Join-Path $directory 'verification.json')))
}finally{
    # Random targets were checked absent before testing. Never remove any other rule.
    if($udpCreated){
        $udp=Get-NetFirewallRule -Name $udpId -ErrorAction Stop
        if($udp.DisplayName -cne $primary -or ($udp | Get-NetFirewallApplicationFilter).Program -ine $canonical -or ($udp | Get-NetFirewallPortFilter).Protocol -ne 'UDP'){throw 'Unexpected UDP fixture state; no broad cleanup.'}
        Remove-NetFirewallRule -Name $udpId -ErrorAction Stop
        if(Get-NetFirewallRule -Name $udpId -ErrorAction SilentlyContinue){throw 'UDP fixture cleanup failed.'}
    }
    foreach($name in $created){$policy.Rules.Remove($name);if($null -ne (Find-Rule $name)){throw 'Fixture cleanup failed.'}}
    $owned=Find-Rule $allowName
    if($null -ne $owned -and $owned.ApplicationName -eq $canonical -and $owned.Grouping -eq 'MomoCamera LAN Authorization v1'){$policy.Rules.Remove($allowName)}
    if(Test-Path -LiteralPath $journalPath){Remove-Item -LiteralPath $journalPath}
}
