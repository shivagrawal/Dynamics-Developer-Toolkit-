# Query Studio Execution Coordinator — Architecture Review and Implementation Plan

**Status:** review completed; implementation work is still required  
**Target:** `feature/sql4cds-query-studio`  
**Related work:** QS-1 contracts, QS-2 coordinator, QS-3 read-only policy, QS-4 native provider, QS-5 FetchXML semantics, QS-7 result normalization, QS-10 release gate  
**Safety boundary:** preserve `main`; do not run audit-mutating live tests without a separately approved environment decision.

## Executive decision

Implement one background-owned coordinator that parses once, applies a fail-closed policy, plans a deterministic provider route, executes only that route (except for an explicitly typed and equivalence-proven capability rejection), and returns the canonical normalized outcome. The UI should invoke one Execute action and render the normalized result; it must not independently select providers or reparse SQL to decide the execution route.

Do not merge the current routing slice as if it completes this architecture. The current UI and background code contain useful guards and tests, but provider choice and parse ownership are still split across layers.

## Findings grounded in current code

### 1. Parsing and route choice are split

- `ui/sql-studio-view.js` calls `DevLensSqlEngine.plan(state.sql)` to detect OFFSET/FETCH, then independently calls the background `querySql` action for native SQL in ordinary cases.
- If the UI chooses the FetchXML route, `executeEngine` compiles and sends `queryFetchXml`; the background validates that request independently. This makes the UI an execution-policy participant rather than a renderer of one coordinator outcome.
- `sql-policy.js` calls `engine.parse(sql)` and returns `route: "native-sql"` for all ordinary valid plans. It validates safety but does not yet choose among native SQL, FetchXML, and named security/audit adapters from a capability matrix.
- The background performs separate security-shape detection and dispatch. Specialized security queries intentionally use stricter adapter-specific validation because their syntax exceeds the ordinary SELECT parser; this is a compatibility exception that must remain explicitly typed and fail closed, not be treated as an ordinary parsed AST.

**Decision:** move provider selection into a single background coordinator. The coordinator should own the parsed plan and a typed policy/route decision. UI-side parsing may remain for editor diagnostics only, never as authority for execution routing.

### 2. Provider contract is not yet canonical end to end

- `sql-result-normalizer.js` already provides `normalizeResult`, `normalizeError`, `normalizeOutcome`, and a legacy UI adapter.
- `ui/sql-studio-view.js` still builds results through its own `legacyNormalizedResult` path and has separate success/error flows for native SQL and FetchXML.
- Provider names in existing paths include legacy labels such as `dataverse-native-sql`, `dataverse-fetchxml-js-engine`, and security-adapter names. The execution boundary must map these to the canonical provider identifiers `native-sql`, `fetchxml`, and `security-audit` before returning canonical outcomes.
- A normalizer is useful only if every provider outcome crosses it. Merely testing the normalizer module does not establish end-to-end integration.

**Decision:** coordinator returns a canonical success/error union; legacy field names and display labels are produced only by the UI compatibility adapter. Preserve exact column labels and order, SQL NULL values, explicit zero counts, unknown counts as absent, and explicit truncation.

### 3. Fallback must be narrower than ordinary error handling

The contract correctly prohibits fallback on authentication, authorization, metadata permission, timeout, transport, throttling, cancellation, data, and internal errors. The normalizer currently sets `fallbackEligible: false` by default; that is a safe baseline but cannot itself establish equivalence of a fallback plan.

**Decision:** the coordinator may try an alternate provider only when all are true:
1. the initial provider returns a typed `PROVIDER_CAPABILITY_REJECTION` (not a message-text heuristic);
2. the planner has a separately validated alternate route for the same parsed request;
3. the route's documented capability semantics are equivalent for that query shape;
4. the alternate route remains within the original deadline, concurrency slot, and output budget; and
5. the retry is recorded in safe diagnostics without query values or secrets.

Never replay a timeout or arbitrary provider failure. OFFSET/FETCH is a deterministic FetchXML route based on observed native endpoint behavior, not error-triggered fallback.

### 4. The existing safety limits have real platform qualifications

The shared background wrapper currently sets a 120-second deadline, maximum four concurrent top-level executions, and an estimated 64 MiB accumulated-row cap. The delivery contract records that `Xrm.WebApi.retrieveMultipleRecords` cannot be aborted in flight and that the row cap is estimated after response parsing/while accumulating rows. These are platform limitations, not hard cancellation or a hard process-memory guarantee.

**Decision:** preserve those accurate qualifications in UI diagnostics and documentation. All provider paths must receive the same execution envelope; a timeout response must not release the active slot until the underlying operation settles.

### 5. Security/audit adapter must stay a named, separate route

The existing tests prove six canonical security/audit query shapes dispatch to the specialized adapter and unsupported near-matches are rejected before provider invocation. Do not route these queries through ordinary FetchXML merely because the generic parser cannot represent their syntax. The adapter's shape validation remains strict, and its persistent audit side effects must not be invoked as part of ordinary read-only smoke tests.

**Decision:** coordinator detects a candidate specialized shape, validates it through the named adapter's approved-shape contract, and either routes it to `security-audit` or fails closed. No generic fallback from or into this route.

## Target contracts

### Request
- `sql`: original statement
- `requestId`: opaque correlation identifier generated locally
- `startedAt` / `deadlineAt`: monotonic or consistently interpreted deadline metadata
- `limits`: clamped execution limits (never caller-increasable)
- Optional internal context: execution surface and environment identifiers only when already available; no credentials or row values in diagnostics.

### Policy and route decision
- `ok`, `code`, safe diagnostic message
- one of `native-sql`, `fetchxml`, `security-audit`, or no route
- trusted parsed plan for ordinary supported SQL; specialized approved-shape token/descriptor for the security/audit adapter
- capability/reason codes from an allowlisted set
- alternate route only when equivalence is explicitly established by the planner

### Canonical success
- `ok: true`
- canonical provider identifier
- ordered column descriptors with stable unique row keys and unchanged labels
- rows with SQL NULL represented as `null`
- optional total count only if the provider explicitly supplies a valid non-negative integer (preserve zero)
- explicit `truncated`, paging metadata, duration, warnings, and safe diagnostics

### Canonical error
- `ok: false`, stable category/code, safe user-facing message, provider if known
- retryability and fallback eligibility are separate fields
- fallback eligibility defaults to false and is not inferred from category or error message
- no raw response bodies, credentials, SQL parameter values, or row values in diagnostics

## Implementation sequence

1. **QS-1 contract/ADR:** freeze request, route-decision, canonical result/error and diagnostics schemas before wiring additional providers.
2. **QS-3 policy boundary:** add a coordinator-facing policy method that accepts the SQL once and returns a trusted plan/decision; keep the security/audit shape path explicitly separate and fail closed.
3. **QS-2 coordinator:** implement a background-owned coordinator with injected provider functions so routing/fallback can be tested without Dataverse.
4. **QS-4 native adapter:** wrap existing native SQL execution and map its response/errors into the canonical outcome.
5. **QS-5 FetchXML adapter:** accept the already parsed/validated plan and metadata, compile and execute without reparsing the original SQL; reject unsupported/misaligned paging before a provider call.
6. **QS-7 normalization:** normalize each provider outcome exactly once at the coordinator boundary; UI uses only the legacy presentation adapter if required.
7. **UI simplification:** one Execute action; remove UI-owned provider choice and generic retry logic. Display selected provider, duration, warnings, truncation, and safe error category.
8. **Adversarial and integration tests:** assert each rejection makes zero provider calls; every success uses exactly one selected route except an approved typed capability rejection; verify no fallback on auth/timeout/transport/throttle/data errors; assert one normalized shape for all routes.
9. **Release gate:** run all offline suites and syntax/manifest validation on the exact candidate SHA. Run read-only live semantic tests on that SHA where possible. Keep audit-mutating tests separately gated and classify hosted CI billing/startup failures as infrastructure blocks, never as passes.

## Acceptance tests required before calling QS-2 complete

- Ordinary supported SELECT is parsed once and selects the provider deterministically from a table-driven capability matrix.
- OFFSET/FETCH selects bounded FetchXML directly; native SQL provider call count is zero.
- Each approved security/audit shape selects `security-audit`; near-matches are rejected before any provider call.
- Writes, CTE-prefixed writes, multiple statements, malformed SQL, unterminated comments/strings, and unsupported syntax fail before provider invocation.
- Capability rejection can trigger fallback only for a planner-approved equivalent route.
- Authentication, authorization, metadata permission, timeout, transport, throttling, cancellation, data, and internal failures never trigger fallback.
- Canonical provider IDs are `native-sql`, `fetchxml`, and `security-audit`; legacy aliases are mapped at the adapter boundary.
- Empty and null-only results preserve ordered column descriptors; duplicate labels retain distinct row keys; explicit zero counts remain zero; absent counts stay absent.
- Truncation is true only when the provider stopped before completing the requested result; UI pagination alone is not truncation.
- Query deadline/concurrency/output limits are shared across the execution attempt and any approved fallback.
- Logs and diagnostics contain no secrets, token material, or row values.
- Existing export, paging, accessibility, and one-Execute UI regressions pass.

## Current status

The local Windows verification report on the runner branch establishes that the current baseline suite and listed live semantic cases pass. It does not prove that this coordinator architecture is implemented. Hosted Actions remains blocked by the account billing/spending limit until a workflow actually executes. No audit-mutating live test was run as part of that local verification.
