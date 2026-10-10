(() => {
  "use strict";
  if (window.DevLensSqlStudioView) return;

  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  }[ch]));
  // Native Dataverse SQL endpoint: browser session in the active Dynamics page context.
  const state = {
    sql: "SELECT TOP 100 accountid, name, accountnumber, createdon\nFROM account\nORDER BY createdon DESC;",
    running: false,
    results: null,
    error: "",
    status: "Ready",
    durationMs: 0,
    lastQuery: "",
    ctx: null
  };
  let host = null;

  function render() {
    if (!host) return;
    const rows = state.results?.rows || [];
    const columns = state.results?.columns || [];
    host.innerHTML = `
      <div class="sqlstudio">
        <style>
          .sqlstudio{color:#e2e8f0;font:13px/1.45 system-ui;display:flex;flex-direction:column;gap:10px}
          .ss-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
          .ss-title{font-size:18px;font-weight:700;margin-right:auto;color:#bfdbfe}
          .ss-btn{border:1px solid #475569;background:#1e293b;color:#fff;padding:7px 11px;border-radius:6px;cursor:pointer}
          .ss-btn.primary{background:#2563eb;border-color:#3b82f6}
          .ss-btn:disabled{opacity:.45;cursor:not-allowed}
          .ss-status{padding:7px 10px;border:1px solid #334155;border-radius:6px;background:#0f172a;color:#94a3b8}
          .ss-error{border-color:#7f1d1d;color:#fecaca;background:#450a0a;white-space:pre-wrap}
          .ss-editor{width:100%;min-height:210px;box-sizing:border-box;resize:vertical;background:#020617;color:#e2e8f0;border:1px solid #475569;border-radius:7px;padding:10px;font:12px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace;tab-size:2}
          .ss-results{border:1px solid #334155;border-radius:7px;overflow:auto;max-height:42vh;background:#020617}
          .ss-results table{border-collapse:collapse;width:max-content;min-width:100%;font-size:12px}
          .ss-results th,.ss-results td{border-bottom:1px solid #334155;border-right:1px solid #1e293b;padding:6px 9px;text-align:left;white-space:nowrap;max-width:420px;overflow:hidden;text-overflow:ellipsis}
          .ss-results th{position:sticky;top:0;background:#1e293b;color:#bfdbfe}
          .ss-empty{color:#94a3b8;padding:16px}.ss-meta{font-size:12px;color:#94a3b8}
          .ss-pill{border:1px solid #166534;color:#86efac;border-radius:999px;padding:2px 8px}
        </style>
        <div class="ss-top"><div class="ss-title">Query Studio</div><span class="ss-pill">READ ONLY</span><button class="ss-btn" data-act="context">Detect environment</button><button class="ss-btn primary" data-act="execute" ${state.running ? "disabled" : ""}>Execute (Ctrl+Enter)</button><button class="ss-btn" data-act="clear">Clear results</button></div>
        <div class="ss-status">Execution: ${esc(state.status)} ${state.ctx ? " · " + esc(state.ctx.clientUrl) : ""} · ${state.results ? `${state.results.rows?.length || 0} rows · ${state.durationMs} ms` : "No results yet"}</div>
        <textarea class="ss-editor" spellcheck="false" aria-label="SQL query editor">${esc(state.sql)}</textarea>
        <div class="ss-meta">Native Dataverse read-only SQL endpoint · one SELECT statement · columns must be named explicitly · no SQL4CDS-only features such as CTEs or DECLARE. Query runs as your current Dynamics user.</div>
        ${state.error ? `<div class="ss-status ss-error">${esc(state.error)}</div>` : ""}
        ${state.results ? `<div class="ss-meta">Query: ${esc(state.lastQuery)} · ${state.results.truncated ? "Results limited" : "Server response received"}</div>` : ""}
        ${state.results ? `<div class="ss-results"><table><thead><tr>${columns.map(c=>`<th title="${esc(c)}">${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows.map(row=>`<tr>${columns.map(c=>`<td title="${esc(row[c])}">${esc(formatValue(row[c]))}</td>`).join("")}</tr>`).join("")}</tbody></table>${rows.length ? "" : '<div class="ss-empty">The query returned no rows.</div>'}</div><div class="ss-top"><button class="ss-btn" data-act="csv">Export CSV</button><button class="ss-btn" data-act="copy">Copy JSON</button></div>` : ""}
      </div>`;
    const editor = host.querySelector("textarea");
    editor.value = state.sql;
    editor.addEventListener("input", e => state.sql = e.target.value);
    editor.addEventListener("keydown", e => {
      if (e.ctrlKey && e.key === "Enter") { e.preventDefault(); void execute(); }
    });
    host.querySelectorAll("[data-act]").forEach(btn => btn.addEventListener("click", () => void act(btn.dataset.act)));
  }

  function formatValue(value) {
    if (value === null || value === undefined) return "NULL";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  async function activeContext() {
    const api = window.D365AnalyzerApi;
    if (!api?.send) throw new Error("DevLens Dataverse bridge is not available. Reload the Dynamics tab.");
    const response = await api.send("shellContext");
    if (!response?.ok) throw new Error(response?.error || "Could not identify current Dataverse environment.");
    return response;
  }

  async function detectContext() {
    state.status = "Detecting environment…";
    state.error = "";
    render();
    try {
      const response = await activeContext();
      // The shell context normally contains clientUrl; fail clearly if the environment is unavailable.
      const clientUrl = response.clientUrl || response.data?.clientUrl;
      if (!clientUrl) throw new Error("Environment URL was not returned by DevLens context.");
      state.ctx = { ...response, clientUrl };
      state.status = "Environment detected";
    } catch (e) {
      state.error = e.message || String(e);
      state.status = "Context unavailable";
    }
    render();
  }

  async function execute() {
    if (state.running) return;
    if (!state.sql.trim()) { state.error = "Enter a SELECT query first."; render(); return; }
    state.running = true; state.error = ""; state.results = null; state.lastQuery = state.sql; state.status = "Executing…";
    const started = performance.now(); render();
    try {
      if (!state.ctx?.clientUrl) {
        const response = await activeContext();
        const clientUrl = response.clientUrl || response.data?.clientUrl;
        if (!clientUrl) throw new Error("Environment URL unavailable. Use Detect environment and retry.");
        state.ctx = { ...response, clientUrl };
      }
      const { clientUrl } = state.ctx;
      const query = state.sql.trim();
      // Client-side guard is UX only; Dataverse enforces SELECT-only at the endpoint.
      if (!/^SELECT\b/i.test(query) || /;\s*\S/.test(query.replace(/;\s*$/, ""))) {
        throw new Error("This endpoint accepts a single SELECT statement only.");
      }
      if (/\b(DECLARE|INSERT|UPDATE|DELETE|MERGE|EXEC|EXECUTE|ALTER|DROP|CREATE|WITH)\b/i.test(query)) {
        throw new Error("Unsupported for the native endpoint: use one SELECT without DECLARE or CTEs.");
      }
      const url = new URL("/api/data/v9.2/accounts", clientUrl);
      url.searchParams.set("sql", query);
      const response = await fetch(url.toString(), {
        method: "GET",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "OData-MaxVersion": "4.0",
          "OData-Version": "4.0",
          Prefer: 'odata.include-annotations="*"'
        },
        cache: "no-store"
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error?.message || `Dataverse SQL request failed (${response.status}).`);
      const data = Array.isArray(payload.value) ? payload.value : [];
      const excluded = new Set(["@odata.etag"]);
      const cols = [...new Set(data.flatMap(row => Object.keys(row).filter(k => !k.startsWith("@") && !k.endsWith("@OData.Community.Display.V1.AttributeName") && !excluded.has(k))))];
      state.results = {
        columns: cols,
        rows: data.map(row => Object.fromEntries(cols.map(key => [key, row[key] ?? null]))),
        truncated: false
      };
      state.status = "Query completed";
      state.durationMs = Math.round(performance.now() - started);
    } catch (e) {
      state.error = e.message || String(e);
      state.status = "Query failed";
      state.durationMs = Math.round(performance.now() - started);
    } finally {
      state.running = false;
      render();
    }
  }

  async function act(action) {
    if (action === "context") return detectContext();
    if (action === "execute") return execute();
    if (action === "clear") { state.results = null; state.error = ""; state.status = "Ready"; render(); return; }
    if (action === "csv") {
      const columns = state.results?.columns || [];
      const rows = state.results?.rows || [];
      const csv = [columns, ...rows.map(row => columns.map(c => row[c]))]
        .map(row => row.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
        .join("\r\n");
      download("devlens-query-results.csv", csv, "text/csv;charset=utf-8");
    }
    if (action === "copy") {
      await navigator.clipboard.writeText(JSON.stringify(state.results, null, 2));
      state.status = "Results copied"; render();
    }
  }

  function download(filename, content, type) {
    const blob = new Blob([content], {type});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  }

  window.DevLensSqlStudioView = {
    renderInto(container) { host = container; render(); },
    dispose() { host = null; },
    isAvailable() { return true; }
  };
})();
