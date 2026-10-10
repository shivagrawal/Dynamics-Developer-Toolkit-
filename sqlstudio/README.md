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

## Scope

- Query Studio UI shell (editor / Execute / result pane / environment status)
- Local companion health and query API contract
- SELECT-only guard using SQL Server ScriptDom
- Follow-up: implement supported authentication, results serialization, cancellation and paging, then test in a disposable Dataverse environment.

This is an integration scaffold, not yet an executable SQL runner until the companion is installed, authenticated and end-to-end tested.
