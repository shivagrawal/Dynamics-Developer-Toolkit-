# Security SQL Query Compatibility

This document tracks the six security/audit query shapes supplied for Query Studio and distinguishes the generic SQL-to-FetchXML compiler from the JavaScript security-query compatibility adapter.

## Runtime architecture

The normal Query Studio path in `background.js` validates read-only SQL and uses the Dataverse SQL endpoint for supported ordinary-table queries. Queries referencing SQL4CDS security/metadata collections or audit JSON expansion are routed to `devLensSecurityAuditBridge("sqlQuery", ...)` in `security-audit-service.js`. That adapter uses authenticated-in-session Dataverse Web API/FetchXML requests and supported audit detail APIs; it has no .NET runtime dependency.

The generic compiler in `sqlstudio/js/sql-engine.js` remains a bounded SQL subset. It does not generically compile SQL Server `CASE`, `ISNULL(MAX(CASE...))`, or `CROSS APPLY OPENJSON` to FetchXML. Instead, the adapter implements the six supplied query shapes with explicit data retrieval and JavaScript projection/aggregation. Unrecognized security SQL shapes fail closed rather than being silently sent to the ordinary-table SQL endpoint.

## Compatibility matrix

| Query | Purpose | Current state | Implementation and validation |
|---|---|---|---|
| 1 | User roles with role business unit; `LIKE`; joins | Live integration passed | One bounded FetchXML request joins role membership, user and business unit; output aliases match the SQL projection. |
| 2 | Privilege names mapped to an entity | Live integration passed | FetchXML joins privilege, privilege-object-type-code mapping and entity metadata; duplicate names are removed and results are ordered. |
| 3 | User roles, business unit and entity privilege depth | Live integration passed after fixing a nested role-inheritance link | One bounded FetchXML request resolves user-role membership, root-role inheritance, privileges and entity mapping; depth masks are projected using the SQL CASE mapping. |
| 4 | Roles containing a named privilege | Live integration passed | FetchXML filters the exact privilege name and returns role, business unit, privilege and depth. |
| 5 | Per-table CRUD/append/assign/share depth summary | Live integration passed | FetchXML retrieves role privileges and entity mappings; JavaScript performs conditional aggregation and defaults missing access levels to `None`. |
| 6 | Audit attribute changes for a record GUID | Live query path passed; detail expansion has offline fixture coverage | Queries read-only audit rows and calls `RetrieveAuditDetails` for each returned audit row, then flattens old/new attribute values. Live detail coverage depends on the target record having audit rows and the caller having audit-history permissions. |

## Test evidence

- Offline regression workflow: [Query Studio Regression Tests](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/actions/workflows/query-studio-regression.yml); latest run: [run 383 — 84 passed, 0 failed, 0 skipped, 0 TODO](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/actions/runs/38086801321)
- Live Dataverse integration workflow: [Security SQL Live Dataverse Integration](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/actions/workflows/security-query-integration.yml); latest completed adapter run: [run 41 — 10 passed, 0 failed, 3 skipped](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/actions/runs/38086836821)
- Data-backed live checks returned 2 user-role rows, 16 user/account-privilege rows, 7 roles for a standard account privilege, 8 account privileges, and 185 rows for the Basic User table-access summary.
- The exact supplied filters for `USD8`, `quote`, the custom `prvReadwesco_legalentity` privilege, and the supplied audit GUID returned zero rows in this test environment. A separate metadata check confirmed that the `salesorder` table is not available in this environment, so its privilege query is expected to return zero rows here. Dynamic controls verify the user/role and privilege paths with records that exist here.
- Audit-detail expansion has offline fixture coverage, but live audit tests are skipped because organization-level or account-level auditing is disabled in this environment. The test suite now checks those settings before attempting to create a disposable record, and does not change environment auditing settings.
- Ordinary SQL/bridge smoke test: [run 28 — completed successfully](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/actions/runs/38086749937)
- Test logs report status/projection/count metadata only; they do not print record values, audit payloads, tokens, or privilege assignments.
## Safety and compatibility boundaries

- Read-only execution only; writes and multiple SQL statements are rejected. SQL LIKE patterns are preserved rather than silently widened from prefix/suffix matching to contains matching.
- User-role and user-privilege FetchXML queries are bounded at 5,000 rows; entity/role privilege queries are bounded at 10,000 rows; audit retrieval examines at most 1,000 audit records per execution. The adapter validates exact SELECT expressions, DISTINCT state, required joins, WHERE predicates, ORDER BY semantics, and the audit JSON field mapping before making requests. Unsupported variants fail closed. It returns a truncation warning when a configured cap is reached, and Query Studio displays that warning with the result metadata.
- The six supplied query shapes are implemented by an explicit compatibility adapter, not by a complete T-SQL interpreter. The adapter strips comments safely, detects statement boundaries outside literals, validates projection aliases and required joins/CASE/aggregate structures, and fails closed on unsupported variants. Other security SQL shapes and generic SQL Server constructs remain unsupported until they have a dedicated implementation and regression coverage.
- Query 6 uses Dataverse audit APIs because audit history is not available through the Dataverse TDS/SQL endpoint. A caller needs the relevant audit-reading privileges.
- Keep all work on `feature/sql4cds-query-studio`; do not merge into `main` without explicit approval.
