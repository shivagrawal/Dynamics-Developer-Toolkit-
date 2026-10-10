import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const engine = require("../../sqlstudio/js/sql-engine.js");

const baseUrl = (process.env.DATAVERSE_URL || "").replace(/\/+$/, "");
const tenantId = process.env.DATAVERSE_TENANT_ID || "";
const clientId = process.env.DATAVERSE_CLIENT_ID || "";
const clientSecret = process.env.DATAVERSE_CLIENT_SECRET || "";

let token;
let metadata;

function requireConfiguration() {
  const missing = [
    ["DATAVERSE_URL", baseUrl],
    ["DATAVERSE_TENANT_ID", tenantId],
    ["DATAVERSE_CLIENT_ID", clientId],
    ["DATAVERSE_CLIENT_SECRET", clientSecret],
  ].filter(([, value]) => !value).map(([name]) => name);
  assert.deepEqual(missing, [], `Missing GitHub Actions secrets: ${missing.join(", ")}`);
  const parsed = new URL(baseUrl);
  assert.equal(parsed.protocol, "https:", "DATAVERSE_URL must use HTTPS");
  assert.match(parsed.hostname, /\.crm(?:\d+)?\.dynamics\.com$|\.crm\.microsoftdynamics\.us$|\.crm\.dynamics\.cn$/i,
    "DATAVERSE_URL must look like a Dataverse organization URL");
}

async function acquireToken() {
  const response = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
      scope: `${baseUrl}/.default`,
    }),
  });
  const body = await response.json().catch(() => ({}));
  assert.equal(response.ok, true,
    `Entra token request failed (HTTP ${response.status}): ${body.error_description || body.error || "no details"}`);
  assert.equal(typeof body.access_token, "string", "Entra response did not contain an access token");
  return body.access_token;
}

async function api(path) {
  const response = await fetch(`${baseUrl}/api/data/v9.2/${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "OData-Version": "4.0",
      "OData-MaxVersion": "4.0",
      "Prefer": 'odata.include-annotations="OData.Community.Display.V1.FormattedValue"',
    },
  });
  const body = await response.json().catch(() => ({}));
  assert.equal(response.ok, true,
    `Dataverse API request failed (HTTP ${response.status}): ${body.error?.message || "no details"}`);
  return body;
}

async function entityMetadata(logicalName) {
  const select = "$select=LogicalName,EntitySetName,PrimaryIdAttribute";
  const expand = "$expand=Attributes($select=LogicalName,AttributeType,IsValidForRead)";
  const path = `EntityDefinitions(LogicalName='${logicalName}')?${select}&${expand}`;
  const result = await api(path);
  return {
    logicalName: result.LogicalName,
    entitySetName: result.EntitySetName,
    primaryIdAttribute: result.PrimaryIdAttribute,
    columns: (result.Attributes || [])
      .filter(attribute => attribute.LogicalName && attribute.IsValidForRead !== false)
      .map(attribute => ({
        logicalName: attribute.LogicalName,
        queryable: attribute.IsValidForRead !== false,
        attributeType: attribute.AttributeType || "",
      })),
  };
}

test.before(async () => {
  requireConfiguration();
  token = await acquireToken();
  const who = await api("WhoAmI");
  assert.ok(who.UserId, "WhoAmI response did not include UserId");
});

test("Dataverse environment is reachable and application user is authorized", () => {
  assert.ok(token, "Dataverse authentication setup completed");
});

test("JavaScript SQL engine compiles and executes a real Account query", async () => {
  assert.ok(token, "Authentication test must run first");
  const account = await entityMetadata("account");
  metadata = { entities: { account } };
  assert.ok(account.entitySetName, "Account EntitySetName was not returned");
  assert.ok(account.columns.some(column => column.logicalName === "accountid"));
  assert.ok(account.columns.some(column => column.logicalName === "name"));

  const compiled = engine.compileSql(
    "SELECT TOP 5 accountid, name FROM account ORDER BY name",
    metadata,
  );
  assert.equal(compiled.readOnly, true);
  const path = `${compiled.entitySetName}?fetchXml=${encodeURIComponent(compiled.fetchXml)}`;
  const result = await api(path);
  assert.ok(Array.isArray(result.value), "Account FetchXML query did not return a value array");
  for (const row of result.value) {
    assert.ok(Object.hasOwn(row, "accountid"), "Account row is missing accountid");
    assert.ok(Object.hasOwn(row, "name"), "Account row is missing name");
  }
  assert.ok(result.value.length <= 5, "TOP 5 query returned more than five rows");
});

test("JavaScript SQL engine compiles and executes a real Contact-to-Account LEFT JOIN", async () => {
  assert.ok(token, "Authentication test must run first");
  const [contact, account] = await Promise.all([
    entityMetadata("contact"),
    entityMetadata("account"),
  ]);
  const joinedMetadata = { entities: { contact, account } };
  const compiled = engine.compileSql(
    "SELECT TOP 5 c.contactid, c.fullname, a.name FROM contact c LEFT JOIN account a ON c.parentcustomerid = a.accountid ORDER BY c.fullname",
    joinedMetadata,
  );
  const result = await api(`${compiled.entitySetName}?fetchXml=${encodeURIComponent(compiled.fetchXml)}`);
  assert.ok(Array.isArray(result.value), "Joined FetchXML query did not return a value array");
  for (const row of result.value) {
    assert.ok(Object.hasOwn(row, "contactid"), "Contact row is missing contactid");
    assert.ok(Object.hasOwn(row, "fullname"), "Contact row is missing fullname");
  }
});

test("unsupported SQL is rejected before any Dataverse request", () => {
  assert.throws(() => engine.plan("DELETE FROM account"), /SELECT statements only/);
});
