import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

export interface WindowsInstallationHints {
  registryPaths: string[]
  shortcutPaths: string[]
  driveRoots: string[]
  probeFailed?: boolean
}

// One bounded, read-only probe per uncached discovery. Never execute registry
// commands or shortcut targets. Return installation paths only, not arguments,
// account/configuration data, or raw registry records.
const probe = String.raw`
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$ErrorActionPreference = 'SilentlyContinue'
$registry = New-Object 'System.Collections.Generic.List[string]'
$shortcuts = New-Object 'System.Collections.Generic.List[string]'
$drives = @([IO.DriveInfo]::GetDrives() | Where-Object { $_.DriveType -eq 'Fixed' -and $_.IsReady } | ForEach-Object { $_.RootDirectory.FullName })
function InstallationPath([string]$value) {
  if (-not $value) { return }
  $value = [Environment]::ExpandEnvironmentVariables($value.Trim())
  if ($value.StartsWith('"')) { $value = ($value -split '"')[1] }
  elseif ($value -match '^(.*?\.exe)(?:\s|,|$)') { $value = $matches[1] }
  if ($value -match '^[A-Za-z]:[\\/]') { $value }
}
$uninstall = @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall', 'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')
foreach ($root in $uninstall) {
  foreach ($key in (Get-ChildItem -LiteralPath $root)) {
    $item = Get-ItemProperty -LiteralPath $key.PSPath
    if (($item.DisplayName -match '(?i)infinity\s*nikki|无限\s*暖暖') -or ($item.DisplayIcon -match '(?i)infinity\s*nikki')) {
      foreach ($value in @($item.InstallLocation, $item.DisplayIcon, $item.UninstallString)) {
        $candidate = InstallationPath $value
        if ($candidate) { $registry.Add($candidate) }
      }
    }
  }
}
# Epic installations also have a local launcher manifest without an uninstall entry.
$manifests = Join-Path $env:ProgramData 'Epic\EpicGamesLauncher\Data\Manifests'
foreach ($file in (Get-ChildItem -LiteralPath $manifests -Filter '*.item' -File | Select-Object -First 256)) {
  if ($file.Length -gt 1MB) { continue }
  $manifest = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json
  if ($manifest.DisplayName -match '(?i)infinity\s*nikki|无限\s*暖暖') {
    $candidate = InstallationPath $manifest.InstallLocation
    if ($candidate) { $registry.Add($candidate) }
  }
}
$shell = New-Object -ComObject WScript.Shell
$places = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('CommonDesktopDirectory'), [Environment]::GetFolderPath('StartMenu'), [Environment]::GetFolderPath('CommonStartMenu')) | Select-Object -Unique
$queue = New-Object 'System.Collections.Generic.Queue[object]'
foreach ($place in $places) { if ($place) { $queue.Enqueue(@{Path=$place;Depth=0}) } }
$examined = 0
$folders = 0
while ($queue.Count -gt 0 -and $examined -lt 512 -and $folders -lt 128) {
  $folder = $queue.Dequeue()
  $folders++
  foreach ($file in (Get-ChildItem -LiteralPath $folder.Path -Filter '*.lnk' -File | Select-Object -First 128)) {
    $examined++
    if ($examined -gt 512) { break }
    $link = $shell.CreateShortcut($file.FullName)
    if (($file.BaseName + ' ' + $link.TargetPath + ' ' + $link.WorkingDirectory) -match '(?i)infinity\s*nikki|nikki|无限\s*暖暖') {
      foreach ($value in @($link.TargetPath, $link.WorkingDirectory)) {
        $candidate = InstallationPath $value
        if ($candidate) { $shortcuts.Add($candidate) }
      }
    }
  }
  if ($folder.Depth -lt 4) {
    foreach ($child in (Get-ChildItem -LiteralPath $folder.Path -Directory | Select-Object -First 64)) {
      if ($queue.Count -lt 256 -and -not ($child.Attributes -band [IO.FileAttributes]::ReparsePoint)) { $queue.Enqueue(@{Path=$child.FullName;Depth=$folder.Depth+1}) }
    }
  }
}
@{registryPaths=@($registry | Select-Object -Unique);shortcutPaths=@($shortcuts | Select-Object -Unique);driveRoots=$drives} | ConvertTo-Json -Compress -Depth 3
`

export async function readWindowsInstallationHints(): Promise<WindowsInstallationHints> {
  if (process.platform !== 'win32') return { registryPaths: [], shortcutPaths: [], driveRoots: [] }
  try {
    const { stdout } = await promisify(execFile)('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(probe, 'utf16le').toString('base64')
    ], { windowsHide: true, timeout: 8000, maxBuffer: 1024 * 1024, encoding: 'utf8' })
    const parsed = JSON.parse(stdout.trim().replace(/^\uFEFF/, '')) as Record<string, unknown>
    const strings = (value: unknown) => Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string' && /^[a-z]:[\\/]/i.test(item)).slice(0, 512)
      : []
    return { registryPaths: strings(parsed.registryPaths), shortcutPaths: strings(parsed.shortcutPaths), driveRoots: strings(parsed.driveRoots) }
  } catch {
    // A restricted PowerShell/COM environment must not disable disk discovery.
    const driveRoots = Array.from({ length: 26 }, (_, i) => `${String.fromCharCode(65 + i)}:\\`)
    return { registryPaths: [], shortcutPaths: [], driveRoots, probeFailed: true }
  }
}
