param([ValidateSet(0,90,180,270)][int]$AdditionalRotation = 0)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$memory = New-Object System.IO.MemoryStream
[Console]::OpenStandardInput().CopyTo($memory)
if ($memory.Length -gt 16777216) { $memory.Dispose(); throw 'Input limit' }
$memory.Position = 0
$image = $null; $bitmap = $null
try {
    $image = [System.Drawing.Image]::FromStream($memory, $true, $true)
    function Read-Ascii([int]$tag) {
        if ($image.PropertyIdList -notcontains $tag) { return $null }
        return [Text.Encoding]::ASCII.GetString($image.GetPropertyItem($tag).Value).Trim([char]0)
    }
    function Read-Rational([int]$tag) {
        if ($image.PropertyIdList -notcontains $tag) { return $null }
        $value = $image.GetPropertyItem($tag).Value
        return [BitConverter]::ToUInt32($value, 0) / [double][BitConverter]::ToUInt32($value, 4)
    }
    $make = Read-Ascii 271; $model = Read-Ascii 272
    $fNumber = Read-Rational 33437; $focal = Read-Rational 37386
    $orientation = 1
    if ($image.PropertyIdList -contains 274) { $orientation = [BitConverter]::ToUInt16($image.GetPropertyItem(274).Value, 0) }
    $transforms = @{ 2 = 4; 3 = 2; 4 = 6; 5 = 5; 6 = 1; 7 = 7; 8 = 3 }
    if ($transforms.ContainsKey([int]$orientation)) { $image.RotateFlip([System.Drawing.RotateFlipType]$transforms[[int]$orientation]) }
    if ($AdditionalRotation) { $image.RotateFlip([System.Drawing.RotateFlipType]($AdditionalRotation / 90)) }
    $bitmap = New-Object System.Drawing.Bitmap($image)
    $sample = New-Object byte[] 256
    $position = 0
    for ($y = 0; $y -lt 8; $y++) {
        for ($x = 0; $x -lt 8; $x++) {
            $pixel = $bitmap.GetPixel([int][Math]::Round($x * ($bitmap.Width - 1) / 7), [int][Math]::Round($y * ($bitmap.Height - 1) / 7))
            $sample[$position++] = $pixel.R; $sample[$position++] = $pixel.G; $sample[$position++] = $pixel.B; $sample[$position++] = $pixel.A
        }
    }
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $pixelFingerprint = -join ($sha.ComputeHash($sample) | ForEach-Object { $_.ToString('x2') }) } finally { $sha.Dispose() }
    @{ width = $bitmap.Width; height = $bitmap.Height; orientation = $orientation; make = $make; model = $model; fNumber = $fNumber; focalLength = $focal; displayedPixelFingerprint = $pixelFingerprint } | ConvertTo-Json -Compress
} finally {
    if ($bitmap) { $bitmap.Dispose() }
    if ($image) { $image.Dispose() }
    $memory.Dispose()
}
