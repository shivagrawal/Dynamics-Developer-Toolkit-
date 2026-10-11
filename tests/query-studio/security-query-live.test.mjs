import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const baseUrl = (process.env.DATAVERSE_URL || "").replace(/\/+$/, "");
const tenantId = process.env.DATAVERSE_TENANT_ID || "";
const clientId = process.env.DATAVERSE_CLIENT_ID || "";
const clientSecret = process.env.DATAVERSE_CLIENT_SECRET || "";
const source = await readFile(new URL("../../security-audit-service.js", import.meta.url), "utf8");
let token = "";
let bridge;
let liveAccountPrivilegeName = "";
const expectedColumns = [
  ["fullname", "systemuserid", "role_name", "role_businessunit"],
  ["privilege_name"],
  ["fullname", "role_name", "role_businessunit", "privilege_name", "depth"],
  ["role_name", "business_unit", "privilege_name", "depth"],
  ["table_name", "CreateAccess", "ReadAccess", "WriteAccess", "DeleteAccess", "AppendAccess", "AppendToAccess", "AssignAccess", "ShareAccess"],
  ["createdon", "ChangedBy", "Event", "logicalname", "oldvalue", "newvalue"]
];

const queries = [
  `SELECT SU.fullname, SU.systemuserid, R.name AS role_name, BU.name AS role_businessunit
FROM SystemUserRoles AS SUR
INNER JOIN SystemUser AS SU ON SUR.systemuserid = SU.systemuserid
INNER JOIN Role AS R ON SUR.roleid = R.roleid
INNER JOIN BusinessUnit AS BU ON R.businessunitid = BU.businessunitid
WHERE SU.fullname LIKE '%USD8%'`,
  `SELECT DISTINCT p.name AS privilege_name
FROM privilege p
INNER JOIN privilegeobjecttypecodes potc ON potc.privilegeid = p.privilegeid
INNER JOIN entity e ON e.objecttypecode = potc.objecttypecode
WHERE e.logicalname = 'salesorder'
ORDER BY p.name`,
  `SELECT DISTINCT su.fullname, ur.name AS role_name, bu.name AS role_businessunit, p.name AS privilege_name,
CASE rp.privilegedepthmask WHEN 1 THEN 'User' WHEN 2 THEN 'Business Unit'
WHEN 4 THEN 'Parent:Child BU' WHEN 8 THEN 'Organization'
ELSE CAST(rp.privilegedepthmask AS VARCHAR(10)) END AS depth
FROM systemuser su
INNER JOIN systemuserroles sur ON sur.systemuserid = su.systemuserid
INNER JOIN role ur ON ur.roleid = sur.roleid
INNER JOIN businessunit bu ON bu.businessunitid = ur.businessunitid
INNER JOIN role pr ON pr.parentrootroleid = ur.parentrootroleid
INNER JOIN roleprivileges rp ON rp.roleid = pr.roleid
INNER JOIN privilege p ON p.privilegeid = rp.privilegeid
INNER JOIN privilegeobjecttypecodes potc ON potc.privilegeid = p.privilegeid
INNER JOIN entity e ON e.objecttypecode = potc.objecttypecode
WHERE su.fullname LIKE '%USD8%' AND e.logicalname = 'quote'
ORDER BY su.fullname, ur.name, p.name`,
  `SELECT DISTINCT r.name AS role_name, bu.name AS business_unit, p.name AS privilege_name,
CASE rp.privilegedepthmask WHEN 1 THEN 'User' WHEN 2 THEN 'Business Unit'
WHEN 4 THEN 'Parent:Child BU' WHEN 8 THEN 'Organization'
ELSE CAST(rp.privilegedepthmask AS VARCHAR(10)) END AS depth
FROM role r
INNER JOIN roleprivileges rp ON rp.roleid = r.roleid
INNER JOIN privilege p ON p.privilegeid = rp.privilegeid
INNER JOIN businessunit bu ON bu.businessunitid = r.businessunitid
WHERE p.name = 'prvReadwesco_legalentity'
ORDER BY r.name, bu.name`,
  `SELECT e.logicalname AS table_name,
ISNULL(MAX(CASE WHEN p.name LIKE 'prvCreate%' THEN CASE rp.privilegedepthmask
WHEN 1 THEN 'User' WHEN 2 THEN 'Business Unit' WHEN 4 THEN 'Parent:Child BU' WHEN 8 THEN 'Organization' END END), 'None') AS CreateAccess,
ISNULL(MAX(CASE WHEN p.name LIKE 'prvRead%' THEN CASE rp.privilegedepthmask
WHEN 1 THEN 'User' WHEN 2 THEN 'Business Unit' WHEN 4 THEN 'Parent:Child BU' WHEN 8 THEN 'Organization' END END), 'None') AS ReadAccess,
ISNULL(MAX(CASE WHEN p.name LIKE 'prvWrite%' THEN CASE rp.privilegedepthmask
WHEN 1 THEN 'User' WHEN 2 THEN 'Business Unit' WHEN 4 THEN 'Parent:Child BU' WHEN 8 THEN 'Organization' END END), 'None') AS WriteAccess,
ISNULL(MAX(CASE WHEN p.name LIKE 'prvDelete%' THEN CASE rp.privilegedepthmask
WHEN 1 THEN 'User' WHEN 2 THEN 'Business Unit' WHEN 4 THEN 'Parent:Child BU' WHEN 8 THEN 'Organization' END END), 'None') AS DeleteAccess,
ISNULL(MAX(CASE WHEN p.name LIKE 'prvAppend%' AND p.name NOT LIKE 'prvAppendTo%' THEN CASE rp.privilegedepthmask
WHEN 1 THEN 'User' WHEN 2 THEN 'Business Unit' WHEN 4 THEN 'Parent:Child BU' WHEN 8 THEN 'Organization' END END), 'None') AS AppendAccess,
ISNULL(MAX(CASE WHEN p.name LIKE 'prvAppendTo%' THEN CASE rp.privilegedepthmask
WHEN 1 THEN 'User' WHEN 2 THEN 'Business Unit' WHEN 4 THEN 'Parent:Child BU' WHEN 8 THEN 'Organization' END END), 'None') AS AppendToAccess,
ISNULL(MAX(CASE WHEN p.name LIKE 'prvAssign%' THEN CASE rp.privilegedepthmask
WHEN 1 THEN 'User' WHEN 2 THEN 'Business Unit' WHEN 4 THEN 'Parent:Child BU' WHEN 8 THEN 'Organization' END END), 'None') AS AssignAccess,
ISNULL(MAX(CASE WHEN p.name LIKE 'prvShare%' THEN CASE rp.privilegedepthmask
WHEN 1 THEN 'User' WHEN 2 THEN 'Business Unit' WHEN 4 THEN 'Parent:Child BU' WHEN 8 THEN 'Organization' END END), 'None') AS ShareAccess
FROM role r
INNER JOIN roleprivileges rp ON rp.roleid = r.roleid
INNER JOIN privilege p ON p.privilegeid = rp.privilegeid
INNER JOIN privilegeobjecttypecodes potc ON potc.privilegeid = p.privilegeid
INNER JOIN entity e ON e.objecttypecode = potc.objecttypecode
WHERE r.name = 'Basic User'
GROUP BY e.logicalname
ORDER BY e.logicalname`,
  `SELECT a.createdon, u.fullname AS ChangedBy,
CASE a.operation WHEN 1 THEN 'Create' WHEN 2 THEN 'Update'
ELSE CAST(a.operation AS VARCHAR(10)) END AS Event,
ca.logicalname, ca.oldvalue, ca.newvalue
FROM audit a
CROSS APPLY OPENJSON(a.changedata, '$.changedAttributes')
WITH (logicalname NVARCHAR(100) '$.logicalName', oldvalue NVARCHAR(MAX) '$.oldValue', newvalue NVARCHAR(MAX) '$.newValue') ca
LEFT JOIN systemuser u ON a.userid = u.systemuserid
WHERE a.objectid = 'bb20fca4-e8a2-f111-b8db-7c1e5280e98a'
ORDER BY a.createdon DESC`
];

function requireConfiguration() {
  const missing = [
    ["DATAVERSE_URL", baseUrl], ["DATAVERSE_TENANT_ID", tenantId],
    ["DATAVERSE_CLIENT_ID", clientId], ["DATAVERSE_CLIENT_SECRET", clientSecret]
  ].filter(([, value]) => !value).map(([name]) => name);
  assert.deepEqual(missing, [], "Missing GitHub Actions secrets: " + missing.join(", "));
  const parsed = new URL(baseUrl);
  assert.equal(parsed.protocol, "https:", "Dataverse URL must use HTTPS.");
}

async function acquireToken() {
  const response = await fetch("https://login.microsoftonline.com/" + encodeURIComponent(tenantId) + "/oauth2/v2.0/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret, grant_type: "client_credentials",
      scope: baseUrl + "/.default"
    })
  });
  const body = await response.json().catch(() => ({}));
  assert.equal(response.ok, true, "Entra token request failed (HTTP " + response.status + "): " + (body.error_description || body.error || "no details"));
  assert.equal(typeof body.access_token, "string", "Entra response did not contain an access token.");
  return body.access_token;
}

function createLiveBridge() {
  const calls = [];
  const authenticatedFetch = (input, init = {}) => {
    calls.push(new URL(String(input)).pathname + new URL(String(input)).search);
    return fetch(input, {
      ...init,
      headers: { ...(init.headers || {}), Authorization: "Bearer " + token, Accept: "application/json" }
    });
  };
  const context = {
    URL, fetch: authenticatedFetch, window: {},
    Xrm: { Utility: { getGlobalContext: () => ({ getClientUrl: () => baseUrl, organizationSettings: {} }) } },
    chrome: { runtime: { onMessage: { addListener: () => {} } }, tabs: {}, scripting: {} },
    console, setTimeout, clearTimeout
  };
  vm.runInNewContext(source, context, { filename: "security-audit-service.js" });
  return {
    run: sql => context.devLensSecurityAuditBridge("sqlQuery", { sql }),
    calls,
    get: async path => {
      const response = await authenticatedFetch(baseUrl + "/api/data/v9.2/" + path);
      const body = await response.json().catch(() => ({}));
      assert.equal(response.ok, true, "Dataverse API request failed (HTTP " + response.status + "): " + (body.error?.message || "no details"));
      return body;
    },
    request: async (method, path, payload) => {
      const response = await authenticatedFetch(baseUrl + "/api/data/v9.2/" + path, {
        method,
        headers: { "Content-Type": "application/json", Prefer: "return=representation" },
        body: payload === undefined ? undefined : JSON.stringify(payload)
      });
      const body = await response.json().catch(() => ({}));
      assert.equal(response.ok, true, "Dataverse fixture request failed (HTTP " + response.status + "): " + (body.error?.message || "no details"));
      return body;
    }
  };
}

test.before(async () => {
  requireConfiguration();
  token = await acquireToken();
  bridge = createLiveBridge();
});

for (let index = 0; index < queries.length; index++) {
  test("live Dataverse security query " + (index + 1) + " returns the expected projection", async () => {
    const result = await bridge.run(queries[index]);
    assert.equal(result.ok, true, "Query adapter failed: " + (result.error || "unknown error"));
    assert.equal(result.readOnly, true);
    assert.ok(Array.isArray(result.rows));
    assert.deepEqual(JSON.parse(JSON.stringify(result.columns)), expectedColumns[index]);
    assert.equal(result.rowCount, result.rows.length);
    for (const row of result.rows) {
      for (const column of expectedColumns[index]) assert.ok(Object.hasOwn(row, column), "Projected result row omitted a requested column.");
    }
    if (index === 0) {
      for (const row of result.rows) {
        assert.match(String(row.systemuserid), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        assert.ok(row.role_name && row.role_businessunit, "User role projection is missing role or business unit values.");
      }
    }
    if (index === 1) {
      const names = result.rows.map(row => row.privilege_name);
      assert.equal(new Set(names).size, names.length, "DISTINCT privilege query returned duplicates.");
      for (const name of names) assert.ok(name.startsWith("prv"), "Privilege projection contains a malformed privilege name.");
    }
    if (index === 2 || index === 3) {
      for (const row of result.rows) assert.match(String(row.depth), /^(User|Business Unit|Parent:Child BU|Organization|\d+)$/, "Privilege depth CASE mapping is invalid.");
      const distinctKeys = result.rows.map(row => JSON.stringify(index === 2
        ? [row.fullname, row.role_name, row.role_businessunit, row.privilege_name, row.depth]
        : [row.role_name, row.business_unit, row.privilege_name, row.depth]));
      assert.equal(new Set(distinctKeys).size, distinctKeys.length, "SELECT DISTINCT query returned duplicate rows.");
    }
    if (index === 4) {
      const accessLevels = new Set(["User", "Business Unit", "Parent:Child BU", "Organization", "None"]);
      const tableNames = result.rows.map(row => row.table_name);
      assert.ok(tableNames.every(Boolean), "Table-access aggregate returned an empty logical name.");
      assert.equal(new Set(tableNames).size, tableNames.length, "GROUP BY e.logicalname returned duplicate table rows.");
      for (const row of result.rows) for (const column of expectedColumns[index].slice(1)) {
        assert.ok(accessLevels.has(row[column]), "Access summary returned an unknown depth label.");
      }
    }
    const label = index === 4 ? "DATA-BACKED" : "FILTER-SMOKE";
    console.log("Live security SQL query " + (index + 1) + ": " + label + "; rows=" + result.rowCount);
    // Never emit row values, record IDs, audit payloads, or privilege assignments in CI logs.
  });
}

test("live salesorder privilege mapping is nonempty when salesorder metadata exists", async t => {
  let metadata;
  try {
    metadata = await bridge.get("EntityDefinitions(LogicalName='salesorder')?$select=LogicalName");
  } catch (error) {
    if (/404|not found|does not exist/i.test(String(error.message))) {
      t.skip("salesorder metadata is not available in this Dataverse environment.");
      return;
    }
    throw error;
  }
  if (!metadata.LogicalName) {
    t.skip("salesorder metadata is not available in this Dataverse environment.");
    return;
  }
  const result = await bridge.run(queries[1]);
  assert.equal(result.ok, true, "salesorder privilege query failed: " + (result.error || "unknown error"));
  assert.ok(result.rows.length > 0, "salesorder metadata exists but no privilege/object-type-code rows were returned.");
});

test("live privilege mapping returns privilege names for a standard table", async () => {
  const query = queries[1].replace("salesorder", "account");
  const result = await bridge.run(query);
  assert.equal(result.ok, true, "Account privilege mapping failed: " + (result.error || "unknown error"));
  assert.ok(result.rows.length > 0, "Expected Dataverse security metadata to expose privileges for the standard account table.");
  assert.equal(new Set(result.rows.map(row => row.privilege_name)).size, result.rows.length);
  for (const row of result.rows) assert.ok(String(row.privilege_name).startsWith("prv"));
  liveAccountPrivilegeName = result.rows.find(row => row.privilege_name === "prvReadAccount")?.privilege_name || result.rows[0].privilege_name;
  console.log("Live account privilege mapping: PASS; privileges=" + result.rowCount);
});


test("live user-role query returns membership for an active user", async t => {
  const users = await bridge.get("systemusers?$select=fullname&$filter=isdisabled%20eq%20false&$top=10");
  for (const user of users.value || []) {
    const fullname = String(user.fullname || "");
    if (!fullname) continue;
    const escaped = fullname.replace(/'/g, "''");
    const query = queries[0].replace("%USD8%", "%" + escaped + "%");
    const result = await bridge.run(query);
    assert.equal(result.ok, true, "User-role query failed: " + (result.error || "unknown error"));
    if (!result.rows.some(row => row.fullname === fullname)) continue;
    for (const row of result.rows.filter(row => row.fullname === fullname)) {
      assert.match(String(row.systemuserid), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
      assert.ok(row.role_name && row.role_businessunit);
    }
    console.log("Live user-role adapter: PASS; matching rows=" + result.rowCount);
    return;
  }
  t.skip("No active user with role membership was available in the test environment.");
});

test("live user entity privilege query returns mapped account privileges", async t => {
  const users = await bridge.get("systemusers?$select=fullname&$filter=isdisabled%20eq%20false&$top=10");
  for (const user of users.value || []) {
    const fullname = String(user.fullname || "");
    if (!fullname) continue;
    const escaped = fullname.replace(/'/g, "''");
    const membership = await bridge.run(queries[0].replace("%USD8%", "%" + escaped + "%"));
    assert.equal(membership.ok, true, "User membership lookup failed: " + (membership.error || "unknown error"));
    if (!membership.rows.some(row => row.fullname === fullname)) continue;
    const query = queries[2].replace("%USD8%", "%" + escaped + "%").replace("e.logicalname = 'quote'", "e.logicalname = 'account'");
    const result = await bridge.run(query);
    assert.equal(result.ok, true, "User entity privilege query failed: " + (result.error || "unknown error"));
    assert.ok(result.rows.some(row => row.fullname === fullname),
      "A user with role membership returned no account privilege rows; this is a semantic regression.");
    for (const row of result.rows.filter(row => row.fullname === fullname)) {
      assert.ok(row.role_name && row.role_businessunit && row.privilege_name);
      assert.match(String(row.depth), /^(User|Business Unit|Parent:Child BU|Organization|\d+)$/);
    }
    console.log("Live user entity privilege adapter: PASS; matching rows=" + result.rowCount);
    return;
  }
  t.skip("No active user with account privileges was available in the test environment.");
});

test("live roles-by-privilege query returns roles for a standard account privilege", async t => {
  if (!liveAccountPrivilegeName) t.skip("Account privilege control did not discover a privilege.");
  const query = queries[3].replace("prvReadwesco_legalentity", liveAccountPrivilegeName);
  const result = await bridge.run(query);
  assert.equal(result.ok, true, "Roles-by-privilege query failed: " + (result.error || "unknown error"));
  assert.ok(result.rows.length > 0, "Expected at least one role to contain the selected standard account privilege.");
  for (const row of result.rows) assert.ok(row.role_name && row.business_unit && row.privilege_name && row.depth);
  console.log("Live roles-by-privilege adapter: PASS; matching rows=" + result.rowCount);
});

test("live audit adapter expands a disposable record's actual audited attribute change", async t => {
  const unique = "DevLens SQL Studio audit integration " + new Date().toISOString() + " " + Math.random().toString(36).slice(2, 8);
  let accountId = "";
  // This is the explicitly designated personal development/test environment.
  // Enable only the settings required to verify audit reconstruction; leave auditing
  // enabled afterward so subsequent live runs can exercise the same capability.
  const organization = await bridge.get("organizations?$select=organizationid,isauditenabled&$top=1");
  const org = organization.value?.[0];
  assert.ok(org?.organizationid, "Dataverse did not return the organization ID.");
  if (org.isauditenabled !== true) {
    await bridge.request("PATCH", "organizations(" + org.organizationid + ")", { isauditenabled: true });
  }

  let accountMetadata = await bridge.get("EntityDefinitions(LogicalName='account')?$select=LogicalName,IsAuditEnabled");
  if (accountMetadata.IsAuditEnabled?.Value !== true) {
    assert.notEqual(accountMetadata.IsAuditEnabled?.CanBeChanged, false,
      "Account auditing is disabled and the table metadata says the setting cannot be changed.");
    // Dataverse metadata definitions require PUT with the full current definition,
    // not PATCH with a partial property set.
    const fullAccountMetadata = await bridge.get("EntityDefinitions(LogicalName='account')");
    fullAccountMetadata.IsAuditEnabled.Value = true;
    await bridge.request("PUT", "EntityDefinitions(LogicalName='account')", fullAccountMetadata);
  }

  let descriptionMetadata = await bridge.get("EntityDefinitions(LogicalName='account')/Attributes(LogicalName='description')?$select=LogicalName,IsAuditEnabled");
  if (descriptionMetadata.IsAuditEnabled?.Value !== true) {
    assert.notEqual(descriptionMetadata.IsAuditEnabled?.CanBeChanged, false,
      "Account description auditing is disabled and the attribute metadata says the setting cannot be changed.");
    const fullDescriptionMetadata = await bridge.get("EntityDefinitions(LogicalName='account')/Attributes(LogicalName='description')");
    fullDescriptionMetadata.IsAuditEnabled.Value = true;
    await bridge.request("PUT", "EntityDefinitions(LogicalName='account')/Attributes(LogicalName='description')", fullDescriptionMetadata);
  }

  await bridge.request("POST", "PublishXml", {
    ParameterXml: "<importexportxml><entities><entity>account</entity></entities></importexportxml>"
  });

  const verifiedOrganization = await bridge.get("organizations?$select=isauditenabled&$top=1");
  accountMetadata = await bridge.get("EntityDefinitions(LogicalName='account')?$select=LogicalName,IsAuditEnabled");
  descriptionMetadata = await bridge.get("EntityDefinitions(LogicalName='account')/Attributes(LogicalName='description')?$select=LogicalName,IsAuditEnabled");
  assert.equal(verifiedOrganization.value?.[0]?.isauditenabled, true, "Organization auditing did not enable successfully.");
  assert.equal(accountMetadata.IsAuditEnabled?.Value, true, "Account auditing did not enable successfully.");
  assert.equal(descriptionMetadata.IsAuditEnabled?.Value, true, "Account description auditing did not enable successfully.");
  try {
    const created = await bridge.request("POST", "accounts", { name: unique, description: "DevLens audit fixture before update" });
    accountId = String(created.accountid || "").replace(/[{}]/g, "");
    assert.match(accountId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "Dataverse did not return the temporary account ID.");
    await bridge.request("PATCH", "accounts(" + accountId + ")", { description: "DevLens audit fixture after update" });
    const query = queries[5].replace("bb20fca4-e8a2-f111-b8db-7c1e5280e98a", accountId);
    const result = await bridge.run(query);
    assert.equal(result.ok, true, "Audit adapter failed for the temporary record: " + (result.error || "unknown error"));
    const descriptionChange = result.rows.find(row => row.logicalname === "description" &&
      String(row.oldvalue).includes("before update") && String(row.newvalue).includes("after update"));
    if (!descriptionChange) {
      const auditRows = await bridge.get("audits?$select=auditid&$filter=_objectid_value%20eq%20" + accountId + "&$top=5");
      if (!(auditRows.value || []).length) {
        t.skip("Dataverse auditing is disabled or no audit history is available for the disposable fixture.");
        return;
      }
      assert.ok(descriptionChange, "Audit details were returned but the known description change was not reconstructed.");
    }
    assert.ok(bridge.calls.some(path => path.includes("RetrieveAuditDetails")), "Audit details API was not called.");
    console.log("Live disposable audit fixture: PASS; audit attribute rows=" + result.rowCount);
  } finally {
    if (accountId) await bridge.request("DELETE", "accounts(" + accountId + ")");
  }
});

test("live audit detail expansion is exercised when the environment has audit rows", async t => {
  const data = await bridge.get("audits?$select=_objectid_value&$top=50&$orderby=createdon%20desc");
  const candidate = (data.value || []).map(row => String(row._objectid_value || "").replace(/[{}]/g, ""))
    .find(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
  if (!candidate) {
    t.skip("The test environment has no audit records with object IDs; offline fixtures cover audit-detail flattening.");
    return;
  }
  const query = queries[5].replace("bb20fca4-e8a2-f111-b8db-7c1e5280e98a", candidate);
  const result = await bridge.run(query);
  assert.equal(result.ok, true, "Audit detail adapter failed: " + (result.error || "unknown error"));
  assert.ok(bridge.calls.some(path => path.includes("RetrieveAuditDetails")), "An audited record was found but RetrieveAuditDetails was not called.");
  assert.deepEqual(JSON.parse(JSON.stringify(result.columns)), expectedColumns[5]);
  console.log("Live audit detail smoke test: PASS; changed-attribute rows=" + result.rowCount);
  // Never emit audit values, record IDs, or user names in CI logs.
});
