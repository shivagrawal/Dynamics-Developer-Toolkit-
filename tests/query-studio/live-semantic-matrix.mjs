import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const engine = require("../../sqlstudio/js/sql-engine.js");
const baseUrl = (process.env.DATAVERSE_URL || "").replace(/\/+$/, "");
const tenantId = process.env.DATAVERSE_TENANT_ID || "";
const clientId = process.env.DATAVERSE_CLIENT_ID || "";
const clientSecret = process.env.DATAVERSE_CLIENT_SECRET || "";

function validateEnvironment() {
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
  assert.equal(response.ok, true, `Entra token request failed (HTTP ${response.status}): ${body.error || "no details"}`);
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
  assert.equal(response.ok, true, `Dataverse request failed (HTTP ${response.status})`);
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

function project(rows, columns) {
  return rows.map(row => columns.map(column => {
    const key = Object.keys(row).find(candidate => candidate.toLowerCase() === column.toLowerCase());
    return key === undefined || row[key] === undefined ? null : row[key];
  }));
}

async function runParityCase({ name, sql, entities, token, expected, fetchXmlOnly = false }) {
  const compiled = engine.compileSql(sql, { entities });
  assert.equal(compiled.readOnly, true, name + ": compiler did not mark query read-only");
  const fetchRaw = await api(compiled.entitySetName + "?fetchXml=" + encodeURIComponent(compiled.fetchXml), token);
  assert.ok(Array.isArray(fetchRaw.value), name + ": FetchXML returned no value array");
  assert.ok(fetchRaw.value.length <= 5, name + ": FetchXML exceeded bounded row limit");

  let nativeRows = null;
  if (!fetchXmlOnly) {
    const baseEntity = entities.contact;
    const nativeRaw = await api(baseEntity.entitySetName + "?sql=" + encodeURIComponent(sql), token);
    assert.ok(Array.isArray(nativeRaw.value), name + ": native SQL returned no value array");
    assert.ok(nativeRaw.value.length <= 5, name + ": native SQL exceeded bounded row limit");
    const columns = ["contactid", "fullname"];
    nativeRows = project(nativeRaw.value, columns);
    nativeRows.sort((a, b) => String(a[0] ?? "").localeCompare(String(b[0] ?? "")));
  }

  const fetchRows = project(fetchRaw.value, ["contactid", "fullname"]);
  fetchRows.sort((a, b) => String(a[0] ?? "").localeCompare(String(b[0] ?? "")));
  if (nativeRows) assert.deepEqual(fetchRows, nativeRows, name + ": native SQL and FetchXML projected values differ");

  if (expected === "null") {
    assert.ok(fetchRows.every(row => row[1] === null), name + ": FetchXML returned a non-null fullname for IS NULL");
    if (nativeRows) assert.ok(nativeRows.every(row => row[1] === null), name + ": native SQL returned a non-null fullname for IS NULL");
  } else if (expected === "not-null") {
    assert.ok(fetchRows.every(row => row[1] !== null), name + ": FetchXML returned a null fullname for IS NOT NULL");
    if (nativeRows) assert.ok(nativeRows.every(row => row[1] !== null), name + ": native SQL returned a null fullname for IS NOT NULL");
  } else if (expected === "like") {
    assert.ok(fetchRows.every(row => typeof row[1] === "string" && row[1].toLowerCase().includes("dataverse")),
      name + ": FetchXML returned a row that violates LIKE");
    if (nativeRows) assert.ok(nativeRows.every(row => typeof row[1] === "string" && row[1].toLowerCase().includes("dataverse")),
      name + ": native SQL returned a row that violates LIKE");
  } else if (expected === "empty") {
    assert.equal(fetchRows.length, 0, name + ": FetchXML expected an empty result");
    if (nativeRows) assert.equal(nativeRows.length, 0, name + ": native SQL expected an empty result");
  }

  return { name, fetchXmlRows: fetchRows.length, nativeSqlRows: nativeRows ? nativeRows.length : null, matched: true, _keys: fetchRows.map(row => row[0]) };
}

try {
  validateEnvironment();
  const token = await acquireToken();
  const entities = {
    contact: await entityMetadata("contact", token),
    account: await entityMetadata("account", token),
  };
  const cases = [
    {
      name: "simple-projection-order",
      sql: "SELECT TOP 5 contactid, fullname FROM contact ORDER BY contactid",
    },
    {
      name: "is-null",
      sql: "SELECT TOP 5 contactid, fullname FROM contact WHERE fullname IS NULL ORDER BY contactid",
      expected: "null",
    },
    {
      name: "is-not-null",
      sql: "SELECT TOP 5 contactid, fullname FROM contact WHERE fullname IS NOT NULL ORDER BY contactid",
      expected: "not-null",
    },
    {
      name: "like-filter",
      sql: "SELECT TOP 5 contactid, fullname FROM contact WHERE fullname LIKE '%dataverse%' ORDER BY contactid",
      expected: "like",
    },
    {
      name: "empty-result",
      sql: "SELECT TOP 5 contactid, fullname FROM contact WHERE contactid = '00000000-0000-0000-0000-000000000001' ORDER BY contactid",
      expected: "empty",
    },
    {
      name: "left-join-cardinality",
      sql: "SELECT TOP 5 c.contactid, c.fullname FROM contact c LEFT JOIN account a ON c.parentcustomerid = a.accountid ORDER BY c.contactid",
    },
    {
      name: "offset-fetch-page-one",
      sql: "SELECT contactid, fullname FROM contact ORDER BY contactid OFFSET 0 ROWS FETCH NEXT 5 ROWS ONLY",
      fetchXmlOnly: true,
    },
    {
      name: "offset-fetch-page-two",
      sql: "SELECT contactid, fullname FROM contact ORDER BY contactid OFFSET 5 ROWS FETCH NEXT 5 ROWS ONLY",
      fetchXmlOnly: true,
    },
  ];

  const results = [];
  const pageKeys = {};
  for (const item of cases) {
    const result = await runParityCase({ ...item, entities, token });
    if (item.name === "offset-fetch-page-one" || item.name === "offset-fetch-page-two") {
      pageKeys[item.name] = result._keys;
    }
    const { _keys, ...summary } = result;
    results.push(summary);
  }

  assert.ok(pageKeys["offset-fetch-page-one"].length > 0,
    "paging: page one must return at least one contact in the configured test environment");
  const firstPageKeys = new Set(pageKeys["offset-fetch-page-one"].map(key => String(key).toLowerCase()));
  assert.ok(pageKeys["offset-fetch-page-two"].every(key => !firstPageKeys.has(String(key).toLowerCase())),
    "paging: page one and page two contain overlapping contact primary keys");
  assert.equal(new Set(pageKeys["offset-fetch-page-one"].map(key => String(key).toLowerCase())).size,
    pageKeys["offset-fetch-page-one"].length, "paging: page one contains duplicate contact primary keys");
  assert.equal(new Set(pageKeys["offset-fetch-page-two"].map(key => String(key).toLowerCase())).size,
    pageKeys["offset-fetch-page-two"].length, "paging: page two contains duplicate contact primary keys");
  results.push({
    name: "offset-fetch-page-boundaries",
    pageOneRows: pageKeys["offset-fetch-page-one"].length,
    pageTwoRows: pageKeys["offset-fetch-page-two"].length,
    overlap: 0,
    matched: true,
  });

  // Explicitly test LEFT JOIN null extension: a contact with no parent account
  // must retain its row while the joined account primary key is null. Values stay
  // in memory and are never written to logs or workflow summaries.
  const unmatchedSql = "SELECT TOP 5 c.contactid, a.accountid FROM contact c LEFT JOIN account a ON c.parentcustomerid = a.accountid WHERE c.parentcustomerid IS NULL ORDER BY c.contactid";
  const unmatchedCompiled = engine.compileSql(unmatchedSql, { entities });
  assert.equal(unmatchedCompiled.readOnly, true, "left-join-null-extension: compiler did not mark query read-only");
  const unmatchedFetch = await api(unmatchedCompiled.entitySetName + "?fetchXml=" + encodeURIComponent(unmatchedCompiled.fetchXml), token);
  const unmatchedNative = await api(entities.contact.entitySetName + "?sql=" + encodeURIComponent(unmatchedSql), token);
  assert.ok(Array.isArray(unmatchedFetch.value), "left-join-null-extension: FetchXML returned no value array");
  assert.ok(Array.isArray(unmatchedNative.value), "left-join-null-extension: native SQL returned no value array");
  assert.ok(unmatchedFetch.value.length > 0, "left-join-null-extension: no unparented contacts exist in the configured test environment");
  assert.ok(unmatchedFetch.value.length <= 5 && unmatchedNative.value.length <= 5,
    "left-join-null-extension: result exceeded the five-row bound");
  const joinedAccountId = row => {
    const key = Object.keys(row).find(candidate =>
      candidate.toLowerCase().endsWith("accountid") && candidate.toLowerCase() !== "contactid");
    assert.ok(key, "left-join-null-extension: joined account ID column is missing");
    return row[key] === undefined ? null : row[key];
  };
  assert.ok(unmatchedFetch.value.every(row => joinedAccountId(row) === null),
    "left-join-null-extension: FetchXML failed to null-extend unmatched account rows");
  assert.ok(unmatchedNative.value.every(row => joinedAccountId(row) === null),
    "left-join-null-extension: native SQL failed to null-extend unmatched account rows");
  results.push({
    name: "left-join-null-extension",
    fetchXmlRows: unmatchedFetch.value.length,
    nativeSqlRows: unmatchedNative.value.length,
    allJoinedAccountIdsNull: true,
    matched: true,
  });

  // Aggregate validation is bounded server-side: it returns one aggregate row,
  // not the underlying contact set. The exact count is deliberately not logged.
  const aggregate = await api(entities.contact.entitySetName + "?sql=" +
    encodeURIComponent("SELECT COUNT(*) AS total FROM contact WHERE contactid = '00000000-0000-0000-0000-000000000001'"), token);
  assert.ok(Array.isArray(aggregate.value), "aggregate: native SQL returned no value array");
  assert.equal(aggregate.value.length, 1, "aggregate: COUNT(*) must return exactly one row");
  const aggregateValue = Object.values(aggregate.value[0]).find(value => typeof value === "number");
  assert.ok(Number.isFinite(aggregateValue) && aggregateValue >= 0, "aggregate: COUNT(*) did not return a non-negative numeric value");
  results.push({ name: "count-aggregate", rows: 1, matched: true });

  console.log(JSON.stringify({
    status: "passed",
    environment: "dataverse-test",
    cases: results,
    rowValuesOmitted: true,
    aggregateValueOmitted: true,
  }, null, 2));
} catch (error) {
  console.error(`Live semantic matrix failed: ${error.message}`);
  process.exitCode = 1;
}
