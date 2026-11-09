# Starts the site-changes runner (inside WSL) automatically when you sign in to
# Windows, with no window. Run once in Windows PowerShell:
#
#   powershell -ExecutionPolicy Bypass -File scripts\laptop-runner\install-startup.ps1
#
# Add -KeepAwake to stop the laptop sleeping while it's plugged in, so requests
# sent from your phone can still reach it.
param(
  [string]$Distro = 'Ubuntu',
  [string]$RunnerDir = '~/actions-runner',
  [switch]$KeepAwake
)

$taskName = 'thelibrary site-changes runner'
$command = "$RunnerDir/run.sh"
$action = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument "--headless wsl.exe -d $Distro -- bash -lc `"$command`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host "Registered and started '$taskName'. It starts again each time you sign in."

if ($KeepAwake) {
  powercfg /change standby-timeout-ac 0
  Write-Host 'Sleep while plugged in is now off. Undo with: powercfg /change standby-timeout-ac 30'
}

Write-Host "To remove it later: Unregister-ScheduledTask -TaskName '$taskName' -Confirm:`$false"
