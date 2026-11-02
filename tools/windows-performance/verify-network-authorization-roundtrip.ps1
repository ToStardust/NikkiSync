param([Parameter(Mandatory)][string]$Executable,[Parameter(Mandatory)][string]$Backend)
$ErrorActionPreference='Stop'
$principal=[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Run acceptance with an already elevated test token; do not display a UAC prompt.'}
$workspace=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$exe=(Resolve-Path -LiteralPath $Executable).Path
$source=(Resolve-Path -LiteralPath $Backend).Path
if(-not $exe.StartsWith((Join-Path $workspace 'release')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Use a delivered workspace release EXE.'}
$directory=Join-Path $workspace ('out/network-authorization-1.0.14/roundtrip space 中文-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $directory | Out-Null
$fixture=Join-Path $directory 'NikkiSync-PC-service.exe'
Copy-Item -LiteralPath $source -Destination $fixture
$canonical=[IO.Path]::GetFullPath($fixture).ToLowerInvariant()
$identity=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($canonical+"`n28080"))).Substring(0,24)
$ruleName='MomoCamera-LAN-TCP-'+$identity
$policy=New-Object -ComObject HNetCfg.FwPolicy2
function Find-TestRule {
    try { return $policy.Rules.Item($ruleName) }
    catch { if($_.Exception.HResult -eq -2147024894){return $null};throw }
}
if($null -ne (Find-TestRule)){throw 'Unexpected rule collision; do not touch existing rules.'}
function Invoke-TestHelper([string]$Operation) {
    $info=[Diagnostics.ProcessStartInfo]::new($exe)
    $info.UseShellExecute=$true;$info.Verb='runas';$info.WorkingDirectory=Split-Path -Parent $exe
    foreach($argument in @('--authorize-network',$fixture,'28080',$Operation)){$info.ArgumentList.Add($argument)}
    $child=[Diagnostics.Process]::Start($info)
    try { if(-not $child.WaitForExit(20000)){throw 'Authorization helper timed out'};return $child.ExitCode }
    finally {$child.Dispose()}
}
try {
    $first=Invoke-TestHelper 'allow';if($first -ne 0){throw ('Actual add failed: '+$first)}
    $rule=Find-TestRule
    if($null -eq $rule -or -not $rule.Enabled -or $rule.Action -ne 1 -or $rule.Direction -ne 1 -or $rule.Protocol -ne 6 -or $rule.Profiles -ne 6 -or $rule.LocalPorts -ne '28080' -or $rule.RemoteAddresses -ne 'LocalSubnet' -or $rule.ApplicationName -ne $canonical -or $rule.EdgeTraversal){throw 'Real saved rule did not match the narrow scope'}
    $second=Invoke-TestHelper 'allow';if($second -ne 8){throw ('Actual deduplication failed: '+$second)}
    $removed=Invoke-TestHelper 'remove';if($removed -ne 9 -or $null -ne (Find-TestRule)){throw ('Actual revoke failed: '+$removed)}
    $report=@{actualPortableHelper=$true;actualRuleAddedAndRead=$true;exactBackend=$true;tcpPort=28080;remoteAddresses='LocalSubnet';privateAndPublicOnly=$true;idempotent=$true;removed=$true;existingUserRulesUntouched=$true;alreadyElevatedToken=$true;userUacPromptTested=$false;exitCodes=@($first,$second,$removed)}
    [IO.File]::WriteAllText((Join-Path $directory 'verification.json'),($report|ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
    Write-Output ($report|ConvertTo-Json -Compress)
    Write-Output ('Report: '+[IO.Path]::GetRelativePath($workspace,(Join-Path $directory 'verification.json')))
} finally {
    # Only this invocation's unique fixture rule was confirmed absent before testing.
    $policy.Rules.Remove($ruleName)
    if($null -ne (Find-TestRule)){throw 'Fixture rule cleanup failed'}
}
