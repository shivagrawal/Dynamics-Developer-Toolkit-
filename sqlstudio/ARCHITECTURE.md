# Query Studio Architecture

## Goals

- Execute supported read-only SQL against Dataverse from the browser without requiring a .NET runtime.
- Preserve SQL projection labels and the supported query's filter, join, and aggregation semantics.
- Reject unsupported security-query variants instead of silently returning results that only look correct.
- Keep user data, access tokens, and audit payloads out of CI logs.
- Keep the ordinary-table query path and the security/metadata compatibility path separate.

## Execution pipeline

1. **Query Studio UI** (ui/sql-studio-view.js) submits SQL through the extension message API and renders the returned column schema, rows, execution provider, compatibility mode, duration, and truncation warning.
2. **Background router** (background.js) checks read-only and single-statement rules and routes recognizable SQL4CDS security/metadata table references to the specialized adapter. Ordinary table SQL continues through the existing Dataverse SQL endpoint bridge.
3. **Security SQL adapter** (security-audit-service.js) removes SQL comments without corrupting quoted literals, detects statement boundaries outside literals, identifies one of six explicitly supported query shapes, validates projection labels and essential joins/CASE/aggregate structures, and only then issues read-only Dataverse requests.
4. **Dataverse Web API/FetchXML** retrieves role membership, privilege metadata, role privileges, business units, and audit records. JavaScript performs the result projection, DISTINCT handling, conditional aggregation, depth-label mapping, and audit-detail flattening that FetchXML alone cannot express.
5. **Result contract** returns stable columns, rows, rowCount, provider, compatibilityMode, and truncated/warning metadata. The UI maps each row to the declared columns and retains null values.

## Provider boundary

### Ordinary-table SQL

The existing querySqlReadOnly path uses the Dataverse SQL endpoint for supported ordinary-table SQL. The generic JavaScript SQL-to-FetchXML engine is a separate bounded subset and does not claim to implement all T-SQL or all SQL4CDS behavior.

### Security and audit SQL

The adapter currently implements the six documented shapes in SECURITY-QUERY-COMPATIBILITY.md. These are explicit compatibility handlers, not a general T-SQL interpreter. The adapter verifies the output projection and critical structural semantics before issuing requests. New SQL forms should be added as named capabilities with fixtures and live checks; do not broaden a regex until the semantics are tested.

## Safety and resource limits

- Only one SELECT statement is accepted by the adapter. Writes and multiple statements fail closed.
- SQL comments are removed with a quote-aware scanner; semicolons inside string literals are not mistaken for statement separators.
- SQL string values are XML-escaped before being inserted into FetchXML.
- Supported result projections are validated before any Dataverse request, preventing unsupported aliases or joins from producing misleading output.
- User-role/user-privilege retrieval is bounded at 5,000 rows; entity/role privilege retrieval is bounded at 10,000 rows; audit retrieval is bounded at 1,000 audit records.
- Audit detail requests use a concurrency limit of four to avoid an unbounded request burst.
- A result cap produces a truncation warning in Query Studio. A capped result must not be interpreted as complete.
- CI logs emit only pass/fail state, row counts, and projection metadata. Never log bearer tokens, record values, user names, audit values, or privilege assignments.

## Auditing test policy

The live environment currently has organization-level or account-level auditing disabled. The integration suite checks both settings before creating a disposable account. It does not change organization auditing configuration automatically because that is a persistent environment-wide governance/storage setting. Audit expansion, operation mapping, changed-attribute flattening, and bounded concurrency are covered by offline fixtures; live audit validation will run automatically when auditing is already enabled.

## Verification layers

- **Unit/regression:** SQL parsing/compiler, routing, security query shape contracts, projection aliases, wildcard preservation, semicolon/comment edge cases, depth fallbacks, aggregate defaults, audit flattening, and concurrency.
- **Live Dataverse integration:** executes all six query shapes using the configured test-environment service principal and data-backed controls for account privileges, user roles, user/table privileges, and roles-by-privilege. Environment-specific filters may legitimately return zero rows.
- **Ordinary SQL smoke test:** checks the standard Dataverse SQL endpoint path independently of the security adapter.
- **No silent success:** unsupported query variants fail before any Dataverse request; test failures must be fixed rather than marked TODO.

## Release discipline

All development and CI work stays on feature/sql4cds-query-studio. Do not merge into main without explicit approval. This feature branch is not considered a complete SQL4CDS replacement; compatibility claims must remain limited to tested capabilities.
