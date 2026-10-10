import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const engine = require("../../sqlstudio/js/sql-engine.js");

const metadata = {
  entities: {
    contact: { logicalName:"contact", entitySetName:"contacts", primaryIdAttribute:"contactid", columns:[
      {logicalName:"contactid",queryable:true},{logicalName:"fullname",queryable:true},{logicalName:"statecode",queryable:true},{logicalName:"parentcustomerid",queryable:true},{logicalName:"createdon",queryable:true}
    ]},
    account: { logicalName:"account", entitySetName:"accounts", primaryIdAttribute:"accountid", columns:[
      {logicalName:"accountid",queryable:true},{logicalName:"name",queryable:true},{logicalName:"accountnumber",queryable:true}
    ]}
  }
};

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
 assert.match(q.fetchXml,/<link-entity name="account" alias="a" from="accountid" to="parentcustomerid" link-type="outer"\/>/);
 assert.match(q.fetchXml,/<attribute name="name" alias="a_name"\/>/);
});

test("supports SQL output aliases without confusing them with table aliases",()=>{
 const q=engine.compileSql("SELECT c.fullname AS ContactName FROM contact AS c",metadata);
 assert.ok(q.fetchXml.includes('<attribute name="fullname" alias="ContactName"/>'));
});

test("SELECT star expands only metadata-approved queryable columns",()=>{
 const q=engine.compileSql("SELECT * FROM contact",metadata);
 assert.match(q.fetchXml,/<attribute name="fullname"\/>/);
 assert.match(q.fetchXml,/<attribute name="contactid"\/>/);
});

test("rejects DML, unknown columns, unknown aliases, unsafe TOP and unsupported syntax",()=>{
 assert.throws(()=>engine.plan("DELETE FROM contact"),/SELECT statements only/);
 assert.throws(()=>engine.compileSql("SELECT missingcolumn FROM contact",metadata),/not queryable/);
 assert.throws(()=>engine.compileSql("SELECT x.fullname FROM contact",metadata),/Unknown table alias/);
 assert.throws(()=>engine.plan("SELECT TOP 99999 fullname FROM contact"),/TOP must be/);
 assert.throws(()=>engine.plan("SELECT fullname FROM contact; SELECT name FROM account"),/one SQL statement/);
 assert.throws(()=>engine.plan("SELECT fullname FROM contact WHERE fullname <> NULL"),/IS NULL/);
});

test("requires metadata and refuses ambiguous joined predicates",()=>{
 assert.throws(()=>engine.compileSql("SELECT fullname FROM contact",{}),/Metadata is required/);
 assert.throws(()=>engine.compileSql("SELECT c.fullname FROM contact c JOIN account a ON c.missingfield = a.accountid",metadata),/JOIN columns were not found/);
});
