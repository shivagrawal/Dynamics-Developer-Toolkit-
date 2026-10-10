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

- Offline regression workflow: [Query Studio Regression Tests](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/actions/workflows/query-studio-regression.yml)
- Live Dataverse integration workflow: [Security SQL Live Dataverse Integration](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/actions/workflows/security-query-integration.yml)
- Live run with all six query projections and the audit-detail smoke test passing: [run 6](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/actions/runs/38084922358)
- Live run 6 completed 7 tests with 7 passed and 0 failed, including an actual `RetrieveAuditDetails` call against available audit data. Test logs report status/projection/count metadata only; they do not print record values, audit payloads, tokens, or privilege assignments.

## Safety and compatibility boundaries

- Read-only execution only; writes and multiple SQL statements are rejected.
- User-role and user-privilege FetchXML queries are bounded at 5,000 rows; entity/role privilege queries are bounded at 10,000 rows; audit retrieval examines at most 1,000 audit records per execution. The adapter returns a truncation warning when a configured cap is reached, and Query Studio displays that warning with the result metadata.
- The six supplied query shapes are implemented by an explicit compatibility adapter, not by a complete T-SQL interpreter. Other security SQL shapes and generic SQL Server constructs remain unsupported until they have a dedicated implementation and regression coverage.
- Query 6 uses Dataverse audit APIs because audit history is not available through the Dataverse TDS/SQL endpoint. A caller needs the relevant audit-reading privileges.
- Keep all work on `feature/sql4cds-query-studio`; do not merge into `main` without explicit approval.
