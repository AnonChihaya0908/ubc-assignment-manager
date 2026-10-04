param(
  [string]$Title = '作业提醒',
  [string]$Message = '有作业即将截止'
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$notification = New-Object System.Windows.Forms.NotifyIcon
try {
  $notification.Icon = [System.Drawing.SystemIcons]::Information
  $notification.Visible = $true
  $notification.BalloonTipTitle = $Title
  $notification.BalloonTipText = $Message
  $notification.ShowBalloonTip(10000)
  Start-Sleep -Seconds 11
} finally {
  $notification.Dispose()
}
