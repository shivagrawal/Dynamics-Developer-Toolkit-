import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
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

test("routes bounded OFFSET/FETCH to FetchXML before native SQL dispatch", () => {
  const result = policy.evaluate(
    "SELECT fullname FROM contact ORDER BY fullname OFFSET 0 ROWS FETCH NEXT 5 ROWS ONLY",
    engine
  );
  assert.equal(result.ok, true);
  assert.equal(result.route, "fetchxml");
  assert.equal(result.plan.hasOffset, true);
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

test("FetchXML policy validates document structure and root entity, not regex near-matches", () => {
  for (const xml of [
    "<fetch><!-- <entity name=\"contact\" /> --><entity name=\"account\" /></fetch>",
    "<fetch><link-entity name=\"contact\" /><entity name=\"account\" /></fetch>",
    "<fetch><entity name=\"contact\"></fetch>",
    "<fetch><entity name=\"contact\" /><entity name=\"account\" /></fetch>",
    "<fetch><entity name=\"contact\" /><update /></fetch>",
    "<fetch><entity name=\"contact\" /><!DOCTYPE fetch></fetch>",
    "prefix<fetch><entity name=\"contact\" /></fetch>",
    "<fetch><entity name=\"contact\" /></fetch>suffix",
    "<fetch><entity name=\"contact&bad;\" /></fetch>",
    "<fetch><entity name=\"contact&\" /></fetch>",
    "<fetch><entity name=\"contact&#0;\" /></fetch>"
  ]) {
    assert.equal(policy.validateFetchXml(xml, "contact").ok, false, xml);
  }
  assert.equal(policy.validateFetchXml("<fetch><entity name='contact' alias='A&amp;B'><attribute name='fullname' /></entity></fetch>", "contact").ok, true);
  assert.equal(policy.validateFetchXml("  <fetch><entity name='contact' /></fetch>  ", "contact").ok, true);
});


test("background execution boundary fails closed before dispatch when policy is unavailable", async () => {
  const backgroundSource = await readFile(new URL("../../background.js", import.meta.url), "utf8");
  let listener;
  const providerCalls = [];
  const chrome = {
    runtime: { onMessage: { addListener: fn => { listener = fn; } } },
    commands: { onCommand: { addListener: () => {} } },
    scripting: {
      executeScript: options => {
        providerCalls.push(options);
        return Promise.resolve([{ result: { ok: true, rows: [], columns: [] } }]);
      }
    },
    tabs: {}
  };
  const context = { chrome, DevLensSqlEngine: engine, console, URL, setTimeout, clearTimeout };
  vm.runInNewContext(backgroundSource, context, { filename: "background.js" });
  const dispatch = message => new Promise(resolve => listener(message, { tab: { id: 123 } }, resolve));
  const sql = await dispatch({ type: "DEVLENS_ACTION", action: "querySql", payload: { sql: "SELECT fullname FROM contact" } });
  const fetchXml = await dispatch({ type: "DEVLENS_ACTION", action: "queryFetchXml", payload: { fetchXml: "<fetch><entity name='contact' /></fetch>", tableName: "contact" } });
  assert.equal(sql.ok, false);
  assert.equal(sql.code, "POLICY_UNAVAILABLE");
  assert.equal(fetchXml.ok, false);
  assert.equal(fetchXml.code, "POLICY_UNAVAILABLE");
  assert.equal(providerCalls.length, 0);
});

test("structurally malformed FetchXML is rejected at the background boundary before dispatch", async () => {
  const backgroundSource = await readFile(new URL("../../background.js", import.meta.url), "utf8");
  let listener;
  const providerCalls = [];
  const chrome = {
    runtime: { onMessage: { addListener: fn => { listener = fn; } } },
    commands: { onCommand: { addListener: () => {} } },
    scripting: {
      executeScript: options => {
        providerCalls.push(options);
        return Promise.resolve([{ result: { ok: true, rows: [], columns: [] } }]);
      }
    },
    tabs: {}
  };
  const context = { chrome, DevLensSqlEngine: engine, DevLensSqlPolicy: policy, console, URL, setTimeout, clearTimeout };
  vm.runInNewContext(backgroundSource, context, { filename: "background.js" });
  const dispatch = message => new Promise(resolve => listener(message, { tab: { id: 123 } }, resolve));
  for (const fetchXml of [
    "prefix<fetch><entity name='contact' /></fetch>",
    "<fetch><entity name='contact&broken;' /></fetch>",
    "<fetch><entity name='contact' /></fetch>suffix"
  ]) {
    const result = await dispatch({ type: "DEVLENS_ACTION", action: "queryFetchXml", payload: { fetchXml, tableName: "contact" } });
    assert.equal(result.ok, false, fetchXml);
    assert.equal(result.code, "READ_ONLY_POLICY", fetchXml);
    assert.equal(providerCalls.length, 0, fetchXml);
  }
});

test("background SQL dispatch rejects adversarial statements before any provider call", async () => {
  const backgroundSource = await readFile(new URL("../../background.js", import.meta.url), "utf8");
  let listener;
  const providerCalls = [];
  const chrome = {
    runtime: { onMessage: { addListener: fn => { listener = fn; } } },
    commands: { onCommand: { addListener: () => {} } },
    scripting: {
      executeScript: options => {
        providerCalls.push(options);
        return Promise.resolve([{ result: { ok: true, rows: [], columns: [] } }]);
      }
    },
    tabs: {}
  };
  const context = { chrome, DevLensSqlEngine: engine, DevLensSqlPolicy: policy, console, URL, setTimeout, clearTimeout };
  vm.runInNewContext(backgroundSource, context, { filename: "background.js" });
  const dispatch = message => new Promise(resolve => listener(message, { tab: { id: 123 } }, resolve));
  const rejectedSql = [
    "DELETE FROM contact",
    "SELECT fullname FROM contact; DELETE FROM contact",
    "SELECT fullname FROM contact UNION SELECT name FROM account",
    "SELECT fullname FROM contact WHERE fullname = 'unterminated",
    "SELECT fullname FROM contact INTO archive"
  ];

  for (const sql of rejectedSql) {
    const result = await dispatch({ type: "DEVLENS_ACTION", action: "querySql", payload: { sql } });
    assert.equal(result.ok, false, sql);
    assert.ok(["SQL_SYNTAX", "SQL_UNSUPPORTED", "READ_ONLY_POLICY", "QUERY_LIMIT_EXCEEDED"].includes(result.code), sql + ": unexpected rejection code " + result.code);
    assert.equal(providerCalls.length, 0, sql + ": unsafe SQL reached the provider dispatch boundary");
  }
});

test("unexpected parser failure fails closed with no plan", () => {
  const brokenEngine = { parse() { throw new Error("unexpected parser fault"); }, tokenize: engine.tokenize };
  const result = policy.evaluate("SELECT fullname FROM contact", brokenEngine);
  assert.equal(result.ok, false);
  assert.equal(result.plan, null);
});
