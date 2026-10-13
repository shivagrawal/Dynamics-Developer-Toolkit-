# Query Studio Architecture

## Product contract

DevLens Query Studio is an independent browser-based SQL workspace for Dataverse developers. Users should not need SQL4CDS, XrmToolBox, a .NET runtime, or a separate query product installed to use its core capabilities.

The product owns its SQL parsing, query planning, provider routing, Dataverse-specific compatibility behavior, result semantics, diagnostics, and test suite. Native Dataverse SQL is one execution provider for Microsoft's supported subset; it is not the complete product engine. The original JavaScript SQL-to-FetchXML planner is an in-house engine that will expand behind a unified execution interface.

The .NET local-agent scaffold is experimental only. It is not in the required runtime path, and the product must not depend on MarkMpn.Sql4Cds.Engine.

## Execution pipeline

1. **Query Studio UI** submits the SQL text and active environment context through the extension message API. It renders stable columns, rows, provider diagnostics, duration, and truncation warnings.
2. **Read-only gate and parser** validate a single SELECT statement. Writes and multiple statements fail closed. Syntax validation must not depend on the UI button or a regex-only security boundary.
3. **Provider planner** selects the safest provider that can preserve the query's supported semantics:
   - Native Dataverse SQL endpoint for queries within the native endpoint's documented subset.
   - In-house JavaScript SQL planner/compiler for supported SQL constructs translated to FetchXML.
   - Named, narrowly validated compatibility handlers for specific security/metadata/audit query shapes.
4. **Dataverse adapters** use the current Dynamics user's authorized Web API context, validate metadata and identifiers, escape FetchXML values, follow same-origin paging links, and enforce row/page limits.
5. **Result normalizer** preserves projection labels, null values, stable column ordering, row count, provider identity, compatibility mode, truncation state, and safe error diagnostics.
6. **UI workspace** displays results and diagnostics, supports paging through the returned result set, and exports CSV/JSON with spreadsheet formula neutralization for CSV.

## Provider boundary

### Native Dataverse SQL endpoint

Use for ordinary SQL that the native endpoint supports. It is valuable because it executes server-side under the current Dataverse user's permissions. Its supported syntax is narrower than the long-term Query Studio goal. Do not claim that this path supports all SQL Server syntax.

### In-house SQL-to-FetchXML planner

The original JavaScript parser and compiler supports a documented subset including explicit projections, aliases, DISTINCT, TOP, WHERE comparisons and predicates, equality joins, ORDER BY, bounded OFFSET/FETCH, and basic aggregates/GROUP BY under restrictions. It must remain honest about unsupported syntax.

The next architecture step is to put both providers behind a single execution contract and automatically route supported statements. Users should not have to select a different engine manually just to access the same workspace. Add SQL constructs to the in-house parser/planner incrementally, with semantics defined for Dataverse-specific data types.

For SQL constructs that FetchXML cannot express, a bounded local execution plan may be considered only when the required data can be retrieved within strict limits and result semantics are well-defined. Never simulate joins or aggregates by downloading unbounded tables.

### Security, metadata, and audit compatibility handlers

These handlers support a small number of explicitly validated query shapes that require Web API metadata, security, or audit operations. They are not a general SQL parser. Keep the handlers named, test exact structure and projection semantics, and reject unsupported variants before sending a request.

### Experimental local agent

The .NET local-agent scaffold is not required by the product and must not be wired into normal query execution as a dependency. It may be removed or repurposed later, but current work should focus on independent browser-side parsing/planning and Dataverse Web API execution. No runtime SQL4CDS dependency should be introduced.

## Compatibility strategy

Maintain a compatibility matrix for every SQL construct with these statuses: planned, implemented, offline-tested, live-tested, unsupported, or blocked by Dataverse platform limits. “Implemented” alone is not evidence of correct semantics.

Prioritize:
1. Correct ordinary SELECT, predicates, aliases, null handling, joins, sorting, and deterministic paging.
2. Dataverse types and relationships: lookup values, polymorphic lookups, option sets, dates, logical/display names, and metadata validation.
3. Aggregates, grouping, CASE, scalar expressions, and richer join combinations.
4. Subqueries, CTEs, UNION, and more complex SQL forms, with strict limits where execution must occur locally.
5. Developer workflow: autocomplete, query history/snippets, explain/diagnostics, cancellation, and useful errors.

Do not silently rewrite unsupported SQL into a query with different meaning. Return an actionable error that identifies the unsupported feature.

## Safety and resource limits

- Only one SELECT statement is accepted by each provider.
- Dataverse authorization is enforced by the server; UI checks are not an authorization boundary.
- Validate table/column identifiers against Dataverse metadata where possible.
- Escape values before generating FetchXML.
- Follow same-origin paging links only, detect repeated links, and cap result rows/pages.
- Bound concurrency and execution time. Respect Dataverse service-protection responses.
- Preserve SQL NULL distinctly from empty strings and formatted labels.
- CSV export neutralizes formula-like values.
- Never log access tokens, query result values, personal data, audit values, or privilege assignments.

## Auditing test policy

The live audit integration test enables organization auditing, Account-table auditing, and Account description auditing if needed. These are persistent environment/table settings, not temporary test state. Run the audit workflow only against the designated personal development/test environment, never production or a shared environment without an approved change. The fixture creates a uniquely named disposable account, verifies an update through RetrieveAuditDetails, and deletes the account in a finally block.

## Verification layers

- **Offline regression:** parser/compiler, SQL validation, provider routing, projection aliases, escaping, NULL semantics, paging, compatibility handlers, and error behavior.
- **Live native SQL smoke test:** validates the ordinary Dataverse SQL endpoint independently.
- **Live in-house engine tests:** validate the supported SQL planner features against the designated test environment.
- **Security tests:** prove that writes, multiple statements, unsupported query shapes, and unsafe paging fail closed before unsafe requests.
- **No silent success:** unsupported variants fail with an actionable diagnostic rather than plausible but incorrect results.

## Release discipline

All work stays on `feature/sql4cds-query-studio`. Do not merge into `main` without explicit approval. Compatibility claims must match the implemented and tested matrix.
