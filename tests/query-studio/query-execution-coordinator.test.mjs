import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const engine = require("../../sqlstudio/js/sql-engine.js");
const policy = require("../../sqlstudio/js/sql-policy.js");
const coordinator = require("../../sqlstudio/js/query-execution-coordinator.js");

test("ordinary supported SELECT deterministically selects native SQL", () => {
  const decision = coordinator.decide("SELECT TOP 5 accountid, name FROM account", engine, policy);
  assert.equal(decision.ok, true);
  assert.equal(decision.route, "native-sql");
  assert.ok(decision.plan);
});

test("OFFSET/FETCH deterministically selects bounded FetchXML", () => {
  const decision = coordinator.decide("SELECT accountid, name FROM account ORDER BY name OFFSET 5 ROWS FETCH NEXT 5 ROWS ONLY", engine, policy);
  assert.equal(decision.ok, true);
  assert.equal(decision.route, "fetchxml");
  assert.equal(decision.reason, "bounded-offset-fetch-semantics");
});

test("approved specialized security shapes select the named adapter", () => {
  const sql = "SELECT SU.fullname, SU.systemuserid, R.name AS role_name, BU.name AS role_businessunit FROM SystemUserRoles SUR INNER JOIN SystemUser SU ON SUR.systemuserid = SU.systemuserid INNER JOIN Role R ON SUR.roleid = R.roleid INNER JOIN BusinessUnit BU ON R.businessunitid = BU.businessunitid WHERE SU.fullname LIKE '%Alex%'";
  const decision = coordinator.decide(sql, engine, policy, { specializedSecurity: true });
  assert.equal(decision.ok, true);
  assert.equal(decision.route, "security-audit");
});

test("policy rejection fails closed and never selects a provider", () => {
  for (const sql of [
    "DELETE FROM account",
    "SELECT name FROM account; SELECT name FROM contact",
    "SELECT name FROM account WHERE name = 'unterminated"
  ]) {
    const decision = coordinator.decide(sql, engine, policy);
    assert.equal(decision.ok, false, sql);
    assert.equal(decision.route, null, sql);
  }
});

test("execution normalizes the selected provider outcome exactly once", async () => {
  const calls = [];
  const normalized = [];
  const outcome = await coordinator.execute({
    sql: "SELECT TOP 1 name FROM account",
    requestId: "test-request",
    decision: { ok: true, route: "native-sql", plan: { table: "account" } }
  }, {
    providers: {
      "native-sql": async request => {
        calls.push(request);
        return { ok: true, columns: [{ name: "name" }], rows: [{ name: null }] };
      }
    },
    normalize: (value, metadata) => {
      normalized.push({ value, metadata });
      return { ...value, normalized: true };
    }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].route, "native-sql");
  assert.equal(normalized.length, 1);
  assert.equal(outcome.normalized, true);
  assert.deepEqual(outcome.rows, [{ name: null }]);
});

test("auth, timeout, transport and data failures never trigger fallback", async t => {
  for (const code of ["AUTHENTICATION", "AUTHORIZATION", "QUERY_TIMEOUT", "TRANSPORT", "DATAVERSE", "INTERNAL"]) {
    await t.test(code, async () => {
      let alternateCalls = 0;
      const result = await coordinator.execute({
        sql: "SELECT TOP 1 name FROM account",
        decision: {
          ok: true, route: "native-sql", plan: {},
          alternateRoute: "fetchxml",
          equivalentAlternateRoutes: ["fetchxml"]
        }
      }, {
        providers: {
          "native-sql": async () => ({ ok: false, code, fallbackEligible: true }),
          fetchxml: async () => { alternateCalls++; return { ok: true, rows: [], columns: [] }; }
        }
      });
      assert.equal(alternateCalls, 0);
      assert.equal(result.ok, false);
      assert.equal(result.fallbackEligible, false);
    });
  }
});

test("fallback requires typed capability rejection and planner-approved equivalence", async () => {
  let alternateCalls = 0;
  const decision = {
    ok: true, route: "native-sql", plan: {},
    alternateRoute: "fetchxml",
    equivalentAlternateRoutes: ["fetchxml"]
  };
  const result = await coordinator.execute({ sql: "SELECT TOP 1 name FROM account", decision }, {
    providers: {
      "native-sql": async () => ({ ok: false, code: "PROVIDER_CAPABILITY_REJECTION", fallbackEligible: true }),
      fetchxml: async () => { alternateCalls++; return { ok: true, rows: [], columns: [] }; }
    }
  });
  assert.equal(alternateCalls, 1);
  assert.equal(result.ok, true);
  assert.equal(result.provider, "fetchxml", "provider identity must reflect the actual fallback provider");
});

test("missing provider fails closed", async () => {
  const result = await coordinator.execute({ decision: { ok: true, route: "fetchxml", plan: {} } }, { providers: {} });
  assert.equal(result.ok, false);
  assert.equal(result.code, "PROVIDER_UNAVAILABLE");
});
