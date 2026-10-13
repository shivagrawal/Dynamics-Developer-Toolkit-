# In-house JavaScript SQL planner/compiler

The Query Studio JavaScript engine is an original, bounded SQL-to-FetchXML implementation. It is an independent, bounded implementation. SQL4CDS and XrmToolBox are not runtime dependencies. It is not yet a general-purpose SQL Server-compatible engine; feature claims must match the tested compatibility matrix.

## Supported subset

- Read-only single SELECT statements.
- Explicit column projections, SELECT * expansion from metadata, AS output aliases, DISTINCT, and integer TOP from 1 through 5000.
- One base table with simple INNER JOIN / LEFT JOIN clauses using equality joins to the base table or a previously introduced joined table. Chained joins compile to nested FetchXML link entities.
- WHERE comparisons (=, !=, <>, >, >=, <, <=), IS NULL, IS NOT NULL, IN / NOT IN, BETWEEN / NOT BETWEEN, LIKE / NOT LIKE, parentheses, AND, and OR, using string, numeric, boolean, and NULL literals where valid.
- Base-table ORDER BY with ASC or DESC, plus bounded OFFSET / FETCH NEXT paging (up to 10,000 rows combined).\n- Basic FetchXML aggregates: COUNT(*), COUNT(column), COUNT(DISTINCT column), SUM, AVG, MIN, MAX, and GROUP BY over base-table columns. Every non-aggregate projection must be listed in GROUP BY.
- Metadata validation for projected columns, filter columns, and join columns.
- FetchXML value escaping and a read-only execution path using the current Dynamics user's authorized Web API context.

## Intentionally unsupported for now

CTEs, subqueries, UNION, HAVING, scalar functions and computed expressions, CASE, variables, non-equality joins and aggregate queries with joins are rejected or not implemented. Do not claim compatibility outside the implemented and tested subset. The roadmap in IMPLEMENTATION-ROADMAP.md defines the planned expansion.

## Safety and result limits

The native SQL endpoint and this in-house compiler are separate providers today. The target architecture is a single Execute action with automatic provider selection. Do not require users to choose an engine. The execution bridge accepts read-only FetchXML, including supported aggregate queries, and checks that its base entity matches the requested table. Dataverse authorization still applies. FetchXML paging cookies are followed for queries without TOP, with a safety cap of 10,000 rows per execution. Results are marked limited if additional pages may remain. Queries using TOP do not use paging-cookie continuation.

## Validation

CI runs the Node regression suite plus JavaScript syntax and manifest JSON checks. Those checks do not replace live tests in a Dataverse environment. Before treating this as production-ready, verify real table metadata, joined alias output, paging, service-protection limits, empty results, and permission-denied / invalid-query responses in a disposable environment.
