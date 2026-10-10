(() => {
  "use strict";
  if (window.DevLensSqlStudioView) return;

  const esc = value => String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
  }[ch]));
  const API_BASE = "http://127.0.0.1:32146";
  let state = {
    sql: "SELECT TOP 100 accountid, name, accountnumber, createdon\nFROM account\nORDER BY createdon DESC;",
    running: false,
    results: null,
    error: "",
    agentStatus: "Not checked",
    durationMs: 0,
    lastQuery: ""
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
          .ss-empty{color:#94a3b8;padding:16px}
          .ss-meta{font-size:12px;color:#94a3b8}
          .ss-pill{border:1px solid #166534;color:#86efac;border-radius:999px;padding:2px 8px}
        </style>
        <div class="ss-top"><div class="ss-title">Query Studio</div><span class="ss-pill">READ ONLY</span><button class="ss-btn" data-act="health">Check agent</button><button class="ss-btn primary" data-act="execute" ${state.running ? "disabled" : ""}>Execute (Ctrl+Enter)</button><button class="ss-btn" data-act="clear" ${state.running ? "disabled" : ""}>Clear results</button></div>
        <div class="ss-status">Local SQL4CDS agent: ${esc(state.agentStatus)} · ${state.results ? `${state.results.rows?.length || 0} rows · ${state.durationMs} ms` : "No results yet"}</div>
        <textarea class="ss-editor" spellcheck="false" aria-label="SQL query editor">${esc(state.sql)}</textarea>
        <div class="ss-meta">SELECT-only mode. SQL is sent only when you press Execute. No credentials are stored in the extension.</div>
        ${state.error ? `<div class="ss-status ss-error">${esc(state.error)}</div>` : ""}
        ${state.results ? `<div class="ss-meta">Query: ${esc(state.lastQuery)} · ${state.results.truncated ? "Results limited" : "Result set complete"} </div>` : ""}
        ${state.results ? `<div class="ss-results"><table><thead><tr>${columns.map(c=>`<th title="${esc(c)}">${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows.map(row=>`<tr>${columns.map(c=>`<td title="${esc(row[c])}">${esc(formatValue(row[c]))}</td>`).join("")}</tr>`).join("")}</tbody></table>${rows.length ? "" : '<div class="ss-empty">The query returned no rows.</div>'}</div><div class="ss-top"><button class="ss-btn" data-act="csv">Export CSV</button><button class="ss-btn" data-act="copy">Copy JSON</button></div>` : ""}
      </div>`;
    host.querySelector("textarea").value = state.sql;
    host.querySelector("textarea").addEventListener("input", e => state.sql = e.target.value);
    host.querySelectorAll("[data-act]").forEach(btn => btn.addEventListener("click", () => void act(btn.dataset.act)));
    host.querySelector("textarea").addEventListener("keydown", e => {
      if (e.ctrlKey && e.key === "Enter") { e.preventDefault(); void act("execute"); }
    });
  }

  function formatValue(value) {
    if (value === null || value === undefined) return "NULL";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  }

  async function health() {
    try {
      const response = await fetch(`${API_BASE}/health`, { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      state.agentStatus = payload.authenticated ? "Connected · authenticated" : "Running · authentication not configured";
      if (payload.version) state.agentStatus += ` · v${payload.version}`;
      state.error = "";
    } catch {
      state.agentStatus = "Not running";
      state.error = "The local SQL4CDS agent could not be reached. Start the companion at http://127.0.0.1:32146.";
    }
    render();
  }

  async function execute() {
    if (state.running) return;
    if (!state.sql.trim()) { state.error = "Enter a SELECT query first."; render(); return; }
    state.running = true; state.error = ""; state.results = null; state.lastQuery = state.sql;
    const started = performance.now(); render();
    try {
      const response = await fetch(`${API_BASE}/api/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sql: state.sql, maxRows: 5000 })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Query failed (HTTP ${response.status})`);
      state.results = payload;
      state.durationMs = Math.round(performance.now() - started);
    } catch (e) {
      state.error = e.message || String(e);
      state.durationMs = Math.round(performance.now() - started);
    } finally {
      state.running = false;
      render();
    }
  }

  async function act(action) {
    if (action === "health") return health();
    if (action === "execute") return execute();
    if (action === "clear") { state.results = null; state.error = ""; render(); return; }
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
      state.agentStatus = "Results copied";
      render();
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
