import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const engine = require("../../sqlstudio/js/sql-engine.js");
const sql = (process.env.SQL_QUERY || "").trim();
const baseUrl = (process.env.DATAVERSE_URL || "").replace(/\/+$/, "");
const tenantId = process.env.DATAVERSE_TENANT_ID || "";
const clientId = process.env.DATAVERSE_CLIENT_ID || "";
const clientSecret = process.env.DATAVERSE_CLIENT_SECRET || "";

function validateInput() {
  assert.ok(sql, "Enter a SQL SELECT query in the workflow's SQL query input.");
  assert.ok(sql.length <= 2000, "SQL query must be 2,000 characters or fewer.");
  assert.ok(!sql.includes(";"), "Semicolons/multiple statements are not allowed.");
  assert.ok(!/--|\/\*|\*\//.test(sql), "SQL comments are not allowed in this test harness.");
  assert.match(sql, /^SELECT\b/i, "Only a single SELECT query is allowed.");
  const top = sql.match(/^SELECT\s+(?:DISTINCT\s+)?TOP\s+(\d+)\b/i);
  assert.ok(top, "Query must start with SELECT TOP N (or SELECT DISTINCT TOP N).");
  const limit = Number(top[1]);
  assert.ok(Number.isInteger(limit) && limit >= 1 && limit <= 25, "TOP must be between 1 and 25.");
  const from = sql.match(/\bFROM\s+([a-z_][a-z0-9_]*)/i);
  assert.ok(from, "Could not identify the FROM table.");
  const entities = [...sql.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)/gi)].map(m => m[1].toLowerCase());
  assert.ok(entities.length > 0 && entities.every(name => ["account", "contact", "systemuser"].includes(name)),
    "For this initial harness, only account and contact tables are permitted.");
  assert.ok(baseUrl && tenantId && clientId && clientSecret, "Dataverse integration secrets are not fully configured.");
  const parsed = new URL(baseUrl);
  assert.equal(parsed.protocol, "https:", "DATAVERSE_URL must use HTTPS.");
  assert.match(parsed.hostname, /\.crm(?:\d+)?\.dynamics\.com$|\.crm\.microsoftdynamics\.us$|\.crm\.dynamics\.cn$/i,
    "DATAVERSE_URL must be a Dataverse organization URL.");
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
  assert.equal(response.ok, true, `Entra token request failed (HTTP ${response.status}): ${body.error_description || body.error || "no details"}`);
  assert.equal(typeof body.access_token, "string", "Entra response did not contain an access token.");
  return body.access_token;
}

async function api(path, token) {
  const response = await fetch(`${baseUrl}/api/data/v9.2/${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "OData-Version": "4.0",
      "OData-MaxVersion": "4.0",
    },
  });
  const body = await response.json().catch(() => ({}));
  assert.equal(response.ok, true, `Dataverse request failed (HTTP ${response.status}): ${body.error?.message || "no details"}`);
  return body;
}

async function entityMetadata(logicalName, token) {
  const path = `EntityDefinitions(LogicalName='${logicalName}')?$select=LogicalName,EntitySetName,PrimaryIdAttribute&$expand=Attributes($select=LogicalName,AttributeType,IsValidForRead)`;
  const result = await api(path, token);
  return {
    logicalName: result.LogicalName,
    entitySetName: result.EntitySetName,
    primaryIdAttribute: result.PrimaryIdAttribute,
    columns: (result.Attributes || [])
      .filter(a => a.LogicalName && a.IsValidForRead !== false)
      .map(a => ({ logicalName: a.LogicalName, queryable: a.IsValidForRead !== false, attributeType: a.AttributeType || "" })),
  };
}

try {
  validateInput();
  const token = await acquireToken();
  const names = [...new Set([...sql.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)/gi)].map(m => m[1].toLowerCase()))];
  const entities = {};
  for (const name of names) entities[name] = await entityMetadata(name, token);
  const compiled = engine.compileSql(sql, { entities });
  assert.equal(compiled.readOnly, true, "Compiler did not mark query as read-only.");
  assert.ok(names.includes(String(compiled.entitySetName || "").toLowerCase()) ||
    Object.values(entities).some(e => e.entitySetName === compiled.entitySetName),
    "Compiled entity set does not match the allowed metadata.");
  const result = await api(`${compiled.entitySetName}?fetchXml=${encodeURIComponent(compiled.fetchXml)}`, token);
  assert.ok(Array.isArray(result.value), "Dataverse query did not return a value array.");
  assert.ok(result.value.length <= 25, "Query returned more than 25 rows.");
  const columns = result.value.length ? Object.keys(result.value[0]) : [];
  console.log(JSON.stringify({
    status: "passed",
    entitySet: compiled.entitySetName,
    returnedRows: result.value.length,
    columns,
    fetchXmlGenerated: Boolean(compiled.fetchXml),
    rowValuesOmitted: true,
  }, null, 2));
} catch (error) {
  console.error(`Harness failed: ${error.message}`);
  process.exitCode = 1;
}
