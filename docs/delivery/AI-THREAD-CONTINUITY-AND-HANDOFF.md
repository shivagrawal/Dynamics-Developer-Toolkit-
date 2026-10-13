# AI Thread Continuity and Handoff Protocol

**Status:** Active operating protocol  
**Pilot:** Dynamics Developer Toolkit — SQL Query Studio  
**Integration branch:** `feature/sql4cds-query-studio`  
**Protected branch:** `main` — do not modify as part of this workflow

## Purpose

Chat threads are temporary workspaces, not the system of record. A thread may reach its context limit, be replaced, or stop being available. Work must continue from repository artifacts and GitHub state without requiring the user to reconstruct prior chat history.

## Source-of-truth order

When information conflicts, use this order and record any consequential resolution:

1. Current repository code and tests on the integration branch.
2. Latest committed delivery/decision documents on that branch.
3. GitHub issues, pull requests, review comments, and CI results tied to exact commits.
4. Specialist report drafts not yet accepted by the coordinator.
5. Chat history, which is context only and may be incomplete.

Never assume that a proposed report exists, a task is complete, a workflow passed on the current commit, or another thread is still active. Verify the repository and GitHub evidence.

## Required durable artifacts

For each non-trivial workstream, keep the following up to date:

- A GitHub issue with scope, acceptance criteria, dependencies, and status.
- A report or decision record committed to the integration branch when findings are substantial.
- An issue comment linking the report and stating the report commit SHA, current status, key conclusions, blockers, and next action.
- Tests and CI evidence with workflow URL and tested commit SHA.
- A short "next actions" section in the report or issue comment.

Record decisions as **Accepted**, **Proposed**, **Rejected**, or **Deferred**. Do not silently convert a proposal into an approved contract.

## Specialist end-of-thread checklist

Before voluntarily ending or replacing a specialist thread:

1. Inspect current GitHub issue, branch, and relevant files.
2. Commit completed findings to the workstream's assigned report path; do not overwrite another workstream's file.
3. Add an issue comment containing:
   - role and scope;
   - report path and link;
   - report commit SHA and branch;
   - evidence inspected (paths, tests, workflow URLs, tested SHAs);
   - decisions proposed versus decisions already approved;
   - unresolved questions, blockers, and dependencies;
   - exact next action.
4. If findings are incomplete, explicitly state what is complete and what remains. Never mark the issue complete merely because the thread is ending.
5. Leave implementation and working-tree state clear. If changes are uncommitted or a commit could not be created, document that honestly.
6. Do not change `main`, request secrets in chat, or claim a live Dataverse test passed without evidence.

## Starting a replacement thread

The user should not need to paste the old conversation. The replacement thread should:

1. Read this protocol and `AGENTS.md`.
2. Open the assigned GitHub issue and read its latest comments.
3. Read the latest report and any referenced contract/roadmap.
4. Inspect the integration branch, relevant commit history, changed paths, and CI for the current commit.
5. Summarize the verified state in a short internal handoff: completed, pending, decisions, risks, next action.
6. Continue only within the assigned ownership boundary. Ask for clarification only when a consequential decision cannot be resolved from the artifacts or the user's authority is required.

### Replacement-thread prompt template

Use the following prompt, changing the role and issue number only:

> Continue the Dynamics Developer Toolkit SQL Query Studio work as the replacement for the prior [ROLE] thread. Do not rely on prior chat context. Use GitHub as the source of truth. First read `AGENTS.md`, `docs/delivery/AI-THREAD-CONTINUITY-AND-HANDOFF.md`, the assigned issue and its comments, and the latest linked report on `feature/sql4cds-query-studio`. Verify current branch/commit, relevant code and tests, and CI evidence before acting. Report the verified state, completed work, unresolved decisions, blockers, and next action. Preserve `main`. Do not duplicate or overwrite existing work. Follow the issue's ownership boundary and update the report and issue comment before ending.

## Current Query Studio workstream registry

This registry is a starting point; always verify issue state and current repository contents.

| Role | Issue | Expected report path | Boundary |
|---|---|---|---|
| QA / Integration | [#2](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/issues/2) | `docs/delivery/QUERY-STUDIO-TEST-MATRIX.md` | Test inventory, gaps, evidence and acceptance criteria; no production implementation |
| Architect | [#3](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/issues/3) | `docs/delivery/QUERY-STUDIO-ARCHITECTURE-REVIEW.md` | Contract review and decisions; no implementation before approval |
| SQL Safety | [#5](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/issues/5) | `docs/delivery/QUERY-STUDIO-READ-ONLY-POLICY-DESIGN.md` | Safety design and adversarial tests; no implementation before contract approval |
| Integration coordinator | [#4](https://github.com/shivagrawal/Dynamics-Developer-Toolkit-/issues/4) and related issues | `docs/delivery/QUERY-STUDIO-BASELINE-AND-EXECUTION-CONTRACT.md` plus current state recorded in GitHub | Reconcile specialist findings, obtain required decisions, sequence implementation, validate CI |

## Decision and integration rules

- The execution contract is **proposed until explicitly approved**. Specialist reports may recommend changes, but do not implement incompatible assumptions in parallel.
- The coordinator reconciles specialist findings and records accepted decisions in the contract or a dedicated decision record before dependent implementation begins.
- Keep each workstream's report path distinct. Shared contract edits should be coordinated by the integration coordinator.
- A CI result applies to the exact tested commit. Docs-only success is not proof that runtime behavior or live Dataverse behavior was tested.
- Separate offline failures from environment/network failures. Record timeout evidence without presenting it as a semantic pass or product-code failure.
- Use pull requests and review for integration when practical. Do not merge to `main` without the user's required release approval.

## Minimum handoff comment template

```markdown
### Workstream handoff

- **Role / issue:** 
- **Branch / report commit SHA:** 
- **Report:** 
- **Status:** complete / partial / blocked
- **Evidence inspected:** code paths, test commands, workflow URLs and tested SHAs
- **Accepted decisions:** 
- **Proposals awaiting approval:** 
- **Open risks / dependencies:** 
- **Next action:** 
- **Not done / not verified:** 
```

The objective is restartability: a new thread should be able to resume from repository evidence without relying on the old thread's memory.
