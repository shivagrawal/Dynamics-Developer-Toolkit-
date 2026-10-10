import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../../security-audit-service.js", import.meta.url), "utf8");
const BASE = "https://contoso.crm.dynamics.com";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ROLE_ID = "22222222-2222-4222-8222-222222222222";
const AUDIT_ID = "33333333-3333-4333-8333-333333333333";

function createBridge(options = {}) {
  const calls = [];
  let activeAuditDetails = 0, maxConcurrentAuditDetails = 0;
  const mockFetch = async input => {
    const url = new URL(String(input));
    const path = url.pathname.split("/api/data/v9.2/")[1] + url.search;
    calls.push(path);
    let body = { value: [] };
    if (path.startsWith("systemusers?fetchXml=")) {
      body = { value: [{ systemuserid: USER_ID, fullname: "USD8 Test User" }] };
    } else if (path.startsWith("roles?fetchXml=")) {
      const roleRow = { roleid: ROLE_ID, name: "Sales Representative", _parentrootroleid_value: ROLE_ID, "bu.name": "Sales BU", "SU.fullname": "USD8 Test User", "SU.systemuserid": USER_ID, "BU.name": "Sales BU" };
      body = { value: options.bulkRoles ? Array.from({ length: 5000 }, () => ({ ...roleRow })) : options.duplicateRoles ? [roleRow, { ...roleRow }] : [roleRow] };
    } else if (path.startsWith("privileges?fetchXml=")) {
      body = { value: [{ name: "prvReadSalesOrder" }, { name: "prvWriteSalesOrder" }, { name: "prvReadSalesOrder" }] };
    } else if (path.startsWith("systemuserrolescollection?fetchXml=")) {
      body = { value: [{ "su.fullname": "USD8 Test User", "ur.roleid": ROLE_ID, "ur.name": "Sales Representative", "bu.name": "Sales BU", "p.privilegeid": "44444444-4444-4444-8444-444444444444", "p.name": "prvReadQuote", "rp.privilegedepthmask": options.userDepthMask ?? 8, "e.logicalname": "quote" }] };
    } else if (path.startsWith("roleprivilegescollection?fetchXml=")) {
      const decoded = decodeURIComponent(path.split("fetchXml=")[1] || "");
      if (decoded.includes("prvReadwesco_legalentity")) {
        body = { value: [{ "r.roleid": ROLE_ID, "r.name": "Sales Representative", "bu.name": "Sales BU", "p.name": "prvReadwesco_legalentity", privilegedepthmask: options.roleDepthMask ?? 8 }] };
      } else {
        body = { value: [
          { "r.roleid": ROLE_ID, "r.name": "Basic User", "bu.name": "Sales BU", "p.name": "prvCreateAccount", privilegedepthmask: 1, "e.logicalname": "account" },
          { "r.roleid": ROLE_ID, "r.name": "Basic User", "bu.name": "Sales BU", "p.name": "prvReadAccount", privilegedepthmask: 2, "e.logicalname": "account" },
          { "r.roleid": ROLE_ID, "r.name": "Basic User", "bu.name": "Sales BU", "p.name": "prvWriteAccount", privilegedepthmask: 0, "e.logicalname": "account" },
          { "r.roleid": ROLE_ID, "r.name": "Basic User", "bu.name": "Sales BU", "p.name": "prvAppendToAccount", privilegedepthmask: 4, "e.logicalname": "account" },
          { "r.roleid": ROLE_ID, "r.name": "Basic User", "bu.name": "Sales BU", "p.name": "prvReadContact", privilegedepthmask: 8, "e.logicalname": "contact" }
        ] };
      }
    } else if (path.startsWith("audits?")) {
      const audit = { auditid: AUDIT_ID, createdon: "2026-01-01T00:00:00Z", operation: options.auditOperation ?? 2, "_userid_value@OData.Community.Display.V1.FormattedValue": "Test Admin", objecttypecode: "account" };
      body = { value: options.bulkAudits ? Array.from({ length: options.bulkAudits }, () => ({ ...audit })) : [audit] };
    } else if (path.startsWith("audits(" + AUDIT_ID + ")/Microsoft.Dynamics.CRM.RetrieveAuditDetails")) {
      activeAuditDetails++;
      maxConcurrentAuditDetails = Math.max(maxConcurrentAuditDetails, activeAuditDetails);
      if (options.auditDelayMs) await new Promise(resolve => setTimeout(resolve, options.auditDelayMs));
      body = { AuditDetail: { OldValue: { name: "Before", customfield: "old" }, NewValue: { name: "After", customfield: "new" } } };
      activeAuditDetails--;
    }
    return { ok: true, status: 200, statusText: "OK", json: async () => body };
  };
  const context = {
    URL, fetch: mockFetch, window: {},
    Xrm: { Utility: { getGlobalContext: () => ({ getClientUrl: () => BASE, organizationSettings: {} }) } },
    chrome: { runtime: { onMessage: { addListener: () => {} } }, tabs: {}, scripting: {} },
    console, setTimeout, clearTimeout
  };
  vm.runInNewContext(source, context, { filename: "security-audit-service.js" });
  return { run: sql => context.devLensSecurityAuditBridge("sqlQuery", { sql }), calls, get maxConcurrentAuditDetails() { return maxConcurrentAuditDetails; } };
}

const queries = {
  userRoles: `SELECT SU.fullname, SU.systemuserid, R.name AS role_name, BU.name AS role_businessunit
FROM SystemUserRoles AS SUR INNER JOIN SystemUser AS SU ON SUR.systemuserid = SU.systemuserid
INNER JOIN Role AS R ON SUR.roleid = R.roleid INNER JOIN BusinessUnit AS BU ON R.businessunitid = BU.businessunitid
WHERE SU.fullname LIKE '%USD8%'`,
  privileges: `SELECT DISTINCT p.name AS privilege_name FROM privilege p
INNER JOIN privilegeobjecttypecodes potc ON potc.privilegeid = p.privilegeid
INNER JOIN entity e ON e.objecttypecode = potc.objecttypecode
WHERE e.logicalname = 'salesorder' ORDER BY p.name`,
  userTable: `SELECT DISTINCT su.fullname, ur.name AS role_name, bu.name AS role_businessunit, p.name AS privilege_name,
CASE rp.privilegedepthmask WHEN 1 THEN 'User' WHEN 2 THEN 'Business Unit' WHEN 4 THEN 'Parent:Child BU' WHEN 8 THEN 'Organization' ELSE CAST(rp.privilegedepthmask AS VARCHAR(10)) END AS depth
FROM systemuser su INNER JOIN systemuserroles sur ON sur.systemuserid = su.systemuserid
INNER JOIN role ur ON ur.roleid = sur.roleid INNER JOIN businessunit bu ON bu.businessunitid = ur.businessunitid
INNER JOIN role pr ON pr.parentrootroleid = ur.parentrootroleid INNER JOIN roleprivileges rp ON rp.roleid = pr.roleid
INNER JOIN privilege p ON p.privilegeid = rp.privilegeid INNER JOIN privilegeobjecttypecodes potc ON potc.privilegeid = p.privilegeid
INNER JOIN entity e ON e.objecttypecode = potc.objecttypecode
WHERE su.fullname LIKE '%USD8%' AND e.logicalname = 'quote'
ORDER BY su.fullname, ur.name, p.name`,
  rolesByPrivilege: `SELECT DISTINCT r.name AS role_name, bu.name AS business_unit, p.name AS privilege_name,
CASE rp.privilegedepthmask WHEN 1 THEN 'User' WHEN 2 THEN 'Business Unit' WHEN 4 THEN 'Parent:Child BU' WHEN 8 THEN 'Organization' ELSE CAST(rp.privilegedepthmask AS VARCHAR(10)) END AS depth
FROM role r INNER JOIN roleprivileges rp ON rp.roleid = r.roleid
INNER JOIN privilege p ON p.privilegeid = rp.privilegeid INNER JOIN businessunit bu ON bu.businessunitid = r.businessunitid
WHERE p.name = 'prvReadwesco_legalentity' ORDER BY r.name, bu.name`,
  roleAccess: `SELECT e.logicalname AS table_name,
ISNULL(MAX(CASE WHEN p.name LIKE 'prvCreate%' THEN CASE rp.privilegedepthmask WHEN 1 THEN 'User' WHEN 2 THEN 'Business Unit' WHEN 4 THEN 'Parent:Child BU' WHEN 8 THEN 'Organization' END END), 'None') AS CreateAccess,
ISNULL(MAX(CASE WHEN p.name LIKE 'prvRead%' THEN CASE rp.privilegedepthmask WHEN 1 THEN 'User' WHEN 2 THEN 'Business Unit' WHEN 4 THEN 'Parent:Child BU' WHEN 8 THEN 'Organization' END END), 'None') AS ReadAccess,
ISNULL(MAX(CASE WHEN p.name LIKE 'prvWrite%' THEN CASE rp.privilegedepthmask WHEN 1 THEN 'User' WHEN 2 THEN 'Business Unit' WHEN 4 THEN 'Parent:Child BU' WHEN 8 THEN 'Organization' END END), 'None') AS WriteAccess,
ISNULL(MAX(CASE WHEN p.name LIKE 'prvDelete%' THEN CASE rp.privilegedepthmask WHEN 1 THEN 'User' WHEN 2 THEN 'Business Unit' WHEN 4 THEN 'Parent:Child BU' WHEN 8 THEN 'Organization' END END), 'None') AS DeleteAccess,
ISNULL(MAX(CASE WHEN p.name LIKE 'prvAppend%' AND p.name NOT LIKE 'prvAppendTo%' THEN CASE rp.privilegedepthmask WHEN 1 THEN 'User' WHEN 2 THEN 'Business Unit' WHEN 4 THEN 'Parent:Child BU' WHEN 8 THEN 'Organization' END END), 'None') AS AppendAccess,
ISNULL(MAX(CASE WHEN p.name LIKE 'prvAppendTo%' THEN CASE rp.privilegedepthmask WHEN 1 THEN 'User' WHEN 2 THEN 'Business Unit' WHEN 4 THEN 'Parent:Child BU' WHEN 8 THEN 'Organization' END END), 'None') AS AppendToAccess,
ISNULL(MAX(CASE WHEN p.name LIKE 'prvAssign%' THEN CASE rp.privilegedepthmask WHEN 1 THEN 'User' WHEN 2 THEN 'Business Unit' WHEN 4 THEN 'Parent:Child BU' WHEN 8 THEN 'Organization' END END), 'None') AS AssignAccess,
ISNULL(MAX(CASE WHEN p.name LIKE 'prvShare%' THEN CASE rp.privilegedepthmask WHEN 1 THEN 'User' WHEN 2 THEN 'Business Unit' WHEN 4 THEN 'Parent:Child BU' WHEN 8 THEN 'Organization' END END), 'None') AS ShareAccess
FROM role r INNER JOIN roleprivileges rp ON rp.roleid = r.roleid INNER JOIN privilege p ON p.privilegeid = rp.privilegeid
INNER JOIN privilegeobjecttypecodes potc ON potc.privilegeid = p.privilegeid INNER JOIN entity e ON e.objecttypecode = potc.objecttypecode
WHERE r.name = 'Basic User' GROUP BY e.logicalname ORDER BY e.logicalname`,
  audit: `SELECT a.createdon, u.fullname AS ChangedBy, CASE a.operation WHEN 1 THEN 'Create' WHEN 2 THEN 'Update' ELSE CAST(a.operation AS VARCHAR(10)) END AS Event,
ca.logicalname, ca.oldvalue, ca.newvalue FROM audit a
CROSS APPLY OPENJSON(a.changedata, '$.changedAttributes') WITH (logicalname NVARCHAR(100) '$.logicalName', oldvalue NVARCHAR(MAX) '$.oldValue', newvalue NVARCHAR(MAX) '$.newValue') ca
LEFT JOIN systemuser u ON a.userid = u.systemuserid
WHERE a.objectid = '33333333-3333-4333-8333-333333333333' ORDER BY a.createdon DESC`
};

test("security query 1 returns role membership and business unit even with a leading SQL comment", async () => {
  const result = await createBridge().run("/* outer /* nested */ still outer */ -- Gets all roles for the user's BU\n" + queries.userRoles);
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.columns)), ["fullname", "systemuserid", "role_name", "role_businessunit"]);
  assert.equal(result.rows[0].fullname, "USD8 Test User");
  assert.equal(result.rows[0].systemuserid, USER_ID);
  assert.equal(result.rows[0].role_name, "Sales Representative");
  assert.equal(result.rows[0].role_businessunit, "Sales BU");
});

test("security query 2 maps distinct privilege names to a table", async () => {
  const result = await createBridge().run(queries.privileges);
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.rows)), [{ privilege_name: "prvReadSalesOrder" }, { privilege_name: "prvWriteSalesOrder" }]);
});

test("security query 3 returns user privilege depth and role details", async () => {
  const result = await createBridge().run(queries.userTable);
  assert.equal(result.ok, true);
  assert.equal(result.compatibilityMode, "user-entity-privileges");
  assert.equal(result.rows[0].fullname, "USD8 Test User");
  assert.equal(result.rows[0].privilege_name, "prvReadQuote");
  assert.equal(result.rows[0].depth, "Organization");
});

test("security query 4 finds roles with a named privilege", async () => {
  const result = await createBridge().run(queries.rolesByPrivilege);
  assert.equal(result.ok, true);
  assert.equal(result.rows[0].role_name, "Sales Representative");
  assert.equal(result.rows[0].depth, "Organization");
});

test("security query 5 calculates per-table access and defaults missing values to None", async () => {
  const result = await createBridge().run(queries.roleAccess);
  assert.equal(result.ok, true);
  const account = result.rows.find(row => row.table_name === "account");
  const contact = result.rows.find(row => row.table_name === "contact");
  assert.equal(account.CreateAccess, "User");
  assert.equal(account.ReadAccess, "Business Unit");
  assert.equal(account.AppendToAccess, "Parent:Child BU");
  assert.equal(account.DeleteAccess, "None");
  assert.equal(contact.CreateAccess, "None");
  assert.equal(contact.ReadAccess, "Organization");
});

test("security query 6 expands audit details to one row per changed attribute", async () => {
  const bridge = createBridge();
  const result = await bridge.run(queries.audit);
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(result.columns)), ["createdon", "ChangedBy", "Event", "logicalname", "oldvalue", "newvalue"]);
  assert.equal(result.rows[0].Event, "Update");
  assert.equal(result.rows.find(row => row.logicalname === "customfield").oldvalue, "old");
  assert.ok(bridge.calls.some(path => path.includes("RetrieveAuditDetails")));
});

test("string literals cannot impersonate missing join structure", async () => {
  const bridge = createBridge();
  const sql = queries.userRoles
    .replace("INNER JOIN Role AS R ON SUR.roleid = R.roleid INNER JOIN BusinessUnit AS BU ON R.businessunitid = BU.businessunitid", "")
    .replace("'%USD8%'", "'%JOIN Role AS R ON SUR.roleid = R.roleid INNER JOIN BusinessUnit AS BU ON R.businessunitid = BU.businessunitid%'");
  const result = await bridge.run(sql);
  assert.equal(result.ok, false);
  assert.match(result.error, /Unsupported SQL structure/);
  assert.equal(bridge.calls.length, 0);
});

test("audit adapter rejects an incorrect OPENJSON field mapping", async () => {
  const bridge = createBridge();
  const sql = queries.audit.replace("$.oldValue", "$.previousValue");
  const result = await bridge.run(sql);
  assert.equal(result.ok, false);
  assert.match(result.error, /must map logicalName, oldValue, and newValue/);
  assert.equal(bridge.calls.length, 0);
});

test("string literals cannot impersonate required SQL projection expressions", async () => {
  const bridge = createBridge();
  const sql = queries.audit.replace("a.createdon,", "'a.createdon' AS createdon,");
  const result = await bridge.run(sql);
  assert.equal(result.ok, false);
  assert.match(result.error, /Unsupported SELECT expressions/);
  assert.equal(bridge.calls.length, 0);
});

test("security adapter rejects a projection it cannot faithfully return before any API request", async () => {
  const bridge = createBridge();
  const sql = queries.userRoles.replace("SU.fullname, SU.systemuserid, R.name AS role_name, BU.name AS role_businessunit", "SU.fullname AS unexpected");
  const result = await bridge.run(sql);
  assert.equal(result.ok, false);
  assert.match(result.error, /Unsupported SELECT projection/);
  assert.equal(bridge.calls.length, 0);
});

test("all six security adapters reject ORDER BY clauses they cannot reproduce", async () => {
  const malformed = [
    queries.userRoles + " ORDER BY SU.fullname DESC",
    queries.privileges.replace("ORDER BY p.name", "ORDER BY p.name DESC"),
    queries.userTable.replace("ORDER BY su.fullname, ur.name, p.name", "ORDER BY su.fullname DESC, ur.name, p.name"),
    queries.rolesByPrivilege.replace("ORDER BY r.name, bu.name", "ORDER BY r.name DESC, bu.name"),
    queries.roleAccess.replace("ORDER BY e.logicalname", "ORDER BY e.logicalname DESC"),
    queries.audit.replace("ORDER BY a.createdon DESC", "ORDER BY a.createdon ASC")
  ];
  for (const sql of malformed) {
    const bridge = createBridge();
    const result = await bridge.run(sql);
    assert.equal(result.ok, false);
    assert.match(result.error, /Unsupported ORDER BY clause/);
    assert.equal(bridge.calls.length, 0);
  }
});

test("all six security adapters reject extra WHERE predicates they cannot execute", async () => {
  const malformed = [
    queries.userRoles.replace("WHERE SU.fullname LIKE '%USD8%'", "WHERE SU.fullname LIKE '%USD8%' AND SU.isdisabled = 0"),
    queries.privileges.replace("WHERE e.logicalname = 'salesorder'", "WHERE e.logicalname = 'salesorder' AND e.logicalname <> 'account'"),
    queries.userTable.replace("WHERE su.fullname LIKE '%USD8%' AND e.logicalname = 'quote'", "WHERE su.fullname LIKE '%USD8%' AND e.logicalname = 'quote' AND su.isdisabled = 0"),
    queries.rolesByPrivilege.replace("WHERE p.name = 'prvReadwesco_legalentity'", "WHERE p.name = 'prvReadwesco_legalentity' AND r.name <> 'Other'"),
    queries.roleAccess.replace("WHERE r.name = 'Basic User'", "WHERE r.name = 'Basic User' AND r.iscustomizable = 1"),
    queries.audit.replace("WHERE a.objectid = '33333333-3333-4333-8333-333333333333'", "WHERE a.objectid = '33333333-3333-4333-8333-333333333333' AND a.operation = 2")
  ];
  for (const sql of malformed) {
    const bridge = createBridge();
    const result = await bridge.run(sql);
    assert.equal(result.ok, false);
    assert.match(result.error, /Unsupported WHERE clause/);
    assert.equal(bridge.calls.length, 0);
  }
});

test("all six security adapters fail closed when required SQL semantics are changed", async () => {
  const malformed = [
    queries.userRoles.replace("SUR.roleid = R.roleid", "SUR.roleid = BU.businessunitid"),
    queries.privileges.replace("potc.objecttypecode", "p.privilegeid"),
    queries.userTable.replace("pr.parentrootroleid = ur.parentrootroleid", "pr.roleid = ur.roleid"),
    queries.rolesByPrivilege.replace("bu.businessunitid = r.businessunitid", "bu.businessunitid = rp.roleid"),
    queries.roleAccess.replace("GROUP BY e.logicalname", "GROUP BY r.name"),
    queries.audit.replace("$.changedAttributes", "$.unrecognizedAttributes")
  ];
  for (const sql of malformed) {
    const bridge = createBridge();
    const result = await bridge.run(sql);
    assert.equal(result.ok, false);
    assert.equal(bridge.calls.length, 0, "Unsupported SQL must be rejected before any Dataverse request.");
  }
});

test("security adapter preserves exact SQL output alias casing", async () => {
  const bridge = createBridge();
  const sql = queries.userRoles.replace("AS role_name", "AS Role_Name");
  const result = await bridge.run(sql);
  assert.equal(result.ok, false);
  assert.match(result.error, /Unsupported SELECT projection/);
  assert.equal(bridge.calls.length, 0);
});

test("security adapter rejects incomplete joins instead of inventing missing relationships", async () => {
  const bridge = createBridge();
  const sql = queries.userRoles.replace("INNER JOIN Role AS R ON SUR.roleid = R.roleid INNER JOIN BusinessUnit AS BU ON R.businessunitid = BU.businessunitid", "");
  const result = await bridge.run(sql);
  assert.equal(result.ok, false);
  assert.match(result.error, /Unsupported SQL structure/);
  assert.equal(bridge.calls.length, 0);
});

test("SQL clause keywords inside string literals do not change WHERE or ORDER BY parsing", async () => {
  const bridge = createBridge();
  const sql = queries.userRoles.replace("'%USD8%'", "'%ORDER BY GROUP BY DISTINCT%'");
  const result = await bridge.run(sql);
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 1);
});

test("DISTINCT inside a string literal does not alter query result deduplication", async () => {
  const bridge = createBridge({ duplicateRoles: true });
  const sql = queries.userRoles.replace("'%USD8%'", "'%DISTINCT%'");
  const result = await bridge.run(sql);
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 2, "A non-DISTINCT SELECT must preserve duplicate rows even when a filter literal contains the word DISTINCT.");
});

test("security adapter preserves SQL LIKE prefix matching instead of widening it to contains", async () => {
  const bridge = createBridge();
  const sql = queries.userRoles.replace("'%USD8%'", "'USD8%'");
  const result = await bridge.run(sql);
  assert.equal(result.ok, true);
  const fetchXml = decodeURIComponent(bridge.calls.find(path => path.startsWith("roles?fetchXml=")));
  assert.match(fetchXml, /operator='like' value='USD8%'/);
  assert.doesNotMatch(fetchXml, /operator='like' value='%USD8%'/);
});

test("security adapter treats semicolons inside string literals as data", async () => {
  const bridge = createBridge();
  const sql = queries.userRoles.replace("'%USD8%'", "'%USD8; Test%'");
  const result = await bridge.run(sql);
  assert.equal(result.ok, true);
  assert.ok(bridge.calls.length > 0);
});

test("security adapter rejects writes and multiple statements", async () => {
  const bridge = createBridge();
  const write = await bridge.run("DELETE FROM account");
  assert.equal(write.ok, false);
  assert.match(write.error, /SELECT statements only/);
  const multiple = await bridge.run("SELECT name FROM account; SELECT name FROM contact");
  assert.equal(multiple.ok, false);
  assert.match(multiple.error, /one SELECT statement/);
});

test("security adapter flags results at the 5,000-row safety cap", async () => {
  const result = await createBridge({ bulkRoles: true }).run(queries.userRoles);
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 5000);
  assert.equal(result.truncated, true);
  assert.match(result.warning, /may be incomplete/);
});

test("CASE depth fallbacks preserve unrecognized numeric masks", async () => {
  const userResult = await createBridge({ userDepthMask: 0 }).run(queries.userTable);
  const roleResult = await createBridge({ roleDepthMask: 0 }).run(queries.rolesByPrivilege);
  assert.equal(userResult.rows[0].depth, "0");
  assert.equal(roleResult.rows[0].depth, "0");
});

test("conditional access aggregation treats unsupported depth masks as None", async () => {
  const result = await createBridge().run(queries.roleAccess);
  const account = result.rows.find(row => row.table_name === "account");
  assert.equal(account.WriteAccess, "None");
});

test("audit detail expansion uses bounded concurrency and preserves all changed attributes", async () => {
  const bridge = createBridge({ bulkAudits: 9, auditDelayMs: 10 });
  const result = await bridge.run(queries.audit);
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 18);
  assert.ok(bridge.maxConcurrentAuditDetails > 1, "Audit detail requests should not all run serially.");
  assert.ok(bridge.maxConcurrentAuditDetails <= 4, "Audit detail concurrency exceeded the safety bound.");
});

test("audit event CASE casts operations other than Create and Update to their numeric string", async () => {
  const result = await createBridge({ auditOperation: 3 }).run(queries.audit);
  assert.equal(result.ok, true);
  assert.equal(result.rows[0].Event, "3");
});
