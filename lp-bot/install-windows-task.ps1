# Registers a Windows Scheduled Task that starts the LP bot at logon and restarts it if it stops.
# Free alternative to a hosted service. Run once from PowerShell:
#   powershell -ExecutionPolicy Bypass -File lp-bot\install-windows-task.ps1
# Remove with: Unregister-ScheduledTask -TaskName ZenthisLpBot -Confirm:$false
$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node).Source
$action = New-ScheduledTaskAction -Execute $node -Argument "lp-bot\index.js" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName "ZenthisLpBot" -Action $action -Trigger $trigger -Settings $settings -Description "Zenthis atomic swap LP bot" -Force | Out-Null
Write-Host "Task ZenthisLpBot registered. Start now with: Start-ScheduledTask -TaskName ZenthisLpBot"
