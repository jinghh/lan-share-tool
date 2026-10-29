param(
    [string]$Url = '',
    [string]$IconPath = '',
    [int]$ParentPid = 0
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$icon = $null
if ($IconPath -and (Test-Path $IconPath)) {
    try {
        $icon = New-Object System.Drawing.Icon($IconPath)
    } catch {
        $icon = $null
    }
}
if ($null -eq $icon) {
    $icon = [System.Drawing.SystemIcons]::Application
}

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = $icon
$notify.Text = 'LAN ShareBox'
$notify.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip

$openItem = $menu.Items.Add('打开 ShareBox')
$openItem.add_Click({
    if ($Url) {
        Start-Process $Url
    }
})

$dataItem = $menu.Items.Add('打开数据目录')
$dataItem.add_Click({
    if ($env:SHAREBOX_DATA_DIR) {
        Start-Process 'explorer.exe' $env:SHAREBOX_DATA_DIR
    }
})

$separator = New-Object System.Windows.Forms.ToolStripSeparator
$menu.Items.Add($separator) | Out-Null

$quitItem = $menu.Items.Add('退出')
$quitItem.add_Click({
    [System.Windows.Forms.Application]::Exit()
})

$notify.ContextMenuStrip = $menu
$notify.add_DoubleClick({
    if ($Url) {
        Start-Process $Url
    }
})

# 主进程被强杀（直接关闭控制台窗口）时托盘会变成孤儿图标，这里做看门狗
$watchdog = $null
if ($ParentPid -gt 0) {
    $watchdog = New-Object System.Windows.Forms.Timer
    $watchdog.Interval = 3000
    $watchdog.add_Tick({
        $alive = Get-Process -Id $ParentPid -ErrorAction SilentlyContinue
        if (-not $alive) {
            [System.Windows.Forms.Application]::Exit()
        }
    })
    $watchdog.Start()
}

[System.Windows.Forms.Application]::Run()

if ($watchdog) {
    $watchdog.Stop()
}
$notify.Visible = $false
$notify.Dispose()

Write-Output 'SHAREBOX_TRAY_EXIT'
