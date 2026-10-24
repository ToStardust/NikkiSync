param([Parameter(Mandatory=$true)][string]$Executable)
$ErrorActionPreference='Stop'
$workspace=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$proof=Join-Path $workspace ('out/recycle-verification-'+[Guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($proof)|Out-Null
$file=Join-Path $proof 'only-this-generated-fixture.jpeg'
[IO.File]::WriteAllBytes($file,[Text.Encoding]::UTF8.GetBytes('MomoCamera generated recycle fixture; not a user photo.'))
$hash=(Get-FileHash -LiteralPath $file).Hash.ToLower()
$size=(Get-Item -LiteralPath $file).Length
$start=[Diagnostics.ProcessStartInfo]::new([IO.Path]::GetFullPath($Executable))
$start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.WindowStyle='Hidden'
$start.ArgumentList.Add('--recycle-file');$start.ArgumentList.Add($file);$start.ArgumentList.Add($hash);$start.ArgumentList.Add([string]$size)
$process=[Diagnostics.Process]::Start($start)
if(-not $process.WaitForExit(30000)){throw 'Recycle helper timed out'}
if($process.ExitCode -ne 0){throw "Recycle helper returned $($process.ExitCode); source exists: $(Test-Path -LiteralPath $file)"}
if(Test-Path -LiteralPath $file){throw 'Source not recycled'}
$shell=New-Object -ComObject Shell.Application
$items=@($shell.NameSpace(10).Items())
$matches=@($items|Where-Object { $_.Name -eq [IO.Path]::GetFileName($file) -and $_.ExtendedProperty('System.Recycle.DeletedFrom') -eq $proof })
if($matches.Count -ne 1){throw 'Could not uniquely locate the generated fixture in Recycle Bin'}
if((Get-FileHash -LiteralPath $matches[0].Path).Hash.ToLower() -ne $hash){throw 'Recycled bytes differ'}
$matches[0].InvokeVerb('undelete')
for($attempt=0;$attempt -lt 30 -and -not (Test-Path -LiteralPath $file);$attempt++){Start-Sleep -Milliseconds 100}
if(-not (Test-Path -LiteralPath $file)){throw 'Fixture restore was not completed'}
if((Get-FileHash -LiteralPath $file).Hash.ToLower() -ne $hash){throw 'Restored bytes differ'}
$result=@{helper=$true;recycled=$true;restored=$true;hashMatches=$true;onlyGeneratedFixture=$true}
$result|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $proof 'result.json') -Encoding utf8
Write-Output $proof
