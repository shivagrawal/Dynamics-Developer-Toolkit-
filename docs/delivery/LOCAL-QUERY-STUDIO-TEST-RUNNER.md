# Local Query Studio test runner (Windows)

This is a free local alternative to GitHub Actions for the Query Studio tests. It does not change `main`, push commits, merge pull requests, or alter Dataverse settings.

## Requirements

- Windows 10/11
- Node.js 20+ (Node 24 matches the current regression workflow)
- A local clone of the private repository on branch `work/local-query-studio-runner` or after this change is reviewed and merged/cherry-picked into the working branch.

## Run offline regression tests on demand

From the repository root in PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\run-query-studio-tests.ps1
```

This checks the same JavaScript syntax and manifest JSON as the current regression workflow and runs its nine offline Query Studio test files. Logs are saved under:
`%LOCALAPPDATA%\DynamicsDeveloperToolkit\QueryStudio\logs`

## Schedule daily offline tests

Run once in PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-query-studio-daily-task.ps1
```

Creates a Windows Task Scheduler task at 8:00 AM local time. The scheduled task runs offline tests only. Your computer must be on; Windows can run the task after a missed start when it becomes available.

Remove the task:

```powershell
Unregister-ScheduledTask -TaskName "DynamicsDeveloperToolkit-QueryStudio-DailyRegression" -Confirm:$false
```

## Optional live Dataverse integration tests

Set these as **current-user environment variables** in Windows, or load them from a local secret manager before invoking Node. Never commit credentials or paste them into chat:

- `DATAVERSE_URL`
- `DATAVERSE_TENANT_ID`
- `DATAVERSE_CLIENT_ID`
- `DATAVERSE_CLIENT_SECRET`

Then run read-only environment tests on demand:

```powershell
node .\scripts\query-studio-local-runner.mjs --live
```

Close and reopen PowerShell after changing user environment variables. Live tests are never part of the daily scheduled task.

For the semantic harness, set `SQL_QUERY` to a reviewed, bounded, read-only query and run:

```powershell
$env:SQL_QUERY = "SELECT TOP 5 accountid, name FROM account ORDER BY name"
node .\scripts\query-studio-local-runner.mjs --live --live-semantic
Remove-Item Env:\SQL_QUERY
```

Review the current harness implementation and query restrictions before using this option. Never supply sensitive row values in SQL.

## Audit tests are deliberately opt-in

The audit integration suite may change persistent organization/table/column auditing settings. Do not run it against production or a shared environment. Review `tests/query-studio/security-query-live.test.mjs` first and confirm the Dataverse environment is isolated and disposable.

Only after that confirmation, run manually in a one-off PowerShell session:

```powershell
$env:ALLOW_LIVE_AUDIT_TESTS = "1"
node .\scripts\query-studio-local-runner.mjs --live --live-audit
Remove-Item Env:\ALLOW_LIVE_AUDIT_TESTS
```

Audit tests are not scheduled and are not enabled by default.

## Limits and safety

- This runner is local automation, not a hosted CI service. It requires your PC to be available.
- It does not configure GitHub branch protection, environment policies, or billing.
- It never reads GitHub secrets; live credentials must be supplied locally.
- It never runs live tests unless `--live` is explicitly supplied.
- Audit tests require both `--live --live-audit` and a one-off `ALLOW_LIVE_AUDIT_TESTS=1` opt-in.
- Logs may contain test output. Review before sharing them.
