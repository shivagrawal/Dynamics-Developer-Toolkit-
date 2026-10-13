# Query Studio Pilot — Board and Work Breakdown

**Integration branch:** `feature/sql4cds-query-studio`  
**Protected from this effort:** `main`  
**Roadmap:** [IMPLEMENTATION-ROADMAP.md](../../sqlstudio/IMPLEMENTATION-ROADMAP.md)

## Sprint goal
Deliver a safe, unified, automatically routed Query Studio execution path with a stable result/error contract, then establish verified semantic and regression coverage before expanding the SQL grammar.

## Epics / workstreams

| Key | Work package | Scope boundary | Dependencies | Exit evidence |
|---|---|---|---|---|
| QS-0 | Baseline and capability matrix | Map current tests and capabilities; distinguish offline, live semantic, and infrastructure status | None | Matrix linked to tests; baseline workflow evidence |
| QS-1 | Execution contract and architecture | Request/result/error/provider contracts, routing decision table, shared-file ownership | QS-0 | Reviewed architecture/ADR and contract tests |
| QS-2 | Unified execution coordinator | One Execute action, normalized results, automatic routing; preserve named security/audit routing | QS-1 | UI and routing tests; existing adapter suites green |
| QS-3 | Read-only AST policy gate | One-statement validation, reject writes and malformed/unsupported constructs before provider calls | QS-1; coordinate with QS-2 | Adversarial safety tests and provider-call assertions |
| QS-4 | Native SQL provider adapter | Normalize native endpoint responses/errors and classify capability vs auth/transport/throttle failures | QS-1 | Provider contract tests and native smoke evidence |
| QS-5 | FetchXML compiler correctness | SQL-to-FetchXML semantics, metadata validation, joins, aliases, nulls and bounded paging | QS-1, QS-3 | Fixture suite plus live semantic tests |
| QS-6 | Security / metadata / audit adapter | Preserve named validated query shapes and audit details; keep special paths explicit | QS-1, QS-3 | Adapter tests; live audit evidence or explicit infrastructure block |
| QS-7 | Result normalization and diagnostics | Columns, aliases, NULLs, truncation, provider, duration, warnings, normalized errors | QS-1, QS-2, QS-4, QS-5, QS-6 | Provider-independent result contract tests |
| QS-8 | SQL capability expansion | CASE, expressions, functions, HAVING, join/aggregate improvements, UNION/subqueries/CTEs by dependency order | QS-2 through QS-7 | Per-feature AST, plan, safety, fixture and live tests |
| QS-9 | Editor and developer experience | Relationships/autocomplete, history/snippets, explain/diagnostics, cancellation | Stable contract; coordinate with QS-2/QS-7 | UI tests and documented data-handling behavior |
| QS-10 | Integrated regression and release gate | Single offline suite, live smoke suite, clear infra-vs-semantic failure reports | All delivered work packages | Green offline suite; live evidence and release checklist |

## Parallelism and ownership rules
- **Architect stream:** QS-0 and QS-1 first; publishes interfaces before fan-out.
- **Execution/UI stream:** QS-2, with UI ownership; does not independently redefine provider semantics.
- **Safety stream:** QS-3; owns the shared policy module and adversarial corpus.
- **Provider/engine stream:** QS-4 and QS-5 can proceed in parallel after QS-1, provided each uses the agreed contracts and avoids simultaneous edits to the same coordinator file.
- **Compatibility stream:** QS-6 can proceed with contract fixtures, then integrate after the shared result contract is stable.
- **QA stream:** QS-0 and QS-10 test inventory and harness; adds contract tests alongside implementation rather than waiting until the end.
- **Developer experience stream:** QS-9 begins after the stable execution/result interfaces are published.
- **Grammar expansion QS-8** is deliberately downstream of correctness and integration; do not broaden syntax before core semantics are trustworthy.

## Priority proposal
- **P0:** QS-0, QS-1, QS-3 safety risks.
- **P1:** QS-2, QS-4, QS-5, QS-7.
- **P2:** QS-6 hardening, QS-10 integrated gate.
- **P3:** QS-8 and QS-9 expansion after core acceptance gates.

Priorities may be revised after baseline evidence; never estimate progress solely from task count.

## Task acceptance template
Each issue must state:
1. Outcome and non-goals.
2. In-scope files/modules and explicit ownership.
3. Dependencies.
4. Acceptance criteria.
5. Offline tests and any live test needed.
6. Risks and failure classification.
7. PR/branch and evidence links.
8. Definition of Done checklist.

## First planning checkpoint
Before assigning implementation:
1. Inventory tests and capability states.
2. Agree the request/result/error/provider contracts.
3. Mark the coordinator and policy-gate files as single-owner during initial integration.
4. Split work into task branches and link PRs to issues.
5. Start independent work only when contracts are stable.
