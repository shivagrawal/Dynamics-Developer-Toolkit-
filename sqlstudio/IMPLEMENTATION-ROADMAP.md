# Query Studio Independent SQL Engine — Implementation Roadmap

**Status date:** 2026-10-12  
**Target branch:** feature/sql4cds-query-studio  
**Product contract:** DevLens Query Studio is an independent browser-based Dataverse SQL workspace. SQL4CDS and XrmToolBox are not runtime dependencies.

## Current coordinator work slice — 2026-10-12

The shared policy decision now returns `route: "fetchxml"` for parsed OFFSET/FETCH plans and `route: "native-sql"` for the ordinary parsed SELECT subset. The UI consumes that route and reuses the returned plan for compilation rather than separately calling `plan()` just to choose the route. The background still re-runs the gate at its trust boundary, which is intentional defense-in-depth; therefore this is **not** a claim that SQL is parsed exactly once end-to-end.

Acceptance evidence required before calling this slice done:
- [ ] Query Studio regression workflow passes on the exact PR head, including policy and UI routing tests.
- [ ] No policy rejection, parser failure, or non-capability provider error can trigger alternate-provider execution.
- [ ] Named security/audit query shapes remain on the specialized adapter and cannot be routed through generic FetchXML.
- [ ] Fresh live OFFSET/FETCH verification confirms page bounds and no overlap on the current integrated code.
- [ ] Contract and issue handoffs link exact tested commit SHAs and workflow URLs.

Remaining coordinator work: unify provider selection, normalized success/error outcomes, diagnostics, and compatibility adaptation behind a coordinator boundary; do not claim full parse-once execution until the trust-boundary interface has a reviewed design that does not trust caller-supplied AST data.

## 1. Milestone definition

The milestone is not “a SQL editor exists” and it is not “the native SQL endpoint works.” The milestone is complete when DevLens has one integrated, read-only SQL experience with a documented compatibility contract, correct Dataverse semantics, bounded execution, useful diagnostics, and a repeatable regression suite that verifies the entire module.

Compatibility should be measured against a versioned SQL feature matrix. We must not claim total SQL Server or SQL4CDS parity unless the relevant syntax and Dataverse semantics are actually supported and tested. Dataverse API limitations must be identified explicitly.

## 2. Current state — verified in repository

| Capability | Current state | Remaining gap / exact resolution |
|---|---|---|
| Browser Query Studio UI | Implemented: one Execute action, SQL editor, status/errors, results grid, result paging, CSV and JSON export | Shared policy now selects the bounded FetchXML route for parsed OFFSET/FETCH before native SQL dispatch, with UI routing covered by the shared policy module; remaining: finish the full coordinator and request-scoped parse/decision contract, integrate canonical result/error normalization across providers, and verify current-commit live behavior. Existing deadline/concurrency/output bounds are implemented at the background boundary; FetchXML API cancellation remains limited |
| Schema Explorer | Implemented: discover tables, search display/logical names, inspect columns/types/primary fields, insert selected logical names and generate SELECT | Add relationship/navigation metadata and autocomplete; cache metadata per environment with invalidation and permission-safe errors |
| Native Dataverse SQL provider | Implemented for Microsoft's native endpoint SQL subset; uses current Dynamics page context; follows bounded same-origin paging links and validates projections | Do not treat it as the product engine. Route only statements whose semantics and syntax fit this provider; normalize all response/error shapes |
| In-house SQL parser/compiler | Implemented as sqlstudio/js/sql-engine.js; parses a bounded SELECT grammar and compiles to FetchXML; metadata validation and XML escaping exist | It is not a complete SQL engine. Extend the AST/planner and add missing constructs listed below; add semantic tests before enabling a feature |
| Existing custom SQL subset | Explicit projections/SELECT *, aliases, DISTINCT, TOP, WHERE comparisons, NULL predicates, IN, BETWEEN, LIKE, AND/OR/NOT, equality INNER/LEFT joins, ORDER BY, bounded OFFSET/FETCH, basic aggregates and GROUP BY subject to restrictions | Test each construct against live Dataverse for types, aliases, empty/null-only results, join cardinality and paging; mark any unverified feature as partial |
| SQL constructs not currently supported by custom planner | CTEs, subqueries, UNION, HAVING, CASE, scalar functions/computed expressions, non-equality joins, aggregate queries with joins; variables are unsupported | Implement in dependency order in Section 4, or reject with precise actionable diagnostics until verified |
| Security/metadata/audit compatibility | Six named, tightly validated query shapes; metadata retrieval, security mapping, audit expansion through RetrieveAuditDetails; fixture and regression coverage | Expand through reusable AST/query plans where appropriate, not regex proliferation. Keep audit/security access subject to Dataverse permissions and platform constraints |
| Read-only safeguards | UI and background checks, SELECT-only custom parser, FetchXML input validation, query/row/page caps, same-origin paging, audit limits, CSV formula neutralization | Put every provider behind one shared parsed-AST policy gate. Test bypass attempts including comments, quoted semicolons, multiple statements, CTE-prefixed writes, malformed syntax, and unsupported constructs |
| Result semantics | Projection verification, null-capable columns, alias normalization, lookup backing-field mapping, explicit truncation indicators exist in some paths | Establish one typed result contract: ordered column descriptors, rows, nulls, duration, provider, warnings, row limits, paging state and normalized errors |
| Automated tests | Node regression suite, syntax/manifest checks, live environment integration, native SQL smoke harness, security/audit live tests exist | One CI entry point must run all offline Query Studio suites. Keep live tests as a separate gated job with clear infrastructure-vs-semantic failure classification |
| Live validation | Offline regression: 190/190 on `af432855b49872d91e3f73c94c8b6e6cc6a4c0a8` ([run 38156403515](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/actions/runs/38156403515)). Live semantic matrix passed on code SHA `25ee4dc97215565d6a9c5c44c0a89648c7a8eef7` ([run 38156387008](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/actions/runs/38156387008)); security/audit and environment integration passed on `f77e015fcc57d9ee2ce3a37f26c9177f21adb62c` ([security](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/actions/runs/38156018818), [environment](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/actions/runs/38156018839)) | Rerun security/audit if its implementation changes; keep exact-SHA evidence. Shared runtime bounds are implemented and offline-tested on feature checkpoint `2a873e7f128601570c7e419bbf44727e3346ffed` (195/195 in [run 38160480955](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/actions/runs/38160480955)); `Xrm.WebApi.retrieveMultipleRecords` cannot be cancelled in flight, so the deadline returns a timeout while the active slot remains occupied until settlement, and the 64 MiB cap is an estimate applied during accumulation rather than a hard process-memory ceiling |
| SQL4CDS local agent | Experimental scaffold only; authentication provider returns AUTH_PROVIDER_REQUIRED and it is not used for query execution | Keep optional/non-required. Do not make it part of normal execution or require users to install SQL4CDS, XrmToolBox, or a .NET runtime |

## 3. Target architecture

Query Studio UI -> shared SQL tokenizer/parser -> AST validation and read-only policy gate -> capability planner / automatic provider selection -> native Dataverse SQL endpoint, in-house SQL-to-FetchXML compiler, bounded local relational operators only where semantics/data bounds permit, or named Dataverse metadata/security/audit adapters -> result normalizer -> result grid/export/diagnostics.

### Routing rules

1. Parse once; do not independently regex-parse the same SQL in each provider.
2. Reject writes, multiple statements, malformed SQL, and unsupported syntax before issuing a Dataverse request.
3. Select a provider based on the parsed query's capabilities and tested semantics, not by asking the user to pick an engine.
4. Use native SQL when the statement fits the documented native subset and that path preserves the requested projection/semantics.
5. Use the in-house compiler for constructs it can faithfully translate to FetchXML.
6. Consider local relational operators only for bounded result sets, with explicit row/memory/time limits and well-defined SQL NULL/type/collation behavior. Never download unbounded tables to emulate SQL.
7. Fallback after an execution error only when the error is specifically classified as a provider syntax/capability rejection. Never hide authentication, authorization, timeout, throttling, or data errors by trying another provider.
8. Return one stable result/error contract regardless of provider.

## 4. Work packages and exact resolutions

### P0 — Establish a reliable baseline and compatibility matrix

**Deliverables**
- Maintain this roadmap and a machine-readable or test-linked feature matrix.
- Inventory every current test and map it to parser, compiler, provider, Dataverse integration, safety, or UI behavior.
- Separate offline semantic failures from external network/authentication failures.
- Fix the latest security/audit live workflow reliability: preflight DNS/TLS/connectivity, bounded retry with backoff for transient connection failures, and report infrastructure blockage distinctly. Keep real assertion failures red.

**Acceptance**
- Every advertised capability has a status: planned, implemented, offline-tested, live-tested, unsupported, or platform-limited.
- Current test baseline is captured; no skipped/failed test is silently counted as passing.
- main remains unchanged.

### P1 — One integrated execution experience

**Deliverables**
- Add a shared query execution coordinator that accepts SQL and returns the standard result contract.
- Route based on parsed AST/provider capability. Keep the native endpoint as a provider, not as the complete engine.
- Keep one user-facing Execute action. Verified OFFSET/FETCH capability routing bypasses native SQL and uses bounded FetchXML; the full parse-once capability coordinator is still outstanding.
- Preserve provider diagnostics internally and show a useful, concise explanation in the UI.
- Normalize aliases, columns, NULL values, errors, truncation and duration across all paths.

**Acceptance**
- The user has one Execute action.
- Existing native SQL, FetchXML planner, and security/audit adapter tests pass through the coordinator.
- Provider selection tests prove each query uses the expected path.
- Authorization, transport and throttling errors are not masked by fallback.

### P2 — Correctness before advanced syntax

**Deliverables**
- Extend shared AST validation and semantic definitions for SQL NULL/three-valued logic, boolean precedence, quoted/bracketed identifiers, escaped string literals, numeric literals, aliases and one-statement parsing.
- Define type conversions for Dataverse GUIDs, lookup values, option sets, booleans, dates/times, money and decimal values.
- Make deterministic ordering/paging explicit; preserve row cardinality for LEFT JOINs and duplicate rows.
- Define behavior for missing metadata, virtual/unreadable attributes, null-only columns, empty results, invalid columns and permission-denied responses.
- Add fixture-driven tests for each edge case.

**Acceptance**
- No query is silently “fixed” into different semantics.
- Every returned projection can be traced to the parsed SELECT list and verified metadata/result shape.
- Paging tests prove no duplicates or missing rows across page boundaries on supported query forms.

### P3 — Expand the in-house SQL grammar and planner

Implement features in dependency order, with parser, planner/compiler, offline fixtures, and live tests per feature:

1. **Expressions and aliases:** arithmetic/string expressions where safe, expression result labels, CAST/CONVERT only with explicitly defined supported conversions.
2. **CASE:** searched/simple CASE as an AST expression; translate to FetchXML only when expressible, otherwise use bounded local projection evaluation after authorized retrieval.
3. **Scalar functions:** start with a documented safe subset (for example COALESCE/NULLIF and selected string/date functions) and explicit Dataverse type semantics.
4. **HAVING:** aggregate-filter AST and execution plan; translate only where FetchXML supports equivalent behavior, otherwise apply to a bounded grouped result.
5. **Join improvements:** validate metadata relationship/key types; support additional equality joins and chained joins; add outer-join, duplicate and null-extension tests. Non-equality joins only through bounded local execution if feasible.
6. **Aggregate improvements:** GROUP BY aliases/expressions where supported, COUNT semantics, NULL handling, DISTINCT aggregates and aggregate ordering; allow joins only after cardinality and grouping semantics are proven.
7. **UNION / UNION ALL:** implement compatible projection/type alignment and duplicate elimination; reject mismatched columns/types.
8. **Subqueries:** start with EXISTS/IN subqueries or scalar subqueries only after correlated vs uncorrelated behavior and query bounds are defined.
9. **CTEs:** non-recursive CTEs first; recursive CTEs remain unsupported unless there is a safe, bounded execution strategy.
10. **Variables and multi-statement SQL:** remain unsupported in read-only mode unless there is a strong product need and a separately designed safe contract. Do not enable writes.

**Acceptance for each feature**
- Parser AST tests, compilation/plan tests, expected-result fixtures, invalid-syntax tests, safety tests, and live Dataverse tests.
- Feature status is not “supported” until tests cover nulls, empty data, aliases, limits and errors.

### P4 — Dataverse-native behavior and developer workflow

**Deliverables**
- Relationship metadata and lookup/polymorphic lookup-aware autocomplete.
- Schema-aware editor diagnostics for table/column names and unsupported types.
- Query history and saved snippets, scoped to the local browser profile/environment with a clear data-handling policy.
- Explain/diagnostics output: parsed query, chosen provider, translated plan (safe/redacted), pages/rows, duration, truncation and warnings.
- Cancellation, request timeouts, concurrency limits, throttling-aware retry, and actionable service-protection errors.
- Consistent CSV/JSON export and result grid behavior.

**Acceptance**
- Metadata calls are cached safely and invalidated on environment change.
- No secrets or result values leak into logs or telemetry.
- Large queries are bounded, cancellable, and clearly marked incomplete when capped.

### P5 — Full-module regression and release gate

**Deliverables**
- A single offline CI workflow for all Query Studio parser/compiler, routing, adapter, result, safety and UI-contract tests.
- Keep live Dataverse workflows separate so transient environment/network issues are visible without confusing offline regressions.
- Add a capability-driven live smoke suite covering simple SELECT, filter/NULL, aliases, joins, aggregate/grouping, paging, empty results, invalid query, permissions, and audit detail where available.
- Add tests for native-to-custom routing and for errors that must never trigger fallback.
- Publish a test summary linked to each capability.

**Release gate**
- All offline regression suites green.
- JavaScript syntax and extension manifest validation green.
- Native SQL live smoke green.
- Each feature marked live-tested has recent passing evidence.
- Security/audit live suite either passes or is explicitly marked blocked by infrastructure; it must not be misreported as passed.
- No unbounded retrieval, write execution, secret logging, silent partial result, or main-branch modification.

## 5. Prioritization

| Priority | Work | Why first |
|---|---|---|
| P0 | Baseline, matrix, live-test reliability | Establishes truthful progress and prevents false confidence |
| P1 | Unified coordinator and automatic routing | Turns existing pieces into one product rather than multiple preview paths |
| P2 | SQL/Dataverse correctness and result contract | Advanced syntax is worthless if nulls, joins, or paging are wrong |
| P3 | Advanced SQL constructs | Expands useful compatibility incrementally without pretending full parity |
| P4 | Editor, metadata, diagnostics and workflow | Makes the engine practical for daily development |
| P5 | Full regression and release gate | Proves the complete module rather than isolated parts |

## 6. Completion dashboard

The product is **not yet at the independent SQL4CDS-class replacement milestone**. It has a useful foundation: one Execute UI, schema explorer, native SQL provider, bounded in-house SQL-to-FetchXML compiler, named security/audit adapters, safety limits, and regression/live-test infrastructure. Live evidence identified and fixed two semantic gaps: native SQL did not honor the OFFSET/FETCH bound in the tested endpoint, and joined projections needed to be emitted inside their FetchXML link entities. The largest remaining work is a shared parse-once execution coordinator, verified runtime limits, semantic hardening, and broad SQL syntax/plan support.

Track progress by acceptance gates rather than a guessed percentage. A feature is done only when implementation, offline tests, and required live tests are all complete. The exact percentage should be calculated after the baseline inventory is mapped to the feature matrix, not estimated from the number of UI features.

## 7. Branch and environment constraints

- Work only on feature/sql4cds-query-studio.
- Preserve main; do not merge or rebase it without explicit approval.
- Use the designated personal development/test environment for live tests.
- Never ask for credentials in chat, commit secrets, or print access tokens/query data.
- The audit integration workflow can change persistent audit configuration; never run it against production or a shared environment without approved authorization.
