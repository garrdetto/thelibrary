param([switch]$Remove)

# Registers (or removes) the Windows task that keeps the Axiom Radar tracker running without anyone starting it:
# every two minutes, for the signed-in user, it runs the guard in scripts/axiom-tracker/watchdog.mjs with no window.
# No administrator rights are needed. Run it from the folder the tracker runs in:
#   pnpm axiom:autostart            install or refresh
#   pnpm axiom:autostart:remove     remove

$ErrorActionPreference = 'Stop'
$taskName = 'Axiom Radar watchdog'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$launcher = Join-Path $PSScriptRoot 'watchdog-hidden.vbs'

if ($Remove) {
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Output "Removed the '$taskName' task. The tracker keeps running until it or PM2 stops."
  } else {
    Write-Output "There is no '$taskName' task to remove."
  }
  exit 0
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Node.js is not on PATH.' }
$pm2 = Join-Path $env:APPDATA 'npm\node_modules\pm2\bin\pm2'
if (-not (Test-Path $pm2)) { throw 'PM2 is not installed. Run: npm install -g pm2' }

$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "//B //Nologo `"$launcher`"" -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 2)
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 3)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "Starts the Axiom Radar tracker from $root and brings it back if it stops." -Force | Out-Null

& node $pm2 save | Out-Null
Write-Output "Installed the '$taskName' task for $env:USERNAME. Every two minutes Windows checks the tracker in $root and starts it or brings it back."
Write-Output 'The list PM2 is running now was saved, so everything in it comes back together after a restart.'
