$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Add-Type -AssemblyName System.Drawing

# A neutral gear distinguishes the background helper from the branded launcher.
# ICO payloads are rendered from geometry, without external image dependencies.
function Render-ServicePng([int]$size) {
    $bitmap = New-Object Drawing.Bitmap($size, $size)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    $memory = New-Object IO.MemoryStream
    $ink = New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml('#68717D'))
    $center = New-Object Drawing.SolidBrush([Drawing.ColorTranslator]::FromHtml('#ECEEF1'))
    try {
        $graphics.Clear([Drawing.Color]::Transparent)
        $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $points = New-Object 'Drawing.PointF[]' 40
        for ($i = 0; $i -lt 40; $i++) {
            $radius = if (($i % 4) -lt 2) { 0.45 * $size } else { 0.36 * $size }
            $angle = ($i * 2 * [Math]::PI / 40) - [Math]::PI / 2
            $points[$i] = New-Object Drawing.PointF ([single]($size/2 + $radius*[Math]::Cos($angle))), ([single]($size/2 + $radius*[Math]::Sin($angle)))
        }
        $graphics.FillPolygon($ink, $points)
        $graphics.FillEllipse($center, [single]($size*0.34), [single]($size*0.34), [single]($size*0.32), [single]($size*0.32))
        $bitmap.Save($memory, [Drawing.Imaging.ImageFormat]::Png)
        return ,$memory.ToArray()
    } finally { $graphics.Dispose(); $bitmap.Dispose(); $memory.Dispose(); $ink.Dispose(); $center.Dispose() }
}

$folder = Join-Path $root 'apps\windows-shell\Assets'
New-Item -ItemType Directory -Force $folder | Out-Null
$sizes = @(16,24,32,48,64,128,256)
$entries = @($sizes | ForEach-Object { ,(Render-ServicePng $_) })
$output = [IO.File]::Create((Join-Path $folder 'service.ico'))
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
Write-Output 'Background service gear icon generated (7 sizes).'
