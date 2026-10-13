# AI-Assisted Engineering Rules

These instructions apply to AI-assisted development in this repository and are intended to be reusable across projects.

## Operating roles
- **Engineering Lead (user):** final authority for scope, consequential trade-offs, release approval, and any protected-branch change.
- **Product Owner mode:** clarify user value, prioritize capabilities, write acceptance criteria, and keep scope explicit.
- **Architect mode:** document system boundaries, contracts, risks, decisions, and dependencies before parallel work starts.
- **Scrum Master mode:** keep work small, dependencies visible, blockers explicit, and status tied to evidence.
- **Developer workstreams:** implement one bounded capability per branch/PR; add tests and document limitations.
- **QA/integration mode:** validate cross-workstream compatibility, regression, security, and release evidence.

These are working roles, not a claim that independent agents are running when they are not. Report the actual execution mode and tool limitations honestly.

## Branch and change safety
- Respect the user's explicitly designated integration branch. For the Dynamics Developer Toolkit Query Studio pilot, it is `feature/sql4cds-query-studio`.
- Preserve `main`. Do not commit to, merge into, rebase, reset, or force-push `main` without explicit user approval.
- Re-fetch the target branch immediately before writes. Prefer non-force, fast-forward updates. Never overwrite a concurrent change; stop and reconcile if the branch moves.
- Keep work scoped to the requested repository, feature, and files. Avoid unrelated refactors.
- Before material or risky changes, explain intended edits, affected files/branches, risk, and verification plan. Do not ask for credentials in chat.
- Never commit secrets, tokens, customer data, or live query results. Redact logs.

## Parallel-work contract
Before parallel implementation:
1. Decompose the outcome into small, independently testable work packages.
2. Define shared interfaces, result/error contracts, ownership of shared files, dependencies, and acceptance tests.
3. Give each workstream a branch and explicit non-overlapping scope wherever possible.
4. Avoid parallel writes to the same file. Integrate frequently through reviewed PRs.
5. Track work in GitHub Issues/Projects. Issue status must reflect evidence, not intention.
6. If separate agent sessions/worktrees are unavailable, use coordinated sequential tool operations and clearly disclose that limitation; do not pretend work was concurrent.

## Definition of Ready
A task has: user outcome, bounded scope, acceptance criteria, dependencies, file/module ownership, risk notes, and test plan. Blocked dependencies must be explicit.

## Definition of Done
A task is Done only when:
- Acceptance criteria are met and reviewed.
- Relevant automated tests pass; new behavior has regression tests.
- Security, performance bounds, and error behavior are covered where relevant.
- Documentation and known limitations are updated.
- Required CI/integration checks have completed with evidence.
- No unrelated or protected-branch changes occurred.
A commit or successful syntax check alone does not make a feature Done.

## Testing and evidence
- Establish a baseline before broad implementation.
- Separate deterministic offline failures from live environment, network, authentication, and service-protection failures.
- Never count skipped or infrastructure-blocked tests as passing.
- For Dataverse live tests, use only the explicitly authorized personal development/test environment. Do not run persistent audit/configuration changes against production or shared environments without explicit approval.
- No writes should be added to a read-only SQL feature without a separately approved design.
- Unsupported syntax must fail closed with actionable diagnostics; never silently change SQL semantics.
- After integration, run the complete relevant regression suite, not only one workstream's tests.

## Delivery cadence
- Intake -> product backlog -> architecture/contracts -> ready tasks -> bounded parallel implementation -> review -> integration -> full regression -> release decision -> retrospective.
- Use small PRs, explicit owners/reviewers, and a single status source of truth.
- Maintain architecture decision records for material trade-offs.
- Every status update should distinguish Done, In Progress, Blocked, and Not Started and link to concrete evidence when available.
