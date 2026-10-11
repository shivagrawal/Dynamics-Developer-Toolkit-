# Query Studio QA and Integration Test Matrix

**Status date:** 2026-10-11  
**Target branch:** `feature/sql4cds-query-studio`  
**Related work:** [Issue #2 — Establish Query Studio capability and regression baseline](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/issues/2)  
**Contract:** [Query Studio Baseline and Execution Contract](QUERY-STUDIO-BASELINE-AND-EXECUTION-CONTRACT.md)  
**Roadmap:** [SQL Studio Implementation Roadmap](../../sqlstudio/IMPLEMENTATION-ROADMAP.md)

## 1. Evidence and status rules

This matrix distinguishes four kinds of evidence:

- **Offline-tested:** assertion runs in the Node test suite with fixtures/mocks. This does not prove live Dataverse semantics.
- **Live-tested:** a capability-specific assertion passed against the designated development/test Dataverse environment on a recorded commit.
- **Blocked/infrastructure:** execution could not reach the service or establish authentication/connectivity. This is neither a semantic pass nor a semantic failure.
- **Gap/unverified:** the repository documents a capability or intent, but the evidence reviewed here does not establish that its full semantics are tested.

The baseline contract records workflow [run 38128383227](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/actions/runs/38128383227), commit `fd068b920af1e86efed839b8c53477e489e35322`, as **111 passed, 0 failed, 0 skipped**, with JavaScript syntax and manifest validation passing. This is historical evidence for that commit, not a fresh run of the current branch. The contract says the latest offline workflow does not call Dataverse. It also records an earlier native SQL smoke/general integration pass and a later security/audit live run that failed with `ETIMEDOUT`; the latter is an infrastructure failure, not evidence of semantic correctness.

The workflow command and file list below were verified from `.github/workflows/query-studio-regression.yml` on the current feature branch. The branch now includes `tests/query-studio/sql-policy.test.mjs`; this update incorporates it and the policy syntax check. The matrix maps capabilities to test files and concrete observed assertions where reviewed; it does not claim exhaustive inspection of every test in every file.

## 2. Current offline test inventory (8 suites)

| Test file | Observed responsibility/evidence | Limits and additions |
|---|---|---|
| `tests/query-studio/sql-engine.test.mjs` | Parser/compiler fixtures include malformed quoted/bracketed values; comments and bracketed identifiers; TOP, projection, filters and ordering; escaped literals; NULL predicates; IN/NOT IN; BETWEEN; LIKE; boolean precedence/NOT; aliases; LEFT JOIN compilation; deterministic order; GROUP BY and aggregates; explicit rejection of HAVING and unsupported aggregate forms. | Most assertions inspect AST/FetchXML shape. Add evaluator/result fixtures for SQL three-valued logic, data types, join cardinality, empty/null-only results, and live equivalence. |
| `tests/query-studio/sql-front-end.test.mjs` | Workflow includes the editor tokenizer/completion suite. | Keep editor assistance separate from execution policy; verify malformed SQL does not become executable merely because completion can parse part of it. Inspect case-level coverage when expanding this matrix. |
| `tests/query-studio/query-studio-regression.test.mjs` | Harness mocks Dataverse page context, metadata, native fetch and FetchXML retrieval. Observed assertions include requested columns, nullable column values, same-origin native paging links, and bridge behavior. | Add explicit request-call counts for rejected SQL, normalized errors, truncation, provider decisions and no-fallback-on-transport/auth errors. |
| `tests/query-studio/security-query-corpus.test.mjs` | Fixture metadata for security views; compiler checks for two supported generic query shapes; explicit rejection of CASE/ISNULL/aggregate/OPENJSON forms delegated to specialized adapters. | Offline compilation is not proof that adapter data matches native SQL4CDS semantics. Maintain negative variants for near-match/unsupported query shapes. |
| `tests/query-studio/security-query-adapter.test.mjs` | Mocked bridge covers security and audit retrieval. Observed negative safety assertions include cross-origin metadata paging rejection, repeated next-link rejection, and a 10,000-row metadata cap. The harness also exposes duplicate, bulk, privilege-depth and audit-detail cases. | Verify every cap and edge fixture has an explicit assertion; add canonical output/error assertions and permission/throttle/timeout simulation. |
| `tests/query-studio/security-sql-routing.test.mjs` | Detects six named security SQL shapes; avoids routing ordinary SQL when security table names appear in strings/comments; asserts specialized bridge dispatch for security SQL and native bridge dispatch for ordinary SQL. | Add provider decision reason codes, malformed/multi-statement adversarial cases, and assertions that fallback never occurs after auth, authorization, transport, timeout, throttling or data errors. |
| `tests/query-studio/sql-policy.test.mjs` | Exercises the shared policy gate: read-only SELECT, write and stacked-statement rejection, malformed quote rejection, quoted semicolons, parser failure fail-closed behavior, join/depth/token/IN-list bounds, specialized security-query envelope, and FetchXML table/write/length checks. | Add provider-call-zero assertions for every rejected input at every entry point; test all six security adapter shapes end-to-end; exercise comment/bracket edge cases and ensure AST limits traverse every relevant node. Structural FetchXML validation and time/memory controls are not established by these tests. |
| `tests/query-studio/sql-studio-ui.test.mjs` | Included in the workflow; baseline contract attributes UI result paging/export and metadata retention coverage to the UI/regression suites. | Confirm null display/export, truncation labeling, error normalization, paging boundaries and compatibility with string column-name consumers. |
| `tests/query-studio/on-demand-query.mjs` | Workflow performs a JavaScript syntax check on the live-query harness. | Syntax validation is not a live test. Record environment, query set, assertions, commit and result for actual live runs. |

### Workflow syntax/manifest checks

The workflow runs:

```sh
node --check background.js
node --check security-audit-service.js
node --check ui/sql-studio-view.js
node --check sqlstudio/js/sql-front-end.js
node --check sqlstudio/js/sql-engine.js
node --check tests/query-studio/on-demand-query.mjs
node -e "JSON.parse(require('node:fs').readFileSync('manifest.json', 'utf8'))"
```

### Full offline regression command

```sh
node --test \
  tests/query-studio/sql-engine.test.mjs \
  tests/query-studio/sql-front-end.test.mjs \
  tests/query-studio/query-studio-regression.test.mjs \
  tests/query-studio/security-query-corpus.test.mjs \
  tests/query-studio/security-query-adapter.test.mjs \
  tests/query-studio/security-sql-routing.test.mjs \
  tests/query-studio/sql-studio-ui.test.mjs
```

Run from the repository root with the workflow's Node.js 24 runtime for comparable CI evidence. The exact workflow command also includes `tests/query-studio/sql-policy.test.mjs`; the command above reflects the current workflow suite. Capture the actual commit SHA, command, exit status, pass/fail/skip counts and workflow URL. Do not copy the historical 111/0/0 result as the result of a new run.

## 3. Capability-to-test matrix

Legend: **Offline evidence** means relevant assertions are known to exist in reviewed test source; **partial** means only a slice of the contract is demonstrated; **missing/unverified** means a dedicated assertion or recent live result was not established in the evidence reviewed.

| Capability / risk | Current evidence | Gap / required test |
|---|---|---|
| Provider routing | `security-sql-routing.test.mjs` asserts specialized security bridge vs native bridge; regression harness asserts native endpoint URL shape. | Add a table-driven routing matrix by query capability/provider and assert exactly one provider invocation. Verify provider reason code and no execution for rejected input. |
| SQL read-only policy | Engine fixtures assert `readOnly`; generic compiler rejects several unsupported constructs; adapter has origin and paging guards. | Adversarial matrix: INSERT/UPDATE/DELETE/DDL, stacked statements, comments, quoted semicolons, CTE-prefixed writes, malformed syntax, unsupported syntax and attempts to reach adapters directly. Assert zero provider/network calls on rejection. |
| SQL NULL semantics | Engine compiles `IS NULL` / `IS NOT NULL`; regression asserts a returned null field and retained column metadata. | Test actual result semantics for comparisons with NULL, AND/OR/NOT three-valued logic, IN lists containing NULL, aggregate NULL behavior, null-only columns, and empty results. Require live checks for supported cases. |
| Joins | Engine test asserts a simple LEFT JOIN FetchXML shape; security corpus covers inner-join compilation. | Verify inner/left joins against fixtures and live Dataverse: unmatched right side yields null extension; duplicate matches preserve cardinality; chained joins and aliased projections map correctly; joins with NULL keys do not create false matches. |
| Ordering and paging | Engine checks primary-key tie-breakers; regression test covers same-origin native paging links; UI contract includes result paging. | Assert stable order across pages, no duplicates/missing rows, page caps, same-origin URL validation, repeated-link detection and behavior when provider ordering is not unique. Exercise native and FetchXML paths separately. |
| Error normalization | Contract defines SQL_SYNTAX, SQL_UNSUPPORTED, READ_ONLY_POLICY, METADATA, AUTHENTICATION, AUTHORIZATION, THROTTLED, TIMEOUT, TRANSPORT, DATAVERSE and INTERNAL categories. | Add contract tests for each reachable category, safe UI message, provider identity, retryable flag and safe correlation ID. Assert no token/header/customer row leakage. |
| Fallback rules | Contract and roadmap prohibit fallback except a classified syntax/capability rejection with proven semantic equivalence. | Mock each provider failure category. Only an explicit capability rejection may invoke a compatible alternate; auth/authorization/timeout/transport/throttling/metadata-permission/data errors must preserve failure and invoke no alternate. |
| Safety / query bounds | Engine has read-only compile assertions; adapter tests cover cross-origin/repeated paging and metadata row cap; workflow has routing corpus. | Shared policy-gate tests at every provider entry point; row/page/time/memory limits; no unbounded local emulation; CSV formula neutralization; no sensitive logging; direct adapter bypass tests. |
| Truncation | Contract requires explicit `truncated`; roadmap says capped results must not appear complete. | Test at-limit, over-limit, provider-capped and paged results. Verify warning/status survives normalization and UI/export; incomplete result never looks complete. |
| Empty/null-only results and metadata | Regression test asserts requested columns and null-capable metadata. | Explicit zero-row, all-NULL, missing projected field, alias casing and stable column order cases for every provider; CSV/JSON exports retain headers. |
| Result normalization | Existing tests exercise legacy string column names and adapter output fixtures. Contract defines typed column descriptors, rows, provider, duration, warnings, truncation and diagnostics. | Add cross-provider contract suite for ordered columns, stable row keys, SQL NULL as `null`, aliases, data types, warnings, pagesRead, duration and compatibility adapter. |
| Live native SQL | Contract records an earlier successful smoke test, but not a current run tied to the latest branch commit. | Run capability smoke against the designated personal dev/test environment; record commit, environment, queries/assertions, result and timestamp. |
| Live FetchXML semantics | Offline compiler tests exist. No complete live semantic matrix is evidenced by the reviewed docs. | Validate NULL, aliases, joins, duplicate cardinality, aggregates, order and paging with known bounded fixtures against Dataverse. |
| Live security/audit | Contract records an earlier security/audit run blocked by `ETIMEDOUT`. | Connectivity preflight then bounded retry for transient connection failures. Re-run only in the designated personal development/test environment; audit checks may modify persistent audit configuration. Keep assertion failures red. |

## 4. Failure classification: offline vs environment

Classify failures before assigning ownership:

1. **Offline semantic/product failure:** deterministic fixture assertion, parser/planner mismatch, unsafe query reaches a provider, incorrect output shape, unexpected fallback, truncation omitted, or paging/ordering mismatch. Reproduce locally and fail CI.
2. **Live semantic/product failure:** connectivity/authentication succeeds but a capability-specific assertion differs from expected Dataverse behavior. Keep the test red and record the query shape, sanitized response summary, provider and request/correlation ID where safe.
3. **Environment/infrastructure blocked:** DNS/TLS/connect timeout (`ETIMEDOUT`), service outage or missing test environment. Mark blocked; do not count as pass and do not infer a semantic defect.
4. **Authentication/authorization failure:** classify separately from transport and SQL semantics. Confirm test identity and permissions without exposing secrets. Never hide this by retrying another provider.
5. **Throttling/service protection:** preserve as a distinct service response; test bounded retry only where policy allows. Do not turn a throttled live run into a semantic pass.
6. **Test harness/configuration failure:** bad environment URL, missing configuration, or invalid test fixture. Fix setup separately; do not weaken the assertion.

Live preflight should verify DNS/TLS/connectivity and authenticated access without printing credentials. Retry only transient connection failures with bounded backoff. Do not retry deterministic assertion failures as though they were infrastructure.

## 5. Acceptance criteria for issue #2

- [ ] All seven offline test files and workflow-level checks are listed with their responsibility and known evidence.
- [ ] Each advertised SQL capability is mapped to at least one concrete test or explicitly marked unsupported/unverified.
- [ ] Provider routing tests prove the selected provider and that rejected queries make zero provider calls.
- [ ] NULL, joins/cardinality, aliases, deterministic ordering and paging have fixture-based assertions; supported semantics also have current live evidence.
- [ ] Error categories and fallback rules are tested, especially no fallback for authentication, authorization, timeout, transport, throttling, metadata permission and data errors.
- [ ] Safety, row/page caps, truncation, export safety and no-secret logging are covered by assertions.
- [ ] Full offline workflow has a fresh run with commit SHA and pass/fail/skip counts; historical results are labelled historical.
- [ ] Live results are recorded by capability and classified as pass, semantic failure or infrastructure-blocked.
- [ ] Audit/live tests run only against the approved personal development/test environment.
- [ ] `main` is unchanged.

## 6. Recommended next steps

1. Run the full offline workflow on the current feature branch and capture fresh evidence.
2. Add the highest-risk missing tests first: provider-call-zero safety tests, no-fallback-on-infrastructure/auth errors, NULL semantics, join cardinality, paging boundaries and truncation.
3. Re-run native SQL smoke and bounded FetchXML live cases on the current commit.
4. Retry security/audit live tests only after connectivity preflight; report infrastructure blocking distinctly.
5. Update this matrix with test names/links and exact run IDs as evidence becomes available. Do not mark a capability live-tested based solely on offline compilation or an earlier commit.
