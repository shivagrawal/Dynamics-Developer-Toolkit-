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
