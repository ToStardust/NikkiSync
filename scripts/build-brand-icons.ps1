param([string]$Source = '')
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$canonical = Join-Path $root 'assets\branding\momo-camera.png'
if (-not $Source) {
    $Source = if (Test-Path -LiteralPath $canonical) { $canonical } else { Join-Path $root 'out\avatar-momo\momo-camera-512.png' }
}
if ((Get-FileHash -LiteralPath $Source -Algorithm SHA256).Hash -ne '9BC0A0D0BCD670F3DA05791E5F851AEC1C4CBBA142D0F8A5097F657DA95F47E0') { throw 'Expected the existing MiniProgram no-text avatar.' }
New-Item -ItemType Directory -Force (Split-Path -Parent $canonical) | Out-Null
if ((Resolve-Path -LiteralPath $Source).Path -ne $canonical) { Copy-Item -LiteralPath $Source -Destination $canonical }
Add-Type -AssemblyName System.Drawing
$image = [Drawing.Image]::FromFile($canonical)
function Render-Png([int]$size, [int]$inset = 0) {
    $bitmap = New-Object Drawing.Bitmap($size, $size)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $memory = New-Object IO.MemoryStream
    try {
        $graphics.Clear([Drawing.Color]::Transparent)
        $graphics.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.DrawImage($image, $inset, $inset, ($size - 2*$inset), ($size - 2*$inset))
        $bitmap.Save($memory, [Drawing.Imaging.ImageFormat]::Png)
        return ,$memory.ToArray()
    } finally { $graphics.Dispose(); $bitmap.Dispose(); $memory.Dispose() }
}
try {
    $iconDirectory = Join-Path $root 'apps\windows-shell\Assets'
    New-Item -ItemType Directory -Force $iconDirectory | Out-Null
    $sizes = @(16,24,32,48,64,128,256)
    $entries = @($sizes | ForEach-Object { ,(Render-Png $_) })
    $output = [IO.File]::Create((Join-Path $iconDirectory 'app.ico'))
    $writer = New-Object IO.BinaryWriter($output)
    try {
        $writer.Write([uint16]0); $writer.Write([uint16]1); $writer.Write([uint16]$sizes.Count)
        $offset = 6 + 16*$sizes.Count
        for ($i=0; $i -lt $sizes.Count; $i++) {
            $side = if ($sizes[$i] -eq 256) { 0 } else { $sizes[$i] }
            $writer.Write([byte]$side); $writer.Write([byte]$side); $writer.Write([byte]0); $writer.Write([byte]0)
            $writer.Write([uint16]1); $writer.Write([uint16]32); $writer.Write([uint32]$entries[$i].Length); $writer.Write([uint32]$offset)
            $offset += $entries[$i].Length
        }
        foreach ($entry in $entries) { $writer.Write([byte[]]$entry) }
    } finally { $writer.Dispose(); $output.Dispose() }
    $res = Join-Path $root 'apps\mobile\app\src\main\res'
    $densities = @{ mdpi=48; hdpi=72; xhdpi=96; xxhdpi=144; xxxhdpi=192 }
    foreach ($density in $densities.Keys) {
        $folder = Join-Path $res ('mipmap-' + $density)
        New-Item -ItemType Directory -Force $folder | Out-Null
        [IO.File]::WriteAllBytes((Join-Path $folder 'ic_launcher.png'), (Render-Png $densities[$density]))
        [IO.File]::WriteAllBytes((Join-Path $folder 'ic_launcher_foreground.png'), (Render-Png ([int]($densities[$density]*2.25)) ([int]($densities[$density]*0.375))))
    }
} finally { $image.Dispose() }
Write-Output 'Existing MiniProgram avatar reused for Windows ICO and Android density/adaptive assets; no AI generation.'
