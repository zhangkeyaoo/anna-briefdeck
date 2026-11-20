$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$expected = Get-Content -Raw -LiteralPath (Join-Path $workspace 'release/p25/source.json') | ConvertFrom-Json
$powerPoint = New-Object -ComObject PowerPoint.Application
$presentation = $powerPoint.Presentations.Open((Join-Path $workspace 'release/p25/confirmed.pptx'), -1, 0, 0)
try {
    $issues = @(); $textCount = 0; $textEditable = $false; $pictureCount = 0
    foreach ($slide in $presentation.Slides) {
        $nativeText = ''
        foreach ($shape in $slide.Shapes) {
            if ($shape.Type -eq 13) { $pictureCount++ }
            if ($shape.HasTextFrame -ne -1 -or $shape.TextFrame.HasText -ne -1) { continue }
            $textCount++
            $range = $shape.TextFrame2.TextRange
            $nativeText += $range.Text -replace '[\r\n\v]', ''
            if ($range.BoundHeight -gt $shape.Height + 2 -or $range.BoundWidth -gt $shape.Width + 2) { $issues += @{ page=$slide.SlideIndex; text=$range.Text; width=$range.BoundWidth; height=$range.BoundHeight; boxWidth=$shape.Width; boxHeight=$shape.Height } }
            if (-not $textEditable -and $slide.SlideIndex -eq 2) {
                $original = $shape.TextFrame.TextRange.Text
                $shape.TextFrame.TextRange.Text = $original + ' [editable]'
                $textEditable = $shape.TextFrame.TextRange.Text.EndsWith('[editable]')
                $shape.TextFrame.TextRange.Text = $original
            }
        }
        foreach ($point in $expected.slides[$slide.SlideIndex - 1].points) { if (-not $nativeText.Contains($point)) { $issues += @{page=$slide.SlideIndex; missing=$point} } }
    }
    $shape = @($presentation.Slides.Item(2).Shapes | Where-Object { $_.Type -eq 1 })[0]
    $oldLeft = [double]$shape.Left; $shape.Left = [double]($oldLeft+1)
    $shapeEditable = [Math]::Abs($shape.Left-$oldLeft-1) -lt 0.1; $shape.Left = $oldLeft
    $picture = @($presentation.Slides.Item(2).Shapes | Where-Object { $_.Type -eq 13 })[0]
    $oldLeft = [double]$picture.Left; $picture.Left = [double]($oldLeft+1)
    $pictureEditable = [Math]::Abs($picture.Left-$oldLeft-1) -lt 0.1; $picture.Left = $oldLeft
    $presentation.Slides.Item(2).Export((Join-Path $workspace 'docs/evidence/p25/04-native-confirmed.png'), 'PNG', 1600, 900)
    $report = @{ pages=$presentation.Slides.Count; textObjects=$textCount; pictures=$pictureCount; textEditable=$textEditable; shapeEditable=$shapeEditable; pictureEditable=$pictureEditable; issues=@($issues) }
    $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $workspace 'docs/evidence/p25/native-results.json') -Encoding utf8
    $report | ConvertTo-Json -Depth 6
    if ($issues.Count -gt 0 -or -not $textEditable -or -not $shapeEditable -or -not $pictureEditable) { exit 1 }
} finally { $presentation.Saved = -1; $presentation.Close() }
