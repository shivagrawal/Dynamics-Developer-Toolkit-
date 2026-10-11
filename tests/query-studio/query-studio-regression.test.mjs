import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const sqlEnginePath = path.resolve(here, "../../sqlstudio/js/sql-engine.js");
const sqlPolicyPath = path.resolve(here, "../../sqlstudio/js/sql-policy.js");
const backgroundPath = path.resolve(here, "../../background.js");
const sqlEngineSource = fs.readFileSync(sqlEnginePath, "utf8");
const sqlPolicySource = fs.readFileSync(sqlPolicyPath, "utf8");
const backgroundSource = fs.readFileSync(backgroundPath, "utf8");

function createHarness({ response, entityMetadata = {}, fetchResponse, fetchPages, metadataError, fetchXmlResponse } = {}) {
  let messageListener;
  let requestedUrl;
  const requestedUrls = [];
  let fetchPageIndex = 0;
  let fetchXmlCallCount = 0;
  const requestedFetchXml = [];
  const clientUrl = "https://example.crm.dynamics.com";
  const xrm = {
    WebApi: { retrieveMultipleRecords: async (table, query, pageSize) => { requestedFetchXml.push({ table, query, pageSize }); if (Array.isArray(fetchXmlResponse)) return fetchXmlResponse[fetchXmlCallCount++] || { entities: [] }; return fetchXmlResponse || { entities: [], nextLink: null }; } },
    Utility: {
      getGlobalContext: () => ({
        getClientUrl: () => clientUrl,
        organizationSettings: { bapEnvironmentId: "test-environment" },
        userSettings: { userId: "test-user", userName: "Regression Test" },
      }),
      getEntityMetadata: async (name) => {
        if (metadataError) throw new Error(metadataError);
        if (entityMetadata[name]?.missing) return {};
        return {
          EntitySetName: entityMetadata[name]?.EntitySetName || (name === "contact" ? "contacts" : "accounts"),
          PrimaryIdAttribute: entityMetadata[name]?.PrimaryIdAttribute || (name === "contact" ? "contactid" : "accountid"),
        };
      },
    },
    Page: {
      data: { entity: { getEntityName: () => null, getId: () => null } },
      ui: { formSelector: { getCurrentItem: () => null, items: { get: () => [] } } },
    },
  };

  const sandbox = {
    console,
    URL,
    URLSearchParams,
    TextDecoder,
    Uint8Array,
    atob: globalThis.atob,
    btoa: globalThis.btoa,
    structuredClone,
    setTimeout,
    clearTimeout,
    window: {},
    Xrm: xrm,
    fetch: async (url) => {
      requestedUrl = String(url);
      requestedUrls.push(String(url));
      if (fetchResponse) return fetchResponse;
      if (fetchPages) {
        const page = fetchPages[fetchPageIndex++];
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => page,
        };
      }
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => response,
      };
    },
    chrome: {
      runtime: { onMessage: { addListener: (listener) => { messageListener = listener; } } },
      scripting: {
        executeScript: async ({ func, args }) => [{ result: await func(...args) }],
      },
      commands: { onCommand: { addListener: () => {} } },
      tabs: { query: async () => [], sendMessage: () => {} },
    },
  };
  // Mirror background-entry.js production load order: engine, shared policy, then dispatcher.
  // Loading only background.js makes every policy-protected action fail closed and masks
  // the behavior this harness intends to exercise.
  const context = vm.createContext(sandbox);
  vm.runInContext(sqlEngineSource, context, { filename: "sqlstudio/js/sql-engine.js" });
  vm.runInContext(sqlPolicySource, context, { filename: "sqlstudio/js/sql-policy.js" });
  vm.runInContext(backgroundSource, context, { filename: "background.js" });

  async function runAction(action, payload) {
    assert.equal(typeof messageListener, "function", "background message listener was registered");
    let result;
    await new Promise((resolve, reject) => {
      const returned = messageListener(
        { type: "DEVLENS_ACTION", action, payload },
        { tab: { id: 1 } },
        (value) => { result = value; resolve(); },
      );
      if (returned !== true) reject(new Error("Expected asynchronous message response"));
    });
    return { result, requestedUrl };
  }
  async function runQuery(sql) { return runAction("querySql", { sql }); }
  return { runQuery, runAction, requestedFetchXml, requestedUrls };
}

test("simple SELECT returns requested columns and preserves null-capable metadata columns", async () => {
  const harness = createHarness({
    response: {
      "@odata.context": "https://example.crm.dynamics.com/api/data/v9.2/$metadata#accounts(accountid,name,accountnumber)",
      value: [{ accountid: "a1", name: "Contoso", accountnumber: null }],
    },
  });
  const { result, requestedUrl } = await harness.runQuery("SELECT accountid, name, accountnumber FROM account");
  assert.equal(result.ok, true);
  assert.deepEqual(Array.from(result.columns), ["accountid", "name", "accountnumber"]);
  assert.equal(result.rows[0].accountnumber, null);
  assert.match(requestedUrl, /\/api\/data\/v9\.2\/accounts\?sql=/);
});

test("native SQL follows same-origin Dataverse paging links", async () => {
  const context = "https://example.crm.dynamics.com/api/data/v9.2/$metadata#accounts(accountid,name)";
  const nextLink = "https://example.crm.dynamics.com/api/data/v9.2/accounts?sql=SELECT%20accountid%2C%20name%20FROM%20account&$skiptoken=page2";
  const harness = createHarness({
    fetchPages: [
      { "@odata.context": context, "@odata.nextLink": nextLink, value: [{ accountid: "a1", name: "First" }] },
      { "@odata.context": context, value: [{ accountid: "a2", name: "Second" }] }
    ]
  });
  const { result } = await harness.runQuery("SELECT accountid, name FROM account");
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[1].name, "Second");
  assert.equal(result.truncated, false);
  assert.equal(harness.requestedUrls.length, 2);
});

test("native SQL stops on a repeated paging link instead of looping", async () => {
  const context = "https://example.crm.dynamics.com/api/data/v9.2/$metadata#accounts(accountid,name)";
  const nextLink = "https://example.crm.dynamics.com/api/data/v9.2/accounts?sql=SELECT%20accountid%2C%20name%20FROM%20account&$skiptoken=repeat";
  const harness = createHarness({
    fetchPages: [
      { "@odata.context": context, "@odata.nextLink": nextLink, value: [{ accountid: "a1", name: "First" }] },
      { "@odata.context": context, "@odata.nextLink": nextLink, value: [{ accountid: "a2", name: "Second" }] }
    ]
  });
  const { result } = await harness.runQuery("SELECT accountid, name FROM account");
  assert.equal(result.ok, false);
  assert.match(result.error, /repeated paging link/i);
  assert.equal(harness.requestedUrls.length, 2);
});

test("native SQL rejects cross-origin paging links without following them", async () => {
  const harness = createHarness({
    fetchPages: [{
      "@odata.context": "https://example.crm.dynamics.com/api/data/v9.2/$metadata#accounts(accountid,name)",
      "@odata.nextLink": "https://attacker.example/api/data/v9.2/accounts?skiptoken=bad",
      value: [{ accountid: "a1", name: "First" }]
    }]
  });
  const { result } = await harness.runQuery("SELECT accountid, name FROM account");
  assert.equal(result.ok, false);
  assert.match(result.error, /invalid paging URL/i);
  assert.equal(harness.requestedUrls.length, 1);
});

test("native SQL count-limit annotations produce a visible truncation warning", async () => {
  const harness = createHarness({
    response: {
      "@odata.context": "https://example.crm.dynamics.com/api/data/v9.2/$metadata#accounts(accountid,name)",
      "@Microsoft.Dynamics.CRM.totalrecordcountlimitexceeded": true,
      value: [{ accountid: "a1", name: "First" }]
    }
  });
  const { result } = await harness.runQuery("SELECT accountid, name FROM account");
  assert.equal(result.ok, true);
  assert.equal(result.truncated, true);
  assert.match(result.warning, /may be incomplete/);
});

test("native SQL stops after 100 pages and marks the result incomplete", async () => {
  const context = "https://example.crm.dynamics.com/api/data/v9.2/$metadata#accounts(accountid,name)";
  const base = "https://example.crm.dynamics.com/api/data/v9.2/accounts?sql=SELECT%20accountid%2C%20name%20FROM%20account&page=";
  const fetchPages = Array.from({ length: 101 }, (_, index) => ({
    "@odata.context": context,
    ...(index < 100 ? { "@odata.nextLink": base + (index + 2) } : {}),
    value: [{ accountid: "a" + (index + 1), name: "Row " + (index + 1) }]
  }));
  const harness = createHarness({ fetchPages });
  const { result } = await harness.runQuery("SELECT accountid, name FROM account");
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 100);
  assert.equal(result.truncated, true);
  assert.match(result.warning, /100-page safety limit/);
  assert.equal(harness.requestedUrls.length, 100);
});

test("native SQL enforces a 10,000-row cap and reports incomplete results", async () => {
  const context = "https://example.crm.dynamics.com/api/data/v9.2/$metadata#accounts(accountid,name)";
  const rows = Array.from({ length: 10001 }, (_, index) => ({ accountid: "a" + index, name: "Row " + index }));
  const harness = createHarness({ fetchPages: [{ "@odata.context": context, value: rows }] });
  const { result } = await harness.runQuery("SELECT accountid, name FROM account");
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 10000);
  assert.equal(result.truncated, true);
  assert.match(result.warning, /may be incomplete/i);
});

test("lookup projection maps verified _parentcustomerid_value to parentcustomerid", async () => {
  const harness = createHarness({
    response: {
      "@odata.context": "https://example.crm.dynamics.com/api/data/v9.2/$metadata#contacts(fullname,_parentcustomerid_value,parentcustomerid_account())",
      value: [{ fullname: "Test Contact", _parentcustomerid_value: "account-guid" }],
    },
  });
  const { result } = await harness.runQuery("SELECT fullname, parentcustomerid FROM contact");
  assert.equal(result.ok, true);
  assert.deepEqual(Array.from(result.columns), ["fullname", "parentcustomerid"]);
  assert.equal(result.rows[0].parentcustomerid, "account-guid");
  assert.equal(Object.hasOwn(result.rows[0], "_parentcustomerid_value"), false);
});

test("JOIN alias keys are normalized and merged into result columns", async () => {
  const harness = createHarness({
    response: {
      "@odata.context": "https://example.crm.dynamics.com/api/data/v9.2/$metadata#contacts(fullname,contactid)",
      value: [{ fullname: "Test Contact", contactid: "contact-guid", a_x002e_name: "Contoso" }],
    },
  });
  const { result } = await harness.runQuery(
    "SELECT c.fullname, a.name FROM contact AS c LEFT JOIN account AS a ON c.accountid = a.accountid",
  );
  assert.equal(result.ok, true);
  assert.ok(Array.from(result.columns).includes("a.name"));
  assert.equal(result.rows[0]["a.name"], "Contoso");
});

test("Dataverse annotation properties are omitted from result columns and rows", async () => {
  const harness = createHarness({
    response: {
      "@odata.context": "https://example.crm.dynamics.com/api/data/v9.2/$metadata#contacts(fullname,contactid)",
      value: [{
        fullname: "Test Contact",
        contactid: "contact-guid",
        "_parentcustomerid_value@Microsoft.Dynamics.CRM.lookuplogicalname": "account",
        "fullname@OData.Community.Display.V1.FormattedValue": "Test Contact",
      }],
    },
  });
  const { result } = await harness.runQuery("SELECT fullname FROM contact");
  assert.equal(result.ok, true);
  assert.deepEqual(Array.from(result.columns), ["fullname"]);
  assert.equal(Object.keys(result.rows[0]).some((key) => key.includes("@")), false);
  assert.deepEqual(Object.keys(result.rows[0]), ["fullname"]);
});

test("projection mismatch fails closed instead of returning misleading results", async () => {
  const harness = createHarness({
    response: {
      "@odata.context": "https://example.crm.dynamics.com/api/data/v9.2/$metadata#contacts(fullname,contactid)",
      value: [{ fullname: "Test Contact", contactid: "contact-guid" }],
    },
  });
  const { result } = await harness.runQuery("SELECT accountid, accountidname FROM contact");
  assert.equal(result.ok, false);
  assert.match(result.error, /does not match the SELECT projection/i);
  assert.match(result.error, /accountidname/i);
});

test("native SQL safely removes unexpected endpoint columns from a verified explicit projection", async () => {
  const harness = createHarness({
    response: {
      "@odata.context": "https://example.crm.dynamics.com/api/data/v9.2/$metadata#systemusers(systemuserid,fullname,ownerid)",
      value: [{
        systemuserid: "user-guid",
        fullname: "Dataverse Test User",
        ownerid: "unexpected-owner-value",
      }],
    },
  });
  const { result } = await harness.runQuery(
    "SELECT TOP 100 systemuserid, fullname FROM systemuser WHERE fullname LIKE '%dataverse%'",
  );
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(Array.from(result.columns), ["systemuserid", "fullname"]);
  assert.deepEqual(Object.keys(result.rows[0]), ["systemuserid", "fullname"]);
  assert.equal(result.rows[0].fullname, "Dataverse Test User");
  assert.equal(Object.hasOwn(result.rows[0], "ownerid"), false);
});

test("non-SELECT statements are rejected before any Dataverse request", async () => {
  const harness = createHarness({ response: { value: [] } });
  const { result, requestedUrl } = await harness.runQuery("DELETE FROM contact");
  assert.equal(result.ok, false);
  assert.match(result.error, /SELECT statements only/i);
  assert.equal(requestedUrl, undefined);
});

test("multiple SQL statements are rejected", async () => {
  const harness = createHarness({ response: { value: [] } });
  const { result, requestedUrl } = await harness.runQuery("SELECT fullname FROM contact; SELECT name FROM account");
  assert.equal(result.ok, false);
  assert.match(result.error, /one SELECT statement at a time/i);
  assert.equal(requestedUrl, undefined);
});


test("nested OData expansions do not leak nested fields into the top-level projection", async () => {
  const harness = createHarness({
    response: {
      "@odata.context": "https://example.crm.dynamics.com/api/data/v9.2/$metadata#contacts(fullname,_parentcustomerid_value,parentcustomerid_account(accountid,name))",
      value: [{ fullname: "Nested Expansion Contact", _parentcustomerid_value: "account-guid" }],
    },
  });
  const { result } = await harness.runQuery("SELECT fullname, parentcustomerid FROM contact");
  assert.equal(result.ok, true);
  assert.deepEqual(Array.from(result.columns), ["fullname", "parentcustomerid"]);
  assert.equal(result.rows[0].parentcustomerid, "account-guid");
  assert.equal(result.columns.includes("accountid"), false);
  assert.equal(result.columns.includes("name"), false);
});

test("simple projection fails closed when Dataverse omits verifiable OData context", async () => {
  const harness = createHarness({
    response: {
      value: [{ fullname: "Unverified Contact", contactid: "contact-guid" }],
    },
  });
  const { result } = await harness.runQuery("SELECT fullname FROM contact");
  assert.equal(result.ok, false);
  assert.match(result.error, /verifiable SQL result projection/i);
});

test("empty SELECT input is rejected before any Dataverse request", async () => {
  const harness = createHarness({ response: { value: [] } });
  const { result, requestedUrl } = await harness.runQuery("   ");
  assert.equal(result.ok, false);
  assert.match(result.error, /Enter a SELECT query/i);
  assert.equal(requestedUrl, undefined);
});

test("oversized query is rejected before any Dataverse request", async () => {
  const harness = createHarness({ response: { value: [] } });
  const { result, requestedUrl } = await harness.runQuery("SELECT " + "x".repeat(100001));
  assert.equal(result.ok, false);
  assert.match(result.error, /100,000 character limit/i);
  assert.equal(requestedUrl, undefined);
});

test("missing table entity-set metadata returns a clear error", async () => {
  const harness = createHarness({
    response: { value: [] },
    entityMetadata: { contact: { missing: true } },
  });
  const { result, requestedUrl } = await harness.runQuery("SELECT fullname FROM contact");
  assert.equal(result.ok, false);
  assert.match(result.error, /entity set for contact/i);
  assert.equal(requestedUrl, undefined);
});

test("Dataverse HTTP errors are surfaced instead of being treated as empty results", async () => {
  const harness = createHarness({
    fetchResponse: {
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => ({ error: { message: "SQL projection is unsupported" } }),
    },
  });
  const { result } = await harness.runQuery("SELECT fullname FROM contact");
  assert.equal(result.ok, false);
  assert.match(result.error, /SQL projection is unsupported/i);
});

test("invalid SELECT response metadata is not silently accepted", async () => {
  const harness = createHarness({
    response: {
      "@odata.context": "https://example.crm.dynamics.com/api/data/v9.2/$metadata#contacts()",
      value: [],
    },
  });
  const { result } = await harness.runQuery("SELECT fullname FROM contact");
  assert.equal(result.ok, false);
  assert.match(result.error, /verifiable SQL result projection/i);
});

test("DISTINCT and TOP projections with WHERE and ORDER BY validate correctly", async () => {
  const harness = createHarness({
    response: {
      "@odata.context": "https://example.crm.dynamics.com/api/data/v9.2/$metadata#contacts(fullname,contactid)",
      value: [{ fullname: "Ada Lovelace", contactid: "contact-guid" }],
    },
  });
  const { result } = await harness.runQuery(
    "SELECT DISTINCT TOP 10 fullname FROM contact WHERE fullname IS NOT NULL ORDER BY fullname",
  );
  assert.equal(result.ok, true);
  assert.deepEqual(Array.from(result.columns), ["fullname"]);
});

test("case-insensitive SQL projection validation accepts differently cased OData columns", async () => {
  const harness = createHarness({
    response: {
      "@odata.context": "https://example.crm.dynamics.com/api/data/v9.2/$metadata#contacts(FullName,ContactId)",
      value: [{ FullName: "Ada Lovelace", ContactId: "contact-guid" }],
    },
  });
  const { result } = await harness.runQuery("SELECT fullname FROM contact");
  assert.equal(result.ok, true);
  assert.ok(Array.from(result.columns).some((column) => column.toLowerCase() === "fullname"));
});

test("qualified projections are left to Dataverse rather than guessed by the simple projection parser", async () => {
  const harness = createHarness({
    response: {
      "@odata.context": "https://example.crm.dynamics.com/api/data/v9.2/$metadata#contacts(fullname,contactid)",
      value: [{ fullname: "Ada Lovelace", contactid: "contact-guid" }],
    },
  });
  const { result } = await harness.runQuery("SELECT c.fullname FROM contact AS c");
  assert.equal(result.ok, true);
  assert.ok(Array.from(result.columns).includes("fullname"));
});

test("empty result sets still require matching projection metadata", async () => {
  const harness = createHarness({
    response: {
      "@odata.context": "https://example.crm.dynamics.com/api/data/v9.2/$metadata#contacts(contactid)",
      value: [],
    },
  });
  const { result } = await harness.runQuery("SELECT fullname FROM contact WHERE fullname = 'no-match'");
  assert.equal(result.ok, false);
  assert.match(result.error, /does not match the SELECT projection/i);
});

test("alias normalization preserves ordinary fields while dropping annotations", async () => {
  const harness = createHarness({
    response: {
      "@odata.context": "https://example.crm.dynamics.com/api/data/v9.2/$metadata#contacts(fullname,contactid)",
      value: [{
        fullname: "Ada Lovelace",
        contactid: "contact-guid",
        a_x002e_name: "Contoso",
        "a_x002e_name@Microsoft.Dynamics.CRM.lookuplogicalname": "account",
      }],
    },
  });
  const { result } = await harness.runQuery(
    "SELECT c.fullname, a.name FROM contact AS c LEFT JOIN account AS a ON c.accountid = a.accountid",
  );
  assert.equal(result.ok, true);
  assert.equal(result.rows[0]["a.name"], "Contoso");
  assert.equal(Object.keys(result.rows[0]).some((key) => key.includes("@")), false);
});
test("SELECT * exposes the columns Dataverse reports in response metadata", async () => {
  const harness = createHarness({
    response: {
      "@odata.context": "https://example.crm.dynamics.com/api/data/v9.2/$metadata#contacts(contactid,fullname,_parentcustomerid_value)",
      value: [{
        contactid: "contact-guid",
        fullname: "Test Contact",
        _parentcustomerid_value: null,
        "fullname@OData.Community.Display.V1.FormattedValue": "Test Contact",
      }],
    },
  });
  const { result, requestedUrl } = await harness.runQuery("SELECT * FROM contact");
  assert.equal(result.ok, true, result.error);
  assert.ok(Array.from(result.columns).includes("contactid"));
  assert.ok(Array.from(result.columns).includes("fullname"));
  assert.equal(Object.keys(result.rows[0]).some((key) => key.includes("@")), false);
  assert.match(requestedUrl, /sql=SELECT\+\*\+FROM\+contact/i);
});

test("SELECT * still fails closed if Dataverse provides no verifiable projection metadata", async () => {
  const harness = createHarness({ response: { value: [{ fullname: "Unverified" }] } });
  const { result } = await harness.runQuery("SELECT * FROM contact");
  assert.equal(result.ok, false);
  assert.match(result.error, /verifiable SQL result projection/i);
});


test("FetchXML action runs read-only queries and filters annotation fields", async () => {
  const harness = createHarness({
    fetchXmlResponse: { entities: [{
      fullname: "Ada Lovelace",
      "a_name": "Contoso",
      "fullname@OData.Community.Display.V1.FormattedValue": "Ada Lovelace"
    }] }
  });
  const { result } = await harness.runAction("queryFetchXml", {
    tableName: "contact",
    fetchXml: '<fetch><entity name="contact"><attribute name="fullname"/></entity></fetch>'
  });
  assert.equal(result.ok, true);
  assert.deepEqual(Array.from(result.columns), ["fullname", "a_name"]);
  assert.equal(result.rows[0].fullname, "Ada Lovelace");
  assert.equal(Object.keys(result.rows[0]).some(key => key.includes("@")), false);
});

test("FetchXML action applies SQL OFFSET/FETCH after paging", async () => {
  const firstPage = Array.from({ length: 500 }, (_, index) => ({ contactid: "contact-" + index }));
  const cookie = '<cookie pagenumber="2" pagingcookie="%253ccookie%2520page%253d%25221%2522%253e%253ccontactid%2520last%253d%2522abc%2522%252f%253e%253c%252fcookie%253e" istracking="False" />';
  const secondPage = Array.from({ length: 100 }, (_, index) => ({ contactid: "contact-" + (500 + index) }));
  const harness = createHarness({ fetchXmlResponse: [
    { entities: firstPage, fetchXmlPagingCookie: cookie },
    { entities: secondPage }
  ] });
  const { result } = await harness.runAction("queryFetchXml", {
    tableName: "contact",
    fetchXml: '<fetch><entity name="contact"><attribute name="contactid"/></entity></fetch>',
    offset: 500,
    limit: 50
  });
  assert.equal(result.ok, true);
  assert.equal(result.rows.length, 50);
  assert.equal(result.rows[0].contactid, "contact-500");
  assert.equal(result.rows[49].contactid, "contact-549");
  assert.equal(result.moreRecords, false);
});

test("FetchXML action rejects aggregate and mutation-like payloads", async () => {
  const harness = createHarness({ fetchXmlResponse: { entities: [] } });
  const aggregate = await harness.runAction("queryFetchXml", {
    tableName: "contact",
    fetchXml: '<fetch aggregate="true"><entity name="contact"/></fetch>'
  });
  assert.equal(aggregate.result.ok, true);
  const mutation = await harness.runAction("queryFetchXml", {
    tableName: "contact",
    fetchXml: '<fetch><entity name="contact"><delete/></entity></fetch>'
  });
  assert.equal(mutation.result.ok, false);
});

test("FetchXML action rejects a mismatched base entity before Dataverse execution", async () => {
  const harness = createHarness({ fetchXmlResponse: { entities: [] } });
  const { result } = await harness.runAction("queryFetchXml", {
    tableName: "contact",
    fetchXml: '<fetch><entity name="account"><attribute name="name"/></entity></fetch>'
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /does not match/i);
});

test("FetchXML action follows paging cookies and returns multiple pages", async () => {
  const firstPage = Array.from({ length: 500 }, (_, index) => ({ contactid: "contact-" + index }));
  const cookie = '<cookie pagenumber="2" pagingcookie="%253ccookie%2520page%253d%25221%2522%253e%253ccontactid%2520last%253d%2522abc%2522%252f%253e%253c%252fcookie%253e" istracking="False" />';
  const harness = createHarness({
    fetchXmlResponse: [
      { entities: firstPage, fetchXmlPagingCookie: cookie },
      { entities: [{ contactid: "contact-final" }] }
    ]
  });
  const { result } = await harness.runAction("queryFetchXml", {
    tableName: "contact",
    fetchXml: '<fetch><entity name="contact"><attribute name="contactid"/></entity></fetch>'
  });
  assert.equal(result.ok, true);
  assert.equal(result.pagesFetched, 2);
  assert.equal(result.rows.length, 501);
  assert.match(harness.requestedFetchXml[0].query, /count="500"/);
  assert.match(harness.requestedFetchXml[1].query, /page="2"/);
  assert.match(harness.requestedFetchXml[1].query, /paging-cookie="&lt;cookie/);
});
