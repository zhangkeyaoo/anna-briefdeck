$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$powerPoint = New-Object -ComObject PowerPoint.Application
$results = @()
foreach ($name in @('visual-relations', 'visual-long-relations')) {
    $presentation = $powerPoint.Presentations.Open((Join-Path $workspace "release/visual/$name.pptx"), -1, 0, 0)
    try {
        $expected = Get-Content -Raw -LiteralPath (Join-Path $workspace "release/visual/$name-source.json") | ConvertFrom-Json
        $issues = @(); $textCount = 0; $textEditable = $false
        foreach ($slide in $presentation.Slides) {
            $nativeText = ''
            foreach ($shape in $slide.Shapes) {
                if ($shape.HasTextFrame -ne -1 -or $shape.TextFrame.HasText -ne -1) { continue }
                $textCount++
                $range = $shape.TextFrame2.TextRange
                $nativeText += $range.Text -replace '[\r\n\v]', ''
                if ($range.BoundHeight -gt $shape.Height + 2 -or $range.BoundWidth -gt $shape.Width + 2) {
                    $issues += @{ page=$slide.SlideIndex; text=$range.Text; width=$range.BoundWidth; height=$range.BoundHeight; boxWidth=$shape.Width; boxHeight=$shape.Height }
                }
                if (-not $textEditable -and $slide.SlideIndex -gt 1) {
                    $original = $shape.TextFrame.TextRange.Text
                    $shape.TextFrame.TextRange.Text = $original + ' [edit check]'
                    if (-not $shape.TextFrame.TextRange.Text.EndsWith('[edit check]')) { throw 'Text edit failed' }
                    $shape.TextFrame.TextRange.Text = $original
                    $textEditable = $true
                }
            }
            foreach ($point in $expected.slides[$slide.SlideIndex - 1].points) {
                if (-not $nativeText.Contains($point)) { $issues += @{page=$slide.SlideIndex; missing=$point} }
            }
        }
        $movable = @($presentation.Slides.Item(2).Shapes | Where-Object { $_.HasTextFrame -ne -1 -or $_.TextFrame.HasText -ne -1 })[0]
        $oldLeft = [double]$movable.Left
        $movable.Left = [double]($oldLeft+1)
        if ([Math]::Abs($movable.Left-$oldLeft-1) -gt 0.1) { throw 'Shape edit failed' }
        $movable.Left = $oldLeft
        foreach ($index in @(2,3,4)) {
            $presentation.Slides.Item($index).Export((Join-Path $workspace "docs/evidence/visual/native-$name-$index.png"), 'PNG', 1600, 900)
        }
        $results += @{ file=$name; pages=$presentation.Slides.Count; textObjects=$textCount; textEditable=$textEditable; shapeEditable=$true; issues=@($issues) }
    } finally { $presentation.Saved = -1; $presentation.Close() }
}
$results | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $workspace 'docs/evidence/visual/native-results.json') -Encoding utf8
$results | ConvertTo-Json -Depth 6
if (@($results | Where-Object {$_.issues.Count -gt 0}).Count -gt 0) { exit 1 }
