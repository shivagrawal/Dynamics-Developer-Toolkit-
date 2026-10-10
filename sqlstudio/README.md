# DevLens SQL Studio (SQL4CDS integration)

This folder contains the local companion contract for the DevLens Query Studio feature.

## Architecture

- The Chrome extension provides the editor, environment context, query status and results grid.
- The localhost companion hosts the published `MarkMpn.Sql4Cds.Engine` NuGet package and owns SQL parsing, planning, Dataverse paging and execution.
- The initial mode is read-only. The companion must parse statements and allow SELECT only before calling the engine. Do not rely on UI controls as a security boundary.
- The companion must bind to loopback only, validate browser requests using a pairing token, cap query size and execution duration, and never expose its API to LAN interfaces. Origin checks alone are not authentication.
- No Dataverse secrets are stored in the extension. The engine currently connects through a Dataverse SDK `IOrganizationService`/`ServiceClient`; browser session-token reuse is not provided by the SQL4CDS connection constructor. A runnable integration requires a supported interactive local sign-in or separately validated token bridge.

## Engine

SQL4CDS MIT engine: https://github.com/MarkMpn/Sql4Cds
NuGet: https://www.nuget.org/packages/MarkMpn.Sql4Cds.Engine/

Keep the package license / notice available in distributions. Review telemetry behavior before packaging: the engine initializes Application Insights, and detailed error telemetry can include SQL text when explicitly enabled. Detailed error telemetry must remain disabled and the companion must not log query values by default.

## Current preview behavior

The extension currently executes supported read-only SQL through the native Dataverse Web API SQL endpoint from the Dynamics page context. It does not use the local SQL4CDS companion for query execution yet.

- SQL editor, execution status, result grid, CSV / JSON export
- Schema Explorer backed by Dataverse metadata APIs
- Search tables by display or logical name
- Inspect table columns, logical names, display names, types, read availability, required level, primary key / primary name, format and max length
- Select columns, insert their logical names into the editor, or generate an explicit `SELECT TOP 100 ... FROM table` query
- Lightweight table-column metadata request to avoid loading the full metadata/relationship/choice graph for each table
- The native SQL endpoint remains read-only and supports only Microsoft's documented SQL subset. It does not support `SELECT *` or every SQL Server / SQL4CDS construct.

## Remaining SQL4CDS integration work

- Implement supported authentication for the local companion
- Connect the companion to the SQL4CDS engine and serialize results
- Add cancellation, paging, safe request pairing and execution limits
- Test in a disposable Dataverse environment
- Build a conservative SQL-to-FetchXML translator for constructs where translation preserves semantics

The companion remains an integration scaffold, not an executable SQL4CDS runner until it is authenticated and end-to-end tested.
