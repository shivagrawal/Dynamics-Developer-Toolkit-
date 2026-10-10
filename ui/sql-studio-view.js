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
    ctx: null,
    schemaOpen: false,
    schemaLoading: false,
    schemaError: "",
    tablesLoaded: false,
    tables: [],
    tableFilter: "",
    selectedTable: "",
    tableMeta: null,
    columnsLoading: false,
    columnsError: "",
    columnFilter: "",
    selectedColumns: [],
    editorSelectionStart: -1,
    editorSelectionEnd: -1,
    pageIndex: 0,
    pageSize: 100
  };
  let host = null;

  function isQueryableColumn(column) {
    return column?.validForRead !== false && String(column?.attributeType || "").toLowerCase() !== "virtual";
  }

  function schemaExplorerHtml() {
    if (!state.schemaOpen) return "";
    const tableMatches = state.tables.filter(table =>
      [table.displayName, table.logicalName, table.schemaName].join(" ").toLowerCase().includes(state.tableFilter.toLowerCase())
    ).slice(0, 250);
    const tableRows = tableMatches.map(table =>
      '<button class="ss-schema-table ' + (state.selectedTable === table.logicalName ? 'selected' : '') +
      '" data-table="' + esc(table.logicalName) + '" title="' + esc(table.logicalName) + '">' +
      '<span class="ss-schema-table-name">' + esc(table.displayName || table.logicalName) + '</span>' +
      '<span class="ss-schema-table-logical">' + esc(table.logicalName) + '</span></button>'
    ).join("");
    const allColumns = (state.tableMeta?.columns || []).filter(isQueryableColumn);
    const visibleColumns = allColumns.filter(column =>
      [column.displayName, column.logicalName, column.schemaName, column.attributeType].join(" ").toLowerCase().includes(state.columnFilter.toLowerCase())
    );
    const columnRows = visibleColumns.map(column => {
      const checked = state.selectedColumns.includes(column.logicalName);
      const badges = [
        column.isPrimaryId ? '<span class="ss-schema-badge">Primary key</span>' : '',
        column.isPrimaryName ? '<span class="ss-schema-badge">Primary name</span>' : '',
        column.isCustom ? '<span class="ss-schema-badge">Custom</span>' : '',
        column.validForRead === false ? '<span class="ss-schema-badge warn">Not readable</span>' : ''
      ].join("");
      const details = [
        column.requiredLevel && column.requiredLevel !== "None" ? column.requiredLevel : "",
        column.maxLength ? "Max " + column.maxLength : "",
        column.format || ""
      ].filter(Boolean).join(" · ");
      return '<label class="ss-schema-column">' +
        '<input type="checkbox" data-col-toggle="' + esc(column.logicalName) + '"' + (checked ? ' checked' : '') + '>' +
        '<span class="ss-schema-column-main"><span class="ss-schema-column-title">' + esc(column.displayName || column.logicalName) + '</span>' +
        '<code>' + esc(column.logicalName) + '</code><span class="ss-schema-column-type">' + esc(column.attributeType) +
        (details ? ' · ' + esc(details) : '') + '</span><span class="ss-schema-badges">' + badges + '</span></span></label>';
    }).join("");
    const tableMeta = state.tableMeta;
    return '<section class="ss-schema"><div class="ss-schema-head"><div><strong>Schema Explorer</strong><div class="ss-meta">Browse Dataverse tables and insert explicit column names.</div></div>' +
      '<button class="ss-btn" data-act="loadTables" ' + (state.schemaLoading || state.tablesLoaded ? 'disabled' : '') + '>' + (state.tablesLoaded ? 'Tables loaded' : 'Load tables') + '</button>' +
      '<button class="ss-btn" data-act="closeSchema">Hide</button></div>' +
      (state.schemaError ? '<div class="ss-status ss-error">' + esc(state.schemaError) + '</div>' : '') +
      '<div class="ss-schema-grid"><div class="ss-schema-pane"><div class="ss-schema-pane-title">Tables ' + (state.tables.length ? '(' + state.tables.length + ')' : '') + '</div>' +
      '<input class="ss-schema-search" data-schema-filter="tables" value="' + esc(state.tableFilter) + '" placeholder="Search display or logical name…">' +
      '<div class="ss-schema-list">' + (state.schemaLoading && !state.tables.length ? '<div class="ss-empty">Loading tables…</div>' : tableRows || '<div class="ss-empty">No matching tables. Load tables to begin.</div>') + '</div>' +
      (state.tables.length > 250 ? '<div class="ss-meta">Showing up to 250 matching tables. Refine your search.</div>' : '') + '</div>' +
      '<div class="ss-schema-pane"><div class="ss-schema-pane-title">' + (tableMeta ? esc(tableMeta.displayName || tableMeta.logicalName) : 'Columns') + '</div>' +
      (tableMeta ? '<div class="ss-schema-table-meta"><code>' + esc(tableMeta.logicalName) + '</code> · ' + esc(tableMeta.columns.length) + ' columns · ' + esc(tableMeta.entitySetName || '') + '</div>' : '<div class="ss-empty">Select a table to inspect its columns.</div>') +
      (state.columnsError ? '<div class="ss-status ss-error">' + esc(state.columnsError) + '</div>' : '') +
      (tableMeta ? '<input class="ss-schema-search" data-schema-filter="columns" value="' + esc(state.columnFilter) + '" placeholder="Search columns or data types…">' +
      '<div class="ss-schema-actions"><button class="ss-btn" data-act="selectVisibleColumns">Select visible</button><button class="ss-btn" data-act="clearSelectedColumns">Clear selection</button><button class="ss-btn" data-act="insertSelected" ' + (!state.selectedColumns.length ? 'disabled' : '') + '>Insert selected</button><button class="ss-btn primary" data-act="generateSelect" ' + (!state.selectedColumns.length ? 'disabled' : '') + '>Generate SELECT</button><button class="ss-btn" data-act="generateAllSelect">Generate SELECT *</button></div>' +
      '<div class="ss-schema-list ss-schema-columns">' + (state.columnsLoading ? '<div class="ss-empty">Loading columns…</div>' : columnRows || '<div class="ss-empty">No matching columns.</div>') + '</div>' +
      '<div class="ss-meta">Selected ' + state.selectedColumns.length + ' · Click a column checkbox, then insert it or generate a query.</div>' : '') +
      '</div></div></section>';
  }

  function render() {
    if (!host) return;
    const activeElement = host.getRootNode()?.activeElement || document.activeElement;
    const focusedFilter = host.contains(activeElement) ? activeElement.getAttribute("data-schema-filter") : null;
    const focusedFilterStart = focusedFilter ? activeElement.selectionStart : null;
    const allRows = state.results?.rows || [];
    const columns = state.results?.columns || [];
    const pageSize = state.pageSize || 100;
    const pageCount = Math.max(1, Math.ceil(allRows.length / pageSize));
    state.pageIndex = Math.max(0, Math.min(state.pageIndex || 0, pageCount - 1));
    const pageStart = state.pageIndex * pageSize;
    const rows = allRows.slice(pageStart, pageStart + pageSize);
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
          .ss-pagination{align-items:center;justify-content:flex-end}
          .ss-results table{border-collapse:collapse;width:max-content;min-width:100%;font-size:12px}
          .ss-results th,.ss-results td{border-bottom:1px solid #334155;border-right:1px solid #1e293b;padding:6px 9px;text-align:left;white-space:nowrap;max-width:420px;overflow:hidden;text-overflow:ellipsis}
          .ss-results th{position:sticky;top:0;background:#1e293b;color:#bfdbfe}
          .ss-empty{color:#94a3b8;padding:16px}.ss-meta{font-size:12px;color:#94a3b8}
          .ss-pill{border:1px solid #166534;color:#86efac;border-radius:999px;padding:2px 8px}
          .ss-schema{border:1px solid #334155;border-radius:8px;padding:10px;background:#0b1220;display:flex;flex-direction:column;gap:8px}
          .ss-schema-head{display:flex;align-items:center;gap:8px;flex-wrap:wrap}.ss-schema-head>div{margin-right:auto}
          .ss-schema-grid{display:grid;grid-template-columns:minmax(180px,.8fr) minmax(300px,1.5fr);gap:8px;min-height:220px}
          .ss-schema-pane{border:1px solid #334155;border-radius:7px;min-width:0;padding:8px;display:flex;flex-direction:column;gap:7px}
          .ss-schema-pane-title{font-weight:700;color:#bfdbfe}.ss-schema-search{box-sizing:border-box;width:100%;padding:7px 8px;background:#020617;color:#e2e8f0;border:1px solid #475569;border-radius:6px}
          .ss-schema-list{overflow:auto;max-height:280px;min-height:70px}.ss-schema-table{display:flex;flex-direction:column;width:100%;text-align:left;gap:1px;background:transparent;border:1px solid transparent;border-radius:5px;color:#e2e8f0;padding:6px;cursor:pointer}
          .ss-schema-table:hover,.ss-schema-table.selected{background:#172554;border-color:#3b82f6}.ss-schema-table-name{font-weight:600}.ss-schema-table-logical{font:11px ui-monospace,monospace;color:#94a3b8}
          .ss-schema-table-meta{font-size:11px;color:#94a3b8}.ss-schema-actions{display:flex;flex-wrap:wrap;gap:5px}.ss-schema-actions .ss-btn{padding:5px 7px;font-size:11px}
          .ss-schema-column{display:flex;align-items:flex-start;gap:7px;padding:7px 4px;border-bottom:1px solid #1e293b;cursor:pointer}.ss-schema-column input{margin-top:3px}
          .ss-schema-column-main{display:flex;flex-direction:column;gap:2px;min-width:0}.ss-schema-column-title{font-weight:600}.ss-schema-column code{font-size:11px;color:#93c5fd;overflow-wrap:anywhere}
          .ss-schema-column-type{font-size:11px;color:#94a3b8}.ss-schema-badges{display:flex;flex-wrap:wrap;gap:4px}.ss-schema-badge{font-size:10px;border:1px solid #475569;border-radius:999px;padding:1px 5px;color:#cbd5e1}.ss-schema-badge.warn{color:#fde68a}
          @media(max-width:760px){.ss-schema-grid{grid-template-columns:1fr}.ss-schema-list{max-height:190px}}
        </style>
        <div class="ss-top"><div class="ss-title">Query Studio</div><span class="ss-pill">READ ONLY</span><button class="ss-btn" data-act="schema">Schema Explorer</button><button class="ss-btn" data-act="context">Detect environment</button><button class="ss-btn primary" data-act="execute" ${state.running ? "disabled" : ""}>Execute (native SQL)</button><button class="ss-btn" data-act="executeEngine" ${state.running ? "disabled" : ""}>Execute JS engine (preview)</button><button class="ss-btn" data-act="clear">Clear results</button></div>
        <div class="ss-status">Execution: ${esc(state.status)} ${state.ctx ? " · " + esc(state.ctx.clientUrl) : ""} · ${state.results ? `${state.results.rows?.length || 0} rows · ${state.durationMs} ms` : "No results yet"}</div>
        ${schemaExplorerHtml()}
        <textarea class="ss-editor" spellcheck="false" aria-label="SQL query editor">${esc(state.sql)}</textarea>
        <div class="ss-meta">Native Dataverse SQL endpoint remains the default. JS engine preview compiles its supported SELECT subset to FetchXML; unsupported SQL is rejected. Both paths are read-only and run as your current Dynamics user.</div>
        ${state.error ? `<div class="ss-status ss-error">${esc(state.error)}</div>` : ""}
        ${state.results ? `<div class="ss-meta">Query: ${esc(state.lastQuery)} · ${state.results.truncated ? "Results limited" : "Server response received"}${state.results.provider ? " · " + esc(state.results.provider) + (state.results.compatibilityMode ? " (" + esc(state.results.compatibilityMode) + ")" : "") : ""}${state.results.warning ? " · " + esc(state.results.warning) : ""}</div>` : ""}
        ${state.results ? `<div class="ss-results"><table><thead><tr>${columns.map(c=>`<th title="${esc(c)}">${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows.map(row=>`<tr>${columns.map(c=>`<td title="${esc(row[c])}">${esc(formatValue(row[c]))}</td>`).join("")}</tr>`).join("")}</tbody></table>${rows.length ? "" : '<div class="ss-empty">The query returned no rows.</div>'}</div>${allRows.length > pageSize ? `<div class="ss-top ss-pagination"><span class="ss-meta">Rows ${pageStart + 1}–${Math.min(pageStart + rows.length, allRows.length)} of ${allRows.length}</span><button class="ss-btn" data-act="prevPage" ${state.pageIndex <= 0 ? "disabled" : ""}>Previous</button><span class="ss-meta">Page ${state.pageIndex + 1} of ${pageCount}</span><button class="ss-btn" data-act="nextPage" ${state.pageIndex >= pageCount - 1 ? "disabled" : ""}>Next</button></div>` : ""}<div class="ss-top"><button class="ss-btn" data-act="csv">Export CSV</button><button class="ss-btn" data-act="copy">Copy JSON</button></div>` : ""}
      </div>`;
    const editor = host.querySelector("textarea");
    editor.value = state.sql;
    editor.addEventListener("input", e => state.sql = e.target.value);
    editor.addEventListener("keydown", e => {
      if (e.ctrlKey && e.key === "Enter") { e.preventDefault(); void execute(); }
    });
    host.querySelectorAll("[data-act]").forEach(btn => btn.addEventListener("click", () => void act(btn.dataset.act)));
    host.querySelectorAll("[data-schema-filter]").forEach(input => input.addEventListener("input", () => {
      if (input.dataset.schemaFilter === "tables") state.tableFilter = input.value;
      if (input.dataset.schemaFilter === "columns") state.columnFilter = input.value;
      render();
    }));
    host.querySelectorAll("[data-table]").forEach(btn => btn.addEventListener("click", () => void loadSchemaTable(btn.dataset.table)));
    host.querySelectorAll("[data-col-toggle]").forEach(input => input.addEventListener("change", () => {
      const name = input.dataset.colToggle;
      state.selectedColumns = input.checked
        ? [...new Set([...state.selectedColumns, name])]
        : state.selectedColumns.filter(item => item !== name);
      render();
    }));
    const filterToRestore = focusedFilter ? host.querySelector('[data-schema-filter="' + focusedFilter + '"]') : null;
    if (filterToRestore) {
      filterToRestore.focus();
      try { filterToRestore.setSelectionRange(focusedFilterStart, focusedFilterStart); } catch {}
    }
    const rememberEditorSelection = () => {
      state.editorSelectionStart = editor.selectionStart;
      state.editorSelectionEnd = editor.selectionEnd;
    };
    editor.addEventListener("select", rememberEditorSelection);
    editor.addEventListener("keyup", rememberEditorSelection);
    editor.addEventListener("click", rememberEditorSelection);
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
      state.ctx = { ...response, clientUrl: response.clientUrl };
      state.status = "Environment detected";
    } catch (e) {
      state.error = e.message || String(e);
      state.status = "Context unavailable";
    }
    render();
  }

  async function loadTables() {
    if (state.schemaLoading || state.tablesLoaded) return;
    state.schemaLoading = true;
    state.schemaError = "";
    state.status = "Loading Dataverse tables…";
    render();
    try {
      const api = window.D365AnalyzerApi;
      if (!api?.send) throw new Error("DevLens Dataverse bridge is not available. Reload the Dynamics tab.");
      const response = await api.send("metadataTables");
      if (!response?.ok) throw new Error(response?.error || "Could not load table metadata.");
      state.tables = Array.isArray(response.data) ? response.data : [];
      state.tablesLoaded = true;
      state.status = "Loaded " + state.tables.length + " tables";
      if (!state.selectedTable) {
        const match = state.sql.match(/FROM[ ]+((?:[A-Za-z_][A-Za-z0-9_]*[.])?[A-Za-z_][A-Za-z0-9_]*)/i);
        const candidate = match?.[1]?.split(".").pop()?.replaceAll("[", "").replaceAll("]", "").replaceAll('"', "").toLowerCase();
        if (candidate && state.tables.some(table => table.logicalName === candidate)) {
          state.selectedTable = candidate;
          await loadSchemaTable(candidate);
          return;
        }
      }
    } catch (error) {
      state.schemaError = error.message || String(error);
      state.status = "Schema loading failed";
    } finally {
      state.schemaLoading = false;
      render();
    }
  }

  async function loadSchemaTable(logicalName) {
    const table = String(logicalName || "").trim().toLowerCase();
    if (!table) return;
    if (state.tableMeta?.logicalName === table && !state.columnsError) {
      state.selectedTable = table;
      state.columnFilter = "";
      state.selectedColumns = [];
      render();
      return;
    }
    state.selectedTable = table;
    state.schemaError = "";
    state.tableMeta = null;
    state.columnsLoading = true;
    state.columnsError = "";
    state.columnFilter = "";
    state.selectedColumns = [];
    render();
    try {
      const api = window.D365AnalyzerApi;
      if (!api?.send) throw new Error("DevLens Dataverse bridge is not available. Reload the Dynamics tab.");
      const response = await api.send("schemaTable", { logicalName: table });
      if (!response?.ok || !response.data) throw new Error(response?.error || "Could not load table columns.");
      state.tableMeta = response.data;
      state.status = "Loaded schema for " + table;
    } catch (error) {
      state.columnsError = error.message || String(error);
      state.status = "Column metadata failed";
    } finally {
      state.columnsLoading = false;
      render();
    }
  }

  function generateSelect(allReadable) {
    const columns = state.tableMeta?.columns || [];
    if (allReadable) {
      if (!state.tableMeta) { state.schemaError = "Select a table first."; render(); return; }
      state.sql = "SELECT TOP 100 *\\nFROM " + state.tableMeta.logicalName + ";";
      state.editorSelectionStart = state.editorSelectionEnd = 0;
      state.error = ""; state.results = null; state.status = "SELECT * generated"; render();
      const editor = host?.querySelector(".ss-editor");
      if (editor) { editor.focus(); editor.setSelectionRange(0, 0); }
      return;
    }
    const names = columns.filter(column => state.selectedColumns.includes(column.logicalName) && isQueryableColumn(column))
      .map(column => column.logicalName);
    if (!state.tableMeta || !names.length) {
      state.schemaError = allReadable ? "No readable columns were returned for this table." : "Select at least one readable column first.";
      render();
      return;
    }
    state.sql = "SELECT TOP 100 " + names.join(", ") + "\nFROM " + state.tableMeta.logicalName + ";";
    state.editorSelectionStart = state.editorSelectionEnd = 0;
    state.error = "";
    state.results = null;
    state.status = "SELECT generated from Dataverse metadata";
    render();
    const editor = host?.querySelector(".ss-editor");
    if (editor) { editor.focus(); editor.setSelectionRange(0, 0); }
  }

  function insertSelectedColumns() {
    const columns = (state.tableMeta?.columns || []).filter(column =>
      state.selectedColumns.includes(column.logicalName) && isQueryableColumn(column)
    ).map(column => column.logicalName);
    if (!columns.length) {
      state.schemaError = "Select at least one readable column to insert.";
      render();
      return;
    }
    const start = state.editorSelectionStart < 0 ? state.sql.length : Math.min(state.editorSelectionStart, state.sql.length);
    const end = Math.min(Math.max(state.editorSelectionEnd, start), state.sql.length);
    const insertion = columns.join(", ");
    state.sql = state.sql.slice(0, start) + insertion + state.sql.slice(end);
    const caret = start + insertion.length;
    state.editorSelectionStart = state.editorSelectionEnd = caret;
    state.status = "Inserted " + columns.length + " column name(s)";
    render();
    const editor = host?.querySelector(".ss-editor");
    if (editor) { editor.focus(); editor.setSelectionRange(caret, caret); }
  }

  async function execute() {
    if (state.running) return;
    if (!state.sql.trim()) { state.error = "Enter a SELECT query first."; render(); return; }
    state.running = true;
    state.error = "";
    state.results = null;
    state.pageIndex = 0;
    state.lastQuery = state.sql;
    state.status = "Executing…";
    const started = performance.now();
    render();

    try {
      const api = window.D365AnalyzerApi;
      if (!api?.send) throw new Error("DevLens Dataverse bridge is not available. Reload the Dynamics tab.");
      const response = await api.send("querySql", { sql: state.sql });
      if (!response?.ok) throw new Error(response?.error || "Query failed.");
      state.ctx = { clientUrl: response.clientUrl, environmentId: response.environmentId, currentUser: response.currentUser };
      const rows = response.rows || [];
      const columns = response.columns || [];
      state.results = {
        columns,
        rows: rows.map(row => Object.fromEntries(columns.map(key => [key, row[key] ?? null]))),
        truncated: response.truncated === true || response.totalRecordCountLimitExceeded === true,
        warning: response.warning || "",
        provider: response.provider || "",
        compatibilityMode: response.compatibilityMode || "",
        totalRecordCount: response.totalRecordCount ?? null
      };
      state.status = "Query completed as " + (response.currentUser?.name || "current Dynamics user");
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

  async function executeEngine() {
    if (state.running) return;
    if (!window.DevLensSqlEngine) { state.error = "JavaScript SQL engine did not load. Reload the Dynamics tab."; render(); return; }
    state.running = true;
    state.error = "";
    state.results = null;
    state.pageIndex = 0;
    state.lastQuery = state.sql + "  [JavaScript SQL engine]";
    state.status = "Planning SQL and loading metadata…";
    const started = performance.now();
    render();
    try {
      const api = window.D365AnalyzerApi;
      if (!api?.send) throw new Error("DevLens Dataverse bridge is not available. Reload the Dynamics tab.");
      const plan = window.DevLensSqlEngine.plan(state.sql);
      const names = [...new Set([plan.table, ...plan.joins.map(j => j.table)])];
      const metadata = { entities: {} };
      for (const logicalName of names) {
        const response = await api.send("schemaTable", { logicalName });
        if (!response?.ok || !response.data) throw new Error(response?.error || "Could not load metadata for " + logicalName + ".");
        const data = response.data;
        metadata.entities[logicalName] = {
          logicalName: data.logicalName,
          entitySetName: data.entitySetName,
          primaryIdAttribute: data.primaryIdAttribute,
          columns: (data.columns || []).map(column => ({
            logicalName: column.logicalName,
            attributeType: column.attributeType,
            queryable: column.validForRead !== false && String(column.attributeType || "").toLowerCase() !== "virtual"
          }))
        };
      }
      const compiled = window.DevLensSqlEngine.compile(plan, metadata);
      state.status = "Executing compiled FetchXML…";
      render();
      const response = await api.send("queryFetchXml", { tableName: plan.table, fetchXml: compiled.fetchXml, offset: plan.offset, limit: plan.fetch });
      if (!response?.ok) throw new Error(response?.error || "Compiled FetchXML execution failed.");
      const sourceRows = response.rows || [];
      const projections = compiled.resultColumns || (plan.columns.some(column => column.star)
        ? metadata.entities[plan.table].columns.filter(column => column.queryable).map(column => ({label: column.logicalName, key: column.logicalName}))
        : plan.columns.map(column => {
            const label = column.alias || (column.tableAlias ? column.tableAlias + "." : "") + column.column;
            const key = column.alias || (column.tableAlias && column.tableAlias.toLowerCase() !== plan.alias.toLowerCase()
              ? column.tableAlias + "_" + column.column
              : column.column);
            return { label, key };
          }));
      const columns = [...new Set(projections.map(p => p.label))];
      const rows = sourceRows.map(row => {
        const output = {};
        for (const projection of projections) {
          const key = Object.keys(row).find(candidate => candidate.toLowerCase() === projection.key.toLowerCase());
          const labelKey = Object.keys(row).find(candidate => candidate.toLowerCase() === projection.label.toLowerCase());
          output[projection.label] = (key ? row[key] : undefined) ?? (labelKey ? row[labelKey] : undefined) ?? null;
        }
        return output;
      });
      state.results = { columns, rows, truncated: response.moreRecords === true, totalRecordCount: response.rowCount ?? rows.length };
      state.status = "JavaScript SQL engine completed (" + rows.length + " rows)" + (response.moreRecords ? " · more records available" : "");
      state.durationMs = Math.round(performance.now() - started);
    } catch (e) {
      state.error = e.message || String(e);
      state.status = "JavaScript SQL engine failed";
      state.durationMs = Math.round(performance.now() - started);
    } finally {
      state.running = false;
      render();
    }
  }

  async function act(action) {
    if (action === "context") return detectContext();
    if (action === "schema") {
      state.schemaOpen = !state.schemaOpen;
      state.schemaError = "";
      render();
      if (state.schemaOpen && !state.tablesLoaded) await loadTables();
      return;
    }
    if (action === "closeSchema") { state.schemaOpen = false; render(); return; }
    if (action === "loadTables") return loadTables();
    if (action === "selectVisibleColumns") {
      const visible = (state.tableMeta?.columns || []).filter(isQueryableColumn).filter(column =>
        [column.displayName, column.logicalName, column.schemaName, column.attributeType].join(" ").toLowerCase().includes(state.columnFilter.toLowerCase())
      ).map(column => column.logicalName);
      state.selectedColumns = [...new Set([...state.selectedColumns, ...visible])];
      render(); return;
    }
    if (action === "clearSelectedColumns") { state.selectedColumns = []; render(); return; }
    if (action === "insertSelected") return insertSelectedColumns();
    if (action === "generateSelect") return generateSelect(false);
    if (action === "generateAllSelect") return generateSelect(true);
    if (action === "execute") return execute();
    if (action === "executeEngine") return executeEngine();
    if (action === "clear") { state.results = null; state.pageIndex = 0; state.error = ""; state.status = "Ready"; render(); return; }
    if (action === "prevPage") { state.pageIndex = Math.max(0, state.pageIndex - 1); render(); return; }
    if (action === "nextPage") {
      const pageCount = Math.max(1, Math.ceil((state.results?.rows?.length || 0) / state.pageSize));
      state.pageIndex = Math.min(pageCount - 1, state.pageIndex + 1);
      render();
      return;
    }
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
