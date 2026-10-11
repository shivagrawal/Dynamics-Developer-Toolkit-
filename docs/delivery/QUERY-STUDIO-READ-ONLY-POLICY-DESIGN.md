# Query Studio Shared Read-Only Policy Design

**Status:** Design proposed; implementation pending contract integration  
**Branch:** `feature/sql4cds-query-studio`  
**Related issue:** [#5 — Implement shared fail-closed read-only SQL policy gate](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/issues/5)  
**Ownership:** Safety design and proposed policy tests; coordinator integrates dispatch; SQL Engine owns parser/AST; Security/Audit owns specialized adapter.

## Objective

Centralize the safety decision without replacing existing SQL semantics or weakening provider-specific and security/audit safeguards. Every provider path must be downstream of the same authoritative parse and read-only policy gate.

## Proposed architecture

1. Accept untrusted SQL text from the UI/background message.
2. Parse once through the canonical SQL Engine parser into a trusted internal representation.
3. Evaluate statement boundaries, read-only operation, supported grammar and query-level hard limits.
4. Reject with a safe deterministic error before any data-provider call if parsing/policy fails.
5. Assess provider capabilities from the same parsed representation.
6. Dispatch only to an approved provider route: native SQL, FetchXML, or the named security/audit adapter.
7. Normalize result/error while retaining provider-specific defenses and Dataverse permissions.

The policy module should be pure: no network access, metadata retrieval, execution, persistent audit configuration changes, or result mutation. It should not implement a second SQL parser. Unexpected parser/policy exceptions fail closed.

## Proposed module and ownership boundaries

| Path/component | Responsibility | Owner |
|---|---|---|
| `sqlstudio/js/sql-policy.js` | New pure policy evaluator over canonical parsed representation | Safety |
| `tests/query-studio/sql-policy.test.mjs` | Unit/adversarial policy corpus | Safety |
| `tests/query-studio/sql-policy-routing.test.mjs` | Cross-provider zero-call integration tests; coordinate harness with QA | Safety + QA |
| `sqlstudio/js/sql-engine.js` | Existing tokenizer/parser/AST/planner/compiler | SQL Engine; Safety does not edit without agreement |
| `background.js` | Mandatory coordinator/gate integration at dispatch boundary | Coordinator/Engineering Lead |
| `security-audit-service.js` | Preserve exact named query recognition and specialized checks | Security/Audit |
| `docs/delivery/QUERY-STUDIO-BASELINE-AND-EXECUTION-CONTRACT.md` | Binding policy, decision, provider and limit contract | Architect/Engineering Lead |

These are proposed paths, not claims that the new files exist.

## Policy outcomes

Reconcile these proposed outcomes with the canonical error registry before implementation:

- `SQL_SYNTAX`: SQL cannot be parsed unambiguously.
- `SQL_UNSUPPORTED`: grammar/feature is not implemented and cannot be executed faithfully.
- `READ_ONLY_POLICY`: statement count/type or policy constraint violates read-only mode.
- `QUERY_LIMIT_EXCEEDED`: configured hard query limit exceeded.
- `PROVIDER_UNSUPPORTED`: globally valid query cannot be executed faithfully by a specific provider.

Policy acceptance is not provider acceptance. A query may be globally read-only and still unsupported by a provider.

## Mandatory invariants

- Exactly one executable statement; multiple statements/batches reject.
- Only the explicitly documented SELECT grammar is accepted.
- No regex/keyword scan may be the authoritative read-only decision.
- Comments, quoted strings, escaped literals, quoted/bracketed identifiers and semicolons are interpreted by the parser, not naïve substring tests.
- Writes, DDL, administrative/execute syntax, unsupported SELECT INTO/hints/locking syntax, CTEs, subqueries, UNION and other unimplemented grammar reject until deliberately implemented and tested.
- No rejected statement is rewritten into a different query to make it pass.
- Every execution entry point, including direct background messages and specialized routes, must invoke the gate.
- Provider-level defenses remain in place.
- A parser/policy exception is a rejection and results in zero data-provider calls.
- The gate's query-level limits and coordinator/provider runtime limits are all hard caps and cannot be raised by UI input.

## Existing bounds observed in the repository

The following values were found in current branch source and tests. They are existing implementation evidence, not proof that every provider enforces one unified contract:

- SQL engine rejects SQL text longer than **100,000 characters**.
- Native SQL retrieval in `background.js` has **10,000 rows** and **100 pages** as local bounds.
- FetchXML retrieval rejects compiled FetchXML over **1,000,000 characters**.
- FetchXML query paging uses a page size up to **500** and caps retrieval around **10,000 rows** via its calculated page limit.
- Security/audit retrieval uses **10,000 rows**, **100 pages**, an audit-row expansion cap of **1,000**, an attribute-row cap of **10,000**, and audit-detail concurrency **4**.
- Existing adapter tests assert the 10,000-row cap and bounded audit behavior.

The current code does not establish a unified AST token/depth/join bound or a single end-to-end query deadline/cancellation contract. These need explicit decisions before implementation.

## Proposed policy and resource rules

- Input-size check before expensive parsing.
- Token count, AST depth, expression count, join count and IN-list size need explicit limits before they can be advertised as bounded. Recommended initial values are recorded in the shared contract; revise only with evidence and tests.
- Maximum returned rows: 10,000 per execution across providers, with `truncated: true` whenever the cap causes incompleteness.
- Maximum provider paging: 100 pages per execution, with page size no greater than 500 where the provider supports it.
- Compiled FetchXML maximum: 1,000,000 characters.
- Security/audit maximum expanded audit rows: 1,000; maximum attribute rows: 10,000; audit-detail concurrency: 4.
- One coordinator-owned end-to-end deadline and cancellation policy must cover dispatch and result collection; no timeout value should be claimed as existing until the implementation enforces it.
- Concurrency and buffered-result memory limits must be coordinator-owned; UI-supplied options cannot increase them.

## Strict fallback policy

Fallback is not a generic retry. Permit it only when all are true:

1. The first provider returned a typed, explicit capability rejection.
2. That outcome cannot be produced from authentication, authorization, metadata permission, transport, timeout, throttling, data or internal errors.
3. The alternate provider is approved for the specific query capabilities.
4. Semantic equivalence is independently covered by tests.
5. The same environment, hard limits, cancellation/deadline and result normalization apply.

Otherwise preserve the original normalized error and do not call another provider. Do not use message-text matching or generic Dataverse/HTTP errors as a capability signal.

## Security/audit compatibility

The shared policy is additive to the six named security/audit shape validations. Each named route retains its projection/predicate checks, bounded retrieval, paging-loop protection, audit-detail concurrency limits and existing permission behavior. An unrecognized near-match must not enter the adapter. Unit tests must not mutate persistent audit configuration.

## Adversarial acceptance matrix

| Scenario | Expected |
|---|---|
| Plain supported SELECT | Accept only if provider capability is proven |
| DELETE/UPDATE/INSERT/MERGE/DDL/execute syntax | Reject; zero provider calls |
| Two SELECTs or SELECT followed by write | Reject; zero provider calls |
| Semicolon inside quoted literal/comment | Treat as content, not a second statement |
| Unclosed quote/comment/bracketed identifier | Syntax reject; zero calls |
| Comments inserted into unsafe token sequence | Structural parser decides; unsafe form rejects |
| Unsupported CTE/subquery/UNION/SELECT INTO/hints | Reject until supported |
| Unexpected parser/policy exception | Fail closed; zero calls |
| SQL longer than input cap | Reject before expensive parsing |
| Excessive nesting/list/joins | Reject at agreed structural cap |
| UI attempts to raise TOP/page/row cap | Hard cap remains authoritative |
| Native/FetchXML/security adapter receives policy rejection | Zero calls to all data providers |
| Cross-origin or repeated paging link | Reject safely |
| Provider capability rejection with proven equivalent route | Approved alternate only |
| Auth/authorization/metadata permission/timeout/transport/throttle/data failure | No fallback |
| Unrecognized security/audit near-match | Reject before adapter data operations |
| Result cap reached | Stop retrieval and accurately signal truncation |

For zero-call assertions, instrument every provider spy at the actual dispatch boundary; asserting only the expected provider's call count is insufficient.

## Dependencies and definition of done

Dependencies:
1. SQL Engine owner agrees the canonical AST and parse-once API.
2. Architect/Engineering Lead approve decision types, provider capability/fallback contract and exact limits.
3. Coordinator identifies every native SQL, FetchXML and security/audit dispatch entry point.
4. QA agrees the adversarial corpus and provider-call instrumentation.

Issue #5 is done only when every execution entry point is gated; policy failures make zero provider/data calls; hard limits cannot be raised by callers; adversarial and regression tests pass; named security/audit behavior remains intact; safe normalized errors are emitted; and fresh offline CI plus designated live verification evidence are recorded separately.

## Disposition

Design only. Do not implement this module until the shared execution contract is approved. No production code or `main` changes are included in this design.
