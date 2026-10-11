# Query Studio Parallel Thread Operations

**Integration branch:** `feature/sql4cds-query-studio`  
**Protected branch:** `main` — do not modify  
**Coordinator:** primary integration thread  
**Purpose:** Let specialist ChatGPT project threads resume with only the word **Continue**, using this repository as their source of truth. This document assigns non-overlapping work and is the current operational handoff.

## User action required now

The user does not need to copy/paste a long prompt. Open each listed existing project thread and send only **Continue**. Each thread must read this file and its assigned issue before acting.

Trigger the threads in this order:

1. **Thread B — QA and Test Strategy**: trigger first. Verify the latest feature-branch regression changes and report exact test/CI evidence. Do not edit runtime implementation.
2. **Thread C — SQL Safety Specialist**: trigger second. Review the committed policy-gate implementation and adversarial tests for correctness, bypasses, and security regressions. Coordinate with Thread B; do not rewrite QA-owned tests or change shared execution files without documenting a specific defect and notifying the coordinator in the issue comment.
3. **Thread A — Query Studio Architect**: trigger third. Review the current implementation against the accepted contract and identify contract/compatibility gaps. Do not implement code or revise the shared contract; publish findings and decisions needed.
4. Return to the **primary integration thread** with the reports/evidence. The coordinator will reconcile findings, make any required changes, run/verify integration, and continue provider/result/UI work.

Do not trigger all threads simultaneously. Sequential starts reduce stale-branch assumptions and conflicting edits. If a thread says the work is complete, ask it to verify the current branch head and exact evidence before considering its issue done.

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
