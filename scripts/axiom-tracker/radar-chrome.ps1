param(
  [switch]$Minimized
)

$candidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chrome = $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $chrome) {
  Write-Error 'Google Chrome was not found.'
  exit 1
}

$profileDir = Join-Path $env:LOCALAPPDATA 'AxiomRadarChrome'
$extensionDir = (Resolve-Path (Join-Path $PSScriptRoot '..\..\extensions\axiom-radar-bridge')).Path
$firstRun = -not (Test-Path $profileDir)

$arguments = @(
  "--user-data-dir=`"$profileDir`"",
  '--no-first-run',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows',
  '--disable-features=CalculateNativeWinOcclusion,IntensiveWakeUpThrottling',
  '--window-size=2400,1500',
  '--force-device-scale-factor=0.6',
  '--new-window',
  'https://axiom.trade/pulse'
)
if ($firstRun) { $arguments += 'chrome://extensions' }

$style = if ($Minimized) { 'Minimized' } else { 'Normal' }
Start-Process -FilePath $chrome -ArgumentList $arguments -WindowStyle $style

Write-Host "Radar Chrome started with its own profile at $profileDir"
if ($firstRun) {
  Write-Host 'First run: sign in to Axiom in that window, then on the chrome://extensions tab turn on Developer mode,'
  Write-Host "click 'Load unpacked' and choose $extensionDir"
}
Write-Host 'Leave that window open (minimized is fine). Use your normal Chrome as usual.'
