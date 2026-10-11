# Query Studio Architecture Review

**Status:** Reviewed; recommendations recorded, contract decisions pending implementation integration  
**Branch:** `feature/sql4cds-query-studio`  
**Related issue:** [#3 — Approve shared query execution and provider contracts](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/issues/3)  
**Scope:** Request, decision, provider, result, error, routing and paging contracts. No production code changes are included in this report.

## Executive recommendation

Approve the architectural direction, subject to the contract decisions below: one SQL input, one authoritative parse/policy decision, one automatically selected execution path, and one stable result/error contract. Provider differences must not leak into inconsistent safety behavior, SQL semantics, errors, exports, or paging.

## Repository evidence and limitations

- `docs/delivery/QUERY-STUDIO-BASELINE-AND-EXECUTION-CONTRACT.md` records a historical offline run of 111 passed, 0 failed, 0 skipped on commit `fd068b920af1e86efed839b8c53477e489e35322`; it is not evidence of a fresh run on the current head.
- `sqlstudio/js/sql-engine.js` implements a bounded SELECT subset and SQL-to-FetchXML planner; it is not a complete SQL Server/SQL4CDS engine.
- `background.js` contains separate native SQL and FetchXML read-only execution functions.
- `ui/sql-studio-view.js` is documented as exposing separate native SQL and FetchXML-preview actions; the single automatic Execute action remains outstanding.
- `security-audit-service.js` has a dedicated security/audit route and existing adapter-specific bounds.
- The contract documents earlier live native SQL/integration success and a later security/audit `ETIMEDOUT`. These outcomes must remain separate from offline CI.

## Recommended contract decisions

### ADR-01 — Request and execution context

Keep the public request minimal:

```ts
type QueryRequest = { sql: string; requestId?: string };
```

The coordinator generates a request ID when omitted and binds execution to the active Dataverse environment. Environment identity, deadline, cancellation, limits, and provider selection are coordinator-owned context, not caller-controlled policy.

Acceptance:
- Missing request ID is generated and propagated.
- Concurrent requests cannot share result/cancellation state.
- Active environment/context lookup failure results in no provider call.
- Caller-supplied values cannot raise hard limits or redirect execution to another environment.

### ADR-02 — One parse and one shared policy decision

Parse original SQL once into the trusted internal representation. The UI must not supply an authoritative AST. A shared fail-closed policy gate runs before any data provider or specialized execution adapter. Unexpected parser/policy exceptions reject execution.

Acceptance:
- Invalid, malformed, multi-statement, unsafe, unsupported and over-limit SQL results in zero data-provider calls.
- Every entry point uses the same gate.
- Policy reason codes are typed and stable.

### ADR-03 — Capability-first automatic routing

Provider capability assessment consumes the canonical parsed representation and must not reparse SQL with a weaker grammar. Route ordinary SQL to native SQL when supported, bounded SQL subset to FetchXML only when its semantics are proven for the query, and the six named validated security/audit shapes to the specialized adapter.

Acceptance:
- Expected route is deterministic for each capability fixture.
- No provider is selected unless its tested capability contract covers the query.
- No capable provider means rejection, not approximation.

### ADR-04 — Strict capability-only fallback

Fallback is permitted only after an explicit, typed capability rejection and only when the approved alternate plan is proven semantically equivalent for the actual query. Authentication, authorization, metadata permission, timeout, transport, throttling, data and internal errors never trigger fallback. Do not infer capability rejection from generic error messages or HTTP status alone.

Acceptance:
- An approved capability rejection can route to an equivalent alternative.
- Auth/authorization/timeout/transport/throttling/data failures cause no fallback.
- The original failure remains observable when fallback is prohibited.

### ADR-05 — Canonical result with legacy UI adapter

Use ordered column descriptors as authoritative projection order. Preserve SQL-facing aliases/casing and all duplicate display labels without overwriting values. Define stable internal keys separately from display labels. Preserve SQL NULL distinctly from empty string and missing value. Empty results retain column metadata. `truncated` means incomplete relative to the requested query, not merely that UI pagination exists. Unknown counts must not be represented as zero. Use a compatibility adapter for existing string-column, paging, export and legacy warning fields.

Acceptance:
- Ordered columns, duplicate labels, alias casing, NULL and empty result metadata survive normalization.
- CSV/JSON exports preserve intended values.
- Truncated output displays an explicit incomplete-result warning.
- Existing UI paging/export regressions remain green through the adapter.

### ADR-06 — Stable error taxonomy and safe diagnostics

Keep the proposed categories `SQL_SYNTAX`, `SQL_UNSUPPORTED`, `READ_ONLY_POLICY`, `METADATA`, `AUTHENTICATION`, `AUTHORIZATION`, `THROTTLED`, `TIMEOUT`, `TRANSPORT`, `DATAVERSE`, and `INTERNAL`, with a documented code registry and category-specific retry/fallback policy. Diagnostic fields are allowlisted, redacted and bounded. Retryability does not imply fallback eligibility.

Acceptance:
- Each error category has stable code and retry policy.
- Raw credentials, headers, result values and sensitive response bodies never enter UI diagnostics.
- Unknown exceptions normalize to safe INTERNAL errors with useful sanitized correlation data.

### ADR-07 — Preserve named security/audit behavior

Retain the six named query-shape routes and their specialized projection, predicate, grouping/order, bounded retrieval and audit-expansion validation. The shared gate is additive; it does not replace adapter validation or Dataverse authorization. No unrecognized query may enter a specialized adapter through permissive fallback.

Acceptance:
- Six supported shapes remain routed to the named adapter.
- Unsupported near-matches reject before adapter data operations.
- Existing paging, row caps, audit-detail concurrency and duplicate/cardinality expectations remain intact.

### ADR-08 — Paging, limits and evidence

Distinguish result truncation from UI pagination. Preserve explicit SQL ordering. Add a deterministic tie-breaker only when it preserves the defined semantics; otherwise reject or document unsupported paging. Validate same-origin paging links and detect repeated links. Maintain a capability-to-test-to-live-evidence matrix.

Acceptance:
- Supported page boundaries contain no duplicates/missing rows under the documented ordering contract.
- Same-origin, repeated-link and cap behavior are tested.
- Offline, live semantic, authentication and infrastructure-blocked outcomes are reported separately.

## Proposed routing matrix

| Condition | Decision |
|---|---|
| Valid ordinary SELECT supported by native endpoint | Route to `native-sql` |
| Query supported by FetchXML planner with proven semantics | Route to `fetchxml` |
| One of six recognized and fully validated security/audit shapes | Route to `security-audit` |
| Unsafe, malformed, unsupported, ambiguous or over-limit SQL | Reject before execution |
| No provider with proven semantics | Reject as unsupported |
| Explicit capability rejection | Alternate only if approved and equivalent |
| Auth, authorization, metadata permission, timeout, transport, throttle, data or internal failure | Preserve normalized error; no fallback |

## Proposed implementation sequence

1. Record/approve ADR-01 through ADR-08 in the shared execution contract.
2. Define the canonical AST/decision/provider outcome interfaces and exact resource limits.
3. Implement shared policy and coordinator dispatch with zero-call and no-fallback tests.
4. Migrate native SQL, FetchXML and security/audit adapters in separate ownership areas.
5. Normalize results/errors and add the UI compatibility adapter.
6. Replace the two execution actions with one automatic Execute action after contract tests pass.
7. Run fresh offline CI and bounded live checks in the designated development/test environment.

## Unresolved implementation details

- Exact AST structure and parser API for parse-once behavior.
- Typed decision and provider outcome shapes.
- Exact shared limits and deadline/cancellation mechanism.
- Duplicate output-column key policy and exact-count semantics.
- How provider capability rejection is represented without message matching.
- Deterministic paging when SQL ordering is non-unique.

## Disposition

Architecture direction recommended for approval; implementation must remain gated until the shared contract records the above decisions and the required interfaces/limits. This report is a design review, not evidence that the proposed interfaces or tests are implemented.
