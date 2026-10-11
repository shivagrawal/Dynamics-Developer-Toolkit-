# Query Studio Parallel Thread Operations

**Integration branch:** `feature/sql4cds-query-studio`  
**Protected branch:** `main` — do not modify  
**Coordinator:** primary integration thread  
**Purpose:** Let specialist ChatGPT project threads resume with only the word **Continue**, using this repository as their source of truth. This document assigns non-overlapping work and is the current operational handoff.

## User action required now

The Engineering Lead triggers each existing project thread by sending only **Continue**. The coordinator maintains this document and assigns distinct implementation boundaries so threads can progress independently without overwriting shared files.

**Current assignments (the earlier QA-only assignment for Thread B is complete):**

- **Thread A — Query Studio Architect → Execution Coordinator Developer**, issue [#4](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/issues/4): implement the execution coordinator and single Execute UI against the accepted contract.
- **Thread B — QA and Test Strategy → Result Normalization Developer**, issue [#8](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/issues/8): implement a provider-independent normalizer and isolated contract tests. Its earlier QA matrix deliverable is complete; this is a new bounded assignment.
- **Thread C — SQL Safety Specialist**, issue [#5](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/issues/5): audit and minimally harden the existing fail-closed gate and its own policy/routing safety tests.

The user may trigger A, B, and C in any order. Every thread must re-read the latest branch head before acting. Since all changes target the shared integration branch and tool operations are not guaranteed to execute concurrently, the coordinator must reconcile each commit before the next shared-branch write; do not claim independent background agents are continuously running.

## Thread A — Execution Coordinator Developer (formerly Architect)

**Issue:** https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/issues/4  
**Owned output:** execution coordinator and one-Execute UI implementation plus coordinator tests.

### File ownership
- Owns background.js, background-entry.js, ui/sql-studio-view.js, and coordinator/UI tests only where necessary.
- Must not edit sqlstudio/js/sql-policy.js, sqlstudio/js/sql-engine.js, or the result-normalizer module/tests owned by Thread B.
- Integrate the normalizer through its exported API after inspecting Thread B's committed module; if the API is not yet present, use a small local contract fixture and leave integration pending rather than creating a competing implementation.

### Instructions
- Read AGENTS.md, this file, the continuity protocol, issue #4 and comments, the accepted execution contract, architecture review, and current code.
- Implement one Execute action with deterministic capability-first routing through the shared policy gate. Preserve the six named security/audit routes and native SQL as a provider.
- Never fallback on auth, authorization, metadata permission, timeout, transport, throttling, data, or internal failures. Capability fallback requires an explicit typed capability rejection and semantic equivalence.
- Keep the policy gate as the allow/deny boundary; do not duplicate or weaken its checks.
- Preserve existing UI result paging, export, metadata and warning behavior through a compatibility adapter.
- Add focused routing/dispatch/UI tests, including no provider calls for rejected requests and no fallback for non-capability failures.
- Do not invent support for unimplemented SQL syntax. Do not claim end-to-end parse-once if the runtime still reparses downstream; document exact limitations.
- Commit bounded changes and update issue #4 with commit SHA, changed files, tests/evidence, blockers and next action.

## Thread B — Result Normalization Developer (QA assignment complete)

**Issue:** https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/issues/8  
**Owned output:** a pure provider-independent result/error normalizer and isolated contract tests.

### File ownership
- Owns new sqlstudio/js/sql-result-normalizer.js and new tests/query-studio/sql-result-normalizer.test.mjs.
- May update the regression workflow only after coordinating with the coordinator; do not edit background.js, background-entry.js, ui/sql-studio-view.js, sqlstudio/js/sql-policy.js, sqlstudio/js/sql-engine.js, or security-audit-service.js.
- Do not integrate the normalizer into provider call sites; Thread A owns that integration.

### Instructions
- Read AGENTS.md, this file, the continuity protocol, issue #8 and comments, the accepted execution contract and current native/FetchXML/security-audit response shapes.
- Implement a pure, dependency-light normalizer for ordered column descriptors, duplicate output labels without value loss, alias casing, SQL NULL, empty-result metadata, explicit truncation, unknown versus exact-zero counts, provider/duration/warnings, and safe normalized error categories.
- Preserve a compatibility adapter for existing string-column/UI consumers, but keep UI integration outside this assignment.
- Never expose secrets, raw headers, result values in diagnostics, or unsafe server payloads. Never reinterpret generic execution failures as capability rejections.
- Add fixtures for native SQL, FetchXML, and named security/audit shapes; include null-only rows, zero rows with known columns, duplicate labels, partial/truncated output, unknown counts, and every error category/fallback classification.
- If the duplicate-column key strategy is not unambiguously specified by the accepted contract, record a deterministic proposal in the report/issue before finalizing it; do not silently alter the public UI contract.
- Add the new suite to the regression workflow only after the module/test contract is stable and notify the coordinator. Commit and comment on issue #8 with exact evidence and next action.

## Thread C — SQL Safety Specialist

**Issue:** https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/issues/5  
**Owned output:** safety audit/addendum, minimal safety fixes, and policy-specific adversarial tests.

### File ownership
- Owns sqlstudio/js/sql-policy.js, sqlstudio/js/sql-engine.js only for concrete parser-limit bypass defects, and tests/query-studio/sql-policy.test.mjs plus focused security-routing safety assertions.
- Must not edit background.js, background-entry.js, ui/sql-studio-view.js, or result-normalizer files owned by A/B. Report dispatch-boundary defects to the coordinator with reproduction and expected minimal fix.
- Do not rewrite QA-owned regression inventory or broaden into automatic routing.

### Instructions
- Read AGENTS.md, this file, issue #5 and comments, the policy design, execution contract, current policy/engine and safety tests.
- Verify parse-once where possible; malformed/unsupported SQL fails closed; token/depth/node/join/IN limits apply to relevant parser/compiler entry points; quoted semicolons/comments and stacked statements are handled correctly; unsafe requests cause zero provider/bridge calls.
- Trace every real FetchXML caller and its actual payload contract. Confirm base entity, well-formedness, and disallowed constructs are validated at the true trust boundary. Trace all six named security/audit SQL shapes and ensure near-matches cannot reach specialized adapters.
- Preserve existing specialized adapter checks and semantics. Do not weaken/delete tests to obtain green results.
- Make only minimal fixes in owned files. For defects requiring coordinator-owned dispatch changes, add a concrete finding to issue #5 and notify Thread A/primary coordinator.
- Commit review/addendum and tests, then comment on issue #5 with exact head SHA, evidence, remaining risks and next action.

## Shared rules for all threads

- Work only on feature/sql4cds-query-studio; preserve main.
- Re-read the latest branch head and assigned issue before every work session.
- Keep edits inside the assigned file boundary. If a shared-file change is unavoidable, stop and coordinate rather than racing another thread.
- Do not request credentials in chat, expose secrets, or alter production/shared environment security configuration.
- Never claim tests, CI, or live Dataverse verification passed without evidence tied to an exact commit.
- Record decisions as accepted/proposed/deferred, and record commits and evidence in the assigned issue.
- End each handoff with: **status**, **branch/head SHA**, **changed files/commit SHAs**, **tests/evidence**, **blockers**, **next action**.

## Suggested short prompt for any assigned thread

> Continue your current Query Studio assignment. First read docs/delivery/QUERY-STUDIO-PARALLEL-THREAD-OPERATIONS.md, the continuity protocol, and your assigned GitHub issue/comments. Verify the current feature/sql4cds-query-studio head and actual code before acting. Follow only your role's assignment and file ownership. Preserve main; avoid overlapping edits; do not claim unverified tests or live results. Commit bounded changes and update your assigned issue comment before handing back.

## Current implementation checkpoint

Latest known changes include:
- `sqlstudio/js/sql-policy.js`: shared typed policy module.
- `sqlstudio/js/sql-engine.js`: parser-level token, predicate-depth/node, join and IN-list limits.
- `background-entry.js` and `background.js`: policy load and pre-dispatch SQL/FetchXML gate; specialized security SQL routing narrowed to named shapes.
- `tests/query-studio/sql-policy.test.mjs` and `tests/query-studio/security-sql-routing.test.mjs`: adversarial and zero-dispatch coverage.
- `.github/workflows/query-studio-regression.yml`: policy suite included.
- `docs/delivery/QUERY-STUDIO-BASELINE-AND-EXECUTION-CONTRACT.md`: implementation checkpoint.

**Important:** GitHub status queries have not yet returned CI results for the latest implementation commits. The work is not verified as passing. Live Dataverse security/audit semantics are also not currently verified. The proposed shared concurrency, 120-second deadline/cancellation and 64 MiB result-buffer controls are still pending; do not describe them as implemented.

## Thread B — QA and Test Strategy

**Issue:** https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/issues/2  
**Owned output:** QA evidence/report and issue #2 comment. Do not edit production/runtime code or the shared contract.

### Instructions
- Read `AGENTS.md`, this file, `docs/delivery/AI-THREAD-CONTINUITY-AND-HANDOFF.md`, issue #2 and its comments, the execution contract, and `.github/workflows/query-studio-regression.yml`.
- Inspect the latest `feature/sql4cds-query-studio` branch head, new policy tests, routing tests, engine changes and workflow configuration.
- Verify whether the regression workflow actually ran on a commit containing these changes. If connector APIs cannot expose the run, say so; do not infer green from an empty status list.
- If a local checkout or runnable environment is available, run the full workflow command exactly as configured and record the command, commit SHA, totals, failures and logs. If it is not available, provide a test-by-test static review and state the limitation.
- Look for test harness mismatches, especially background worker script load order, CommonJS/ESM imports, mocked bridges, expected supported security-query shapes, and zero-provider-call assertions.
- Separate offline failures, CI/configuration failures, and live Dataverse/network failures.
- Update the existing QA report or add a clearly named dated addendum; do not overwrite another workstream's report.
- Comment on issue #2 with branch/head SHA, exact evidence, pass/fail/blocked status, report link, and next action. Do not mark complete without real evidence.

## Thread C — SQL Safety Specialist

**Issue:** https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/issues/5  
**Owned output:** safety review/addendum and issue #5 comment. The current implementation exists; this is now an audit/hardening assignment, not a greenfield design.

### Instructions
- Read `AGENTS.md`, this file, issue #5 and comments, `docs/delivery/QUERY-STUDIO-READ-ONLY-POLICY-DESIGN.md`, the execution contract, `sqlstudio/js/sql-policy.js`, `sqlstudio/js/sql-engine.js`, `background-entry.js`, `background.js`, and security routing/policy tests.
- Review the current branch head rather than assuming the previous design is still the implementation.
- Check that ordinary SQL is parsed once; malformed/unsupported SQL fails closed; the 20,000-token, 64-depth, 512-node, 8-join and 1,000-item limits cannot be bypassed through parser/compiler entry points; semicolons in quoted literals/comments are handled correctly; and unsafe requests cause zero provider/bridge calls.
- Specifically examine FetchXML pre-dispatch validation and whether the request payload contract really supplies `fetchXml` and `tableName`; trace every caller before concluding the gate is correct. Review specialized security SQL routing for compatibility with all six existing named query shapes and ensure near-matches cannot reach the specialized adapter.
- Review possible bypasses caused by regex shape matching, aliases/case/comments/literals, comment stripping, tokenization and semicolon handling. Test the actual code if execution is available.
- Preserve the named security/audit adapter's checks and semantics. Do not weaken or delete existing tests to make the suite pass.
- Avoid broad edits to `background.js` or `sql-engine.js` unless you identify a concrete defect. If code changes are necessary, state the exact defect and intended minimal patch in an issue comment first when practical; coordinate with the primary thread to avoid concurrent edits.
- Commit a safety review/addendum and comment on issue #5 with exact head SHA, evidence, remaining risks, and next action. Do not claim verified without executed tests.

## Thread A — Query Studio Architect

**Issue:** https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/issues/3  
**Owned output:** architecture review/addendum and issue #3 comment. No implementation or shared-contract edits.

### Instructions
- Read `AGENTS.md`, this file, issue #3 and comments, `docs/delivery/QUERY-STUDIO-ARCHITECTURE-REVIEW.md`, the execution contract, the roadmap, and current policy/provider/UI implementation.
- Compare actual code with the accepted decisions: typed execution decisions, parse-once AST/policy, capability-first routing, capability-only fallback with semantic equivalence, normalized result plus legacy adapter, error taxonomy, preservation of all named security/audit routes, and paging/evidence matrix.
- Determine whether the current dispatcher actually achieves parse-once execution across provider paths or only gates before routing; distinguish this from the desired target.
- Identify interface mismatches or compatibility regressions introduced by the current safety gate. Do not implement fixes.
- State decisions that are already accepted separately from new recommendations requiring approval.
- Add a concise architecture addendum or update only the architecture-owned report, then comment on issue #3 with the exact branch/head SHA, evidence, findings, dependencies, and next action.

## Shared rules for all threads

- Work only on `feature/sql4cds-query-studio`; preserve `main`.
- Read current GitHub code and issue state first. Chat history is not authoritative.
- Never assume another thread's work is committed. Fetch the latest branch head before editing.
- Do not run simultaneous updates against the same file. Use distinct report paths where possible.
- Do not request credentials in chat, expose secrets, or alter production/shared environment security configuration.
- Do not claim tests, CI, or live Dataverse verification passed without evidence tied to an exact commit.
- Record commits and findings in the assigned issue comment. Keep proposed controls clearly distinguished from implemented/enforced controls.
- End each handoff with: **status**, **branch/head SHA**, **changed files/commit SHAs**, **tests/evidence**, **blockers**, **next action**.

## Suggested short prompt for any assigned thread

> Continue your assigned Query Studio workstream. First read `docs/delivery/QUERY-STUDIO-PARALLEL-THREAD-OPERATIONS.md`, the continuity protocol, and your assigned GitHub issue/comments. Verify the current `feature/sql4cds-query-studio` head and actual code before acting. Follow only your role's assignment in the operations document. Preserve `main`; avoid overlapping edits; do not claim unverified tests or live results. Commit your report/evidence and update your assigned issue comment before handing back.
