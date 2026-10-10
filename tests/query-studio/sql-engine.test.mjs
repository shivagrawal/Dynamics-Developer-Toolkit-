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

test("accepts bracketed identifiers and ignores SQL comments safely",()=>{
 const q=engine.compileSql("/* start */ SELECT [fullname] FROM [contact] -- table\nWHERE [statecode] = 1",metadata);
 assert.match(q.fetchXml,/<entity name="contact">/);
 assert.match(q.fetchXml,/<attribute name="fullname"\/>/);
 assert.match(q.fetchXml,/operator="eq"><value>1<\/value>/);
});

test("compiles basic SELECT with TOP, projection, filter and sort",()=>{
 const q=engine.compileSql("SELECT TOP 25 fullname, createdon FROM contact WHERE statecode = 0 ORDER BY createdon DESC",metadata);
 assert.equal(q.entitySetName,"contacts");
 assert.match(q.fetchXml,/<fetch top="25">/);
 assert.match(q.fetchXml,/<attribute name="fullname"\/>/);
 assert.match(q.fetchXml,/<condition attribute="statecode" operator="eq"><value>0<\/value><\/condition>/);
 assert.match(q.fetchXml,/<order attribute="createdon" descending="true"\/>/);
 assert.equal(q.readOnly,true);
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

test("compiles a simple left join with explicit joined projection",()=>{
 const q=engine.compileSql("SELECT c.fullname, a.name FROM contact AS c LEFT JOIN account AS a ON c.parentcustomerid = a.accountid",metadata);
 assert.ok(q.fetchXml.includes('<link-entity name="account" alias="a" from="accountid" to="parentcustomerid" link-type="outer"></link-entity>'));
 assert.match(q.fetchXml,/<attribute name="name" alias="a_name"\/>/);
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
