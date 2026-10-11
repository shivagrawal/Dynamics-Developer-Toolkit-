# Query Studio Baseline and Execution Contract

**Status:** baseline recorded; architectural direction approved on 2026-10-11; implementation is in progress. Detailed AST/provider/normalizer decisions and current-commit verification remain open.  
**Integration branch:** `feature/sql4cds-query-studio`  
**Product boundary:** independent, read-only browser-based Dataverse SQL workspace. SQL4CDS and XrmToolBox are not runtime dependencies.

## Current integration checkpoint — 2026-10-11

This section supersedes older workflow counts below when describing the current integrated branch. Historical evidence remains historical.

- Latest verified application-code/test checkpoint SHA: `af432855b49872d91e3f73c94c8b6e6cc6a4c0a8`; subsequent commits in this sequence update delivery documentation only.
- Latest completed offline regression: [run 38156403515](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/actions/runs/38156403515), exact SHA `af432855b49872d91e3f73c94c8b6e6cc6a4c0a8`, **190 passed, 0 failed, 0 skipped**.
- Live semantic matrix: [run 38156387008](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/actions/runs/38156387008), SHA `25ee4dc97215565d6a9c5c44c0a89648c7a8eef7`, **passed**. It verified simple projection/order, NULL and NOT NULL predicates, LIKE, empty results, LEFT JOIN cardinality parity, bounded COUNT, two FetchXML OFFSET/FETCH pages of five rows with zero overlap, and LEFT JOIN null-extension for a deterministic unmatched join. The later `af432855` change adds a security-route guard and test. Values and aggregate counts were omitted from logs.
- Live security/audit integration: [run 38156018818](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/actions/runs/38156018818), SHA `f77e015fcc57d9ee2ce3a37f26c9177f21adb62c`, **passed**. This run is on the immediately preceding code commit before subsequent test-only edits; inspect a new run if security/audit code changes.
- Dataverse environment integration: [run 38156018839](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/actions/runs/38156018839), SHA `f77e015fcc57d9ee2ce3a37f26c9177f21adb62c`, **passed**.
- Live native OFFSET/FETCH probe showed the native SQL endpoint returned more rows than the requested FETCH NEXT bound: [run 38155846050](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/actions/runs/38155846050). Query Studio now routes parsed OFFSET/FETCH statements directly through the bounded FetchXML path; a regression test verifies the native SQL provider is not called for that syntax.
- Branch reconciliation: feature is 0 commits behind `main`; PR #1 is mergeable but remains draft. Protected `main` remains at `ac139117a2651e94fbdf368c5ae50ad0590821da` and has not been modified by this work.
- **Persistent environment side effect:** the live audit test enables organization auditing, account-table auditing, and account-description auditing where needed, and intentionally leaves them enabled. Do not automatically revert these settings without an explicit environment decision.

### Current release status

The latest completed offline regression is green on SHA `b2b669ef9bd7979d05d2c1c190d60dc2a639b0c6` ([run 38156199548](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/actions/runs/38156199548)); the live semantic matrix is green on code-equivalent SHA `e0b505f80ed5b9d71fd425219f2084e9cfa4a413` ([run 38156100763](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/actions/runs/38156100763)). Later changes in this sequence were documentation-only. Security/audit and environment integration were green on the immediately preceding code commit `f77e015fcc57d9ee2ce3a37f26c9177f21adb62c`; the subsequent changes were confined to test files. Release acceptance is **not yet complete** because the shared deadline, cancellation, concurrency, and output-buffer controls remain unverified at the authoritative coordinator boundary, and a final release-gate review is still required.

**OFFSET/FETCH capability decision from live evidence:** the native Dataverse SQL endpoint did not enforce the requested row bound in the live probe. The UI therefore routes this syntax to FetchXML rather than trusting native SQL. FetchXML page/count can represent only exact page boundaries in this compiler; a missing FETCH NEXT or non-aligned offset is rejected rather than silently changing SQL semantics. The current live matrix verifies aligned page 1 and page 2 behavior. This is a tested capability-specific route, not generic fallback on an error.

### Contract reconciliation rules

- Canonical provider identifiers remain `native-sql`, `fetchxml`, and `security-audit`. Existing legacy provider labels may be accepted at an adapter boundary for compatibility, but must be mapped to these canonical identifiers before they are represented as canonical results. Do not change current callers without a compatibility test.
- Ordered column descriptors and exact labels are canonical. Duplicate labels may remain identical in descriptors; each column must have a distinct stable row key. The legacy UI adapter may disambiguate display keys, but must not mutate canonical labels or lose values.
- A total count is present only when a provider explicitly supplies a valid non-negative integer. Unknown count is omitted; exact zero is retained. Returned row count must not be used as a count substitute.
- `truncated` means the provider stopped before the requested result was complete. UI pagination alone is not truncation. Any provider cap that prevents completeness must be surfaced as truncation.
- Fallback eligibility is a coordinator decision, never inferred from retryability or a generic error category/message. Only an explicit typed capability rejection may be considered, and only when the alternate plan is independently proven equivalent. Auth, authorization, metadata permission, timeout, transport, throttling, data, cancellation and internal errors never trigger fallback.
- Runtime controls are implemented in the feature code checkpoint `2a873e7f128601570c7e419bbf44727e3346ffed` and covered by the full offline regression workflow [run 38160480955](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/actions/runs/38160480955): **195 passed, 0 failed, 0 skipped**. GitHub Actions checked out PR merge ref `c3d12f3313a95f25162a1503be624f3b0617f8c0` containing the feature changes.
- Enforced controls: 120-second deadline, fail-fast maximum of four concurrent top-level query executions, and 64 MiB estimated accumulated-row output cap. Native SQL and security-adapter HTTP requests receive AbortSignal; accumulated rows are bounded and truncation/typed limit outcomes are surfaced.
- **Platform limitation:** `Xrm.WebApi.retrieveMultipleRecords` cannot be aborted in flight. Query Studio returns a timeout at the deadline, but the execution slot remains occupied until the pending call settles. This is not a guarantee that an unresponsive FetchXML call is physically terminated.
- The output cap is a conservative estimate applied during row accumulation; a provider response page is already parsed by `response.json()` before its rows can be capped. It is not a hard browser-process memory limit.
- These controls close the previously unverified runtime-bounds gap for the tested boundary, but the full parse-once capability-first coordinator and final release gate remain outstanding.

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

- The offline regression workflow does not call Dataverse. Current result: [run 38156100708](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/actions/runs/38156100708), 189 passed, 0 failed, 0 skipped on `e0b505f80ed5b9d71fd425219f2084e9cfa4a413`.
- The bounded live semantic matrix passed on that same SHA: [run 38156100763](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/actions/runs/38156100763). This verifies only the listed cases, not all SQL compatibility.
- Security/audit and general Dataverse integration passed on `f77e015fcc57d9ee2ce3a37f26c9177f21adb62c` ([security/audit](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/actions/runs/38156018818), [environment integration](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/actions/runs/38156018839)); later changes were confined to tests and semantic-matrix evidence.
- A previous security/audit run timed out with `ETIMEDOUT`; that remains a historical infrastructure failure, not a semantic pass or proof of a SQL defect.
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
| Bounded live semantic matrix | Listed cases passed on `25ee4dc`; broader compatibility remains incomplete | Add more capability-specific fixtures and keep infrastructure failures distinct |

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
7. Route OFFSET/FETCH through the bounded FetchXML provider, not the native Dataverse SQL endpoint: live evidence showed the endpoint can return more rows than FETCH NEXT requests. The FetchXML compiler accepts only bounded, exact page boundaries (`offset % fetch === 0`) and rejects missing FETCH NEXT or non-aligned offsets rather than silently changing results. Evidence: [live semantic matrix](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/actions/runs/38156387008) and [native endpoint bound failure](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/actions/runs/38155846050).

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

## 7. Current coordination priorities

1. The baseline inventory and architecture review are committed; the Engineering Lead has approved the high-level architecture and strict capability-only fallback.
2. Complete the safety audit and obtain fresh regression evidence for the already-committed policy gate. The historical 111/0/0 run is not current-branch evidence.
3. Finalize the exact canonical AST/policy/provider-outcome interfaces, duplicate-column key strategy, and unknown-versus-zero count semantics in the relevant owned workstreams before freezing their APIs.
4. Implement the normalizer and execution coordinator within the file ownership boundaries in `QUERY-STUDIO-PARALLEL-THREAD-OPERATIONS.md`; reconcile each commit before the next shared-branch write.
5. Run full offline regression and bounded live checks against the exact integrated commit; record infrastructure-blocked checks separately.


## 1.1 Offline test inventory

The current workflow explicitly runs these eight test files:

| Test file | Primary responsibility | Coverage boundary / next improvement |
|---|---|---|
| `tests/query-studio/sql-engine.test.mjs` | In-house SQL parser/planner and FetchXML compiler | Add semantic edge cases and per-feature tests as grammar grows; live equivalence is separate |
| `tests/query-studio/sql-front-end.test.mjs` | Tokenization, clause/projection parsing for editor assistance, completion context | Keep completion parsing distinct from execution-policy parsing; malformed input should suppress suggestions safely |
| `tests/query-studio/query-studio-regression.test.mjs` | Query Studio regression behaviors and shared execution helper scenarios | Map each test to capability and expected provider; add normalized result/error contract assertions |
| `tests/query-studio/security-query-corpus.test.mjs` | Golden corpus for six named security/audit SQL shapes and their semantics | Expand only when adapter behavior is implemented and validated; reject unimplemented semantic variants |
| `tests/query-studio/security-query-adapter.test.mjs` | Specialized adapter projection/condition/ordering validation and bounded audit behavior | Add shared policy-gate integration assertions and normalized adapter output tests |
| `tests/query-studio/security-sql-routing.test.mjs` | Ensures named security SQL uses the specialized bridge while ordinary SQL remains on native route | Migrate assertions to the coordinator/provider decision contract when it exists |
| `tests/query-studio/sql-policy.test.mjs` | Shared fail-closed policy and resource-limit checks; verify dispatch-boundary zero-call behavior, all six named shapes, AST traversal, and FetchXML validation at the true trust boundary |
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

The high-level architecture is approved, but these implementation details are not silently treated as accepted: canonical AST/parse-once interface, typed decision and provider outcome shapes, precise enforced limits versus proposed deadline/concurrency/memory controls, duplicate-column key strategy, count semantics, and dispatch ownership. Resolve them in the owning workstream/issue before freezing dependent APIs. The specialist reports are linked from [issue #3](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/issues/3) and [issue #5](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/issues/5).

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

1. **Finish safety verification:** audit the committed policy gate, all six named security/audit shapes, actual FetchXML entry points, parser limit traversal, and zero-provider-call assertions. Record current-commit CI evidence when available; do not treat missing status data as a pass.
2. **Freeze remaining interface details:** document the trusted parsed-AST handoff, typed policy decision/provider capability outcome, exact error-to-fallback classification, duplicate-column key strategy, and count/truncation semantics. Keep proposed numeric deadline/concurrency/memory controls separate from enforced limits.
3. **Implement the pure result/error normalizer:** use the assigned new module and isolated contract tests; preserve duplicate values, alias casing, SQL NULL, empty-result columns, explicit truncation, and unknown versus exact-zero counts. Do not integrate it into provider call sites until its API is committed.
4. **Implement the execution coordinator and one Execute action:** route deterministically through the shared policy gate, preserve all six named security/audit routes, and allow fallback only for typed capability rejection when an equivalent route is proven. Use a local contract fixture if the normalizer is not yet committed; do not create a competing normalizer.
5. **Integrate and verify:** connect the committed normalizer through the legacy UI adapter, test every provider path and no-fallback failure class, then run the complete offline workflow and bounded live checks against the exact integrated commit.
6. **Record release evidence:** link workflow URLs and tested SHAs; distinguish semantic failures from network/auth/service infrastructure blocks; update the capability matrix. Keep `main` untouched.

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
