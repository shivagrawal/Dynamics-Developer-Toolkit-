import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const engine = require("../../sqlstudio/js/sql-engine.js");

const metadata = {
  entities: {
    contact: { logicalName:"contact", entitySetName:"contacts", primaryIdAttribute:"contactid", columns:[
      {logicalName:"contactid",queryable:true},{logicalName:"fullname",queryable:true},{logicalName:"statecode",queryable:true},{logicalName:"parentcustomerid",queryable:true},{logicalName:"createdon",queryable:true},{logicalName:"annualincome",queryable:true}
    ]},
    account: { logicalName:"account", entitySetName:"accounts", primaryIdAttribute:"accountid", columns:[
      {logicalName:"accountid",queryable:true},{logicalName:"name",queryable:true,attributeType:"String"},{logicalName:"accountnumber",queryable:true}
    ]},
    opportunity: { logicalName:"opportunity", entitySetName:"opportunities", primaryIdAttribute:"opportunityid", columns:[
      {logicalName:"opportunityid",queryable:true},{logicalName:"name",queryable:true},{logicalName:"parentaccountid",queryable:true}
    ]}
  }
};

test("rejects unterminated quoted values even when the final character is an escaped quote",()=>{
 assert.throws(()=>engine.plan("SELECT fullname FROM contact WHERE fullname = 'abc''"),/Unterminated SQL quoted value/);
 assert.throws(()=>engine.plan("SELECT [fullname]] FROM contact"),/Unterminated bracketed identifier/);
});

test("accepts bracketed identifiers and ignores SQL comments safely",()=>{
 const q=engine.compileSql("/* start */ SELECT [fullname] FROM [contact] -- table\nWHERE [statecode] = 1",metadata);
 assert.match(q.fetchXml,/<entity name="contact">/);
 assert.match(q.fetchXml,/<attribute name="fullname"\/>/);
 assert.match(q.fetchXml,/operator="eq" value="1"\/>/);
});

test("compiles basic SELECT with TOP, projection, filter and sort",()=>{
 const q=engine.compileSql("SELECT TOP 25 fullname, createdon FROM contact WHERE statecode = 0 ORDER BY createdon DESC",metadata);
 assert.equal(q.entitySetName,"contacts");
 assert.match(q.fetchXml,/<fetch top="25">/);
 assert.match(q.fetchXml,/<attribute name="fullname"\/>/);
 assert.match(q.fetchXml,/<condition attribute="statecode" operator="eq" value="0"\/>/);
 assert.match(q.fetchXml,/<order attribute="createdon" descending="true"\/>/);
 assert.equal(q.readOnly,true);
});

test("nests a simple LIKE condition inside a FetchXML filter for TOP queries",()=>{
 const q=engine.compileSql("SELECT TOP 100 systemuserid, fullname FROM systemuser WHERE fullname LIKE '%dataverse%'",{
  entities:{systemuser:{logicalName:"systemuser",entitySetName:"systemusers",primaryIdAttribute:"systemuserid",columns:[
   {logicalName:"systemuserid",queryable:true},{logicalName:"fullname",queryable:true,attributeType:"String"}
  ]}}
 });
 assert.match(q.fetchXml,/<fetch top="100"><entity name="systemuser">/);
 assert.match(q.fetchXml,/<filter type="and"><condition attribute="fullname" operator="like" value="%dataverse%"\/><\/filter>/);
 assert.doesNotMatch(q.fetchXml,/<entity[^>]*>\s*<condition/);
});

test("escapes string literals and translates null, IN, LIKE and boolean filters",()=>{
 const q=engine.compileSql("SELECT fullname FROM contact WHERE fullname = 'O''Brien & Sons' AND statecode IS NOT NULL",metadata);
 assert.match(q.fetchXml,/O&apos;Brien &amp; Sons/);
 assert.match(q.fetchXml,/operator="not-null"/);
 const list=engine.compileSql("SELECT fullname FROM contact WHERE statecode IN (0, 1, 2)",metadata);
 assert.match(list.fetchXml,/operator="in"/);
 assert.equal((list.fetchXml.match(/<value>/g)||[]).length,3);
 const like=engine.compileSql("SELECT fullname FROM contact WHERE fullname LIKE '%DevLens%'",metadata);
 assert.match(like.fetchXml,/%DevLens%/);
});

test("preserves supported LIKE wildcards and rejects ambiguous backslash escapes",()=>{
 const q=engine.compileSql("SELECT fullname FROM contact WHERE fullname LIKE 'A_B%'",metadata);
 assert.match(q.fetchXml,/operator="like" value="A_B%"/);
 assert.throws(()=>engine.compileSql("SELECT fullname FROM contact WHERE fullname LIKE 'A\\%B'",metadata),/LIKE escape sequences/);
 assert.throws(()=>engine.compileSql("SELECT fullname FROM contact WHERE fullname LIKE 'A\\_B'",metadata),/LIKE escape sequences/);
});

test("compiles NOT IN, BETWEEN, NOT BETWEEN and preserves AND/OR precedence",()=>{
 const notIn=engine.compileSql("SELECT fullname FROM contact WHERE statecode NOT IN (0, 2)",metadata);
 assert.match(notIn.fetchXml,/<condition attribute="statecode" operator="not-in"><value>0<\/value><value>2<\/value><\/condition>/);

 const between=engine.compileSql("SELECT fullname FROM contact WHERE statecode BETWEEN 1 AND 3",metadata);
 assert.match(between.fetchXml,/<condition attribute="statecode" operator="between"><value>1<\/value><value>3<\/value><\/condition>/);

 const notBetween=engine.compileSql("SELECT fullname FROM contact WHERE statecode NOT BETWEEN 1 AND 3",metadata);
 assert.match(notBetween.fetchXml,/<condition attribute="statecode" operator="not-between"><value>1<\/value><value>3<\/value><\/condition>/);

 const grouped=engine.compileSql("SELECT fullname FROM contact WHERE statecode = 0 OR statecode = 1 AND fullname LIKE 'A%'",metadata);
 assert.match(grouped.fetchXml,/<filter type="or"><condition attribute="statecode" operator="eq" value="0"\/><filter type="and"><condition attribute="statecode" operator="eq" value="1"\/><condition attribute="fullname" operator="like" value="A%"\/><\/filter><\/filter>/);
});

test("supports unary NOT with De Morgan semantics and inverse comparison operators",()=>{
 const simple=engine.compileSql("SELECT fullname FROM contact WHERE NOT statecode = 1",metadata);
 assert.match(simple.fetchXml,/<condition attribute="statecode" operator="ne" value="1"\/>/);

 const comparatorCases = [
  ["statecode != 1", "ne"],
  ["statecode <> 1", "ne"],
  ["statecode >= 1", "ge"],
  ["statecode < 1", "lt"],
  ["statecode <= 1", "le"]
 ];
 for (const [predicate, operator] of comparatorCases) {
  const query=engine.compileSql("SELECT fullname FROM contact WHERE "+predicate,metadata);
  assert.match(query.fetchXml,new RegExp(`<condition attribute="statecode" operator="${operator}" value="1"\\/>`),predicate);
 }

 const grouped=engine.compileSql("SELECT fullname FROM contact WHERE NOT (statecode = 0 OR fullname LIKE 'A%')",metadata);
 assert.ok(grouped.fetchXml.includes('<filter type="and"><condition attribute="statecode" operator="ne" value="0"/><condition attribute="fullname" operator="not-like" value="A%"/></filter>'));

 const nested=engine.compileSql("SELECT fullname FROM contact WHERE NOT (statecode > 1 AND statecode <= 3)",metadata);
 assert.ok(nested.fetchXml.includes('<filter type="or"><condition attribute="statecode" operator="le" value="1"/><condition attribute="statecode" operator="gt" value="3"/></filter>'));

 const nullAndIn=engine.compileSql("SELECT fullname FROM contact WHERE NOT (statecode IS NULL OR statecode IN (0, 1))",metadata);
 assert.ok(nullAndIn.fetchXml.includes('<filter type="and"><condition attribute="statecode" operator="not-null"/><condition attribute="statecode" operator="not-in"><value>0</value><value>1</value></condition></filter>'));

 const notBetween=engine.compileSql("SELECT fullname FROM contact WHERE NOT statecode BETWEEN 1 AND 3",metadata);
 assert.ok(notBetween.fetchXml.includes('<condition attribute="statecode" operator="not-between"><value>1</value><value>3</value></condition>'));
});
 
test("adds stable paging order for DISTINCT base projections",()=>{
 const q=engine.compileSql("SELECT DISTINCT fullname, statecode FROM contact ORDER BY fullname",metadata);
 assert.match(q.fetchXml,/<fetch distinct="true">/);
 assert.match(q.fetchXml,/<order attribute="fullname" descending="false"\/>/);
 assert.match(q.fetchXml,/<order attribute="statecode"\/>/);
});

test("resolves simple projection aliases in ORDER BY",()=>{
 const q=engine.compileSql("SELECT fullname AS ContactName FROM contact ORDER BY ContactName DESC",metadata);
 assert.match(q.fetchXml,/<attribute name="fullname" alias="ContactName"\/>/);
 assert.match(q.fetchXml,/<order attribute="fullname" descending="true"\/>/);
});

test("compiles a simple left join with explicit joined projection",()=>{
 const q=engine.compileSql("SELECT c.fullname, a.name FROM contact AS c LEFT JOIN account AS a ON c.parentcustomerid = a.accountid",metadata);
 assert.ok(q.fetchXml.includes('<link-entity name="account" alias="a" from="accountid" to="parentcustomerid" link-type="outer"></link-entity>'));
 assert.match(q.fetchXml,/<attribute name="name" alias="a_name"\/>/);
});

test("adds a primary-key tie-breaker for non-unique ORDER BY values",()=>{
 const q=engine.compileSql("SELECT fullname FROM contact ORDER BY fullname",metadata);
 assert.ok(q.fetchXml.indexOf('<order attribute="fullname"/>') < q.fetchXml.indexOf('<order attribute="contactid"/>'));
});

test("adds remaining GROUP BY columns as deterministic aggregate tie-breakers",()=>{
 const q=engine.compileSql("SELECT statecode, fullname, COUNT(*) AS contact_count FROM contact GROUP BY statecode, fullname ORDER BY statecode",metadata);
 assert.ok(q.fetchXml.indexOf('<order alias="statecode"/>') < q.fetchXml.indexOf('<order alias="fullname"/>'));
});

test("orders grouped aggregate rows when SQL omits ORDER BY",()=>{
 const q=engine.compileSql("SELECT statecode, COUNT(*) AS contact_count FROM contact GROUP BY statecode",metadata);
 assert.match(q.fetchXml,/<order alias="statecode"\/>/);
});

test("compiles COUNT and SUM with GROUP BY and aggregate output aliases",()=>{
 const q=engine.compileSql("SELECT statecode, COUNT(*) AS contact_count, COUNT(annualincome) AS income_count, SUM(annualincome) AS total_income, AVG(annualincome) AS avg_income, MIN(createdon) AS first_created, MAX(createdon) AS last_created FROM contact GROUP BY statecode ORDER BY statecode",metadata);
 assert.match(q.fetchXml,/<fetch aggregate="true">/);
 assert.match(q.fetchXml,/<attribute name="statecode" groupby="true" alias="statecode"\/>/);
 assert.match(q.fetchXml,/<attribute name="contactid" aggregate="count" alias="contact_count"\/>/);
 assert.match(q.fetchXml,/<attribute name="annualincome" aggregate="countcolumn" alias="income_count"\/>/);
 assert.match(q.fetchXml,/<attribute name="annualincome" aggregate="sum" alias="total_income"\/>/);
 assert.match(q.fetchXml,/<attribute name="annualincome" aggregate="avg" alias="avg_income"\/>/);
 assert.match(q.fetchXml,/<attribute name="createdon" aggregate="min" alias="first_created"\/>/);
 assert.match(q.fetchXml,/<attribute name="createdon" aggregate="max" alias="last_created"\/>/);
 assert.match(q.fetchXml,/<order alias="statecode"/);
 assert.deepEqual(q.resultColumns.map(c=>c.label),["statecode","contact_count","income_count","total_income","avg_income","first_created","last_created"]);
});

test("compiles COUNT(DISTINCT column) with FetchXML distinct countcolumn",()=>{
 const q=engine.compileSql("SELECT COUNT(DISTINCT parentcustomerid) AS unique_customers FROM contact",metadata);
 assert.match(q.fetchXml,/<attribute name="parentcustomerid" aggregate="countcolumn" distinct="true" alias="unique_customers"\/>/);
 assert.throws(()=>engine.plan("SELECT SUM(DISTINCT annualincome) FROM contact"),/DISTINCT is supported only for COUNT/);
});

test("resolves grouped output aliases in ORDER BY",()=>{
 const q=engine.compileSql("SELECT statecode AS state, COUNT(*) AS contact_count FROM contact GROUP BY statecode ORDER BY state DESC",metadata);
 assert.match(q.fetchXml,/<attribute name="statecode" groupby="true" alias="state"\/>/);
 assert.match(q.fetchXml,/<order alias="state" descending="true"\/>/);
});

test("rejects HAVING and invalid aggregate grouping rather than guessing",()=>{
 assert.throws(()=>engine.plan("SELECT statecode, COUNT(*) FROM contact GROUP BY statecode HAVING COUNT(*) > 1"),/HAVING is not supported/);
 assert.throws(()=>engine.plan("SELECT fullname, COUNT(*) FROM contact"),/Non-aggregate SELECT columns must appear in GROUP BY/);
 assert.throws(()=>engine.compileSql("SELECT SUM(name) FROM account",metadata),/SUM requires a numeric column/);
});

test("supports ORDER BY on joined entity aliases",()=>{
 const q=engine.compileSql("SELECT c.fullname, a.name FROM contact c LEFT JOIN account a ON c.parentcustomerid = a.accountid ORDER BY a.name DESC",metadata);
 assert.match(q.fetchXml,/<order attribute="name" entityname="a" descending="true"\/>/);
});

test("compiles chained joins as nested FetchXML link entities",()=>{
 const q=engine.compileSql("SELECT c.fullname, a.name, o.name AS OpportunityName FROM contact c LEFT JOIN account a ON c.parentcustomerid = a.accountid INNER JOIN opportunity o ON a.accountid = o.parentaccountid",metadata);
 assert.ok(q.fetchXml.indexOf('<link-entity name="account"') < q.fetchXml.indexOf('<link-entity name="opportunity"'));
 assert.ok(q.fetchXml.includes('<attribute name="name" alias="OpportunityName"/>'));
});

test("validates WHERE columns and preserves boolean filter grouping",()=>{
 assert.throws(()=>engine.compileSql("SELECT fullname FROM contact WHERE notarealcolumn = 1",metadata),/not queryable/);
 const q=engine.compileSql("SELECT fullname FROM contact WHERE (statecode = 0 OR statecode = 1) AND fullname LIKE 'A%'",metadata);
 assert.match(q.fetchXml,/<filter type="and">/);
 assert.match(q.fetchXml,/<filter type="or">/);
});

test("supports WHERE conditions against explicitly joined entities",()=>{
 const q=engine.compileSql("SELECT c.fullname, a.name FROM contact c LEFT JOIN account a ON c.parentcustomerid = a.accountid WHERE a.name LIKE 'Contoso%'",metadata);
 assert.match(q.fetchXml,/entityname="a"/);
 assert.match(q.fetchXml,/Contoso%/);
});

test("parses OFFSET/FETCH and enforces bounded deterministic paging",()=>{
 const p=engine.plan("SELECT fullname FROM contact ORDER BY fullname OFFSET 10 ROWS FETCH NEXT 5 ROWS ONLY");
 assert.equal(p.offset,10);
 assert.equal(p.fetch,5);
 const q=engine.compile(p,metadata);
 assert.match(q.fetchXml,/<fetch page="3" count="5">/);
 assert.doesNotMatch(q.fetchXml,/<fetch top=/);
 assert.match(q.fetchXml,/<order attribute="fullname"/);
 assert.throws(()=>engine.compile(engine.plan("SELECT fullname FROM contact ORDER BY fullname OFFSET 10 ROWS"),metadata),/requires FETCH NEXT/);
 assert.throws(()=>engine.compile(engine.plan("SELECT fullname FROM contact ORDER BY fullname OFFSET 10 ROWS FETCH NEXT 6 ROWS ONLY"),metadata),/multiple of FETCH NEXT/);
 assert.throws(()=>engine.plan("SELECT fullname FROM contact OFFSET 10 ROWS"),/requires ORDER BY/);
 assert.throws(()=>engine.plan("SELECT TOP 10 fullname FROM contact ORDER BY fullname OFFSET 0 ROWS"),/TOP cannot be combined/);
 assert.throws(()=>engine.plan("SELECT fullname FROM contact ORDER BY fullname OFFSET 9999 ROWS FETCH NEXT 2 ROWS ONLY"),/10,000-row safety cap/);
});

test("supports implicit SQL output aliases for columns and aggregates",()=>{
 const columnAlias=engine.compileSql("SELECT c.fullname ContactName FROM contact c",metadata);
 assert.ok(columnAlias.fetchXml.includes('<attribute name="fullname" alias="ContactName"/>'));
 assert.deepEqual(columnAlias.resultColumns.map(column=>column.label),["ContactName"]);

 const aggregateAlias=engine.compileSql("SELECT COUNT(*) contact_count FROM contact",metadata);
 assert.ok(aggregateAlias.fetchXml.includes('alias="contact_count"'));
 assert.deepEqual(aggregateAlias.resultColumns.map(column=>column.label),["contact_count"]);
});

test("supports SQL output aliases without confusing them with table aliases",()=>{
 const q=engine.compileSql("SELECT c.fullname AS ContactName FROM contact AS c",metadata);
 assert.ok(q.fetchXml.includes('<attribute name="fullname" alias="ContactName"/>'));
});

test("SELECT star expands only metadata-approved queryable columns",()=>{
 const q=engine.compileSql("SELECT * FROM contact",metadata);
 assert.match(q.fetchXml,/<attribute name="fullname"\/>/);
 assert.match(q.fetchXml,/<attribute name="contactid"\/>/);
 assert.match(q.fetchXml,/<order attribute="contactid"\/>/);
});

test("rejects DML, unknown columns, unknown aliases, unsafe TOP and unsupported syntax",()=>{
 assert.throws(()=>engine.plan("DELETE FROM contact"),/SELECT statements only/);
 assert.throws(()=>engine.compileSql("SELECT missingcolumn FROM contact",metadata),/not queryable/);
 assert.throws(()=>engine.compileSql("SELECT x.fullname FROM contact",metadata),/Unknown table alias/);
 assert.throws(()=>engine.plan("SELECT TOP 99999 fullname FROM contact"),/TOP must be/);
 assert.throws(()=>engine.plan("SELECT c.fullname FROM contact c JOIN account c ON c.parentcustomerid = c.accountid"),/aliases must be unique/);
 assert.throws(()=>engine.plan("SELECT fullname FROM contact; SELECT name FROM account"),/one SQL statement/);
 assert.throws(()=>engine.plan("SELECT fullname FROM contact WHERE fullname <> NULL"),/IS NULL/);
 assert.throws(()=>engine.plan("SELECT fullname FROM contact WHERE statecode IN (0, NULL)"),/NULL values in IN lists/);
 assert.throws(()=>engine.compileSql("SELECT * FROM contact",{entities:{contact:{logicalName:"contact",columns:[]}}}),/No queryable columns/);
});

test("requires metadata and refuses ambiguous joined predicates",()=>{
 assert.throws(()=>engine.compileSql("SELECT fullname FROM contact",{}),/Metadata is required/);
 assert.throws(()=>engine.compileSql("SELECT c.fullname FROM contact c JOIN account a ON c.missingfield = a.accountid",metadata),/JOIN columns were not found/);
});
