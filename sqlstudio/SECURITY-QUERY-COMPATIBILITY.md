# Security SQL Query Compatibility

This document tracks the six security/audit query shapes supplied for Query Studio and distinguishes the generic SQL-to-FetchXML compiler from the JavaScript security-query compatibility adapter.

## Runtime architecture

The normal Query Studio path in `background.js` validates read-only SQL and uses the Dataverse SQL endpoint for supported ordinary-table queries. Queries referencing SQL4CDS security/metadata collections or audit JSON expansion are routed to `devLensSecurityAuditBridge("sqlQuery", ...)` in `security-audit-service.js`. That adapter uses authenticated-in-session Dataverse Web API/FetchXML requests and supported audit detail APIs; it has no .NET runtime dependency.

The generic compiler in `sqlstudio/js/sql-engine.js` remains a bounded SQL subset. Its WHERE grammar supports unary `NOT` by inverting comparisons and applying De Morgan's law; ambiguous `LIKE` backslash escapes before `%` or `_` are rejected instead of silently changing the pattern. It does not generically compile SQL Server `CASE`, `ISNULL(MAX(CASE...))`, or `CROSS APPLY OPENJSON` to FetchXML. Instead, the adapter implements the six supplied query shapes with explicit data retrieval and JavaScript projection/aggregation. Unrecognized security SQL shapes fail closed rather than being silently sent to the ordinary-table SQL endpoint.

## Compatibility matrix

| Query | Purpose | Current state | Implementation and validation |
|---|---|---|---|
| 1 | User roles with role business unit; `LIKE`; joins | Original `%USD8%` filter returns zero rows in this environment; dynamic active-user control returns membership rows | One bounded FetchXML request joins role membership, user and business unit. The original filter smoke test validates execution/projection only; the dynamic control validates actual memberships. |
| 2 | Privilege names mapped to an entity | `salesorder` is unavailable in this environment; `account` control returns real privilege rows | FetchXML joins privilege, privilege-object-type-code mapping and entity metadata; duplicate names are removed and results are ordered. |
| 3 | User roles, business unit and entity privilege depth | Original `%USD8%`/`quote` filter returns zero rows; dynamic active-user/`account` control returns real privilege rows | One bounded FetchXML request resolves user-role membership, root-role inheritance, privileges and entity mapping; depth masks are projected using the SQL CASE mapping. The dynamic control now fails if a user with membership has no account-privilege rows. |
| 4 | Roles containing a named privilege | Custom `prvReadwesco_legalentity` filter returns zero rows; standard account privilege control returns matching roles | FetchXML filters the exact privilege name and returns role, business unit, privilege and depth. |
| 5 | Per-table CRUD/append/assign/share depth summary | Live integration passed | FetchXML retrieves role privileges and entity mappings; JavaScript performs conditional aggregation and defaults missing access levels to `None`. |
| 6 | Audit attribute changes for a record GUID | Live disposable-record test passed; it reconstructed the exact description change. The separate recent-audit smoke test expanded 29 attribute rows. | The adapter queries audit rows, calls `RetrieveAuditDetails()` and flattens old/new values. The live fixture verifies the persisted update, `Update` event, old value, and new value. |

## Test evidence

- Offline regression workflow: [Query Studio Regression Tests](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/actions/runs/38119069365) — **111 passed, 0 failed, 0 skipped**.
- Live ordinary SQL smoke: [Dataverse On-demand SQL Test Harness](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/actions/runs/38119069467) — passed. FetchXML and native SQL paths each returned 3 rows for the bounded `systemuser` query; projection checks confirmed only requested columns are exposed.
- Read-only environment integration: [Dataverse Environment Integration Tests](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/actions/runs/38119069496) — passed.
- Live security/audit integration: [Security SQL Live Dataverse Integration](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/actions/runs/38119069350) — **12 passed, 0 failed, 1 skipped**. The skipped check is `salesorder` because its metadata is unavailable in this environment.
- Data-backed live checks returned 2 user-role rows, 16 user/account-privilege rows, 7 roles for a standard account privilege, 8 account privileges, and 185 rows for the Basic User table-access summary.
- Exact supplied filters for `USD8`, `quote`, and custom privilege `prvReadwesco_legalentity` returned zero rows in this environment. Those checks validate execution/projection only, not matching-data semantics. Separate data-backed controls validate actual membership and privilege rows.
- Audit detail was verified live. The disposable Account fixture confirmed the timestamp, actor, operation, and old/new description values; a separate audit-detail smoke test expanded 29 changed-attribute rows.
- The live audit fixture enables organization-level auditing and Account `description` auditing if disabled, publishes metadata changes if needed, and leaves those settings enabled. This is intentionally limited to the personal development/test environment; organization-level auditing can increase audit-log volume. The fixture account is deleted in a `finally` block.
- Test logs emit counts/status/projection metadata only; record values, audit payloads, credentials, and privilege assignments are not logged.

## Safety and compatibility boundaries

- Read-only execution only; writes and multiple SQL statements are rejected. SQL LIKE patterns are preserved rather than silently widened from prefix/suffix matching to contains matching.
- Ordinary-table SQL and security-metadata paging follow only same-origin Dataverse API links, reject repeated links, and cap results at 10,000 rows/100 pages. CSV export neutralizes spreadsheet formula prefixes.
- User-role and user-privilege FetchXML queries are bounded at 5,000 rows; entity/role privilege queries are bounded at 10,000 rows; audit retrieval examines at most 1,000 audit records per execution. The adapter validates exact SELECT expressions, DISTINCT state, exact JOIN/APPLY counts, rejects comma-separated FROM sources, validates WHERE predicates, ORDER BY semantics, and the audit JSON field mapping before making requests. Security metadata paging rejects cross-origin links and repeated links; unbounded catalog reads fail rather than silently returning partial data. Unsupported variants fail closed. It returns a truncation warning when a configured cap is reached, and Query Studio displays that warning with the result metadata.
- The six supplied query shapes are implemented by an explicit compatibility adapter, not by a complete T-SQL interpreter. The adapter strips comments safely, detects statement boundaries outside literals, validates projection aliases and required joins/CASE/aggregate structures, and fails closed on unsupported variants. Other security SQL shapes and generic SQL Server constructs remain unsupported until they have a dedicated implementation and regression coverage.
- Query 6 uses Dataverse audit APIs because audit history is not available through the Dataverse TDS/SQL endpoint. The adapter invokes the documented bound function `audits(<auditid>)/Microsoft.Dynamics.CRM.RetrieveAuditDetails()` and has both regression and live integration coverage. A caller needs the `prvReadRecordAuditHistory` and `prvReadAuditSummary` privileges.
- Keep all work on `feature/sql4cds-query-studio`; do not merge into `main` without explicit approval.
