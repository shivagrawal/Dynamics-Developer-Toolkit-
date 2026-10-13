import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const resultNormalizer = require("../../sqlstudio/js/sql-result-normalizer.js");

const source = await readFile(new URL("../../ui/sql-studio-view.js", import.meta.url), "utf8");

function createHost() {
  const editor = {
    value: "",
    selectionStart: 0,
    selectionEnd: 0,
    addEventListener(type, handler) { if (type === "input") this.onInput = handler; },
    getAttribute() { return null; },
    focus() {},
    setSelectionRange() {}
  };
  const root = { activeElement: null };
  const host = {
    _html: "",
    _buttons: [],
    get innerHTML() { return this._html; },
    set innerHTML(value) {
      this._html = value;
      this._buttons = [...value.matchAll(/data-act="([^"]+)"/g)].map(match => ({
        dataset: { act: match[1] },
        disabled: /\bdisabled\b/.test(value.slice(match.index, value.indexOf(">", match.index))),
        addEventListener(type, handler) { if (type === "click") this.onClick = handler; },
        getAttribute(name) { return name === "data-act" ? this.dataset.act : null; },
        focus() { root.activeElement = this; },
        click() { root.activeElement = this; if (this.onClick) this.onClick(); }
      }));
    },
    querySelector(selector) {
      if (selector === "textarea") return editor;
      const action = /\[data-act="([^"]+)"\]/.exec(selector)?.[1];
      return action ? this._buttons.find(button => button.dataset.act === action) || null : null;
    },
    querySelectorAll(selector) {
      if (selector === "[data-act]") return this._buttons;
      return [];
    },
    getRootNode() { return root; },
    contains(element) { return element === editor || this._buttons.includes(element); }
  };
  return host;
}


function installRouteDecisionMock(window) {
  const api = window.D365AnalyzerApi;
  if (!api || typeof api.send !== "function" || api.__routeDecisionMockInstalled) return;
  api.__routeDecisionMockInstalled = true;
  const send = api.send.bind(api);
  api.send = async (action, payload) => {
    if (action === "queryExecute") {
      const sql = String(payload?.sql || "");
      const securitySurface = /\\b(?:audit|systemuserroles|roleprivileges|privilegeobjecttypecodes|systemuser|businessunit)\\b/i.test(sql);
      if (securitySurface || !/\\bOFFSET\\b/i.test(sql)) return send("querySql", payload);
      const plan = window.DevLensSqlEngine?.plan?.(sql) || {
        table: "contact", joins: [], columns: [{ column: "fullname" }],
        offset: 5, fetch: 5, hasOffset: true, alias: "c", orderBy: []
      };
      const metadata = { entities: {} };
      for (const logicalName of [...new Set([plan.table, ...(plan.joins || []).map(join => join.table)])]) {
        const response = await send("schemaTable", { logicalName });
        if (!response?.ok || !response.data) return response;
        metadata.entities[logicalName] = {
          logicalName: response.data.logicalName, entitySetName: response.data.entitySetName,
          primaryIdAttribute: response.data.primaryIdAttribute,
          columns: (response.data.columns || []).map(column => ({
            logicalName: column.logicalName, attributeType: column.attributeType,
            queryable: column.validForRead !== false && String(column.attributeType || "").toLowerCase() !== "virtual"
          }))
        };
      }
      const compiled = window.DevLensSqlEngine.compile(plan, metadata);
      const response = await send("queryFetchXml", { tableName: plan.table, fetchXml: compiled.fetchXml, offset: plan.offset, limit: plan.fetch });
      if (!response?.ok) return response;
      const projections = compiled.resultColumns || plan.columns.map(column => ({ label: column.alias || column.column, key: column.alias || column.column }));
      return {
        ...response,
        columns: projections.map(projection => ({ name: projection.label, label: projection.label, sourceKey: projection.label })),
        rows: (response.rows || []).map(row => Object.fromEntries(projections.map(projection => {
          const key = Object.keys(row).find(candidate => candidate.toLowerCase() === projection.key.toLowerCase());
          return [projection.label, key ? row[key] : null];
        }))),
        provider: response.provider || "dataverse-fetchxml-js-engine"
      };
    }
    if (action === "queryRouteDecision") return { ok: false, error: "UI must not request a separate route decision." };
    return send(action, payload);
  };
}

function rowCount(html) {
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(html)?.[1] || "";
  return (body.match(/<tr>/g) || []).length;
}

async function click(host, action) {
  const button = host._buttons.find(item => item.dataset.act === action);
  assert.ok(button, "Expected action button: " + action);
  button.click();
  await new Promise(resolve => setTimeout(resolve, 0));
}

test("Query Studio paginates large result sets without losing exportable results or metadata", async () => {
  const rows = Array.from({ length: 250 }, (_, index) => ({
    id: index + 1,
    name: ([
      "=1+1",
      "\t=2+2",
      "+cmd|' /C calc'!A0",
      "-2+3",
      "@SUM(A1:A2)"
    ])[index] ?? "Row " + (index + 1)
  }));
  const window = {
    DevLensSqlResultNormalizer: resultNormalizer,
    D365AnalyzerApi: {
      send: async action => {
        assert.equal(action, "querySql");
        return {
          ok: true,
          columns: ["id", "name"],
          rows,
          currentUser: { id: "test-user", name: "QA User" },
          clientUrl: "https://example.crm.dynamics.com",
          environmentId: "qa-environment",
          provider: "dataverse-security-query-adapter",
          compatibilityMode: "user-roles",
          truncated: true,
          warning: "Results may be incomplete; refine the query."
        };
      }
    }
  };
  const host = createHost();
  let downloadedContent = "";
  class FakeBlob {
    constructor(parts) { this.parts = parts; }
  }
  const context = {
    window,
    document: { activeElement: null, createElement: () => ({ click() {} }) },
    performance: { now: () => 1 },
    Blob: FakeBlob,
    URL: {
      createObjectURL: blob => { downloadedContent = blob.parts.join(""); return "blob:query-results"; },
      revokeObjectURL() {}
    },
    console
  };
  installRouteDecisionMock(window);
  vm.runInNewContext(source, context, { filename: "sql-studio-view.js" });
  window.DevLensSqlStudioView.renderInto(host);
  assert.match(host.innerHTML, />Execute<\/button>/);
  assert.match(host.innerHTML, /security\/audit query shapes use the dedicated read-only adapter/);

  await click(host, "execute");
  assert.equal(rowCount(host.innerHTML), 100);
  assert.match(host.innerHTML, /Rows 1–100 of 250/);
  assert.match(host.innerHTML, /Page 1 of 3/);
  assert.match(host.innerHTML, /Results may be incomplete; refine the query\./);
  assert.match(host.innerHTML, /dataverse-security-query-adapter/);

  await click(host, "nextPage");
  assert.equal(rowCount(host.innerHTML), 100);
  assert.match(host.innerHTML, /Rows 101–200 of 250/);
  assert.match(host.innerHTML, /Page 2 of 3/);
  assert.match(host.innerHTML, />Row 101</);
  assert.equal(host.getRootNode().activeElement?.dataset.act, "nextPage", "Keyboard focus should stay on the active pagination control.");

  await click(host, "nextPage");
  assert.equal(rowCount(host.innerHTML), 50);
  assert.match(host.innerHTML, /Rows 201–250 of 250/);
  assert.match(host.innerHTML, /Page 3 of 3/);
  assert.match(host.innerHTML, /data-act="nextPage" disabled/);
  assert.equal(host.getRootNode().activeElement?.dataset.act, "prevPage", "Focus should move to the available page control when Next becomes disabled.");

  await click(host, "prevPage");
  assert.match(host.innerHTML, /Rows 101–200 of 250/);
  assert.equal(rowCount(host.innerHTML), 100);

  await click(host, "csv");
  assert.equal(downloadedContent.split("\r\n").length, 251, "CSV export must include all 250 rows, not only the current page.");
  assert.match(downloadedContent, /Row 250/);
  assert.match(downloadedContent, /"'=1\+1"/, "Formula-like values starting with equals must be neutralized.");
  assert.match(downloadedContent, /"'\t=2\+2"/, "Tab-prefixed formula-like values must be neutralized.");
  assert.ok(downloadedContent.includes(`"'+cmd|' /C calc'!A0"`), "Formula-like values starting with plus must be neutralized.");
  assert.match(downloadedContent, /"'-2\+3"/, "Formula-like values starting with minus must be neutralized.");
  assert.match(downloadedContent, /"'@SUM\(A1:A2\)"/, "Formula-like values starting with at-sign must be neutralized.");
});


test("single Execute does not implicitly reroute typed capability failures", async () => {
  const calls = [];
  const window = {
    DevLensSqlResultNormalizer: resultNormalizer,
    DevLensSqlEngine: {
      plan: () => ({ table: "contact", joins: [], columns: [{ column: "fullname" }], offset: 0, fetch: null, alias: "c" }),
      compile: () => ({
        fetchXml: '<fetch><entity name="contact"><attribute name="fullname"/></entity></fetch>',
        resultColumns: [{ label: "fullname", key: "fullname" }]
      })
    },
    D365AnalyzerApi: {
      send: async (action) => {
        calls.push(action);
        if (action === "querySql") return { ok: false, code: "PROVIDER_CAPABILITY_REJECTION", error: "typed capability" };
        if (action === "schemaTable") return { ok: true, data: {
          logicalName: "contact", entitySetName: "contacts", primaryIdAttribute: "contactid",
          columns: [{ logicalName: "fullname", attributeType: "string", validForRead: true }]
        } };
        if (action === "queryFetchXml") return {
          ok: true, provider: "FetchXML JS engine", columns: ["fullname"],
          rows: [{ fullname: "Ada" }], rowCount: 1, moreRecords: false,
          warning: "token=secret-value; see https://example.invalid/path?access_token=secret"
        };
        throw new Error("unexpected action " + action);
      }
    }
  };
  const host = createHost();
  const context = {
    window, document: { activeElement: null, createElement: () => ({ click() {} }) },
    performance: { now: () => 1 }, Blob: class { constructor(parts) { this.parts = parts; } },
    URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} }, console
  };
  installRouteDecisionMock(window);
  vm.runInNewContext(source, context, { filename: "sql-studio-view.js" });
  window.DevLensSqlStudioView.renderInto(host);
  assert.match(host.innerHTML, />Execute<\/button>/);
  assert.doesNotMatch(host.innerHTML, /Execute via FetchXML/);
  await click(host, "execute");
  assert.deepEqual(calls, ["querySql"]);
  assert.match(host.innerHTML, /could not complete the request/i);
  assert.doesNotMatch(host.innerHTML, /dataverse-fetchxml-js-engine/);
  assert.doesNotMatch(host.innerHTML, /token=\[redacted\]/);
  assert.doesNotMatch(host.innerHTML, /secret-value|access_token=secret|example\.invalid/);
});

test("single Execute routes OFFSET/FETCH directly through bounded FetchXML", async () => {
  const calls = [];
  const plan = {
    table: "contact", joins: [], columns: [{ column: "fullname" }], offset: 5, fetch: 5,
    hasOffset: true, alias: "c", orderBy: [{ column: "contactid", direction: "asc" }], groupBy: []
  };
  const window = {
    DevLensSqlResultNormalizer: resultNormalizer,
    DevLensSqlEngine: {
      plan: () => plan,
      compile: () => ({
        fetchXml: '<fetch page="2" count="5"><entity name="contact"><attribute name="fullname"/></entity></fetch>',
        resultColumns: [{ label: "fullname", key: "fullname" }]
      })
    },
    D365AnalyzerApi: {
      send: async (action, payload) => {
        calls.push({ action, payload });
        if (action === "schemaTable") return { ok: true, data: {
          logicalName: "contact", entitySetName: "contacts", primaryIdAttribute: "contactid",
          columns: [
            { logicalName: "contactid", attributeType: "uniqueidentifier", validForRead: true },
            { logicalName: "fullname", attributeType: "string", validForRead: true }
          ]
        } };
        if (action === "queryFetchXml") return {
          ok: true, provider: "FetchXML JS engine", columns: ["fullname"],
          rows: [{ fullname: "Page two" }], rowCount: 1, moreRecords: false
        };
        if (action === "querySql") throw new Error("OFFSET/FETCH must not be sent to native SQL");
        throw new Error("unexpected action " + action);
      }
    }
  };
  const host = createHost();
  const context = {
    window, document: { activeElement: null, createElement: () => ({ click() {} }) },
    performance: { now: () => 1 }, Blob: class { constructor(parts) { this.parts = parts; } },
    URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} }, console
  };
  installRouteDecisionMock(window);
  vm.runInNewContext(source, context, { filename: "sql-studio-view.js" });
  window.DevLensSqlStudioView.renderInto(host);
  const editor = host.querySelector("textarea");
  editor.value = "SELECT fullname FROM contact ORDER BY contactid OFFSET 5 ROWS FETCH NEXT 5 ROWS ONLY";
  editor.onInput({ target: editor });
  await click(host, "execute");
  assert.deepEqual(calls.map(call => call.action), ["schemaTable", "queryFetchXml"]);
  assert.equal(calls[1].payload.offset, 5);
  assert.equal(calls[1].payload.limit, 5);
  assert.match(calls[1].payload.fetchXml, /page="2" count="5"/);
  assert.match(host.innerHTML, /dataverse-fetchxml-js-engine/);
  assert.match(host.innerHTML, /Page two/);
});

test("OFFSET/FETCH routing never bypasses named security/audit queries", async () => {
  const calls = [];
  const window = {
    DevLensSqlResultNormalizer: resultNormalizer,
    DevLensSqlEngine: {
      plan: () => ({ hasOffset: true, table: "systemuserroles", joins: [], columns: [{ column: "systemuserid" }], offset: 0, fetch: 5, alias: "sur" })
    },
    D365AnalyzerApi: {
      send: async action => {
        calls.push(action);
        if (action === "querySql") return {
          ok: false, code: "UNSUPPORTED_SECURITY_SQL_SHAPE",
          error: "This security/audit SQL query does not match a supported read-only query shape."
        };
        throw new Error("security/audit OFFSET/FETCH must not call " + action);
      }
    }
  };
  const host = createHost();
  const context = {
    window, document: { activeElement: null, createElement: () => ({ click() {} }) },
    performance: { now: () => 1 }, Blob: class { constructor(parts) { this.parts = parts; } },
    URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} }, console
  };
  installRouteDecisionMock(window);
  vm.runInNewContext(source, context, { filename: "sql-studio-view.js" });
  window.DevLensSqlStudioView.renderInto(host);
  const editor = host.querySelector("textarea");
  editor.value = "SELECT systemuserid FROM systemuserroles ORDER BY systemuserid OFFSET 0 ROWS FETCH NEXT 5 ROWS ONLY";
  editor.onInput({ target: editor });
  await click(host, "execute");
  assert.deepEqual(calls, ["querySql"]);
  assert.doesNotMatch(host.innerHTML, /FetchXML compatibility route/);
});

test("single Execute does not fall back on authorization or generic provider errors", async () => {
  const calls = [];
  const window = {
    DevLensSqlResultNormalizer: resultNormalizer,
    D365AnalyzerApi: {
      send: async action => {
        calls.push(action);
        return { ok: false, code: "AUTHORIZATION", error: "Permission denied" };
      }
    }
  };
  const host = createHost();
  const context = {
    window, document: { activeElement: null, createElement: () => ({ click() {} }) },
    performance: { now: () => 1 }, Blob: class {}, URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} }, console
  };
  installRouteDecisionMock(window);
  vm.runInNewContext(source, context, { filename: "sql-studio-view.js" });
  window.DevLensSqlStudioView.renderInto(host);
  await click(host, "execute");
  assert.deepEqual(calls, ["querySql"]);
  assert.match(host.innerHTML, /permission to run this query/i);
});


test("single Execute never falls back for timeout, transport, throttling, metadata, or data failures", async () => {
  for (const code of ["TIMEOUT", "TRANSPORT", "THROTTLED", "METADATA", "DATAVERSE", "INTERNAL"]) {
    const calls = [];
    const window = {
      DevLensSqlResultNormalizer: resultNormalizer,
      D365AnalyzerApi: {
        send: async action => {
          calls.push(action);
          return { ok: false, code, error: "untrusted provider detail" };
        }
      }
    };
    const host = createHost();
    const context = {
      window, document: { activeElement: null, createElement: () => ({ click() {} }) },
      performance: { now: () => 1 }, Blob: class {},
      URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} }, console
    };
    installRouteDecisionMock(window);
    vm.runInNewContext(source, context, { filename: "sql-studio-view.js" });
    window.DevLensSqlStudioView.renderInto(host);
    await click(host, "execute");
    assert.deepEqual(calls, ["querySql"], code + " must not trigger provider fallback");
    assert.doesNotMatch(host.innerHTML, /untrusted provider detail/);
  }
});


test("typed capability responses never reroute named security/audit queries", async () => {
  const calls = [];
  const window = {
    DevLensSqlResultNormalizer: resultNormalizer,
    D365AnalyzerApi: {
      send: async action => {
        calls.push(action);
        return { ok: false, code: "PROVIDER_CAPABILITY_REJECTION", error: "typed capability" };
      }
    }
  };
  const host = createHost();
  const context = {
    window, document: { activeElement: null, createElement: () => ({ click() {} }) },
    performance: { now: () => 1 }, Blob: class {},
    URL: { createObjectURL: () => "blob:test", revokeObjectURL() {} }, console
  };
  installRouteDecisionMock(window);
  vm.runInNewContext(source, context, { filename: "sql-studio-view.js" });
  window.DevLensSqlStudioView.renderInto(host);
  const editor = host.querySelector("textarea");
  editor.value = "SELECT name FROM audit";
  editor.onInput?.({ target: editor });
  // The UI fallback guard is deliberately conservative; the background remains
  // authoritative for deciding whether this is one of the six approved shapes.
  await click(host, "execute");
  assert.deepEqual(calls, ["querySql"]);
  assert.match(host.innerHTML, /could not complete the request/i);
});
