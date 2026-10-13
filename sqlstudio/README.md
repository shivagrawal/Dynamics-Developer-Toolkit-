# DevLens Query Studio

## Product goal

DevLens Query Studio is an independent, browser-based SQL workspace for Dataverse developers. A developer should be able to open a Dynamics environment, explore its schema, write SQL, run queries, inspect results, and export data without installing or depending on SQL4CDS, XrmToolBox, or a separate query application.

The goal is broad, dependable SQL compatibility built into DevLens itself. The native Dataverse SQL endpoint is a useful execution provider for the subset it supports, not the definition of the product's SQL capability. DevLens owns its SQL parser, query planner, Dataverse execution adapters, result semantics, diagnostics, and compatibility test suite.

## Current architecture

- The browser extension hosts the editor, environment context, Schema Explorer, status, results grid, and export actions.
- The native Dataverse SQL endpoint handles supported read-only queries using the current Dynamics page's authenticated context.
- The in-house JavaScript SQL planner/compiler translates its supported SQL subset to FetchXML and executes it through the current Dynamics user's Web API context.
- A dedicated compatibility adapter handles explicitly supported security and audit query shapes where the general Dataverse SQL endpoint cannot provide the required data. It must fail closed on unrecognized shapes.
- The .NET local-agent project is an experimental, non-required integration scaffold. It is not part of the product's required install or execution path. Do not make Query Studio depend on an external SQL4CDS package or require users to install another application to use its core features.

## Product principles

1. **Independent by default:** core query execution must work without SQL4CDS or XrmToolBox installed.
2. **SQL compatibility is explicit:** maintain a documented feature matrix and add syntax only with parser tests, semantic tests, and live Dataverse verification.
3. **No silent semantic changes:** reject unsupported constructs with actionable diagnostics instead of returning results that merely look plausible.
4. **Read-only first:** permit one SELECT statement only. Writes, multiple statements, and unsupported statements must fail closed.
5. **Dataverse-aware:** support logical names, lookups, polymorphic relationships, option sets, metadata, permissions, paging, and audit/security surfaces where the platform permits.
6. **Respect the signed-in user:** requests must use the active user's Dataverse authorization. Never embed an admin credential or ask users to paste secrets into the editor.
7. **Safe and bounded:** enforce query, row, page, concurrency, and duration limits; keep bearer tokens, row values, and audit payloads out of logs.
8. **Evidence before claims:** distinguish tested support, partial support, unsupported syntax, and platform restrictions.

## Current capabilities

- SQL editor, execution status, result grid, CSV and JSON export.
- Schema Explorer backed by Dataverse metadata APIs, including table search and column details.
- Native Dataverse SQL execution for the server-supported SQL subset.
- An original JavaScript SQL-to-FetchXML planner supporting a bounded SELECT subset, including projections, aliases, DISTINCT, TOP, WHERE predicates, equality joins, ORDER BY, paging, and basic aggregates within documented limits.
- Explicit security/audit compatibility handlers for known query shapes.
- Regression tests plus controlled live checks against a designated development/test environment.

The in-house JavaScript planner is currently a bounded implementation, not yet a drop-in SQL Server or SQL4CDS-equivalent engine. Do not describe the whole product as fully SQL-compatible until the relevant feature has passed semantic and live tests.

## Compatibility roadmap

### Phase 1 — Make the existing experience dependable
- Unify provider selection behind one execution interface so the user does not need to understand separate engines.
- Keep native SQL execution as a provider for its supported subset.
- Improve parser diagnostics, result-column stability, paging correctness, cancellation, and error normalization.
- Publish a versioned compatibility matrix with test evidence.

### Phase 2 — Expand the independent SQL planner
- Add SQL syntax incrementally: richer expressions and functions, CASE, HAVING, subqueries/CTEs, UNION, and more join/aggregate combinations.
- Implement a clear logical query plan and Dataverse-aware type/value handling rather than growing ad-hoc string rewrites.
- For constructs that cannot be translated faithfully to FetchXML, use bounded local execution over authorized Web API data only when the semantics and row limits are safe. Never download unbounded tables to simulate SQL.
- Define semantics for NULL, lookup comparisons, option sets, date/time, string collation, and aggregate values, and test them explicitly.

### Phase 3 — Developer-grade workflow
- Add autocomplete and schema-aware validation, saved snippets/history, explain/diagnostic output, query cancellation, and execution metrics.
- Show which provider ran a query and why, without requiring manual engine selection.
- Add repeatable fixture tests and live test cases for each advertised compatibility feature.

### Phase 4 — Compatibility hardening
- Compare outputs against a trusted reference only during development/testing, never as a runtime dependency.
- Test empty results, null-only columns, aliases, duplicate rows, paging boundaries, permission failures, service-protection responses, and large-result safeguards.
- Keep unsupported/platform-inaccessible features clearly identified.

## Security and resource limits

- Only one read-only SELECT statement is accepted by execution providers.
- Dataverse authorization is the final access boundary; client-side UI checks are not authorization.
- Follow only same-origin Dataverse paging links, detect loops, and cap rows/pages.
- Escape values in FetchXML and validate table/column identifiers against metadata.
- CSV export neutralizes formula-like values before producing spreadsheet-openable CSV.
- CI logs may report pass/fail, counts, and non-sensitive projection metadata, but must not log credentials, record values, names, audit values, or privilege assignments.

## Verification

- **Offline regression:** parser/compiler, provider routing, SQL shape validation, result projection, escaping, paging, and error handling.
- **Live ordinary SQL:** test the native Dataverse SQL endpoint separately.
- **Live compatibility tests:** validate each in-house planner feature against a designated personal development/test environment.
- **Safety tests:** verify writes and multiple statements are rejected before any data request.

The experimental local agent may be useful as a development comparison harness, but it must remain optional and must never become a prerequisite for the independent browser product.
