# AI-Assisted Software Delivery Operating Model

**Purpose:** reusable team process for future repositories and features.  
**Pilot:** Dynamics Developer Toolkit — SQL Query Studio.  
**Task system:** GitHub Issues and GitHub Projects.  
**Code evidence:** branches, pull requests, GitHub Actions, tests, and release notes.

## 1. Team charter

We optimize for reliable user outcomes, not code volume or parallelism for its own sake. The Engineering Lead remains the final decision-maker. AI roles support delivery but must report tool limitations and execution facts accurately.

### Roles and decision rights

| Role | Accountability | Decision rights |
|---|---|---|
| Engineering Lead | Scope, risk acceptance, cross-project standards, release | Final approval for material trade-offs, protected branch changes, and release |
| Product Owner | User value, priority, backlog, acceptance criteria | Proposes priority and accepts product behavior against agreed criteria |
| Architect | Architecture, contracts, dependencies, non-functional requirements | Recommends designs; records decisions and alternatives |
| Scrum Master | Work flow, board hygiene, blockers, sprint review | Coordinates cadence; does not silently change product scope |
| Developer workstream | Implementation and tests for a bounded capability | Makes local implementation decisions within approved contracts |
| QA / Integration | Regression, integration, security, release evidence | Can block a task from Done when required evidence is missing |

One assistant may operate in multiple roles, but must label role-specific outputs. Do not claim independent simultaneous agents unless separate sessions/tools are actually active.

## 2. Work intake and delivery flow

1. **Intake:** capture user problem, target audience, expected outcome, constraints, non-goals, and success measures.
2. **Product definition:** create epics/features and acceptance criteria; prioritize by user value, risk reduction, dependencies, and effort.
3. **Architecture:** map components and data flow; define interfaces, safety boundaries, observability, error model, and ADRs for consequential decisions.
4. **Breakdown:** split into tasks small enough to review independently; document dependencies and shared-file ownership.
5. **Ready review:** confirm every task meets Definition of Ready before assignment.
6. **Implementation:** use isolated branches/PRs. Parallelize only work with stable contracts and minimal shared-file contention.
7. **Review:** inspect correctness, security, test quality, scope, and compatibility; request changes with actionable feedback.
8. **Integration:** merge only reviewed work into the designated integration branch. Resolve contract mismatches and run cross-workstream tests.
9. **Verification:** run the complete offline suite plus appropriate integration/live checks. Classify environment failures separately from semantic failures.
10. **Release:** document included capabilities, limitations, migration/configuration, recovery path, and evidence; obtain required approval.
11. **Retrospective:** identify wait time, rework, blockers, flaky tests, and process improvements.

## 3. GitHub board structure

Use one GitHub Project board per product or delivery stream. Issues are the durable work records; pull requests and Actions runs are the implementation and verification evidence. Do not maintain a second competing status tracker.

### Recommended columns/statuses
- **Backlog:** not yet prioritized for a delivery cycle.
- **Ready:** meets Definition of Ready; dependencies resolved or explicitly accepted.
- **In Progress:** implementation or analysis actively underway.
- **Blocked:** cannot proceed; blocker, responsible owner, and next action recorded.
- **In Review:** PR submitted and review/checks pending.
- **Integration:** approved work is being integrated on the designated feature branch.
- **QA / Validation:** integrated behavior is being tested.
- **Done:** acceptance criteria met, reviewed, required checks green, documentation updated.
- **Closed / Won't Do:** explicitly descoped or superseded, with rationale.

Suggested fields: Status, Priority, Epic, Workstream, Owner, Reviewer, Estimate/size, Sprint, Dependencies, Risk, Target version, PR URL, Test evidence, and Blocker/next action. Use GitHub issue links and PR links as the authoritative references.

### Labels
Use a compact vocabulary: `type:feature`, `type:bug`, `type:tech-debt`, `type:research`, `area:architecture`, `area:engine`, `area:ui`, `area:security`, `area:qa`, `priority:P0`, `priority:P1`, `priority:P2`, `blocked`, and `good-first-task`. Create only labels that the repo can maintain consistently.

## 4. Definition of Ready
A task is Ready when it includes:
- A clear user or engineering outcome.
- Scope and explicit non-goals.
- Testable acceptance criteria.
- Dependencies and contracts.
- File/module ownership and known collision risks.
- Security, data-handling, and operational risk notes.
- A verification plan and expected evidence.
- A reasonable size; split tasks that cannot be reviewed independently.

## 5. Definition of Done
- Acceptance criteria pass.
- Implementation reviewed and integrated into the designated branch.
- Relevant tests pass; new behavior has regression coverage.
- Full relevant offline regression passes after integration.
- Required live/integration tests pass or are explicitly marked blocked with evidence and risk acceptance; blocked is never relabeled as passed.
- Security, performance limits, errors, paging, and edge cases are covered where relevant.
- Docs, compatibility matrix, and known limitations are updated.
- No secret leakage, unrelated changes, unbounded data access, or unauthorized protected-branch change.
- PR and test evidence are linked from the issue.

## 6. Parallel development rules
- Architect and Product Owner agree on contracts and acceptance tests before implementation fans out.
- One workstream owns a shared module/file at a time. Prefer additive adapters and new modules over simultaneous edits to a hot file.
- Each workstream has a named scope, branch, owner, reviewer, test plan, and exit criteria.
- Avoid long-lived divergence: integrate small PRs frequently.
- A dependent task can start with mocks/fixtures only after the interface is agreed.
- Rebase/merge conflicts are coordination signals; never resolve them by overwriting another workstream's changes.
- If actual multi-agent execution is unavailable, coordinate bounded tasks sequentially and report honestly.

## 7. Cadence and metrics
For a small AI-assisted team, use a one-week delivery cycle initially:
- **Planning:** choose a sprint goal, confirm Ready work, identify dependencies.
- **Async daily check-in:** what changed, next action, blockers, evidence.
- **Mid-cycle architecture/integration checkpoint:** resolve contract drift early.
- **Review/demo:** show working software against acceptance criteria.
- **Retrospective:** one or two measurable improvements.

Track cycle time, lead time, work in progress, blocked time, reopened issues, regression failures, and escaped defects. Do not use raw lines of code or number of agent messages as productivity measures.

## 8. Branch and release policy
- Each repo declares its integration branch and protected branches.
- For the Query Studio pilot, integration is `feature/sql4cds-query-studio`; `main` is protected from this effort.
- Use short-lived task branches and PRs targeting the feature integration branch when branch protections and repository configuration permit.
- No force push or protected-branch change without explicit approval.
- Before writes, refresh refs and reconcile concurrent updates.
- Release promotion follows the repository's established ALM process; this operating model does not override environment promotion rules.

## 9. Security and operational controls
- Never request credentials in chat or commit secrets.
- Use least privilege and designated test environments.
- Redact query values, tokens, personal data, and customer data from logs.
- Keep read-only behavior read-only unless a separately reviewed requirement explicitly changes it.
- Separate transient network/auth/service issues from functional regressions.
- Any persistent configuration change in a live environment requires explicit environment suitability and authorization.

## 10. Templates and records
Maintain:
- `AGENTS.md`: persistent agent operating rules.
- `docs/architecture/`: architecture diagrams, contracts, and ADRs.
- GitHub issue templates: feature, bug, research/spike.
- Pull request template: outcome, design, risk, tests, rollback.
- GitHub Actions: deterministic offline quality gates plus separately reported live tests.
- A release checklist and capability/test matrix.

## 11. Pilot success criteria
The Query Studio pilot succeeds when:
- Work is tracked as linked epics/issues with explicit dependencies and owners/workstreams.
- The architecture and provider/result/error contracts are reviewed before parallel implementation.
- At least two low-collision work packages can progress independently.
- Integration is performed only on `feature/sql4cds-query-studio`; `main` remains unchanged.
- Full offline regression and relevant live test evidence are linked to the delivered milestone.
- A retrospective captures what to reuse for the next project.
