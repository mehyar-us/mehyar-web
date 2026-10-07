# Draw the original geometric M app mark; no avatar/image editing or external fonts.
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$assetDirectory=Join-Path $PSScriptRoot '../web/public'
foreach($size in @(180,192,512)){
  $bitmap=[System.Drawing.Bitmap]::new($size,$size)
  $graphics=[System.Drawing.Graphics]::FromImage($bitmap)
  $brush=[System.Drawing.SolidBrush]::new([System.Drawing.Color]::White)
  try{
    $graphics.SmoothingMode=[System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $graphics.Clear([System.Drawing.ColorTranslator]::FromHtml('#102b47'))
    # Keep the mark within the maskable icon's central safe circle.
    $coordinates=@(@(.27,.73),@(.27,.27),@(.37,.27),@(.50,.47),@(.63,.27),@(.73,.27),@(.73,.73),@(.63,.73),@(.63,.46),@(.50,.64),@(.37,.46),@(.37,.73))
    [System.Drawing.PointF[]]$points=foreach($point in $coordinates){[System.Drawing.PointF]::new([single]($point[0]*$size),[single]($point[1]*$size))}
    $graphics.FillPolygon($brush,$points)
    $bitmap.Save((Join-Path $assetDirectory "icon-$size.png"),[System.Drawing.Imaging.ImageFormat]::Png)
  }finally{$brush.Dispose();$graphics.Dispose();$bitmap.Dispose()}
}
