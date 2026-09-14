<#
.SYNOPSIS
Prepares the editable, 39-slide MISU reference template and browser backgrounds.
.DESCRIPTION
Requires Windows and installed PowerPoint. The PPTX is edited directly as ZIP/XML;
PowerPoint opens a temporary byte-identical source copy read-only, without a
window, only to measure text and export previews from memory. A distinct path
prevents PowerPoint from reusing an already-open user presentation. The temporary
copy is removed. Source paragraphs, runs, formatting, and unmarked parts survive.

Manifest coordinates are slide-relative points. Paragraph left/width describe the
full native text content box, while sourceBounds describe the measured source
text. Paragraph height extends to the next paragraph or the field bottom;
sourceOverflowBottom records intentional native overflow beyond that space.
Each native paragraph has its own slot, including trailing empty paragraphs.
lineHeight is a font-size multiplier; lineHeightPoints is its point equivalent.
lineSpacing and paragraph spacing retain PowerPoint's units, qualified by the
corresponding *IsMultiple flags.
Each slide description includes all unmarked native text, including intentional
static officer names. Marked shapes are represented by their paragraph slots.
.EXAMPLE
.\create-main-agenda-template.ps1 -SourcePath 'C:\slides\Main Slides.pptx' `
    -OutputPath '..\..\backend\static\main-slides\main-agenda-template.pptx'
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$SourcePath,
    [Parameter(Mandatory = $true)]
    [string]$OutputPath,
    [string]$PreviewOutputDirectory,
    [string]$ManifestPath = (Join-Path $PSScriptRoot '..\src\lib\mainSlidesTemplate.json')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$utf8 = [Text.UTF8Encoding]::new($false, $true)
$shapePattern = [regex]::new('<p:sp\b[^>]*>.*?</p:sp>', 'Singleline')
$paragraphPattern = [regex]::new('<a:p(?:\s[^>]*)?>.*?</a:p>|<a:p(?:\s[^>]*)?/>', 'Singleline')
$textPattern = [regex]::new('(?<open><a:t(?:\s[^>]*)?>)(?<text>.*?)(?<close></a:t>)', 'Singleline')
$namePattern = [regex]::new('(?<open><p:cNvPr\b[^>]*\bname=")[^"]*(?<close>")')

function Read-ZipBytes($Archive, [string]$Name) {
    $entry = $Archive.GetEntry($Name)
    if ($null -eq $entry) { throw "Source presentation is missing ZIP part '$Name'." }
    $stream = $entry.Open()
    $buffer = [IO.MemoryStream]::new()
    try {
        $stream.CopyTo($buffer)
        return ,$buffer.ToArray()
    }
    finally {
        $buffer.Dispose()
        $stream.Dispose()
    }
}

function Read-Xml([string]$Text) {
    $xml = [Xml.XmlDocument]::new()
    $xml.PreserveWhitespace = $true
    $xml.XmlResolver = $null
    $xml.LoadXml($Text.TrimStart([char]0xfeff))
    return ,$xml
}

function Get-Namespaces($Xml) {
    $ns = [Xml.XmlNamespaceManager]::new($Xml.NameTable)
    $ns.AddNamespace('p', 'http://schemas.openxmlformats.org/presentationml/2006/main')
    $ns.AddNamespace('a', 'http://schemas.openxmlformats.org/drawingml/2006/main')
    $ns.AddNamespace('r', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
    return ,$ns
}

function Get-ParagraphText($Paragraph, $Namespaces) {
    return ($Paragraph.SelectNodes('.//a:t', $Namespaces) | ForEach-Object InnerText) -join ''
}

function Get-Hash([byte[]]$Bytes) {
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash($Bytes)) }
    finally { $sha.Dispose() }
}

function Release-Com($Object) {
    if ($null -ne $Object -and [Runtime.InteropServices.Marshal]::IsComObject($Object)) {
        [void][Runtime.InteropServices.Marshal]::ReleaseComObject($Object)
    }
}

function Get-Number($Value) {
    return [Math]::Round([double]$Value, 4)
}

function Get-ShapeById($Slide, [int]$Id, [int]$Number) {
    $shapes = $Slide.Shapes
    try {
        for ($index = 1; $index -le $shapes.Count; $index++) {
            $shape = $shapes.Item($index)
            if ($shape.Id -eq $Id) { return ,$shape }
            Release-Com $shape
        }
        throw "PowerPoint slide $Number is missing required shape id $Id."
    }
    finally { Release-Com $shapes }
}

function Get-FieldLayout($Shape, $Contract, [int]$Number) {
    $frame = $null
    $range = $null
    $allParagraphs = $null
    try {
        $frame = $Shape.TextFrame
        $range = $frame.TextRange
        $allParagraphs = $range.Paragraphs()
        $count = $allParagraphs.Count
        $left = [double]$Shape.Left + [double]$frame.MarginLeft
        $width = [double]$Shape.Width - [double]$frame.MarginLeft - [double]$frame.MarginRight
        $paragraphs = [Collections.Generic.List[object]]::new()
        for ($index = 0; $index -lt $Contract.texts.Count; $index++) {
            $paragraph = $null
            $firstCharacter = $null
            $font = $null
            $color = $null
            $format = $null
            $lines = $null
            try {
                # PowerPoint omits the final empty XML paragraph from TextRange.
                $trailingEmpty = $index -ge $count
                if ($trailingEmpty -and ($Contract.texts[$index] -ne '' -or $index -ne $count)) {
                    throw "Slide $Number shape $($Contract.id): PowerPoint exposes $count paragraphs, XML has $($Contract.texts.Count)."
                }
                $paragraph = $range.Paragraphs([Math]::Min($index + 1, $count), 1)
                $firstCharacter = $paragraph.Characters(1, 1)
                $font = $firstCharacter.Font
                $color = $font.Color
                $format = $paragraph.ParagraphFormat
                $lines = $paragraph.Lines()
                $align = switch ([int]$format.Alignment) {
                    1 { 'left' }
                    2 { 'center' }
                    3 { 'right' }
                    default { throw "Slide $Number shape $($Contract.id) paragraph $($index + 1) has unsupported alignment $($format.Alignment)." }
                }
                $rgb = [int]$color.RGB
                $fontSize = [double]$font.Size
                if ($fontSize -le 0 -or $width -le 0) {
                    throw "Invalid text geometry on slide $Number shape $($Contract.id), paragraph $($index + 1)."
                }
                $boundTop = [double]$paragraph.BoundTop
                $boundHeight = [double]$paragraph.BoundHeight
                $sourceBounds = [ordered]@{
                    left = Get-Number $paragraph.BoundLeft
                    top = Get-Number $boundTop
                    width = Get-Number $paragraph.BoundWidth
                    height = Get-Number $boundHeight
                }
                if ($trailingEmpty) {
                    $boundTop += $boundHeight
                    $boundHeight = 0
                    $sourceBounds = $null
                }
                $lineHeight = if ($format.LineRuleWithin -ne 0) {
                    $fontSize * 1.2 * [double]$format.SpaceWithin
                }
                else { [double]$format.SpaceWithin }
                $paragraphs.Add([ordered]@{
                    text = $Contract.texts[$index]
                    left = Get-Number $left
                    top = Get-Number $boundTop
                    width = Get-Number $width
                    height = Get-Number $boundHeight
                    fontSize = Get-Number $fontSize
                    color = ('#{0:x2}{1:x2}{2:x2}' -f ($rgb -band 255), (($rgb -shr 8) -band 255), (($rgb -shr 16) -band 255))
                    bold = $font.Bold -eq -1
                    italic = $font.Italic -eq -1
                    align = $align
                    fontFamily = [string]$font.Name
                    lineHeight = Get-Number ($lineHeight / $fontSize)
                    lineHeightPoints = Get-Number $lineHeight
                    lineSpacing = Get-Number $format.SpaceWithin
                    lineSpacingIsMultiple = $format.LineRuleWithin -ne 0
                    spaceBefore = Get-Number $format.SpaceBefore
                    spaceBeforeIsMultiple = $format.LineRuleBefore -ne 0
                    spaceAfter = Get-Number $format.SpaceAfter
                    spaceAfterIsMultiple = $format.LineRuleAfter -ne 0
                    sourceLineCount = [int]$lines.Count
                    sourceBounds = $sourceBounds
                    empty = $Contract.texts[$index] -eq ''
                    editable = $index -notin $Contract.preserve
                })
            }
            finally {
                Release-Com $lines
                Release-Com $format
                Release-Com $color
                Release-Com $font
                Release-Com $firstCharacter
                Release-Com $paragraph
            }
        }
        for ($index = 0; $index -lt $paragraphs.Count; $index++) {
            $slot = $paragraphs[$index]
            $bottom = if ($index + 1 -lt $paragraphs.Count) {
                $paragraphs[$index + 1].top
            }
            else { [double]$Shape.Top + [double]$Shape.Height }
            if ($bottom -lt $slot.top) {
                throw "Slide $Number shape $($Contract.id) paragraph $($index + 1) starts below its available text box."
            }
            $slot.height = Get-Number ($bottom - $slot.top)
            $slot.sourceOverflowBottom = if ($null -eq $slot.sourceBounds) { 0 } else {
                Get-Number ([Math]::Max(0.0, [double]($slot.sourceBounds.height - $slot.height)))
            }
        }
        return [ordered]@{
            marker = $Contract.marker
            left = Get-Number $Shape.Left
            top = Get-Number $Shape.Top
            width = Get-Number $Shape.Width
            height = Get-Number $Shape.Height
            marginLeft = Get-Number $frame.MarginLeft
            marginTop = Get-Number $frame.MarginTop
            marginRight = Get-Number $frame.MarginRight
            marginBottom = Get-Number $frame.MarginBottom
            verticalAnchor = [int]$frame.VerticalAnchor
            paragraphs = @($paragraphs.ToArray())
        }
    }
    finally {
        Release-Com $allParagraphs
        Release-Com $range
        Release-Com $frame
    }
}

function Set-ShapeFields([string]$Text, $Contract, [int]$Number) {
    $shapeMatches = $shapePattern.Matches($Text)
    $matchingShapes = @($shapeMatches | Where-Object {
        $_.Value -match ('<p:cNvPr\b[^>]*\bid="' + $Contract.id + '"')
    })
    if ($matchingShapes.Count -ne 1) {
        throw "Slide $Number must contain exactly one native text shape id $($Contract.id); found $($matchingShapes.Count)."
    }
    $match = $matchingShapes[0]
    $shapeText = $match.Value
    $paragraphMatches = $paragraphPattern.Matches($shapeText)
    if ($paragraphMatches.Count -ne $Contract.texts.Count) {
        throw "Slide $Number shape $($Contract.id) must have $($Contract.texts.Count) paragraphs; found $($paragraphMatches.Count)."
    }
    for ($index = $paragraphMatches.Count - 1; $index -ge 0; $index--) {
        if ($index -in $Contract.preserve) { continue }
        $paragraphMatch = $paragraphMatches[$index]
        $paragraphText = $paragraphMatch.Value
        $textMatches = $textPattern.Matches($paragraphText)
        if ($textMatches.Count -eq 0 -and $Contract.texts[$index] -ne '') {
            throw "Slide $Number shape $($Contract.id) paragraph $($index + 1) has no existing text run for its placeholder."
        }
        for ($runIndex = $textMatches.Count - 1; $runIndex -ge 0; $runIndex--) {
            $textMatch = $textMatches[$runIndex].Groups['text']
            $replacement = if ($runIndex -eq 0) { [Security.SecurityElement]::Escape($Contract.texts[$index]) } else { '' }
            $paragraphText = $paragraphText.Remove($textMatch.Index, $textMatch.Length).Insert($textMatch.Index, $replacement)
        }
        $shapeText = $shapeText.Remove($paragraphMatch.Index, $paragraphMatch.Length).Insert($paragraphMatch.Index, $paragraphText)
    }
    if ($namePattern.Matches($shapeText).Count -ne 1) {
        throw "Slide $Number shape $($Contract.id) must have exactly one existing name attribute."
    }
    $shapeText = $namePattern.Replace($shapeText, ('${open}' + $Contract.marker + '${close}'), 1)
    return $Text.Remove($match.Index, $match.Length).Insert($match.Index, $shapeText)
}

function Get-NativeTitle($Xml, $Namespaces, [int]$Number) {
    $shapes = @($Xml.SelectNodes('/p:sld/p:cSld/p:spTree/p:sp[p:txBody/a:p//a:t]', $Namespaces))
    $titleShape = $shapes | Where-Object {
        $null -ne $_.SelectSingleNode('p:nvSpPr/p:nvPr/p:ph[@type="title" or @type="ctrTitle"]', $Namespaces)
    } | Select-Object -First 1
    if ($null -eq $titleShape) {
        $titleShape = $shapes | Where-Object {
            $_.SelectSingleNode('p:nvSpPr/p:cNvPr', $Namespaces).GetAttribute('name').StartsWith('MISU_FIELD:')
        } | Select-Object -First 1
    }
    if ($null -eq $titleShape) {
        $titleShape = $shapes | Sort-Object -Descending -Property {
            $sizes = @($_.SelectNodes('.//a:rPr/@sz', $Namespaces) | ForEach-Object { [int]$_.Value })
            if ($sizes.Count -eq 0) { 0 } else { ($sizes | Measure-Object -Maximum).Maximum }
        } | Select-Object -First 1
    }
    if ($null -eq $titleShape) { return "Slide $Number" }
    $titleParagraphs = $titleShape.SelectNodes('p:txBody/a:p', $Namespaces)
    if ($titleShape.SelectSingleNode('p:nvSpPr/p:cNvPr', $Namespaces).GetAttribute('name') -eq 'MISU_FIELD:session') {
        $titleParagraphs = @($titleParagraphs[0])
    }
    $title = (($titleParagraphs | ForEach-Object {
        Get-ParagraphText $_ $Namespaces
    }) -join ' ').Trim()
    # Keep titles concise; descriptions retain complete static roster text.
    return ($title -replace '\s*\(\d{4}[./-]\d{1,2}\s*[-\u2013\u2014]\s*\d{4}[./-]\d{1,2}\)', '').Trim()
}

function Get-StaticDescription($Xml, $Namespaces) {
    $paragraphs = $Xml.SelectNodes(
        '/p:sld/p:cSld/p:spTree//a:p[not(ancestor::p:sp[starts-with(p:nvSpPr/p:cNvPr/@name,"MISU_FIELD:")])]',
        $Namespaces
    )
    $lines = @(foreach ($paragraph in $paragraphs) {
        $text = (($paragraph.SelectNodes('.//a:t | .//a:br', $Namespaces) | ForEach-Object {
            if ($_.LocalName -eq 'br') { "`n" } else { $_.InnerText }
        }) -join '').Trim()
        if ($text.Length -gt 0) { $text }
    })
    return $lines -join "`n"
}

$SourcePath = (Resolve-Path -LiteralPath $SourcePath).ProviderPath
$OutputPath = [IO.Path]::GetFullPath($OutputPath)
$ManifestPath = [IO.Path]::GetFullPath($ManifestPath)
if ([string]::IsNullOrWhiteSpace($PreviewOutputDirectory)) {
    $PreviewOutputDirectory = [IO.Path]::GetDirectoryName($OutputPath)
}
$PreviewOutputDirectory = [IO.Path]::GetFullPath($PreviewOutputDirectory)
if ([IO.Path]::GetExtension($SourcePath) -ine '.pptx' -or [IO.Path]::GetExtension($OutputPath) -ine '.pptx') {
    throw 'SourcePath and OutputPath must be .pptx files.'
}
if ([IO.Path]::GetExtension($ManifestPath) -ine '.json') { throw 'ManifestPath must be a .json file.' }
if ([string]::Equals($SourcePath, $OutputPath, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'OutputPath must not overwrite the source presentation.'
}
if ($null -eq [type]::GetTypeFromProgID('PowerPoint.Application')) {
    throw 'Installed Microsoft PowerPoint is required to export the reference backgrounds.'
}

$contracts = @{}
foreach ($number in @(5, 20, 22, 23, 25, 26, 29, 32, 34)) {
    $contracts[$number] = @(@{ id = 3; marker = 'MISU_FIELD:session'; texts = @('TBD', 'TBD'); preserve = @() })
}
$contracts[6] = @(
    @{ id = 2; marker = 'MISU_FIELD:intro.title'; texts = @('TBD'); preserve = @() },
    @{ id = 3; marker = 'MISU_FIELD:intro.detail'; texts = @('TBD', 'Microsoft Suzhou Toastmasters Club', 'TBD'); preserve = @(1) }
)
foreach ($number in @(21, 24, 28)) {
    $texts = @(if ($number -eq 21) { 'TBD'; 'TBD' } else { 'TBD' })
    $contracts[$number] = @(@{ id = 2; marker = 'MISU_FIELD:section'; texts = $texts; preserve = @() })
}
foreach ($number in @(27, 30, 35, 36, 37)) {
    $id = if ($number -in @(27, 30)) { 5 } else { 3 }
    $contracts[$number] = @(@{ id = $id; marker = 'MISU_FIELD:heading'; texts = @('TBD'); preserve = @() })
}
$contracts[31] = @(@{ id = 3; marker = 'MISU_FIELD:reports'; texts = @('TBD', 'TBD'); preserve = @() })
$contracts[33] = @(@{ id = 3; marker = 'MISU_FIELD:reports'; texts = @('TBD', 'TBD', ''); preserve = @(2) })
$contracts[38] = @(
    @{ id = 4; marker = 'MISU_FIELD:appreciation.manager'; texts = @('Meeting Manager', 'TBD'); preserve = @(0) },
    @{ id = 6; marker = 'MISU_FIELD:appreciation.photographer'; texts = @('Photographer', 'TBD'); preserve = @(0) }
)

$sourceHash = (Get-FileHash -LiteralPath $SourcePath -Algorithm SHA256).Hash
$source = [IO.Compression.ZipFile]::OpenRead($SourcePath)
$stagingDirectories = [Collections.Generic.List[string]]::new()
$publications = [Collections.Generic.List[object]]::new()
$completed = $false
$app = $null
$presentations = $null
$presentation = $null
$slides = $null
$ownsApplication = @(Get-Process -Name POWERPNT -ErrorAction SilentlyContinue).Count -eq 0
try {
    $presentationXml = Read-Xml ($utf8.GetString((Read-ZipBytes $source 'ppt/presentation.xml')))
    $ns = Get-Namespaces $presentationXml
    $slideIds = @($presentationXml.SelectNodes('/p:presentation/p:sldIdLst/p:sldId', $ns))
    $slideEntries = @($source.Entries | Where-Object FullName -match '^ppt/slides/slide\d+\.xml$')
    if ($slideIds.Count -ne 39 -or $slideEntries.Count -ne 39) {
        throw "Expected 39 source slides; presentation lists $($slideIds.Count) and ZIP contains $($slideEntries.Count)."
    }
    $size = $presentationXml.SelectSingleNode('/p:presentation/p:sldSz', $ns)
    if ($size.GetAttribute('cx') -ne '12192000' -or $size.GetAttribute('cy') -ne '6858000') {
        throw 'Expected the 960 x 540 point MISU reference slide size.'
    }
    $relationships = Read-Xml ($utf8.GetString((Read-ZipBytes $source 'ppt/_rels/presentation.xml.rels')))
    $slideParts = @{}
    $updatedSlides = @{}
    $titles = @{}
    $descriptions = @{}
    $originalPersonalText = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    for ($number = 1; $number -le 39; $number++) {
        $relationshipId = $slideIds[$number - 1].GetAttribute('id', $ns.LookupNamespace('r'))
        $relationship = @($relationships.DocumentElement.ChildNodes | Where-Object {
            $_.GetAttribute('Id') -eq $relationshipId -and $_.GetAttribute('Type').EndsWith('/slide')
        })
        if ($relationship.Count -ne 1 -or $relationship[0].GetAttribute('TargetMode') -eq 'External') {
            throw "Slide $number has an invalid presentation relationship '$relationshipId'."
        }
        $part = ([Uri]::new([Uri]'https://pptx.invalid/ppt/presentation.xml', $relationship[0].GetAttribute('Target'))).AbsolutePath.TrimStart('/')
        if ($part -notmatch '^ppt/slides/slide\d+\.xml$' -or $part -in $slideParts.Values) {
            throw "Slide $number has an unexpected or duplicate slide part '$part'."
        }
        $slideParts[$number] = $part
        $text = $utf8.GetString((Read-ZipBytes $source $part))
        $xml = Read-Xml $text
        $slideNs = Get-Namespaces $xml
        if ($contracts.ContainsKey($number)) {
            foreach ($contract in $contracts[$number]) {
                $shape = $xml.SelectSingleNode("/p:sld/p:cSld/p:spTree/p:sp[p:nvSpPr/p:cNvPr[@id='$($contract.id)']]", $slideNs)
                if ($null -eq $shape) { throw "Slide $number is missing required native text shape id $($contract.id) ($($contract.marker))." }
                $paragraphs = @($shape.SelectNodes('p:txBody/a:p', $slideNs))
                if ($paragraphs.Count -ne $contract.texts.Count) {
                    throw "Slide $number shape $($contract.id) requires $($contract.texts.Count) paragraphs; found $($paragraphs.Count)."
                }
                foreach ($index in $contract.preserve) {
                    $label = Get-ParagraphText $paragraphs[$index] $slideNs
                    if ($label -cne $contract.texts[$index]) {
                        throw "Slide $number shape $($contract.id) paragraph $($index + 1) must preserve label '$($contract.texts[$index])'; found '$label'."
                    }
                }
                $personalIndices = switch ($contract.marker) {
                    'MISU_FIELD:session' { @(1) }
                    'MISU_FIELD:intro.detail' { @(0, 2) }
                    'MISU_FIELD:reports' { @(0, 1) }
                    'MISU_FIELD:appreciation.manager' { @(1) }
                    'MISU_FIELD:appreciation.photographer' { @(1) }
                    default { @() }
                }
                foreach ($index in $personalIndices) {
                    $personalText = Get-ParagraphText $paragraphs[$index] $slideNs
                    if (-not [string]::IsNullOrWhiteSpace($personalText)) {
                        [void]$originalPersonalText.Add($personalText.Trim())
                    }
                }
                $text = Set-ShapeFields $text $contract $number
            }
            $updatedSlides[$part] = $utf8.GetBytes($text)
            $xml = Read-Xml $text
            $slideNs = Get-Namespaces $xml
        }
        $titles[$number] = Get-NativeTitle $xml $slideNs $number
        $descriptions[$number] = Get-StaticDescription $xml $slideNs
    }

    $stageId = '.main-agenda-' + [Guid]::NewGuid().ToString('N')
    $stages = @{}
    foreach ($parent in @([IO.Path]::GetDirectoryName($OutputPath), $PreviewOutputDirectory, [IO.Path]::GetDirectoryName($ManifestPath))) {
        if (-not $stages.ContainsKey($parent)) {
            [void][IO.Directory]::CreateDirectory($parent)
            $stage = Join-Path $parent $stageId
            [void][IO.Directory]::CreateDirectory($stage)
            $stages[$parent] = $stage
            $stagingDirectories.Add($stage)
        }
    }
    $templateStage = Join-Path $stages[[IO.Path]::GetDirectoryName($OutputPath)] 'template.pptx'
    [IO.File]::Copy($SourcePath, $templateStage)
    $template = [IO.Compression.ZipFile]::Open($templateStage, [IO.Compression.ZipArchiveMode]::Update)
    try {
        foreach ($part in $updatedSlides.Keys) {
            $entry = $template.GetEntry($part)
            $stream = $entry.Open()
            try {
                $stream.SetLength(0)
                $stream.Write($updatedSlides[$part], 0, $updatedSlides[$part].Length)
            }
            finally { $stream.Dispose() }
        }
    }
    finally { $template.Dispose() }

    $previewSourceStage = Join-Path $stages[[IO.Path]::GetDirectoryName($OutputPath)] 'preview-source.pptx'
    [IO.File]::Copy($SourcePath, $previewSourceStage)
    $app = New-Object -ComObject PowerPoint.Application
    $presentations = $app.Presentations
    $presentation = $presentations.Open($previewSourceStage, -1, 0, 0)
    $slides = $presentation.Slides
    if ($slides.Count -ne 39 -or $presentation.ReadOnly -ne -1 -or $presentation.FullName -ine $previewSourceStage) {
        throw 'PowerPoint must open the 39-slide temporary source copy read-only.'
    }
    $manifestSlides = [Collections.Generic.List[object]]::new()
    for ($number = 1; $number -le 39; $number++) {
        $slide = $slides.Item($number)
        $hiddenShapes = [Collections.Generic.List[object]]::new()
        try {
            $fields = [Collections.Generic.List[object]]::new()
            if ($contracts.ContainsKey($number)) {
                foreach ($contract in $contracts[$number]) {
                    $shape = Get-ShapeById $slide $contract.id $number
                    $hiddenShapes.Add(@{ shape = $shape; visible = $shape.Visible })
                    $fields.Add((Get-FieldLayout $shape $contract $number))
                    $shape.Visible = 0
                }
            }
            $filename = 'reference-slide-{0:00}.png' -f $number
            $imageStage = Join-Path $stages[$PreviewOutputDirectory] $filename
            $slide.Export($imageStage, 'PNG', 1440, 810)
            $png = [IO.File]::ReadAllBytes($imageStage)
            if ($png.Length -lt 24 -or [BitConverter]::ToString($png[0..7]) -ne '89-50-4E-47-0D-0A-1A-0A' -or
                [BitConverter]::ToString($png[16..23]) -ne '00-00-05-A0-00-00-03-2A') {
                throw "PowerPoint failed to export slide $number as a 1440 x 810 PNG."
            }
            $publications.Add(@{ staged = $imageStage; target = (Join-Path $PreviewOutputDirectory $filename); backup = $null; published = $false })
            $manifestSlides.Add([ordered]@{
                number = $number
                title = $titles[$number]
                description = $descriptions[$number]
                image = '/static/main-slides/' + $filename
                fields = @($fields.ToArray())
            })
        }
        finally {
            foreach ($hidden in $hiddenShapes) {
                $hidden.shape.Visible = $hidden.visible
                Release-Com $hidden.shape
            }
            Release-Com $slide
        }
    }
    $manifest = [ordered]@{ width = 960; height = 540; slides = @($manifestSlides.ToArray()) }
    $manifestStage = Join-Path $stages[[IO.Path]::GetDirectoryName($ManifestPath)] 'manifest.json'
    $manifestJson = ($manifest | ConvertTo-Json -Depth 12) + [Environment]::NewLine
    $dynamicMetadata = @(foreach ($slide in $manifest.slides) {
        $slide.title
        foreach ($field in $slide.fields) {
            foreach ($paragraph in $field.paragraphs) {
                if ($paragraph.editable) { $paragraph.text }
            }
        }
    })
    foreach ($personalText in $originalPersonalText) {
        foreach ($text in $dynamicMetadata) {
            if ($text.Contains($personalText)) {
                throw 'Generated title or dynamic paragraph still contains an original presenter, report, or meeting date.'
            }
        }
    }
    [IO.File]::WriteAllText($manifestStage, $manifestJson, $utf8)
    $roundTrip = Get-Content -LiteralPath $manifestStage -Raw | ConvertFrom-Json
    if ($roundTrip.slides.Count -ne 39 -or @($roundTrip.slides.fields).Count -ne 23) {
        throw 'Generated manifest must contain 39 slides and 23 marked shapes.'
    }

    $template = [IO.Compression.ZipFile]::OpenRead($templateStage)
    $unchangedCount = 0
    $mediaCount = 0
    $gifCount = 0
    try {
        if ($template.Entries.Count -ne $source.Entries.Count) { throw 'Template ZIP part count changed.' }
        foreach ($entry in $source.Entries) {
            $expected = if ($updatedSlides.ContainsKey($entry.FullName)) { $updatedSlides[$entry.FullName] } else { Read-ZipBytes $source $entry.FullName }
            $actual = Read-ZipBytes $template $entry.FullName
            if ((Get-Hash $expected) -ne (Get-Hash $actual)) { throw "Template ZIP part '$($entry.FullName)' did not match its expected bytes." }
            if (-not $updatedSlides.ContainsKey($entry.FullName)) { $unchangedCount++ }
            if ($entry.FullName.StartsWith('ppt/media/')) { $mediaCount++ }
            if ($entry.FullName -match '^ppt/media/.*\.gif$') { $gifCount++ }
        }
    }
    finally { $template.Dispose() }
    if ((Get-FileHash -LiteralPath $SourcePath -Algorithm SHA256).Hash -ne $sourceHash) {
        throw 'Source presentation changed during preparation; refusing to publish.'
    }

    # Publish only verified artifacts, replacing each file atomically on its volume.
    # Backups allow rollback if any subsequent publication fails.
    $publications.Add(@{ staged = $manifestStage; target = $ManifestPath; backup = $null; published = $false })
    $publications.Add(@{ staged = $templateStage; target = $OutputPath; backup = $null; published = $false })
    foreach ($publication in $publications) {
        if ([IO.File]::Exists($publication.target)) {
            $publication.backup = $publication.staged + '.previous'
            [IO.File]::Replace($publication.staged, $publication.target, $publication.backup)
        }
        else { [IO.File]::Move($publication.staged, $publication.target) }
        $publication.published = $true
    }
    $completed = $true
    Write-Output "Prepared 39 native slides, 23 marked shapes, and 39 backgrounds (1440 x 810)."
    Write-Output "Verified $unchangedCount unchanged ZIP parts, including all $mediaCount media parts ($gifCount GIF); source SHA256 unchanged."
    Write-Output "Template: $OutputPath"
    Write-Output "Manifest: $ManifestPath"
}
finally {
    try {
        try {
            Release-Com $slides
            if ($null -ne $presentation) {
                $presentation.Saved = -1
                $presentation.Close()
                Release-Com $presentation
            }
        }
        finally {
            if ($null -ne $app -and $ownsApplication -and $null -ne $presentations -and $presentations.Count -eq 0) {
                $app.Quit()
            }
            Release-Com $presentations
            Release-Com $app
        }
    }
    finally {
        $source.Dispose()
        if (-not $completed) {
            for ($index = $publications.Count - 1; $index -ge 0; $index--) {
                $publication = $publications[$index]
                if ($publication.published) {
                    if ($null -ne $publication.backup) {
                        [IO.File]::Replace($publication.backup, $publication.target, [NullString]::Value)
                    }
                    else { [IO.File]::Delete($publication.target) }
                }
            }
        }
        foreach ($stage in $stagingDirectories) {
            Remove-Item -LiteralPath $stage -Recurse -Force
        }
    }
}
