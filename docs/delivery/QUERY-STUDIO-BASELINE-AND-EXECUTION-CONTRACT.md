# Query Studio Baseline and Execution Contract

**Status:** baseline recorded; execution contract proposed for review, not yet implemented.  
**Integration branch:** `feature/sql4cds-query-studio`  
**Product boundary:** independent, read-only browser-based Dataverse SQL workspace. SQL4CDS and XrmToolBox are not runtime dependencies.

## 1. Baseline evidence

### Offline regression

- Workflow: [Query Studio Regression Tests](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/actions/runs/38128383227)
- Tested commit: `fd068b920af1e86efed839b8c53477e489e35322`
- Result: **111 passed, 0 failed, 0 skipped**.
- JavaScript syntax checks and extension manifest JSON validation passed.
- Suite command is in `.github/workflows/query-studio-regression.yml`.

The current offline suite covers:
- SQL engine parser/planner/compiler behavior and unsupported syntax.
- SQL editor tokenizer/completion.
- Query Studio regression and result paging/export contract.
- Six security/audit query adapters and their fail-closed corpus.
- Security SQL routing and UI integration.

### Live environment evidence — do not conflate with offline CI

- The latest offline workflow does not call Dataverse.
- Earlier live native SQL smoke and general Dataverse integration checks passed on an earlier feature-branch commit; those results are not evidence for every later change.
- The most recent recorded security/audit live run failed with an endpoint connection timeout (`ETIMEDOUT`). This is an infrastructure failure, not a semantic pass or proof of a SQL defect.
- Retry live security/audit only after connectivity preflight, with bounded retry for transient connection failures. Keep actual assertion failures red.
- Audit integration can modify persistent audit configuration. Run only against the designated personal development/test environment; never production/shared environments without explicit approval.

## 2. Current capability inventory

| Capability | Evidence-backed status | Main gap |
|---|---|---|
| Query Studio editor/results/exports | Implemented; offline-tested | One Execute path and consistent diagnostics |
| Schema explorer | Implemented | Relationships, metadata cache policy and richer completion |
| Native Dataverse SQL | Implemented provider for its supported subset; live smoke has passed historically | Stable adapter contract and strict error classification |
| In-house SQL-to-FetchXML planner/compiler | Implemented for a bounded SELECT subset; offline-tested | Correctness expansion and live validation by feature |
| Security/metadata/audit adapters | Implemented for six named query shapes; offline corpus tested | Preserve exact semantics while centralizing policy/routing |
| Read-only bounds and fail-closed parsing | Present in multiple layers | One shared policy gate before every provider |
| Unified automatic execution coordinator | Not complete | Introduce agreed request/decision/result/error contracts |
| Advanced SQL compatibility | Partial/not supported for several constructs | Add features one by one with fixtures and live evidence |
| Full live semantic matrix | Incomplete | Capability-specific Dataverse tests and honest infrastructure classification |

## 3. Proposed architecture

`UI` → `execution coordinator` → `shared parse + read-only policy` → `capability planner/provider router` → one of:
- `native-sql`: Microsoft's Dataverse SQL endpoint when the query fits its tested capability contract.
- `fetchxml`: in-house SQL subset planner/compiler plus Dataverse FetchXML execution.
- `security-audit`: named, explicitly validated metadata/security/audit adapter shapes.

All paths return through a result normalizer to the UI. Metadata lookup is a dependency of the FetchXML compiler and must be permission-aware and bounded.

This is the target design. Existing code has separate paths and does not yet satisfy the complete contract below.

## 4. Contract v0.1

### 4.1 Query request

```ts
type QueryRequest = {
  sql: string;
  requestId?: string;
  // Execution limits are policy-owned. UI callers cannot raise hard caps.
};
```

The coordinator must own timing and execution state. The SQL string is the source input; providers must not invent or silently rewrite query semantics.

### 4.2 Policy and routing decision

```ts
type ProviderId = "native-sql" | "fetchxml" | "security-audit";

type QueryDecision = {
  accepted: boolean;
  provider?: ProviderId;
  reasonCode: string;
  safeExplanation: string;
  // Internal parsed representation/plan is not exposed as trusted user input.
};
```

Decision requirements:
1. Parse the query once through the shared parser/token stream.
2. Reject writes, multiple statements, malformed SQL, unsupported syntax and exceeded limits before any data provider is called.
3. Select a provider from parsed capabilities and tested semantics, not a user-facing engine selector.
4. Keep named security/audit shapes routed to their dedicated adapter until equivalent generic execution is proven.
5. Never use regex-only matching as the security gate. A specialized adapter must validate the exact projection, predicates, joins, grouping/order semantics it implements.
6. Do not fetch unbounded datasets to emulate unsupported SQL locally.

### 4.3 Canonical execution result

```ts
type QueryColumn = {
  name: string;       // stable key used in each row object
  label: string;      // SQL-facing output label, preserving alias casing
  logicalName?: string;
  dataType?: string;
};

type QueryResult = {
  provider: ProviderId;
  columns: QueryColumn[];
  rows: Array<Record<string, unknown>>; // SQL NULL is represented as null
  truncated: boolean;
  totalRecordCount?: number;
  durationMs: number;
  warnings: string[];
  diagnostics?: {
    planSummary?: string; // safe/redacted only
    pagesRead?: number;
  };
};
```

Compatibility rule: the current UI and some APIs consume string column names. Introduce an adapter at the UI/provider boundary during migration; do not change the public UI shape in a way that breaks export/paging tests. Null-only and empty result sets must still retain column metadata. Truncated results must never look complete.

### 4.4 Canonical error

```ts
type QueryErrorCategory =
  | "SQL_SYNTAX" | "SQL_UNSUPPORTED" | "READ_ONLY_POLICY"
  | "METADATA" | "AUTHENTICATION" | "AUTHORIZATION"
  | "THROTTLED" | "TIMEOUT" | "TRANSPORT"
  | "DATAVERSE" | "INTERNAL";

type QueryError = {
  category: QueryErrorCategory;
  code: string;
  message: string;       // actionable, safe for UI
  provider?: ProviderId;
  retryable: boolean;
  detailsSafe?: Record<string, unknown>;
};
```

Do not expose tokens, raw headers, customer result values, or sensitive server payloads in errors/logs. Preserve actionable Dataverse correlation/request identifiers only where safe.

### 4.5 Fallback policy

Fallback is permitted only when a provider returns a specifically classified **syntax/capability rejection** and the alternate provider is independently proven to preserve the query's semantics and bounds.

Never fallback on authentication, authorization, timeout, transport, throttling, service-protection, metadata permission, or data errors. Never swallow the original provider error and report a success from a path that changed query meaning.

## 5. Ownership boundaries for coordinated threads

| Workstream | Owns primarily | Must coordinate before editing |
|---|---|---|
| Architect / coordinator | This contract, ADRs, provider routing design | All shared execution interfaces |
| SQL engine | `sqlstudio/js/sql-engine.js` and engine-focused tests | AST and policy-gate contract |
| Safety | New shared policy module and adversarial safety tests | Coordinator/provider entry points |
| Native provider | Native adapter boundary and provider tests | Result/error contract and background bridge |
| UI/coordinator | `ui/sql-studio-view.js` and orchestration tests | Provider routing and UI compatibility adapter |
| Security/audit | `security-audit-service.js` and adapter corpus | Named-query dispatch and policy gate |
| QA | Test inventory, regression workflow, live harness documentation | Acceptance criteria and infrastructure failure policy |

Do not assign simultaneous edits to the same file. A dependent stream may build contract tests against fixtures/mocks once this contract is accepted.

## 6. Acceptance gates

- **Gate A — contract approved:** Engineering Lead and Architect agree request, decision, result/error shapes and routing/fallback rules.
- **Gate B — coordinator:** one Execute action, deterministic routing tests, existing native and adapter regressions green.
- **Gate C — safety:** provider-call tests prove unsafe SQL is rejected before any execution.
- **Gate D — semantic correctness:** null, alias, joins, duplicate cardinality, ordering and paging fixtures; live evidence for features marked live-tested.
- **Gate E — release:** all offline Query Studio tests pass; syntax/manifest checks pass; live results are current and clearly classified; `main` remains untouched.

## 7. Immediate next tasks

1. Complete baseline test inventory and link it to issue #2.
2. Review and approve this contract under issue #3.
3. Only then allocate implementation threads for coordinator, policy, provider adapters and QA.


## 1.1 Offline test inventory

The current workflow explicitly runs these seven test files:

| Test file | Primary responsibility | Coverage boundary / next improvement |
|---|---|---|
| `tests/query-studio/sql-engine.test.mjs` | In-house SQL parser/planner and FetchXML compiler | Add semantic edge cases and per-feature tests as grammar grows; live equivalence is separate |
| `tests/query-studio/sql-front-end.test.mjs` | Tokenization, clause/projection parsing for editor assistance, completion context | Keep completion parsing distinct from execution-policy parsing; malformed input should suppress suggestions safely |
| `tests/query-studio/query-studio-regression.test.mjs` | Query Studio regression behaviors and shared execution helper scenarios | Map each test to capability and expected provider; add normalized result/error contract assertions |
| `tests/query-studio/security-query-corpus.test.mjs` | Golden corpus for six named security/audit SQL shapes and their semantics | Expand only when adapter behavior is implemented and validated; reject unimplemented semantic variants |
| `tests/query-studio/security-query-adapter.test.mjs` | Specialized adapter projection/condition/ordering validation and bounded audit behavior | Add shared policy-gate integration assertions and normalized adapter output tests |
| `tests/query-studio/security-sql-routing.test.mjs` | Ensures named security SQL uses the specialized bridge while ordinary SQL remains on native route | Migrate assertions to the coordinator/provider decision contract when it exists |
| `tests/query-studio/sql-studio-ui.test.mjs` | UI behavior including result pagination/export and metadata retention | Add one-Execute-action, provider diagnostics, truncation and normalized error tests |

Workflow-level checks also run `node --check` for the background bridge, security/audit service, UI, front-end parser, SQL engine and live-query harness, and parse `manifest.json`.

This inventory is a test-file map, not a claim that every possible behavior within each area is covered. Detailed capability-to-test traceability remains part of QS-0.


---

## 2. Approved architectural decisions and implementation gate

**Decision status:** the Engineering Lead approved the architectural direction on 2026-10-11. The exact numeric limits and detailed AST/provider interfaces below are recorded as proposals for implementation planning and must be validated against the existing runtime before code changes.

The approved architectural decisions are:

1. **One authoritative execution pipeline.** Parse the original SQL once into a trusted internal representation, apply a shared fail-closed read-only policy, assess capabilities, select an execution path, and normalize the outcome. No UI flag or provider entry point may bypass this sequence.
2. **Capability-first automatic routing.** The coordinator selects the provider from the validated query's capabilities and verified semantics. There is no user-facing engine selector. If no provider is proven to preserve semantics, reject the query rather than approximate.
3. **Strict capability-only fallback.** Fallback is permitted only after an explicit typed capability rejection and only when an approved alternate route is independently proven semantically equivalent for the query. Authentication, authorization, metadata permission, timeout, transport, throttling, data, and internal errors never trigger fallback. Generic messages, HTTP status alone, and broad DATAVERSE errors are not capability signals.
4. **Canonical result/error contract with a compatibility adapter.** Ordered column descriptors are authoritative; duplicate labels must not overwrite values; aliases and SQL NULL semantics are preserved; empty results retain metadata; truncation is distinct from UI pagination; unknown count is distinct from exact zero. Existing string-column, paging, export and legacy warning consumers are preserved through an adapter during migration.
5. **Preserve specialized security/audit routes.** Keep the six named query-shape routes and their adapter-specific validations and bounds. The shared policy gate is mandatory and additive; it does not replace specialized checks or Dataverse authorization.

Implementation remains gated on agreement of the canonical AST/parse-once interface, typed decision and provider outcome shapes, precise hard limits/deadline behavior, duplicate-column key strategy, count semantics, and dispatch ownership. The specialist reports are linked from [issue #3](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/issues/3) and [issue #5](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/issues/5).

### 2.1 Proposed canonical decision and provider outcome

The following is a logical contract, not a required literal implementation shape:

- Parse failure -> stable `SQL_SYNTAX`, no data-provider call.
- Unsupported grammar -> stable `SQL_UNSUPPORTED`, no data-provider call.
- Unsafe statement/policy violation -> `READ_ONLY_POLICY`, no data-provider call.
- Query-level resource bound exceeded -> `QUERY_LIMIT_EXCEEDED`, no data-provider call.
- Policy accepted -> provider capability planning consumes the same trusted parsed representation.
- Provider capability assessment says unsupported -> consider another approved, semantically equivalent route before execution; otherwise reject.
- Execution outcome -> success or normalized failure. Execution failures must not be reclassified as capability rejections by message matching.

A typed discriminated union is preferred so invalid combinations (for example, a rejected decision with an executable provider) cannot be represented. The original AST must remain internal and must not be accepted from the UI as authoritative input.

### 2.2 Exact limits: existing evidence and proposed initial caps

The current code has several local limits but not yet one unified policy. The table distinguishes source-observed values from new recommended initial caps. New limits become binding only after implementation and tests enforce them at the authoritative boundary.

| Dimension | Current source evidence | Recommended initial contract | Enforcement and notes |
|---|---|---|---|
| Original SQL text | `sqlstudio/js/sql-engine.js` rejects over 100,000 characters | **100,000 characters maximum** | Check before tokenization; applies to all providers and specialized routes |
| Token count | No unified token-count cap verified | **20,000 tokens maximum** | Add to canonical tokenizer/parser boundary; reject before planning/provider dispatch |
| AST nesting | No unified depth cap verified | **64 nested levels maximum** | Count parentheses/nesting structurally, not with regex |
| Join count | Grammar supports bounded join forms; no shared hard join cap verified | **8 joins maximum** | Capability and policy checks share the same parsed representation |
| IN/NOT IN list | No shared list-size cap verified | **1,000 items maximum** | Apply to each list and reject before provider dispatch |
| Result rows | Native and security/audit paths use 10,000-row local caps; FetchXML retrieval is capped around 10,000 | **10,000 rows maximum per execution** | Applies across providers; set `truncated=true` if the cap prevents full result delivery |
| Provider pages | Native and security/audit code use a 100-page bound | **100 pages maximum per execution** | Repeated links rejected; paging links must remain in the active environment |
| Provider page size | FetchXML page size is at most 500 | **500 rows maximum per request/page where supported** | Do not claim native page size is 500 unless its actual API call is configured that way |
| Compiled FetchXML | `background.js` rejects compiled FetchXML over 1,000,000 characters | **1,000,000 characters maximum** | Preserve existing local validation and enforce before Dataverse retrieval |
| Security/audit expansion | Existing code uses a 1,000 audit-row expansion cap, 10,000 attribute-row cap and concurrency 4 | **1,000 audit rows; 10,000 attribute rows; 4 concurrent audit-detail calls** | Preserve existing specialized bounds; do not widen during centralization |
| Concurrent top-level executions | No unified global cap verified | **4 concurrent executions per extension context** | Proposed conservative initial cap; reject/queue deterministically and test isolation |
| End-to-end deadline | No unified coordinator deadline/cancellation contract verified | **120 seconds per execution** | Enforce at coordinator; abort underlying work when supported, ignore late completion, release concurrency slots, and return TIMEOUT. Verify actual abort support before claiming network cancellation |
| Buffered output | No unified byte cap verified | **64 MiB estimated serialized result buffer per execution** | Proposed protective ceiling; estimate bounded normalized output and stop safely with truncation or a safe limit error per final contract |
| Query cancellation | No unified cancellation contract verified | **One cancellation scope per request ID** | Cancellation must not affect concurrent requests; no provider fallback on cancellation/timeout |

These are recommendations for the first implementation, not assertions that every cap already exists. If a proposed cap conflicts with a current supported use case, record the fixture and evidence before changing it; do not silently raise limits. Tests must prove each limit is enforced before dispatch where it is a query-level constraint and during retrieval where it is a runtime constraint.

### 2.3 Paging and truncation contract

- `rows` contains the normalized rows returned to the caller for this execution, subject to the execution row cap.
- `columns` defines authoritative projection order and is returned even when `rows` is empty.
- `truncated=true` only when execution cannot return the complete requested result because an execution cap or explicit truncation policy stopped retrieval. Merely having more rows on another UI page is not truncation.
- `totalRecordCount` is nullable/unknown unless the provider can establish the count with the defined semantics. Never substitute zero for unknown.
- Preserve explicit SQL ordering. If supported paging cannot be deterministic for a non-unique order, document the limitation or reject that paging form rather than silently inventing SQL ordering.
- Follow only validated same-origin/environment paging links, reject repeated links, and apply the 100-page/10,000-row caps consistently.
- The UI adapter must preserve current paging and CSV/JSON export behavior while mapping canonical column descriptors to the legacy string-column contract.

### 2.4 Error classification and fallback matrix

| Outcome | Retry/fallback policy |
|---|---|
| SQL syntax, unsupported SQL, read-only policy, query limit | No retry and no provider fallback |
| Explicit typed provider capability rejection | Alternate route only when approved and equivalence-tested for the actual query |
| Authentication, authorization, metadata permission | No provider fallback |
| Timeout/cancellation | No provider fallback; do not automatically replay |
| Transport failure | No semantic fallback; any future infrastructure retry must be separately bounded and explicit |
| Throttling/service protection | Respect service-protection behavior; no provider fallback |
| Data/Dataverse/internal error | Preserve normalized error; no fallback unless a future specific typed contract proves it is a capability outcome |

A retry policy is not a fallback policy. Stable codes and safe, allowlisted, bounded diagnostics are required. Raw credentials, headers, query result values and sensitive service response bodies must not be exposed.

### 2.5 Acceptance gates before provider integration

- [ ] All policy-rejected queries produce zero data-provider calls across native SQL, FetchXML and security/audit routes.
- [ ] Multi-statement, malformed, unsupported, write/DDL, comment/quote and parser-exception adversarial cases fail closed.
- [ ] Provider capability rejection is typed; no message-text or generic HTTP-error fallback.
- [ ] Authentication, authorization, metadata permission, timeout, transport, throttling, data and internal failures cause no provider fallback.
- [ ] Exact resource caps and deadline behavior are enforced and covered by tests.
- [ ] Duplicate columns, aliases, SQL NULL, empty result metadata, truncation, unknown count, and safe errors have contract tests.
- [ ] Existing six named security/audit query shapes and specialized bounds remain intact.
- [ ] Existing UI paging and export tests remain green through the compatibility adapter.
- [ ] Fresh offline CI is recorded against the exact commit. Live Dataverse semantic checks are separately recorded as passed, failed, or infrastructure-blocked.

## 3. Specialist report links and ownership

- Architecture review: [QUERY-STUDIO-ARCHITECTURE-REVIEW.md](QUERY-STUDIO-ARCHITECTURE-REVIEW.md) — [issue #3](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/issues/3).
- QA/integration matrix: [QUERY-STUDIO-QA-TEST-MATRIX.md](QUERY-STUDIO-QA-TEST-MATRIX.md) — [issue #2](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/issues/2).
- Read-only policy design: [QUERY-STUDIO-READ-ONLY-POLICY-DESIGN.md](QUERY-STUDIO-READ-ONLY-POLICY-DESIGN.md) — [issue #5](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/issues/5).

The coordinator owns the shared contract and dispatch integration. SQL Engine owns parser/AST changes. Safety owns the isolated policy module and adversarial unit tests after the AST interface is agreed. QA owns test traceability and regression evidence. Security/Audit retains its adapter-specific implementation. Avoid concurrent edits to shared hot files.

## 4. Next implementation sequence

1. Validate the proposed limits against current code paths and agree the canonical AST, decision, provider outcome, deadline and cancellation interfaces.
2. Implement the shared pure policy module and zero-provider-call tests.
3. Integrate the mandatory gate in the coordinator before every provider/specialized adapter dispatch.
4. Migrate provider capability outcomes and strict fallback classification.
5. Add canonical result/error normalization and the legacy UI adapter.
6. Consolidate the UI to one automatic Execute action after routing/normalization contract tests pass.
7. Run the complete offline regression workflow and bounded live checks in the designated development/test environment; record the exact tested commit and distinguish infrastructure failures from semantic results.

`main` remains protected and is not a target for this work. No implementation step is complete until its code/tests and commit evidence exist.


## Implementation checkpoint — shared read-only gate

The first implementation slice is committed on `feature/sql4cds-query-studio`:

- `sqlstudio/js/sql-policy.js` — pure typed policy decisions, canonical engine parse for ordinary SQL, cross-provider plan limits, specialized security-query envelope, and pre-dispatch FetchXML validation.
- `sqlstudio/js/sql-engine.js` — 20,000-token, 64 predicate-depth, 512 predicate-node, 8-join, and 1,000-value IN-list hard caps are enforced in the parser itself so direct parser/compiler callers cannot bypass them.
- `background-entry.js` and `background.js` — load the shared gate in the extension worker and reject unsafe SQL / invalid FetchXML before injecting an execution bridge. Specialized routing is narrowed to named query shapes; the security/audit adapter retains its own detailed projection, join, predicate and paging checks.
- `tests/query-studio/sql-policy.test.mjs` and `tests/query-studio/security-sql-routing.test.mjs` — adversarial policy cases and zero-dispatch assertions; the regression workflow includes the new policy suite.

**Implemented limits:** SQL text 100,000 characters (existing), 20,000 tokens, predicate AST depth 64, 512 predicate nodes, 8 joins, 1,000 values per IN list, TOP/FETCH and OFFSET bounded to the existing 10,000-row ceiling, and compiled FetchXML 1,000,000 characters.

**Not yet implemented as unified coordinator controls:** four concurrent top-level executions, a 120-second end-to-end deadline/cancellation, a 64 MiB serialized-result budget, and one request-scoped cancellation lifecycle. Do not treat these proposals as enforced limits. Existing provider-specific row/page caps remain in place but need unified result/truncation verification.

**Verification status:** code and regression workflow updates are committed; the connected GitHub status interface has not returned a check result for these commits. Do not mark the policy issue complete until the updated offline workflow is observed passing and live Dataverse verification is recorded separately. Security/audit routes also require a valid-shape regression run after the tightened dispatcher matcher.
