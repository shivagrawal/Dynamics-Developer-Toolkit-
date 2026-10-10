import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const backgroundPath = path.resolve(here, "../../background.js");
const backgroundSource = fs.readFileSync(backgroundPath, "utf8");

function createHarness({ response, entityMetadata = {}, fetchResponse, metadataError } = {}) {
  let messageListener;
  let requestedUrl;
  const clientUrl = "https://example.crm.dynamics.com";
  const xrm = {
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
      if (fetchResponse) return fetchResponse;
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
  vm.runInNewContext(backgroundSource, sandbox, { filename: "background.js" });

  async function runQuery(sql) {
    assert.equal(typeof messageListener, "function", "background message listener was registered");
    let result;
    await new Promise((resolve, reject) => {
      const returned = messageListener(
        { type: "DEVLENS_ACTION", action: "querySql", payload: { sql } },
        { tab: { id: 1 } },
        (value) => { result = value; resolve(); },
      );
      if (returned !== true) reject(new Error("Expected asynchronous message response"));
    });
    return { result, requestedUrl };
  }
  return { runQuery };
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
  assert.deepEqual(Array.from(result.columns), ["fullname", "contactid"]);
  assert.equal(Object.keys(result.rows[0]).some((key) => key.includes("@")), false);
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
