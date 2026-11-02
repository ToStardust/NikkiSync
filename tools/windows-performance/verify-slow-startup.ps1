param([Parameter(Mandatory=$true)][string]$Executable, [Parameter(Mandatory=$true)][string]$ExpectedApkSha256)
$ErrorActionPreference='Stop'
$workspace=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$exe=[IO.Path]::GetFullPath((Join-Path $workspace $Executable))
if(-not $exe.StartsWith((Join-Path $workspace 'release')+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Expected a workspace release EXE.'}
$output=Join-Path $workspace ('out\slow-startup-'+[Guid]::NewGuid().ToString('N'))
$profile=Join-Path $output 'startup'
$data=Join-Path $profile 'localdata\NikkiSync'
$game=Join-Path $output 'synthetic-game\InfinityNikki'
$photos=Join-Path $game 'X6Game\Saved\GamePlayPhotos\10001\NikkiPhotos_HighQuality'
[IO.Directory]::CreateDirectory($data)|Out-Null
[IO.Directory]::CreateDirectory($photos)|Out-Null
[IO.File]::WriteAllText((Join-Path $game 'InfinityNikki.exe'),'')
[IO.File]::WriteAllText((Join-Path $data 'retention-probe.txt'),'keep user data')
[IO.File]::WriteAllText((Join-Path $data 'metadata-resolver.json'),'{"enabled":false}')
[IO.File]::WriteAllText((Join-Path $data 'metadata-dictionary-remote.json'),'{"enabled":false,"gallery":{"enabled":false}}')
# Only synthetic owned files: thirteen exclusive locks each exercise the existing
# ten-second stability limit. This creates a real >120s scan without copying 40GB.
$locks=[Collections.Generic.List[IO.FileStream]]::new()
$child=$null
$variables=@('LOCALAPPDATA','DOTNET_BUNDLE_EXTRACT_BASE_DIR','NIKKISYNC_GAME_ROOT','NIKKISYNC_BIND','NIKKISYNC_PORT','NIKKISYNC_MDNS')
$saved=@{}
foreach($name in $variables){$saved[$name]=[Environment]::GetEnvironmentVariable($name,'Process')}
try{
  for($index=0;$index -lt 13;$index++){
    $file=Join-Path $photos ('locked-'+$index+'.jpg')
    [IO.File]::WriteAllBytes($file,[byte[]](1,2,3,4))
    $locks.Add([IO.File]::Open($file,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None))
  }
  [IO.File]::WriteAllBytes((Join-Path $photos 'readable.png'),[Convert]::FromBase64String('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9S8AAAAASUVORK5CYII='))
  $env:LOCALAPPDATA=Join-Path $profile 'localdata'
  $env:DOTNET_BUNDLE_EXTRACT_BASE_DIR=Join-Path $output 'native-cache'
  $env:NIKKISYNC_GAME_ROOT=$game
  $env:NIKKISYNC_BIND='127.0.0.1';$env:NIKKISYNC_PORT='0';$env:NIKKISYNC_MDNS='0'
  $reserve=[Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback,0)
  $reserve.Start();$port=$reserve.LocalEndpoint.Port;$reserve.Stop()
  if($port -eq 28950){throw 'Reserved production desktop port is not allowed.'}
  $watch=[Diagnostics.Stopwatch]::StartNew()
  $child=Start-Process -FilePath $exe -ArgumentList @('--verify-startup',('"'+$profile+'"'),[string]$port) -WindowStyle Hidden -PassThru
  $samples=[Collections.Generic.List[object]]::new()
  while(-not $child.HasExited){
    if($watch.Elapsed.TotalSeconds -gt 240){throw 'Slow scan verification exceeded four minutes.'}
    Start-Sleep -Milliseconds 500
    $timings=Join-Path $data 'startup-service-timings.json'
    if(Test-Path -LiteralPath $timings){
      try{
        $sample=[IO.File]::ReadAllText($timings)|ConvertFrom-Json
        if($sample.scan -and ($samples.Count -eq 0 -or $sample.scan.filesCompleted -ne $samples[$samples.Count-1].filesCompleted)){
          $samples.Add([pscustomobject]@{elapsedMs=[math]::Round($watch.Elapsed.TotalMilliseconds);filesCompleted=$sample.scan.filesCompleted;bytesRead=$sample.scan.bytesRead;stage=$sample.scan.stage})
        }
      }catch{ # An atomicity race while a diagnostic file is being rewritten is harmless.
      }
    }
  }
  $child.WaitForExit()
  if($child.ExitCode -ne 0){throw ('Actual EXE verification failed, exit='+$child.ExitCode)}
  $startup=[IO.File]::ReadAllText((Join-Path $profile 'startup-verification.json'))|ConvertFrom-Json
  $service=[IO.File]::ReadAllText((Join-Path $data 'startup-service-timings.json'))|ConvertFrom-Json
  if(-not $startup.ok -or -not $startup.browserVisible -or -not $startup.loaderHidden){throw 'Dashboard did not become ready.'}
  if($startup.stages.serviceReadyMs -lt 120000 -or $service.scan.filesCompleted -ne 14 -or $samples.Count -lt 10){throw 'Controlled scan did not exercise progress beyond two minutes.'}
  if([IO.File]::ReadAllText((Join-Path $data 'retention-probe.txt')) -ne 'keep user data'){throw 'User-data marker changed.'}
  $embedded=@(Get-ChildItem -LiteralPath (Join-Path $profile 'runtime-cache') -Recurse -File -Filter 'NikkiSync-Android.apk')
  if($embedded.Count -ne 1 -or (Get-FileHash -LiteralPath $embedded[0].FullName).Hash -ne $ExpectedApkSha256){throw 'Unexpected embedded APK.'}
  $report=[ordered]@{ok=$true;exeSha256=(Get-FileHash -LiteralPath $exe).Hash.ToLowerInvariant();apkSha256=$ExpectedApkSha256.ToLowerInvariant();privateSyntheticProfile=$true;loopbackOnly=$true;onlineProvidersDisabled=$true;realUserProfileUntouched=$true;controlledLockedFiles=13;filesCompleted=$service.scan.filesCompleted;startup=$startup;samples=$samples;elapsedMs=[math]::Round($watch.Elapsed.TotalMilliseconds)}
  [IO.File]::WriteAllText((Join-Path $output 'report.json'),($report|ConvertTo-Json -Depth 8),[Text.UTF8Encoding]::new($false))
  Write-Output ('Slow startup PASS: '+(Join-Path $output 'report.json'))
}finally{
  if($child -and -not $child.HasExited){Stop-Process -Id $child.Id -Force}
  foreach($stream in $locks){$stream.Dispose()}
  foreach($name in $variables){[Environment]::SetEnvironmentVariable($name,$saved[$name],'Process')}
}
