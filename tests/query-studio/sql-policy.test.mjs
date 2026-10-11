import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const engine = require("../../sqlstudio/js/sql-engine.js");
const policy = require("../../sqlstudio/js/sql-policy.js");

test("accepts only parsed read-only SELECT plans and returns a typed route", () => {
  const result = policy.evaluate("SELECT TOP 10 fullname FROM contact WHERE statecode = 0", engine);
  assert.equal(result.ok, true);
  assert.equal(result.code, "OK");
  assert.equal(result.route, "native-sql");
  assert.equal(result.plan.type, "select");
});

test("rejects writes, batches, malformed SQL and unsupported grammar", () => {
  for (const sql of [
    "DELETE FROM contact",
    "SELECT fullname FROM contact; SELECT name FROM account",
    "WITH c AS (SELECT fullname FROM contact) SELECT fullname FROM c",
    "SELECT fullname FROM contact WHERE fullname = 'unterminated"
  ]) {
    const result = policy.evaluate(sql, engine);
    assert.equal(result.ok, false, sql);
    assert.equal(result.route, null, sql);
  }
});

test("enforces hard join, predicate-depth, token and IN-list caps", () => {
  const joins = "SELECT c.fullname FROM contact c " +
    Array.from({ length: 9 }, (_, i) => `JOIN account a${i} ON c.parentcustomerid = a${i}.accountid`).join(" ");
  assert.equal(policy.evaluate(joins, engine).code, "QUERY_LIMIT_EXCEEDED");

  const nested = "SELECT fullname FROM contact WHERE " + "(".repeat(65) +
    "fullname = 'x'" + ")".repeat(65);
  assert.equal(policy.evaluate(nested, engine).code, "QUERY_LIMIT_EXCEEDED");

  const values = Array.from({ length: 1001 }, (_, i) => String(i)).join(",");
  assert.equal(policy.evaluate(`SELECT fullname FROM contact WHERE statecode IN (${values})`, engine).code, "QUERY_LIMIT_EXCEEDED");

  const manyTokens = "SELECT fullname FROM contact WHERE " +
    Array.from({ length: 7000 }, () => "statecode = 1").join(" OR ");
  assert.equal(policy.evaluate(manyTokens, engine).code, "QUERY_LIMIT_EXCEEDED");
});

test("rejects malformed or unknown predicate AST nodes fail-closed", () => {
  const base = { type: "select", joins: [], top: null, offset: null, fetch: null };
  for (const where of [
    { type: "function", name: "unsafe", field: { column: "statecode" } },
    { type: "and", left: { type: "compare", field: { column: "statecode" }, operator: "eq", value: { type: "number", value: 1 } } },
    { type: "compare", field: { column: "statecode" }, operator: "raw-sql", value: { type: "number", value: 1 } },
    { type: "in", field: { column: "statecode" }, not: false, values: [{ type: "null", value: null }] }
  ]) {
    const result = policy.validatePlan({ ...base, where });
    assert.equal(result.ok, false);
    assert.equal(result.code, "READ_ONLY_POLICY");
    assert.equal(result.plan, null);
  }
});

test("semicolons inside string literals are content, not statement separators", () => {
  const result = policy.evaluate("SELECT fullname FROM contact WHERE fullname = 'A;B'", engine);
  assert.equal(result.ok, true);
});

test("specialized security adapter route has a read-only single-statement envelope", () => {
  const valid = policy.evaluate(
    "SELECT SU.fullname FROM SystemUserRoles SUR INNER JOIN SystemUser SU ON SUR.systemuserid = SU.systemuserid",
    engine,
    { specializedSecurity: true }
  );
  assert.equal(valid.ok, true);
  assert.equal(valid.route, "security-audit");
  assert.equal(policy.evaluate("DELETE FROM systemuserroles", engine, { specializedSecurity: true }).ok, false);
  assert.equal(policy.evaluate("SELECT fullname FROM systemuserroles; SELECT name FROM role", engine, { specializedSecurity: true }).ok, false);
});

test("FetchXML policy rejects writes, invalid base tables and oversized XML", () => {
  assert.equal(policy.validateFetchXml("<fetch><entity name=\"contact\" /></fetch>", "contact").ok, true);
  assert.equal(policy.validateFetchXml("<fetch><entity name=\"account\" /></fetch>", "contact").ok, false);
  assert.equal(policy.validateFetchXml("<fetch><entity name=\"contact\"><update /></entity></fetch>", "contact").ok, false);
  assert.equal(policy.validateFetchXml("<fetch>" + " ".repeat(1000000) + "</fetch>", "contact").code, "QUERY_LIMIT_EXCEEDED");
});

test("unexpected parser failure fails closed with no plan", () => {
  const brokenEngine = { parse() { throw new Error("unexpected parser fault"); }, tokenize: engine.tokenize };
  const result = policy.evaluate("SELECT fullname FROM contact", brokenEngine);
  assert.equal(result.ok, false);
  assert.equal(result.plan, null);
});
