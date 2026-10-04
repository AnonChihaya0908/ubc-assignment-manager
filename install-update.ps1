param(
  [Parameter(Mandatory=$true)][string]$Archive,
  [Parameter(Mandatory=$true)][string]$AppDirectory,
  [Parameter(Mandatory=$true)][string]$StageDirectory,
  [Parameter(Mandatory=$true)][string]$Version,
  [Parameter(Mandatory=$true)][int]$ParentPid,
  [string]$HealthUrl = 'http://127.0.0.1:43873/api/state',
  [int]$HealthAttempts = 30
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$product = 'UBC作业管理工具'
$appRoot = [IO.Path]::GetFullPath($AppDirectory).TrimEnd('\')
$stageRoot = [IO.Path]::GetFullPath($StageDirectory).TrimEnd('\')
$updatesRoot = [IO.Path]::GetFullPath((Split-Path -Parent $stageRoot)).TrimEnd('\')
$resultPath = Join-Path $updatesRoot 'last-update.json'
$backup = Join-Path $stageRoot 'backup'
$extracted = Join-Path $stageRoot 'extracted'
$folders = @('lib', 'public', 'runtime')
$files = @("$product.exe", 'app.js', 'notify.ps1', 'README.md', 'package.json', 'install-update.ps1')
$oldMoved = $false
$newLaunched = $false

function Assert-Child([string]$parent, [string]$target) {
  $full = [IO.Path]::GetFullPath($target)
  if (-not $full.StartsWith($parent + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "目标路径超出允许范围：$full"
  }
  return $full
}

function Write-Result([string]$state, [string]$detail) {
  @{ state = $state; version = $Version; detail = $detail; at = (Get-Date).ToUniversalTime().ToString('o') } |
    ConvertTo-Json -Compress | Set-Content -LiteralPath $resultPath -Encoding UTF8
}

try {
  if ($appRoot -eq [IO.Path]::GetPathRoot($appRoot) -or $stageRoot -eq [IO.Path]::GetPathRoot($stageRoot)) { throw '更新路径无效。' }
  if ($stageRoot.StartsWith($appRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw '暂存目录不能位于应用目录内。' }
  if (-not (Test-Path -LiteralPath $appRoot -PathType Container)) { throw '应用目录不存在。' }
  $archivePath = Assert-Child $stageRoot $Archive
  if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf)) { throw '更新包不存在。' }
  if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw '目标版本号无效。' }
  if ($HealthUrl -notmatch '^http://127\.0\.0\.1:\d+/api/state$' -or $HealthAttempts -lt 1 -or $HealthAttempts -gt 30) { throw '健康检查参数无效。' }

  $deadline = (Get-Date).AddSeconds(40)
  while (Get-Process -Id $ParentPid -ErrorAction SilentlyContinue) {
    if ((Get-Date) -gt $deadline) { throw '旧版应用未退出，安装已取消。' }
    Start-Sleep -Milliseconds 500
  }

  New-Item -ItemType Directory -Path $extracted, $backup -Force | Out-Null
  $zip = [IO.Compression.ZipFile]::OpenRead($archivePath)
  try {
    $total = [long]0
    $prefix = "$product/"
    foreach ($entry in $zip.Entries) {
      $entryName = $entry.FullName.Replace('\', '/')
      if (-not $entryName.StartsWith($prefix, [StringComparison]::Ordinal) -or
          $entryName -match '(^|/)\.\.(/|$)' -or $entryName.Contains(':') -or
          $entryName -match '/\.local-data(/|$)') { throw '更新包包含不允许的路径。' }
      $relative = $entryName.Substring($prefix.Length)
      if ($relative -and -not ($files -contains $relative) -and
          -not ($relative -match '^(lib|public|runtime)/')) { throw '更新包包含未预期的文件。' }
      $total += $entry.Length
      if ($total -gt 500MB) { throw '更新包解压后过大。' }
    }
  } finally { $zip.Dispose() }
  [IO.Compression.ZipFile]::ExtractToDirectory($archivePath, $extracted)
  $source = Assert-Child $extracted (Join-Path $extracted $product)
  foreach ($item in $folders + $files) {
    if (-not (Test-Path -LiteralPath (Join-Path $source $item))) { throw "更新包缺少 $item。" }
  }
  $manifest = Get-Content -LiteralPath (Join-Path $source 'package.json') -Raw | ConvertFrom-Json
  if ($manifest.version -ne $Version) { throw '更新包版本与 GitHub Release 不一致。' }

  foreach ($item in $folders + $files) {
    $original = Assert-Child $appRoot (Join-Path $appRoot $item)
    $saved = Assert-Child $backup (Join-Path $backup $item)
    if (Test-Path -LiteralPath $original) { Move-Item -LiteralPath $original -Destination $saved; $oldMoved = $true }
  }
  foreach ($item in $folders + $files) {
    $destination = Assert-Child $appRoot (Join-Path $appRoot $item)
    Copy-Item -LiteralPath (Join-Path $source $item) -Destination $destination -Recurse
  }
  Start-Process -FilePath (Join-Path $appRoot "$product.exe") -WorkingDirectory $appRoot -WindowStyle Hidden
  $newLaunched = $true
  $ready = $false
  for ($i = 0; $i -lt $HealthAttempts; $i++) {
    Start-Sleep -Seconds 1
    try {
      $state = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 2
      if ($state.version -eq $Version) { $ready = $true; break }
    } catch { }
  }
  if (-not $ready) { throw '新版应用未能启动，正在恢复旧版。' }
  Write-Result 'success' "已更新到 $Version。"
} catch {
  $detail = $_.Exception.Message
  if ($newLaunched) {
    try {
      $running = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 2
      if ($running.version -eq $Version) {
        Invoke-RestMethod -Uri ($HealthUrl -replace '/api/state$', '/api/shutdown') -Method Post -ContentType 'application/json' -Body '{}' -TimeoutSec 3 | Out-Null
        Start-Sleep -Seconds 2
      }
    } catch { }
  }
  if ($oldMoved -and (Test-Path -LiteralPath $backup -PathType Container)) {
    foreach ($item in $folders + $files) {
      $original = Assert-Child $appRoot (Join-Path $appRoot $item)
      $saved = Assert-Child $backup (Join-Path $backup $item)
      if (Test-Path -LiteralPath $saved) {
        if (Test-Path -LiteralPath $original) { Remove-Item -LiteralPath $original -Recurse -Force }
        Move-Item -LiteralPath $saved -Destination $original
      }
    }
    if (Test-Path -LiteralPath (Join-Path $appRoot "$product.exe")) {
      Start-Process -FilePath (Join-Path $appRoot "$product.exe") -WorkingDirectory $appRoot -WindowStyle Hidden
    }
  }
  Write-Result 'failed' $detail
} finally {
  if (Test-Path -LiteralPath $stageRoot -PathType Container) {
    Assert-Child $updatesRoot $stageRoot | Out-Null
    Remove-Item -LiteralPath $stageRoot -Recurse -Force
  }
}
