param([int]$Port = 43873)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$baseUrl = "http://127.0.0.1:$Port"
$script:paused = $false
$script:failures = 0
$script:language = if ((Get-UICulture).Name -like 'zh*') { 'zh' } else { 'en' }
$script:labels = @{
  zh = @{ app = 'UBC作业管理工具'; background = '后台运行中'; paused = '提醒已暂停'; syncing = '正在同步'; open = '打开主窗口'; sync = '立即同步'; pause = '暂停提醒'; resume = '恢复提醒'; exit = '退出应用'; openError = '主窗口暂时无法打开，请重新启动应用。'; started = '已开始同步课程。'; syncError = '同步失败'; settingsError = '设置失败'; welcome = '应用正在后台运行。关闭主窗口不会停止提醒，可从托盘重新打开。' }
  en = @{ app = 'UBC Assignment Manager'; background = 'Running in background'; paused = 'Reminders paused'; syncing = 'Syncing'; open = 'Open main window'; sync = 'Sync now'; pause = 'Pause reminders'; resume = 'Resume reminders'; exit = 'Quit app'; openError = 'The main window could not be opened. Restart the app.'; started = 'Course sync started.'; syncError = 'Sync failed'; settingsError = 'Settings failed'; welcome = 'The app is running in the background. Reopen it from the tray after closing the main window.' }
}
function T([string]$Key) { return $script:labels[$script:language][$Key] }
function Set-TrayLanguage($State) {
  $choice = $State.preferences.language
  if ($choice -eq 'en-US') { $script:language = 'en' }
  elseif ($choice -eq 'zh-CN') { $script:language = 'zh' }
  else { $script:language = if ($State.systemLocale -like 'zh*') { 'zh' } else { 'en' } }
}
function Update-TrayLabels([bool]$Syncing = $false) {
  $openItem.Text = T 'open'
  $syncItem.Text = T 'sync'
  $pauseItem.Text = T $(if ($script:paused) { 'resume' } else { 'pause' })
  $exitItem.Text = T 'exit'
  $tray.Text = "$(T 'app') · $(if ($script:paused) { T 'paused' } elseif ($Syncing) { T 'syncing' } else { T 'background' })"
}

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
$tray.Text = "$(T 'app') · $(T 'background')"
$tray.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$openItem = $menu.Items.Add((T 'open'))
$syncItem = $menu.Items.Add((T 'sync'))
$pauseItem = $menu.Items.Add((T 'pause'))
[void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$exitItem = $menu.Items.Add((T 'exit'))
$tray.ContextMenuStrip = $menu

$openWindow = {
  try { Invoke-LocalApi '/api/window/open' | Out-Null }
  catch { $tray.ShowBalloonTip(4000, (T 'app'), (T 'openError'), 'Error') }
}
$openItem.add_Click($openWindow)
$tray.add_DoubleClick($openWindow)
$syncItem.add_Click({
  try {
    Invoke-LocalApi '/api/sync-all/start' | Out-Null
    $tray.ShowBalloonTip(2500, (T 'app'), (T 'started'), 'Info')
  } catch { $tray.ShowBalloonTip(4000, (T 'syncError'), $_.Exception.Message, 'Error') }
})
$pauseItem.add_Click({
  try {
    $result = Invoke-LocalApi '/api/reminders' 'PATCH' @{ paused = -not $script:paused }
    $script:paused = [bool]$result.wechat.remindersPaused
    Update-TrayLabels
  } catch { $tray.ShowBalloonTip(4000, (T 'settingsError'), $_.Exception.Message, 'Error') }
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
    Set-TrayLanguage $current
    Update-TrayLabels ([bool]$current.syncing)
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
try {
  $initial = Invoke-LocalApi '/api/state' 'GET'
  $script:paused = [bool]$initial.wechat.remindersPaused
  Set-TrayLanguage $initial
  Update-TrayLabels ([bool]$initial.syncing)
} catch {}
$tray.ShowBalloonTip(5000, (T 'app'), (T 'welcome'), 'Info')
try { [System.Windows.Forms.Application]::Run() }
finally { $timer.Dispose(); $menu.Dispose(); $tray.Dispose() }
