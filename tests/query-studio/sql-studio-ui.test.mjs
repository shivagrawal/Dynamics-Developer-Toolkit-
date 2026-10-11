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
    addEventListener() {},
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
  vm.runInNewContext(source, context, { filename: "sql-studio-view.js" });
  window.DevLensSqlStudioView.renderInto(host);
  assert.match(host.innerHTML, />Execute SQL<\/button>/);
  assert.match(host.innerHTML, /security\/metadata query shapes use the JavaScript compatibility adapter/);

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


test("single Execute uses native SQL first and only falls back on typed capability rejection", async () => {
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
  vm.runInNewContext(source, context, { filename: "sql-studio-view.js" });
  window.DevLensSqlStudioView.renderInto(host);
  assert.match(host.innerHTML, />Execute<\/button>/);
  assert.doesNotMatch(host.innerHTML, /Execute via FetchXML/);
  await click(host, "execute");
  assert.deepEqual(calls, ["querySql", "schemaTable", "queryFetchXml"]);
  assert.match(host.innerHTML, /dataverse-fetchxml-js-engine/);
  assert.match(host.innerHTML, /token=\[redacted\]/);
  assert.doesNotMatch(host.innerHTML, /secret-value|access_token=secret|example\.invalid/);
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
  vm.runInNewContext(source, context, { filename: "sql-studio-view.js" });
  window.DevLensSqlStudioView.renderInto(host);
  await click(host, "execute");
  assert.deepEqual(calls, ["querySql"]);
  assert.match(host.innerHTML, /permission to run this query/i);
});
