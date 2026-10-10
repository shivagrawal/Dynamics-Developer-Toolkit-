import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../../security-audit-service.js", import.meta.url), "utf8");
const BASE = "https://contoso.crm.dynamics.com";
const USER_ID = "11111111-1111-4111-8111-111111111111";
const ROLE_ID = "22222222-2222-4222-8222-222222222222";
const AUDIT_ID = "33333333-3333-4333-8333-333333333333";

function createBridge() {
  const calls = [];
  const mockFetch = async input => {
    const url = new URL(String(input));
    const path = url.pathname.split("/api/data/v9.2/")[1] + url.search;
    calls.push(path);
    let body = { value: [] };
    if (path.startsWith("systemusers?fetchXml=")) {
      body = { value: [{ systemuserid: USER_ID, fullname: "USD8 Test User" }] };
    } else if (path.startsWith("roles?fetchXml=")) {
      body = { value: [{ roleid: ROLE_ID, name: "Sales Representative", _parentrootroleid_value: ROLE_ID, "bu.name": "Sales BU" }] };
    } else if (path.startsWith("privileges?fetchXml=")) {
      body = { value: [{ name: "prvReadSalesOrder" }, { name: "prvWriteSalesOrder" }, { name: "prvReadSalesOrder" }] };
    } else if (path.startsWith("systemuserrolescollection?fetchXml=")) {
      body = { value: [{ "su.fullname": "USD8 Test User", "ur.roleid": ROLE_ID, "ur.name": "Sales Representative", "bu.name": "Sales BU", "p.privilegeid": "44444444-4444-4444-8444-444444444444", "p.name": "prvReadQuote", "rp.privilegedepthmask": 8, "e.logicalname": "quote" }] };
    } else if (path.startsWith("roleprivilegescollection?fetchXml=")) {
      const decoded = decodeURIComponent(path.split("fetchXml=")[1] || "");
      if (decoded.includes("prvReadwesco_legalentity")) {
        body = { value: [{ "r.roleid": ROLE_ID, "r.name": "Sales Representative", "bu.name": "Sales BU", "p.name": "prvReadwesco_legalentity", privilegedepthmask: 8 }] };
      } else {
        body = { value: [
          { "r.roleid": ROLE_ID, "r.name": "Basic User", "bu.name": "Sales BU", "p.name": "prvCreateAccount", privilegedepthmask: 1, "e.logicalname": "account" },
          { "r.roleid": ROLE_ID, "r.name": "Basic User", "bu.name": "Sales BU", "p.name": "prvReadAccount", privilegedepthmask: 2, "e.logicalname": "account" },
          { "r.roleid": ROLE_ID, "r.name": "Basic User", "bu.name": "Sales BU", "p.name": "prvAppendToAccount", privilegedepthmask: 4, "e.logicalname": "account" },
          { "r.roleid": ROLE_ID, "r.name": "Basic User", "bu.name": "Sales BU", "p.name": "prvReadContact", privilegedepthmask: 8, "e.logicalname": "contact" }
        ] };
      }
    } else if (path.startsWith("audits?")) {
      body = { value: [{ auditid: AUDIT_ID, createdon: "2026-01-01T00:00:00Z", operation: 2, "_userid_value@OData.Community.Display.V1.FormattedValue": "Test Admin", objecttypecode: "account" }] };
    } else if (path.startsWith("audits(" + AUDIT_ID + ")/Microsoft.Dynamics.CRM.RetrieveAuditDetails")) {
      body = { AuditDetail: { OldValue: { name: "Before", customfield: "old" }, NewValue: { name: "After", customfield: "new" } } };
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
  return { run: sql => context.devLensSecurityAuditBridge("sqlQuery", { sql }), calls };
}

const queries = {
  userRoles: \`SELECT SU.fullname, SU.systemuserid, R.name AS role_name, BU.name AS role_businessunit
FROM SystemUserRoles AS SUR INNER JOIN SystemUser AS SU ON SUR.systemuserid = SU.systemuserid
INNER JOIN Role AS R ON SUR.roleid = R.roleid INNER JOIN BusinessUnit AS BU ON R.businessunitid = BU.businessunitid
WHERE SU.fullname LIKE '%USD8%'\`,
  privileges: \`SELECT DISTINCT p.name AS privilege_name FROM privilege p
INNER JOIN privilegeobjecttypecodes potc ON potc.privilegeid = p.privilegeid
INNER JOIN entity e ON e.objecttypecode = potc.objecttypecode
WHERE e.logicalname = 'salesorder' ORDER BY p.name\`,
  userTable: \`SELECT DISTINCT su.fullname, ur.name AS role_name, bu.name AS role_businessunit, p.name AS privilege_name,
CASE rp.privilegedepthmask WHEN 1 THEN 'User' WHEN 2 THEN 'Business Unit' WHEN 4 THEN 'Parent:Child BU' WHEN 8 THEN 'Organization' END AS depth
FROM systemuser su INNER JOIN systemuserroles sur ON sur.systemuserid = su.systemuserid
INNER JOIN role ur ON ur.roleid = sur.roleid INNER JOIN businessunit bu ON bu.businessunitid = ur.businessunitid
INNER JOIN role pr ON pr.parentrootroleid = ur.parentrootroleid INNER JOIN roleprivileges rp ON rp.roleid = pr.roleid
INNER JOIN privilege p ON p.privilegeid = rp.privilegeid INNER JOIN privilegeobjecttypecodes potc ON potc.privilegeid = p.privilegeid
INNER JOIN entity e ON e.objecttypecode = potc.objecttypecode
WHERE su.fullname LIKE '%USD8%' AND e.logicalname = 'quote'
ORDER BY su.fullname, ur.name, p.name\`,
  rolesByPrivilege: \`SELECT DISTINCT r.name AS role_name, bu.name AS business_unit, p.name AS privilege_name,
CASE rp.privilegedepthmask WHEN 1 THEN 'User' WHEN 2 THEN 'Business Unit' WHEN 4 THEN 'Parent:Child BU' WHEN 8 THEN 'Organization' END AS depth
FROM role r INNER JOIN roleprivileges rp ON rp.roleid = r.roleid
INNER JOIN privilege p ON p.privilegeid = rp.privilegeid INNER JOIN businessunit bu ON bu.businessunitid = r.businessunitid
WHERE p.name = 'prvReadwesco_legalentity' ORDER BY r.name, bu.name\`,
  roleAccess: \`SELECT e.logicalname AS table_name, ISNULL(MAX(CASE WHEN p.name LIKE 'prvCreate%' THEN
CASE rp.privilegedepthmask WHEN 1 THEN 'User' WHEN 2 THEN 'Business Unit' WHEN 4 THEN 'Parent:Child BU' WHEN 8 THEN 'Organization' END END), 'None') AS CreateAccess
FROM role r INNER JOIN roleprivileges rp ON rp.roleid = r.roleid INNER JOIN privilege p ON p.privilegeid = rp.privilegeid
INNER JOIN privilegeobjecttypecodes potc ON potc.privilegeid = p.privilegeid
INNER JOIN entity e ON e.objecttypecode = potc.objecttypecode
WHERE r.name = 'Basic User' GROUP BY e.logicalname ORDER BY e.logicalname\`,
  audit: \`SELECT a.createdon, u.fullname AS ChangedBy, CASE a.operation WHEN 1 THEN 'Create' WHEN 2 THEN 'Update' ELSE CAST(a.operation AS VARCHAR(10)) END AS Event,
ca.logicalname, ca.oldvalue, ca.newvalue FROM audit a
CROSS APPLY OPENJSON(a.changedata, '$.changedAttributes') WITH (logicalname NVARCHAR(100) '$.logicalName', oldvalue NVARCHAR(MAX) '$.oldValue', newvalue NVARCHAR(MAX) '$.newValue') ca
LEFT JOIN systemuser u ON a.userid = u.systemuserid
WHERE a.objectid = '33333333-3333-4333-8333-333333333333' ORDER BY a.createdon DESC\`
};

test("security query 1 returns role membership and business unit", async () => {
  const result = await createBridge().run(queries.userRoles);
  assert.equal(result.ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.columns)), ["fullname", "systemuserid", "role_name", "role_businessunit"]);
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

test("security adapter rejects writes and multiple statements", async () => {
  const bridge = createBridge();
  await assert.rejects(bridge.run("DELETE FROM account"), /SELECT statements only/);
  await assert.rejects(bridge.run("SELECT name FROM account; SELECT name FROM contact"), /one SELECT statement/);
});
