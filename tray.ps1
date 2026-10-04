param([int]$Port = 43873)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$baseUrl = "http://127.0.0.1:$Port"
$script:paused = $false
$script:failures = 0

function Invoke-LocalApi {
  param([string]$Path, [string]$Method = 'POST', [hashtable]$Body = @{})
  if ($Method -eq 'GET') {
    return Invoke-RestMethod -Uri "$baseUrl$Path" -Method Get -TimeoutSec 5
  }
  $json = $Body | ConvertTo-Json -Compress
  Invoke-RestMethod -Uri "$baseUrl$Path" -Method $Method -ContentType 'application/json' -Body $json -TimeoutSec 5
}

$tray = New-Object System.Windows.Forms.NotifyIcon
$exePath = Join-Path $PSScriptRoot 'UBC作业管理工具.exe'
try { $tray.Icon = [System.Drawing.Icon]::ExtractAssociatedIcon($exePath) }
catch { $tray.Icon = [System.Drawing.SystemIcons]::Application }
$tray.Text = 'UBC作业管理工具 · 后台运行中'
$tray.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$openItem = $menu.Items.Add('打开主窗口')
$syncItem = $menu.Items.Add('立即同步')
$pauseItem = $menu.Items.Add('暂停提醒')
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$exitItem = $menu.Items.Add('退出应用')
$tray.ContextMenuStrip = $menu

$openWindow = {
  try { Invoke-LocalApi '/api/window/open' | Out-Null }
  catch { $tray.ShowBalloonTip(4000, 'UBC作业管理工具', '主窗口暂时无法打开，请重新启动应用。', 'Error') }
}
$openItem.add_Click($openWindow)
$tray.add_DoubleClick($openWindow)
$syncItem.add_Click({
  try {
    Invoke-LocalApi '/api/sync-all/start' | Out-Null
    $tray.ShowBalloonTip(2500, 'UBC作业管理工具', '已开始同步课程。', 'Info')
  } catch { $tray.ShowBalloonTip(4000, '同步失败', $_.Exception.Message, 'Error') }
})
$pauseItem.add_Click({
  try {
    $result = Invoke-LocalApi '/api/reminders' 'PATCH' @{ paused = -not $script:paused }
    $script:paused = [bool]$result.wechat.remindersPaused
    $pauseItem.Text = if ($script:paused) { '恢复提醒' } else { '暂停提醒' }
  } catch { $tray.ShowBalloonTip(4000, '设置失败', $_.Exception.Message, 'Error') }
})
$exitItem.add_Click({
  try { Invoke-LocalApi '/api/shutdown' | Out-Null } catch {}
  $tray.Visible = $false
  [System.Windows.Forms.Application]::ExitThread()
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.add_Tick({
  try {
    $current = Invoke-LocalApi '/api/state' 'GET'
    $script:failures = 0
    $script:paused = [bool]$current.wechat.remindersPaused
    $pauseItem.Text = if ($script:paused) { '恢复提醒' } else { '暂停提醒' }
    $tray.Text = if ($script:paused) { 'UBC作业管理工具 · 提醒已暂停' } elseif ($current.syncing) { 'UBC作业管理工具 · 正在同步' } else { 'UBC作业管理工具 · 后台运行中' }
  } catch {
    $script:failures += 1
    if ($script:failures -ge 3) {
      $timer.Stop()
      $tray.Visible = $false
      [System.Windows.Forms.Application]::ExitThread()
    }
  }
})
$timer.Start()
$tray.ShowBalloonTip(5000, 'UBC作业管理工具', '应用正在后台运行。关闭主窗口不会停止提醒，可从托盘重新打开。', 'Info')
try { [System.Windows.Forms.Application]::Run() }
finally { $timer.Dispose(); $menu.Dispose(); $tray.Dispose() }
