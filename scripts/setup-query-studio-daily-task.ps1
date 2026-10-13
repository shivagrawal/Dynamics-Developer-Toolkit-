$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$RunnerScript = Join-Path $PSScriptRoot "run-query-studio-tests.ps1"
$TaskName = "DynamicsDeveloperToolkit-QueryStudio-DailyRegression"
$Node = (Get-Command node -ErrorAction Stop).Source

# Runs offline tests daily at 8:00 AM local time. Live tests and audit tests are never scheduled.
$Action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$RunnerScript`""
$Trigger = New-ScheduledTaskTrigger -Daily -At 8:00AM
$Settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 30)
Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger $Trigger -Settings $Settings -Description "Runs offline Query Studio syntax, manifest and regression tests. Does not run live Dataverse or audit tests." -Force | Out-Null
Write-Host "Created scheduled task: $TaskName"
Write-Host "Daily at 8:00 AM local time; offline tests only."
Write-Host "Run on demand: powershell -NoProfile -ExecutionPolicy Bypass -File `"$RunnerScript`""
