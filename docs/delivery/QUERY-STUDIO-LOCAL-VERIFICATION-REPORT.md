# Query Studio Local Runner — Verification Report

Date: 2026-10-13 (local Windows run; timestamp recorded in log)
Branch: `work/local-query-studio-runner`
Verified head at time of run: `6947d8230d91b849fad8f40bfaa5ce3a1a6d5a27`
Environment: personal development/test Dataverse environment (`dataverse-test`)

## Results

**Local verification: PASS**

- JavaScript syntax checks: all 9 configured files passed.
- `manifest.json`: valid JSON.
- Offline Query Studio regression suite: **195 passed, 0 failed, 0 skipped**.
- Read-only Dataverse integration suite: **4 passed, 0 failed**.
- Bounded on-demand SQL query: passed; 5 Account rows returned through FetchXML and native SQL, projected results matched, order checked, row values omitted from output.
- Live semantic matrix: **11 cases passed**:
  - simple projection/order
  - IS NULL
  - IS NOT NULL
  - LIKE filter
  - empty result
  - LEFT JOIN cardinality
  - OFFSET/FETCH page one
  - OFFSET/FETCH page two
  - OFFSET/FETCH boundaries (5 rows per page, zero overlap)
  - LEFT JOIN null extension
  - COUNT aggregate
- Overall local runner result: `PASS`.

Local log:
`%LOCALAPPDATA%\DynamicsDeveloperToolkit\QueryStudio\logs\query-studio-2026-10-13T22-00-35-715Z.log`

## Important interpretation

- The OFFSET/FETCH live cases validate the Query Studio FetchXML paging route and non-overlap between adjacent pages. The native SQL endpoint was deliberately not used as proof that it honors OFFSET/FETCH.
- The on-demand smoke query compared the same bounded Account projection across the FetchXML and native SQL paths.
- Live security/audit integration tests were **not run**. They remain opt-in because they may change persistent audit settings.
- The local run is evidence for the exact checked-out branch at the time of execution. Repeat the run if the branch head changes.

## GitHub Actions

The GitHub Actions run associated with this head is recorded as failed. The prior investigation found the run was blocked before job steps by the repository's Actions billing/spending limit; this is an infrastructure/billing blocker, not a test assertion failure. Confirm the current run details in GitHub before treating hosted CI as green.

## Review findings and remaining gates

1. **No merge yet.** Keep PR #13 a draft until the feature branch owner completes the intended integration/review.
2. **Hosted CI is not green.** Local Windows results are strong evidence but do not substitute for a successful hosted run if branch protection requires it.
3. **OFFSET/FETCH native-endpoint behavior remains intentionally unsupported/untrusted.** Keep the dedicated FetchXML route and ensure routing never bypasses named security/audit adapters.
4. **Audit/live mutation tests remain disabled.** Do not enable them on production or shared environments.
5. **Scheduled task is offline-only.** The daily task must never invoke live Dataverse or audit tests.
6. **Windows helper execution has been exercised by the successful live run.** Credentials were read from Windows Credential Manager and not included in the log output.

## Reproduction

From the repository root in Windows PowerShell:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\query-studio-live.ps1 -Semantic
```

This uses the default bounded query:
`SELECT TOP 5 accountid, name FROM account ORDER BY name`

No secrets should be pasted into chat, committed, or included in shared logs.
