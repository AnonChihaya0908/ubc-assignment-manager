$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcherSource = Join-Path $appRoot 'launcher\Program.cs'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$runtimeDir = Join-Path $appRoot 'runtime'
$sourceNode = (Get-Command node -ErrorAction Stop).Source
$productName = 'UBC作业管理工具'
$version = (Get-Content -LiteralPath (Join-Path $appRoot 'package.json') -Raw | ConvertFrom-Json).version
$outputExe = Join-Path $appRoot "$productName.exe"
$uninstallerExe = Join-Path $appRoot "卸载 $productName.exe"
$releaseRoot = Join-Path $appRoot 'release'
$iconPath = Join-Path $releaseRoot 'app.ico'

if (-not (Test-Path -LiteralPath $compiler)) { throw '未找到 Windows C# 编译器。' }

New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
Add-Type -AssemblyName System.Drawing
$bitmap = New-Object Drawing.Bitmap 256,256
$graphics = [Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.Clear([Drawing.Color]::FromArgb(55,75,210))
  $brush = [Drawing.SolidBrush]::new([Drawing.Color]::White)
  $font = [Drawing.Font]::new('Segoe UI',92,[Drawing.FontStyle]::Bold,[Drawing.GraphicsUnit]::Pixel)
  try { $graphics.DrawString('U',$font,$brush,53,58) } finally { $font.Dispose(); $brush.Dispose() }
  $icon = [Drawing.Icon]::FromHandle($bitmap.GetHicon())
  $stream = [IO.File]::Create($iconPath)
  try { $icon.Save($stream) } finally { $stream.Dispose(); $icon.Dispose() }
} finally { $graphics.Dispose(); $bitmap.Dispose() }

New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
$bundledNode = Join-Path $runtimeDir 'node.exe'
if (-not (Test-Path -LiteralPath $bundledNode)) {
  Copy-Item -LiteralPath $sourceNode -Destination $bundledNode -Force
}

& $compiler /nologo /target:winexe /codepage:65001 "/win32icon:$iconPath" "/out:$outputExe" $launcherSource
if ($LASTEXITCODE -ne 0) { throw 'Windows 应用启动器编译失败。' }
& $compiler /nologo /target:winexe /codepage:65001 "/win32icon:$iconPath" /reference:System.Windows.Forms.dll "/out:$uninstallerExe" (Join-Path $appRoot 'installer\Uninstaller.cs')
if ($LASTEXITCODE -ne 0) { throw 'Windows 卸载程序编译失败。' }
Write-Output "已生成：$outputExe"

$packageDir = Join-Path $releaseRoot $productName
$rootFull = [IO.Path]::GetFullPath($appRoot)
$packageFull = [IO.Path]::GetFullPath($packageDir)
if (-not $packageFull.StartsWith($rootFull + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw '打包目录不在工作区内。' }
if (Test-Path -LiteralPath $packageDir) { Remove-Item -LiteralPath $packageDir -Recurse -Force }
New-Item -ItemType Directory -Path $packageDir,(Join-Path $packageDir 'lib'),(Join-Path $packageDir 'public'),(Join-Path $packageDir 'runtime') -Force | Out-Null
foreach ($name in @("$productName.exe","卸载 $productName.exe",'app.js','notify.ps1','tray.ps1','README.md','package.json','install-update.ps1')) {
  Copy-Item -LiteralPath (Join-Path $appRoot $name) -Destination $packageDir
}
Copy-Item -Path (Join-Path $appRoot 'lib\*') -Destination (Join-Path $packageDir 'lib') -Recurse
Copy-Item -Path (Join-Path $appRoot 'public\*') -Destination (Join-Path $packageDir 'public') -Recurse
Copy-Item -LiteralPath $bundledNode -Destination (Join-Path $packageDir 'runtime\node.exe')
$archive = Join-Path $releaseRoot "ubc-assignment-manager-$version-windows.zip"
Compress-Archive -LiteralPath $packageDir -DestinationPath $archive -Force
$sha = [Security.Cryptography.SHA256]::Create()
$stream = [IO.File]::OpenRead($archive)
try { $hash = ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
finally { $stream.Dispose(); $sha.Dispose() }
[IO.File]::WriteAllText("$archive.sha256", "$hash  $(Split-Path -Leaf $archive)`n", (New-Object Text.UTF8Encoding($false)))
Write-Output "便携包：$archive"

$installerExe = Join-Path $releaseRoot "ubc-assignment-manager-$version-setup.exe"
& $compiler /nologo /target:winexe /codepage:65001 "/win32icon:$iconPath" /reference:System.Windows.Forms.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll /reference:Microsoft.CSharp.dll "/resource:$archive,payload.zip" "/out:$installerExe" (Join-Path $appRoot 'installer\Program.cs')
if ($LASTEXITCODE -ne 0) { throw 'Windows 安装程序编译失败。' }
$installerSha = [Security.Cryptography.SHA256]::Create()
$installerStream = [IO.File]::OpenRead($installerExe)
try { $installerHash = ([BitConverter]::ToString($installerSha.ComputeHash($installerStream))).Replace('-', '').ToLowerInvariant() }
finally { $installerStream.Dispose(); $installerSha.Dispose() }
[IO.File]::WriteAllText("$installerExe.sha256", "$installerHash  $(Split-Path -Leaf $installerExe)`n", (New-Object Text.UTF8Encoding($false)))
Write-Output "安装包：$installerExe"
