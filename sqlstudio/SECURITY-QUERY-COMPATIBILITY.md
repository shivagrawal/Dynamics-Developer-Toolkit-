# Security SQL Query Compatibility

This document tracks the six security/audit query shapes supplied for Query Studio.
The query engine must fail clearly when a shape is not implemented; it must not silently
rewrite the query or show results that do not match the requested projection.

## Runtime architecture discovered

The current browser query path in `background.js` resolves the first table using
`Xrm.Utility.getEntityMetadata(tableName)`, then sends SQL through the Dataverse SQL
query endpoint. That is suitable only for tables exposed through that endpoint. The
separate JavaScript SQL-to-FetchXML compiler has a limited SQL grammar and requires
metadata for every table.

The supplied queries include SQL4CDS metadata/system tables that are not ordinary
Dataverse entity tables, plus SQL Server constructs that cannot be represented directly
as FetchXML. Passing them through the existing generic path is not enough.

## Compatibility matrix

| Query | Purpose | Current state | Work required |
|---|---|---|---|
| 1 | User roles with role business unit; `LIKE`; three joins | Parser/compiler fixture passes against mocked SQL-visible metadata; not live-verified | Add a real Dataverse-backed relationship adapter for user-role membership and verify alias projection against a test environment |
| 2 | Privilege names mapped to an entity | Parser/compiler fixture passes against mocked SQL-visible metadata; not live-verified | Resolve privilege/entity mappings through supported Dataverse metadata or organization APIs |
| 3 | User roles and effective role privileges for an entity | Not implemented | Resolve roles and root-role inheritance; obtain role privileges; map privileges to entity and depth |
| 4 | Roles containing a named privilege | Not implemented | Resolve roles and privilege assignments without scanning or leaking unnecessary security data |
| 5 | Per-table CRUD/append/assign/share depth summary | Not implemented | Implement conditional aggregate semantics or equivalent safe client-side aggregation, plus entity/privilege mapping |
| 6 | Audit attribute changes for a record GUID | Not implemented | Query audit rows and retrieve audit detail through supported Dataverse APIs; parse changed attributes in JavaScript instead of relying on SQL Server `OPENJSON` |

## Implementation rules

- Keep all work on `feature/sql4cds-query-studio`; do not merge into `main` as part of this work.
- Read-only execution only. Reject DML, multiple statements, unsupported functions and unsafe/unbounded execution.
- Do not print record values, access tokens, audit payloads, or privilege assignments in CI logs.
- Treat a passing parser/compiler fixture as a unit test only. End-to-end support requires a real Dataverse integration test.
- Keep the on-demand integration harness separate from offline parser/compiler tests.
- Query 6 must not assume `OPENJSON` or `CROSS APPLY` are supported by the Dataverse SQL endpoint. The intended adapter should use the Dataverse audit APIs and return equivalent rows.
