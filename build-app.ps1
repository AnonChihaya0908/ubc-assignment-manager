$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcherSource = Join-Path $appRoot 'launcher\Program.cs'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
$runtimeDir = Join-Path $appRoot 'runtime'
$sourceNode = (Get-Command node -ErrorAction Stop).Source
$productName = 'UBC作业管理工具'
$outputExe = Join-Path $appRoot "$productName.exe"

if (-not (Test-Path -LiteralPath $compiler)) { throw '未找到 Windows C# 编译器。' }

New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
$bundledNode = Join-Path $runtimeDir 'node.exe'
if (-not (Test-Path -LiteralPath $bundledNode)) {
  Copy-Item -LiteralPath $sourceNode -Destination $bundledNode -Force
}

& $compiler /nologo /target:winexe /codepage:65001 "/out:$outputExe" $launcherSource
if ($LASTEXITCODE -ne 0) { throw 'Windows 应用启动器编译失败。' }
Write-Output "已生成：$outputExe"

$releaseRoot = Join-Path $appRoot 'release'
$packageDir = Join-Path $releaseRoot $productName
$rootFull = [IO.Path]::GetFullPath($appRoot)
$packageFull = [IO.Path]::GetFullPath($packageDir)
if (-not $packageFull.StartsWith($rootFull + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw '打包目录不在工作区内。' }
if (Test-Path -LiteralPath $packageDir) { Remove-Item -LiteralPath $packageDir -Recurse -Force }
New-Item -ItemType Directory -Path $packageDir,(Join-Path $packageDir 'lib'),(Join-Path $packageDir 'public'),(Join-Path $packageDir 'runtime') -Force | Out-Null
foreach ($name in @("$productName.exe",'app.js','notify.ps1','README.md')) {
  Copy-Item -LiteralPath (Join-Path $appRoot $name) -Destination $packageDir
}
Copy-Item -Path (Join-Path $appRoot 'lib\*') -Destination (Join-Path $packageDir 'lib') -Recurse
Copy-Item -Path (Join-Path $appRoot 'public\*') -Destination (Join-Path $packageDir 'public') -Recurse
Copy-Item -LiteralPath $bundledNode -Destination (Join-Path $packageDir 'runtime\node.exe')
$archive = Join-Path $releaseRoot "$productName-1.0.0.zip"
Compress-Archive -LiteralPath $packageDir -DestinationPath $archive -Force
Write-Output "便携包：$archive"
