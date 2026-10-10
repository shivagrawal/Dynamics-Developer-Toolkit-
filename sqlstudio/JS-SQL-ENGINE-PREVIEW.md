# JavaScript SQL engine preview

The Query Studio JavaScript engine is an original, bounded SQL-to-FetchXML implementation. It is not yet a full SQL4CDS port and must remain a preview until live Dataverse verification is complete.

## Supported subset

- Read-only single SELECT statements.
- Explicit column projections, SELECT * expansion from metadata, AS output aliases, DISTINCT, and integer TOP from 1 through 5000.
- One base table with zero or more simple INNER JOIN / LEFT JOIN clauses whose equality condition directly connects the base entity and joined entity.
- WHERE comparisons (=, !=, <>, >, >=, <, <=), IS NULL, IS NOT NULL, IN, LIKE, parentheses, AND, and OR, using string, numeric, boolean, and NULL literals where valid.
- Base-table ORDER BY with ASC or DESC.
- Metadata validation for projected columns, filter columns, and join columns.
- FetchXML value escaping and a read-only execution path using the current Dynamics user's authorized Web API context.

## Intentionally unsupported for now

CTEs, subqueries, UNION, aggregation / GROUP BY / HAVING, scalar functions and computed expressions, CASE, variables, OFFSET/FETCH, NOT IN, NOT LIKE, multi-table join chains, non-equality joins, and ORDER BY on joined columns are rejected or not implemented. Do not assume SQL4CDS compatibility outside the supported subset.

## Safety and result limits

The JavaScript engine preview is a separate button; the existing native Dataverse SQL endpoint remains the default path. The execution bridge accepts non-aggregate FetchXML only and checks that its base entity matches the requested table. Dataverse authorization still applies. FetchXML paging cookies are followed for queries without TOP, with a safety cap of 10,000 rows per execution. Results are marked limited if additional pages may remain. Queries using TOP do not use paging-cookie continuation.

## Validation

CI runs the Node regression suite plus JavaScript syntax and manifest JSON checks. Those checks do not replace live tests in a Dataverse environment. Before treating this as production-ready, verify real table metadata, joined alias output, paging, service-protection limits, empty results, and permission-denied / invalid-query responses in a disposable environment.
