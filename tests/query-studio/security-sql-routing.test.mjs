import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../../background.js", import.meta.url), "utf8");
const require = (await import("node:module")).createRequire(import.meta.url);
const sqlEngine = require("../../sqlstudio/js/sql-engine.js");
const sqlPolicy = require("../../sqlstudio/js/sql-policy.js");

function loadBackground() {
  let listener;
  const calls = [];
  const securityBridge = function securityBridge() {};
  const chrome = {
    runtime: { onMessage: { addListener: fn => { listener = fn; } } },
    commands: { onCommand: { addListener: () => {} } },
    scripting: {
      executeScript: options => {
        calls.push(options);
        return Promise.resolve([{ result: { ok: true, rows: [], columns: [] } }]);
      }
    },
    tabs: {}
  };
  const context = { chrome, devLensSecurityAuditBridge: securityBridge, DevLensSqlEngine: sqlEngine, DevLensSqlPolicy: sqlPolicy, console, URL, setTimeout, clearTimeout };
  vm.runInNewContext(source, context, { filename: "background.js" });
  return { context, calls, get listener() { return listener; }, securityBridge };
}

const securityQueries = [
  "SELECT SU.fullname FROM SystemUserRoles SUR INNER JOIN SystemUser SU ON SUR.systemuserid = SU.systemuserid",
  "SELECT p.name FROM privilege p INNER JOIN privilegeobjecttypecodes potc ON potc.privilegeid = p.privilegeid",
  "SELECT su.fullname FROM systemuser su INNER JOIN roleprivileges rp ON rp.roleid = su.systemuserid INNER JOIN privilegeobjecttypecodes potc ON potc.privilegeid = rp.privilegeid",
  "SELECT r.name FROM role r INNER JOIN roleprivileges rp ON rp.roleid = r.roleid WHERE p.name = 'prvReadAccount'",
  "SELECT e.logicalname FROM role r INNER JOIN roleprivileges rp ON rp.roleid = r.roleid WHERE r.name = 'Basic User'",
  "SELECT ca.logicalname FROM audit a CROSS APPLY OPENJSON(a.changedata, '$.changedAttributes') ca WHERE a.objectid = '33333333-3333-4333-8333-333333333333'"
];

test("all six security query shapes are detected for the specialized adapter", () => {
  const { context } = loadBackground();
  for (const sql of securityQueries) assert.equal(context.isSecuritySqlCandidate(sql), true, sql);
  const commentedUserRoleQuery = "-- Gets all the role of the user along with role's BU\nSELECT SU.fullname FROM SystemUserRoles SUR INNER JOIN SystemUser SU ON SUR.systemuserid = SU.systemuserid WHERE SU.fullname LIKE '%USD8%'";
  assert.equal(context.isSecuritySqlCandidate(commentedUserRoleQuery), true);
});

test("ordinary queries are not routed because a string or comment mentions a security table", () => {
  const { context } = loadBackground();
  assert.equal(context.isSecuritySqlCandidate("SELECT name FROM account WHERE name = 'roleprivileges'"), false);
  assert.equal(context.isSecuritySqlCandidate("SELECT roleprivileges FROM account"), false);
  assert.equal(context.isSecuritySqlCandidate("SELECT name FROM privilege WHERE name = 'privilegeobjecttypecodes'"), false);
  assert.equal(context.isSecuritySqlCandidate("SELECT name FROM account WHERE name = 'x -- roleprivileges'"), false);
  assert.equal(context.isSecuritySqlCandidate("SELECT name FROM account WHERE name = 'x /* roleprivileges */'"), false);
  assert.equal(context.isSecuritySqlCandidate("SELECT name FROM account -- FROM systemuserroles"), false);
  assert.equal(context.isSecuritySqlCandidate("/* FROM audit CROSS APPLY OPENJSON */ SELECT name FROM account"), false);
  assert.equal(context.isSecuritySqlCandidate("/* outer /* nested FROM systemuserroles */ still outer */ SELECT name FROM account"), false);
  assert.equal(context.isSecuritySqlCandidate("SELECT TOP 5 accountid, name FROM account"), false);
});

test("security SQL is dispatched to the security bridge while ordinary SQL keeps the native bridge", async () => {
  const { listener, calls, context, securityBridge } = loadBackground();
  const dispatch = message => new Promise(resolve => {
    listener(message, { tab: { id: 123 } }, resolve);
  });
  await dispatch({ type: "DEVLENS_ACTION", action: "querySql", payload: { sql: securityQueries[0] } });
  assert.equal(calls[0].func, securityBridge);
  assert.equal(calls[0].args[0], "sqlQuery");
  assert.equal(calls[0].args[1].sql, securityQueries[0]);
  await dispatch({ type: "DEVLENS_ACTION", action: "querySql", payload: { sql: "SELECT TOP 5 accountid, name FROM account" } });
  assert.equal(calls[1].func, context.pageBridge);
  assert.equal(calls[1].args[0], "querySql");
});

test("shared policy rejects unsafe SQL before any injected bridge or provider is called", async () => {
  const { listener, calls } = loadBackground();
  const dispatch = message => new Promise(resolve => listener(message, { tab: { id: 123 } }, resolve));
  for (const sql of [
    "DELETE FROM contact",
    "SELECT fullname FROM contact; SELECT name FROM account",
    "SELECT fullname FROM contact WHERE fullname = 'unterminated"
  ]) {
    const result = await dispatch({ type: "DEVLENS_ACTION", action: "querySql", payload: { sql } });
    assert.equal(result.ok, false, sql);
    assert.equal(calls.length, 0, sql);
  }
});

test("shared policy rejects invalid FetchXML before any injected bridge or provider is called", async () => {
  const { listener, calls } = loadBackground();
  const dispatch = message => new Promise(resolve => listener(message, { tab: { id: 123 } }, resolve));
  const result = await dispatch({ type: "DEVLENS_ACTION", action: "queryFetchXml", payload: { fetchXml: "<fetch><entity name=\"account\" /></fetch>", tableName: "contact" } });
  assert.equal(result.ok, false);
  assert.equal(calls.length, 0);
});
