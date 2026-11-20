$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$powerPoint = New-Object -ComObject PowerPoint.Application
$results = @()
foreach ($name in @('mentor-real-replay', 'density-boundaries')) {
    $filePath = Join-Path $workspace "release/density/$name.pptx"
    $presentation = $powerPoint.Presentations.Open($filePath, -1, 0, 0)
    try {
        $issues = @()
        $textCount = 0
        $editChecked = $false
        foreach ($slide in $presentation.Slides) {
            foreach ($shape in $slide.Shapes) {
                if ($shape.HasTextFrame -ne -1 -or $shape.TextFrame.HasText -ne -1) { continue }
                $textCount++
                $range = $shape.TextFrame2.TextRange
                if ($range.BoundHeight -gt $shape.Height + 2 -or $range.BoundWidth -gt $shape.Width + 2) {
                    $issues += @{ page = $slide.SlideIndex; text = $range.Text; width = $range.BoundWidth; height = $range.BoundHeight; boxWidth = $shape.Width; boxHeight = $shape.Height }
                }
                if (-not $editChecked -and $slide.SlideIndex -gt 1) {
                    $original = $shape.TextFrame.TextRange.Text
                    $shape.TextFrame.TextRange.Text = $original + ' [edit check]'
                    if (-not $shape.TextFrame.TextRange.Text.EndsWith('[edit check]')) { throw 'Native text edit failed' }
                    $shape.TextFrame.TextRange.Text = $original
                    $editChecked = $true
                }
            }
        }
        $shapeToMove = @($presentation.Slides.Item(2).Shapes | Where-Object { $_.HasTextFrame -ne -1 -or $_.TextFrame.HasText -ne -1 })[0]
        $oldLeft = [double]$shapeToMove.Left
        $shapeToMove.Left = [double]($oldLeft + 1)
        if ([Math]::Abs($shapeToMove.Left - $oldLeft - 1) -gt 0.1) { throw 'Native shape edit failed' }
        $shapeToMove.Left = $oldLeft
        if ($name -eq 'mentor-real-replay') {
            $diagnostic = Get-Content -Raw -LiteralPath (Join-Path $workspace 'test/fixtures/mentor-real-diagnostic.json') | ConvertFrom-Json
            $raw = $diagnostic.response.content.text | ConvertFrom-Json
            $nativeText = (@($presentation.Slides.Item(4).Shapes | Where-Object { $_.HasTextFrame -eq -1 } | ForEach-Object { $_.TextFrame.TextRange.Text }) -join '') -replace '[\r\n\v]', ''
            foreach ($point in $raw.slides[3].points) { if (-not $nativeText.Contains($point)) { throw "Missing stage: $point" } }
            $presentation.Slides.Item(4).Export((Join-Path $workspace 'docs/evidence/density/05-native-mentor.png'), 'PNG', 1600, 900)
        } else {
            $presentation.Slides.Item(7).Export((Join-Path $workspace 'docs/evidence/density/06-native-six-points.png'), 'PNG', 1600, 900)
        }
        $results += @{ file = $name; pages = $presentation.Slides.Count; textObjects = $textCount; textEditable = $editChecked; shapeEditable = $true; issues = @($issues) }
    } finally {
        $presentation.Saved = -1
        $presentation.Close()
    }
}
$results | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $workspace 'release/density/native-results.json') -Encoding utf8
$results | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $workspace 'docs/evidence/density/07-native-final-results.json') -Encoding utf8
$results | ConvertTo-Json -Depth 6
if (@($results | Where-Object { $_.issues.Count -gt 0 }).Count -gt 0) { exit 1 }
