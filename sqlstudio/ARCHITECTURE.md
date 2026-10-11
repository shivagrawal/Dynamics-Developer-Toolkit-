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
3. **Security SQL adapter** (security-audit-service.js) removes SQL comments without corrupting quoted literals, detects statement boundaries outside literals, identifies one of six explicitly supported query shapes, validates exact projection expressions and alias casing, DISTINCT state, required joins, WHERE predicates, ORDER BY semantics, CASE/aggregate structure, and the audit JSON mapping, and only then issues read-only Dataverse requests.
4. **Dataverse Web API/FetchXML** retrieves role membership, privilege metadata, role privileges, business units, and audit records. JavaScript performs the result projection, DISTINCT handling, conditional aggregation, depth-label mapping, and audit-detail flattening that FetchXML alone cannot express. Audit values preserve raw scalar representations and SQL NULL for missing old/new values rather than substituting formatted labels or empty strings.
5. **Result contract** returns stable columns, rows, rowCount, provider, compatibilityMode, and truncated/warning metadata. The UI maps each row to the declared columns, retains null values, and paginates results in 100-row views while keeping the full result available for export. Pagination preserves keyboard focus and exposes accessible table headings and live row-range status.

## Provider boundary

### Ordinary-table SQL

The existing querySqlReadOnly path uses the Dataverse SQL endpoint for supported ordinary-table SQL. The generic JavaScript SQL-to-FetchXML engine is a separate bounded subset and does not claim to implement all T-SQL or all SQL4CDS behavior.

### Security and audit SQL

The adapter currently implements the six documented shapes in SECURITY-QUERY-COMPATIBILITY.md. These are explicit compatibility handlers, not a general T-SQL interpreter. The adapter verifies the output projection and critical structural semantics before issuing requests. New SQL forms should be added as named capabilities with fixtures and live checks; do not broaden a regex until the semantics are tested.

## Safety and resource limits

- Only one SELECT statement is accepted by the adapter. Writes and multiple statements fail closed.
- SQL comments are removed with a quote-aware scanner; semicolons inside string literals are not mistaken for statement separators.
- SQL string values are XML-escaped before being inserted into FetchXML.
- Exact result projection expressions, aliases, DISTINCT state, required joins, WHERE predicates, and ORDER BY clauses are validated before any Dataverse request, preventing unsupported query variants from producing misleading output. String literals cannot satisfy structural checks.
- Ordinary-table SQL follows only same-origin Dataverse paging links, caps results at 10,000 rows/100 pages, and warns if more results may remain.
- Security metadata retrieval applies the same-origin check to every Dataverse API URL, detects repeated paging links, caps pages/rows, and fails rather than silently returning partial catalog data.
- The security SQL compatibility adapter validates the exact number of JOIN/APPLY clauses and rejects comma-separated FROM sources, so unmodeled relationships cannot silently change SQL result cardinality.
- CSV export neutralizes formula-like values (including `=`, `+`, `-`, `@`, and leading control characters) before producing spreadsheet-openable CSV.
- User-role/user-privilege retrieval is bounded at 5,000 rows; entity/role privilege retrieval is bounded at 10,000 rows; audit retrieval is bounded at 1,000 audit records and 10,000 expanded changed-attribute rows.
- Audit detail requests use a concurrency limit of four to avoid an unbounded request burst.
- SQL LIKE patterns are preserved as written; the adapter does not widen prefix/suffix matching into contains matching.
- In-memory DISTINCT normalizes string keys for case/accent-insensitive comparison to approximate the Dataverse SQL collation; collation edge cases outside this approximation remain a compatibility boundary.
- Query Studio renders at most 100 result rows per page to keep large result sets responsive, while CSV/JSON export retains the full returned result.
- A result cap produces a truncation warning in Query Studio. A capped result must not be interpreted as complete.
- CI logs emit only pass/fail state, row counts, and projection metadata. Never log bearer tokens, record values, user names, audit values, or privilege assignments.

## Auditing test policy

The live audit integration test explicitly enables organization auditing, Account-table auditing, and Account description auditing when needed, then leaves those settings enabled for subsequent runs. These are persistent environment-wide/table-level governance and storage settings, not temporary test state; run this workflow only against the designated personal development/test environment, never production or a shared environment without an approved change. The fixture creates a uniquely named disposable account, verifies a real description update through `RetrieveAuditDetails`, and deletes the account in a `finally` block. Audit expansion, operation mapping, changed-attribute flattening, and bounded concurrency also have offline fixture coverage.

The implementation follows Microsoft's documented bound Web API function, [RetrieveAuditDetails](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/webapi/reference/retrieveauditdetails?view=dataverse-latest). Audit details are retrieved through the Web API because [audit history is not available through the Dataverse TDS/SQL endpoint](https://learn.microsoft.com/en-us/powerapps/developer/data-platform/retrieve-and-delete-the-history-of-audited-data-changes).

## Verification layers

- **Unit/regression:** SQL parsing/compiler, routing, security query shape contracts, projection aliases, wildcard preservation, semicolon/comment edge cases, depth fallbacks, aggregate defaults, audit flattening, and concurrency.
- **Live Dataverse integration:** executes all six query shapes using the configured test-environment service principal and data-backed controls for account privileges, user roles, user/table privileges, and roles-by-privilege. Environment-specific filters may legitimately return zero rows.
- **Ordinary SQL smoke test:** checks the standard Dataverse SQL endpoint path independently of the security adapter.
- **No silent success:** unsupported query variants fail before any Dataverse request; test failures must be fixed rather than marked TODO.

## Release discipline

All development and CI work stays on feature/sql4cds-query-studio. Do not merge into main without explicit approval. This feature branch is not considered a complete SQL4CDS replacement; compatibility claims must remain limited to tested capabilities.
