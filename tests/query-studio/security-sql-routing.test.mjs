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
  const supportedSecuritySql = "SELECT SU.fullname, SU.systemuserid, R.name AS role_name, BU.name AS role_businessunit FROM SystemUserRoles SUR INNER JOIN SystemUser SU ON SUR.systemuserid = SU.systemuserid INNER JOIN Role R ON SUR.roleid = R.roleid INNER JOIN BusinessUnit BU ON R.businessunitid = BU.businessunitid WHERE SU.fullname LIKE '%USD8%'";
  await dispatch({ type: "DEVLENS_ACTION", action: "querySql", payload: { sql: supportedSecuritySql } });
  assert.equal(calls[0].func, securityBridge);
  assert.equal(calls[0].args[0], "sqlQuery");
  assert.equal(calls[0].args[1].sql, supportedSecuritySql);
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

test("security near-matches are rejected before the specialized adapter is invoked", async () => {
  const { listener, calls } = loadBackground();
  const dispatch = message => new Promise(resolve => listener(message, { tab: { id: 123 } }, resolve));
  const result = await dispatch({ type: "DEVLENS_ACTION", action: "querySql", payload: { sql: "SELECT name FROM roleprivileges" } });
  assert.equal(result.ok, false);
  assert.equal(calls.length, 0);
});


const supportedSecurityDispatchQueries = [
  {
    name: "user roles",
    sql: "SELECT SU.fullname, SU.systemuserid, R.name AS role_name, BU.name AS role_businessunit FROM SystemUserRoles SUR INNER JOIN SystemUser SU ON SUR.systemuserid = SU.systemuserid INNER JOIN Role R ON SUR.roleid = R.roleid INNER JOIN BusinessUnit BU ON R.businessunitid = BU.businessunitid WHERE SU.fullname LIKE '%USD8%'"
  },
  {
    name: "privileges by entity",
    sql: "SELECT DISTINCT P.name AS privilege_name FROM privilege P INNER JOIN privilegeobjecttypecodes POTC ON POTC.privilegeid = P.privilegeid INNER JOIN entity E ON E.objecttypecode = POTC.objecttypecode WHERE E.logicalname = 'account'"
  },
  {
    name: "user privilege depth",
    sql: "SELECT SU.fullname, E.logicalname, CASE RP.privilegedepthmask WHEN 1 THEN 'User' WHEN 2 THEN 'Business Unit' WHEN 4 THEN 'Parent:Child Business Units' WHEN 8 THEN 'Organization' ELSE 'Unknown' END AS depth FROM systemuser SU INNER JOIN systemuserroles SUR ON SUR.systemuserid = SU.systemuserid INNER JOIN roleprivileges RP ON RP.roleid = SUR.roleid INNER JOIN privilegeobjecttypecodes POTC ON POTC.privilegeid = RP.privilegeid INNER JOIN entity E ON E.objecttypecode = POTC.objecttypecode WHERE SU.fullname LIKE '%Alex%' AND E.logicalname = 'account'"
  },
  {
    name: "role by privilege",
    sql: "SELECT R.name FROM role R INNER JOIN roleprivileges RP ON RP.roleid = R.roleid INNER JOIN privilege P ON P.privilegeid = RP.privilegeid WHERE P.name = 'prvReadAccount'"
  },
  {
    name: "role entity privileges",
    sql: "SELECT E.logicalname FROM role R INNER JOIN roleprivileges RP ON RP.roleid = R.roleid INNER JOIN privilegeobjecttypecodes POTC ON POTC.privilegeid = RP.privilegeid INNER JOIN entity E ON E.objecttypecode = POTC.objecttypecode WHERE R.name = 'Basic User' GROUP BY E.logicalname"
  },
  {
    name: "audit changed attributes",
    sql: "SELECT A.auditid, CA.logicalname, U.fullname FROM audit A CROSS APPLY OPENJSON(A.changedata, '$.changedAttributes') CA LEFT JOIN systemuser U ON A.userid = U.systemuserid WHERE A.objectid = '33333333-3333-4333-8333-333333333333'"
  }
];

test("each canonical supported security shape is policy-accepted and dispatched exactly once to the security bridge", async t => {
  for (const sample of supportedSecurityDispatchQueries) {
    await t.test(sample.name, async () => {
      const { listener, calls, context, securityBridge } = loadBackground();
      assert.equal(context.isSecuritySqlCandidate(sample.sql), true, sample.sql);
      assert.equal(context.isSupportedSecuritySqlShape(sample.sql), true, sample.sql);
      const dispatch = message => new Promise(resolve => listener(message, { tab: { id: 123 } }, resolve));
      const result = await dispatch({ type: "DEVLENS_ACTION", action: "querySql", payload: { sql: sample.sql } });
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(calls.length, 1);
      assert.equal(calls[0].func, securityBridge);
      assert.equal(calls[0].args[0], "sqlQuery");
      assert.equal(calls[0].args[1].sql, sample.sql);
    });
  }
});


test("unsupported security/audit near-matches fail closed before every provider call", async t => {
  const unsupported = [
    {
      name: "roleprivileges without an approved role/privilege projection",
      sql: "SELECT name FROM roleprivileges"
    },
    {
      name: "privilege join missing the approved entity join and projection",
      sql: "SELECT P.name FROM privilege P INNER JOIN privilegeobjecttypecodes POTC ON POTC.privilegeid = P.privilegeid"
    },
    {
      name: "systemuserroles without the approved user/role/business-unit shape",
      sql: "SELECT SUR.systemuserid FROM SystemUserRoles SUR"
    },
    {
      name: "audit OPENJSON missing required object filter and user join",
      sql: "SELECT A.auditid, CA.logicalname FROM audit A CROSS APPLY OPENJSON(A.changedata, '$.changedAttributes') CA"
    }
  ];

  for (const sample of unsupported) {
    await t.test(sample.name, async () => {
      const { listener, calls, context } = loadBackground();
      assert.equal(context.isSecuritySqlCandidate(sample.sql), true, sample.sql);
      assert.equal(context.isSupportedSecuritySqlShape(sample.sql), false, sample.sql);
      const dispatch = message => new Promise(resolve => listener(message, { tab: { id: 123 } }, resolve));
      const result = await dispatch({ type: "DEVLENS_ACTION", action: "querySql", payload: { sql: sample.sql } });
      assert.equal(result.ok, false);
      assert.equal(result.code, "UNSUPPORTED_SECURITY_SQL_SHAPE");
      assert.equal(calls.length, 0, sample.sql);
    });
  }
});

test("security table names only in literals or comments retain ordinary SQL routing", async () => {
  const ordinaryQueries = [
    "SELECT name FROM account WHERE name = 'roleprivileges'",
    "SELECT name FROM account -- FROM systemuserroles",
    "/* FROM audit CROSS APPLY OPENJSON */ SELECT name FROM account"
  ];
  for (const sql of ordinaryQueries) {
    const { listener, calls, context, securityBridge } = loadBackground();
    assert.equal(context.isSecuritySqlCandidate(sql), false, sql);
    const dispatch = message => new Promise(resolve => listener(message, { tab: { id: 123 } }, resolve));
    const result = await dispatch({ type: "DEVLENS_ACTION", action: "querySql", payload: { sql } });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(calls.length, 1, sql);
    assert.equal(calls[0].func, context.pageBridge, sql);
    assert.notEqual(calls[0].func, securityBridge, sql);
  }
});


test("dispatcher does not retry or switch bridges after provider failures", async t => {
  const failures = [
    { name: "authentication", code: "AUTHENTICATION" },
    { name: "authorization", code: "AUTHORIZATION" },
    { name: "timeout", code: "TIMEOUT" },
    { name: "transport", code: "TRANSPORT" },
    { name: "throttling", code: "THROTTLED" },
    { name: "Dataverse data", code: "DATAVERSE" }
  ];
  const routes = [
    {
      name: "specialized security bridge",
      sql: supportedSecurityDispatchQueries[0].sql,
      expectedBridge: "security"
    },
    {
      name: "native SQL bridge",
      sql: "SELECT TOP 5 accountid, name FROM account",
      expectedBridge: "native"
    }
  ];

  for (const route of routes) {
    for (const failure of failures) {
      await t.test(`${route.name} preserves ${failure.name} failures without fallback`, async () => {
        const { listener, calls, context, securityBridge } = loadBackground();
        context.chrome.scripting.executeScript = options => {
          calls.push(options);
          return Promise.resolve([{
            result: {
              ok: false,
              code: failure.code,
              error: `Simulated ${failure.code} failure`
            }
          }]);
        };
        const dispatch = message => new Promise(resolve => listener(message, { tab: { id: 123 } }, resolve));
        const result = await dispatch({
          type: "DEVLENS_ACTION",
          action: "querySql",
          payload: { sql: route.sql }
        });

        assert.equal(result.ok, false);
        assert.equal(result.code, failure.code);
        assert.equal(calls.length, 1, "a provider failure must not trigger a second dispatch");
        assert.equal(calls[0].func, route.expectedBridge === "security" ? securityBridge : context.pageBridge);
      });
    }
  }
});
