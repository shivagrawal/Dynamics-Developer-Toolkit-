import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const sql = require("../../sqlstudio/js/sql-front-end.js");

test("tokenizer preserves strings, escaped quotes, comments and bracket identifiers", () => {
  const t = sql.tokenize("SELECT [account]]name], 'it''s ok' -- comment\nFROM account");
  assert.ok(t.some(x => x.type === "quotedIdentifier" && x.value === "[account]]name]"));
  assert.ok(t.some(x => x.type === "string" && x.value === "'it''s ok'"));
  assert.ok(t.some(x => x.type === "comment"));
});

test("SELECT parser splits projections only at top level", () => {
  const p = sql.parseSelect("SELECT c.fullname, COALESCE(c.emailaddress1, 'x,y') AS email FROM contact AS c WHERE c.statecode = 0 ORDER BY c.fullname");
  assert.equal(p.ok, true);
  assert.deepEqual(p.projection, ["c.fullname", "COALESCE ( c.emailaddress1 , 'x,y' ) AS email"]);
  assert.equal(p.table, "contact");
  assert.equal(p.alias, "c");
  assert.equal(p.clauses.WHERE, "c . statecode = 0");
  assert.equal(p.clauses["ORDER BY"], "c . fullname");
});

test("completion context resolves table aliases to logical tables", () => {
  const query = "SELECT fullname FROM contact WHERE full";
  const ctx = sql.completionContext(query, query.length);
  assert.equal(ctx.kind, "column");
  assert.equal(ctx.prefix, "full");
  const suggestions = sql.complete(ctx, { columns: [{ table: "contact", logicalName: "fullname" }, { table: "account", logicalName: "name" }] });
  assert.deepEqual(suggestions.map(x => x.label), ["fullname"]);
  const joined = sql.completionContext("SELECT a.na FROM account AS a WHERE a.na", 40);
  assert.equal(joined.table, "account");
});

test("completion suppresses suggestions inside comments and strings", () => {
  assert.equal(sql.completionContext("SELECT * FROM account -- hi", 28).kind, "none");
  assert.equal(sql.completionContext("SELECT * FROM account WHERE name = 'abc", 40).kind, "none");
});

test("phase 1 parser fails closed on non-SELECT statements", () => {
  assert.equal(sql.parseSelect("DELETE FROM account").ok, false);
});
