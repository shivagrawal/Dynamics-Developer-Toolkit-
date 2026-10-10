(() => {
  "use strict";
  if (window.__DEVLENS5101) return;
  window.__DEVLENS5101 = true;
  const APP_VERSION = "5.20.13.1";
  const APP_AUTHOR = "Shiv Agrawal";

  let host,
    shadow,
    report = null,
    scan = null,
    allFieldsData = null,
    visible = false,
    minimized = false;
  let view = "events",
    eventTab = "all",
    jsTab = "libraries",
    search = "",
    fieldFilters = new Set(),
    allFieldsMode = "flat",
    drawers = [];
  const byId = (id) => shadow.getElementById(id);
  const escapeHtml = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (character) =>
      character === "&"
        ? "&amp;"
        : character === "<"
          ? "&lt;"
          : character === ">"
            ? "&gt;"
            : character === '"'
              ? "&quot;"
              : "&#39;",
    );
  let activeSurfaceState={selectedSurface:null,panes:[]};
  window.addEventListener("message",event=>{if(event.source!==window||event.origin!==location.origin)return;if(event.data?.source==="DEVLENS_SURFACE_BOOTSTRAP"&&event.data.type==="SURFACE_STATE"){const old=activeSurfaceState.selectedSurface?.surfaceId;activeSurfaceState=event.data.payload||{selectedSurface:null,panes:[]};if(visible&&old!==activeSurfaceState.selectedSurface?.surfaceId){report=null;scan=null;allFieldsData=null;window.D365ProcessView?.reset?.();void load(true)}}},true);
  const activeSurfacePayload=()=>activeSurfaceState.selectedSurface||null;
  function extractToolFields(response) {
    if (Array.isArray(response?.fields)) return response.fields;
    if (Array.isArray(response?.data)) return response.data;
    if (Array.isArray(response?.data?.fields)) return response.data.fields;
    return [];
  }
  function normalizeToolField(item) {
    return {
      ...item,
      name: item?.name || item?.logicalName || "",
      type: item?.type || item?.attributeType || "unknown",
      required: item?.required ?? item?.requiredLevel ?? "unknown",
      locations: Array.isArray(item?.locations) ? item.locations : []
    };
  }  const isFieldTarget = item => { const targetType=String(item?.targetType||"").trim().toLowerCase(); return targetType==="field"||targetType==="attribute"||String(item?.category||"").trim().toUpperCase()==="FIELD"; };
  const extensionUnavailable = () => !globalThis.chrome?.runtime?.id;
  const send = (action, payload = {}) => new Promise((resolve) => {
    if (extensionUnavailable()) { resolve({ ok:false, error:"Extension context was reloaded. Reload this Dynamics tab to reconnect DevLens." }); return; }
    try { chrome.runtime.sendMessage({ type:"DEVLENS_ACTION", action, payload:{...payload,__devlensSurface:activeSurfacePayload()} }, (response) => { const runtimeError=chrome.runtime?.lastError; if(response?.code === "SIDE_PANE_LIVE_RUNTIME_REQUIRED") response.error = "Selected side pane detected. Live runtime unavailable. The action was not applied to the parent form.";
              if(response?.code === "SIDE_PANE_AGENT_IDENTITY_MISMATCH") response.error = "The live Form Agent context does not match the selected side-pane record. No form was modified.";
              if(response?.provider) response.providerLabel={"form-agent":"Live side-pane Form Agent","uci-redux":"Internal UCI form-state inspection","dataverse-webapi":"Persisted Dataverse inspection","main-form-xrm":"Main-form Xrm runtime"}[response.provider]||response.provider; resolve(response || { ok:false, error:runtimeError?.message || "DevLens received no extension response. Reload the Dynamics tab." }); }); }
    catch(error) { resolve({ ok:false, error:error?.message || String(error) }); }
  });

  function init() {
    host = document.createElement("div");
    document.documentElement.appendChild(host);
    shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>
      :host{all:initial}.p{position:fixed;inset:10px;z-index:2147483647;background:#0b1224;color:#e5e7eb;border:1px solid #475569;border-radius:12px;box-shadow:0 20px 60px #0009;font:13px/1.4 system-ui;display:flex;flex-direction:column;overflow:hidden}.p.min{inset:auto 15px 15px auto;width:min(480px,calc(100vw - 30px));height:auto}.p.min .main{display:none}.p.min .drawer{display:none!important}.p.min #refresh,.p.min #close{display:none}.main{display:flex;flex-direction:column;min-height:0;flex:1}.row{display:flex;gap:8px;align-items:center;padding:8px 12px;flex-wrap:wrap;border-bottom:1px solid #334155}.head{background:#020617;flex-wrap:nowrap}.grow{flex:1;min-width:0}.b,.pill,.i{border:1px solid #475569;background:#1e293b;color:#fff;border-radius:7px;padding:7px 10px}.b,.pill{cursor:pointer}.b:hover{border-color:#60a5fa}.active,.pri{background:#2563eb}.danger{background:#991b1b}.safe{padding:6px 12px;background:#052e16;color:#86efac}.body{flex:1;min-height:0;overflow:auto;padding:0 12px 12px}.status{padding:6px 12px;color:#93c5fd}.search{min-width:230px;flex:1}table{border-collapse:collapse;width:100%;min-width:900px}th{position:sticky;top:0;background:#1e293b;text-align:left;z-index:1}th,td{padding:8px;border-bottom:1px solid #334155;vertical-align:top}.link{color:#93c5fd;text-decoration:underline;cursor:pointer}.card{background:#111c31;border:1px solid #334155;border-radius:9px;padding:10px;margin:9px 0}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px}.drawer{position:absolute;inset:0 0 0 auto;width:min(1040px,96vw);background:#111827;display:none;z-index:5;flex-direction:column}.drawer.open{display:flex}.muted{color:#94a3b8}.bad{color:#fca5a5}.good{color:#86efac}.warn{color:#fde68a}.code{white-space:pre;background:#020617;overflow:auto;max-height:75vh;padding:8px}.line{display:block}.mark{background:#854d0e}.ln{display:inline-block;width:52px;color:#64748b}details{border:1px solid #334155;border-radius:8px;padding:8px;margin:8px 0}summary{cursor:pointer}.icon{width:30px;height:30px;object-fit:contain}.toolSection{margin:14px 0}.toolSection h3{margin:0 0 8px;color:#bfdbfe}.toolCard{text-align:left;min-height:58px}.toolCard b{display:block}.toolCard span{font-size:12px;color:#94a3b8}.banner{border:1px solid #2563eb;background:#172554;border-radius:8px;padding:9px;margin:8px 0}.impersonating{border-color:#f59e0b;background:#451a03}.processCount{float:right;color:#93c5fd}.nowrap{white-space:nowrap}.fieldCard{display:flex;flex-direction:column;gap:7px}.fieldValue{background:#020617;border:1px solid #334155;border-radius:6px;padding:8px;overflow-wrap:anywhere}.badges,.fieldActions{display:flex;gap:5px;flex-wrap:wrap}.badge{border:1px solid #475569;border-radius:999px;padding:2px 7px;font-size:11px}.fieldSummary{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;margin:9px 0}.fieldStat{background:#111c31;border:1px solid #334155;border-radius:8px;padding:9px}.fieldStat b{display:block;font-size:18px;color:#bfdbfe}.fieldGroup{margin:12px 0}.locationList{font-size:12px;color:#94a3b8}.fieldFilter.active{background:#2563eb}.fieldActions .b{padding:4px 7px;font-size:11px}.copyOk{border-color:#166534!important;color:#86efac!important}.tablePickerResults{margin:0 12px 8px;padding:8px;border:1px solid #475569;border-radius:8px;background:#0f172a;max-height:260px;overflow:auto}.tablePickerResult{display:block;width:100%;text-align:left;margin:4px 0}.globalChoiceBadge{display:inline-block;padding:2px 7px;border-radius:999px;background:#14532d;color:#bbf7d0;font-weight:700}
    </style><div id="panel" class="p"><div class="row head"><img class="icon" src="${chrome.runtime.getURL("icons/icon32.png")}"><b>Dynamics 365 & Dataverse DevLens v${APP_VERSION}</b><span id="context" class="grow">Open a form</span><button id="refresh" class="b">Refresh</button><button id="minimize" class="b" title="Minimize DevLens (Alt+P)" aria-label="Minimize or restore DevLens with Alt+P">Minimize</button><button id="close" class="b">Close</button></div><div class="main"><div class="safe">Safe diagnostics. Form changes are temporary and reversible. Impersonation is isolated to a dedicated Dynamics tab and matching Dataverse Web API requests in that tab.</div><div class="row">${[
      ["events", "Events"],
      ["js", "JS Explorer"],
      ["fields", "Fields Explorer"],
      ["snapshots", "Snapshots"],
      ["compare", "Compare"],
      ["metadata", "Metadata Browser"],
      ["processes", "Process Explorer"],
      ["sqlstudio", "Query Studio"],
      ["tools", "Developer Toolkit"],
      ["about", "About & Guide"],
    ]
      .map(
        (item, index) =>
          `<button class="b top ${index ? "" : "active"}" data-view="${item[0]}">${item[1]}</button>`,
      )
      .join(
        "",
      )}</div><div id="toolbar" class="row"><input id="query" class="i search" placeholder="Search"><button id="csv" class="b">CSV</button><button id="json" class="b">JSON</button><button id="snapshot" class="b">Save Snapshot</button></div><div id="subtabs" class="row"></div><div id="status" class="status">Loading DevLens context and registered form events...</div><div id="body" class="body"></div></div><aside id="drawer" class="drawer"><div class="row head"><button id="back" class="b">Back</button><b id="drawerTitle" class="grow"></b><button id="drawerClose" class="b">Close</button></div><div id="drawerBody" class="body"></div></aside></div>`;
    byId("close").onclick = toggle;
    byId("minimize").onclick = toggleMinimize;
    byId("refresh").onclick = () => load(true);
    byId("query").oninput = () => {
      search = byId("query").value.toLowerCase();
      render();
    };
    byId("csv").onclick = () => download("csv");
    byId("json").onclick = () => download("json");
    byId("snapshot").onclick = saveSnapshot;
    byId("drawerClose").onclick = closeDrawer;
    byId("back").onclick = () => {
      drawers.pop();
      renderDrawer();
    };
    shadow
      .querySelectorAll(".top")
      .forEach(
        (button) =>
          (button.onclick = () => switchView(button.dataset.view, button)),
      );
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.altKey && !event.shiftKey && event.code === "KeyP") {
          event.preventDefault();
          toggleMinimize();
        }
      },
      true,
    );
  }

  function cancelAnalysis() {
    window.D365FunctionDependencyService?.cancel?.();
    window.D365CallGraphIndexer?.cancel?.();
    if (byId("status")) byId("status").textContent = "";
  }
  function toggleMinimize() {
    cancelAnalysis();
    minimized = !minimized;
    byId("panel").classList.toggle("min", minimized);
    byId("minimize").textContent = minimized ? "Restore" : "Minimize";
    byId("minimize").title = minimized
      ? "Restore DevLens (Alt+P)"
      : "Minimize DevLens (Alt+P)";
    byId("minimize").setAttribute("aria-label", byId("minimize").title);
  }
  function toggle() {
    if (!host) init();
    if (visible) cancelAnalysis();
    visible = !visible;
    host.style.display = visible ? "" : "none";
    if (visible) report ? render() : load();
  }
  function switchView(next, button) {
    cancelAnalysis();
    view = next;
    search = "";
    byId("query").value = "";
    if (next === "fields") { fieldFilters.clear(); allFieldsMode = "flat"; }
    shadow
      .querySelectorAll(".top")
      .forEach((item) => item.classList.toggle("active", item === button));
    byId("subtabs").innerHTML = "";
    byId("status").textContent = "";
    void render();
  }
  const eventRows = () => report?.rows || [];

  function configure() {
    const searchable = [
      "events",
      "js",
      "fields",
      "snapshots",
      "tools",
    ].includes(view);
    byId("toolbar").style.display = ["metadata", "processes", "compare", "about", "sqlstudio"].includes(
      view,
    )
      ? "none"
      : "flex";
    byId("query").style.display = searchable ? "" : "none";
    byId("csv").style.display = byId("json").style.display =
      view === "events" ? "" : "none";
    byId("snapshot").style.display = ["events", "snapshots"].includes(view)
      ? ""
      : "none";
    byId("subtabs").style.display = ["events", "js", "fields"].includes(view)
      ? "flex"
      : "none";
  }

  function filteredEvents() {
    let rows = eventRows();
    if (eventTab === "load")
      rows = rows.filter((item) => item.eventType === "ONLOAD");
    else if (eventTab === "save")
      rows = rows.filter((item) => item.eventType === "ONSAVE");
    else if (eventTab === "fields")
      rows = rows.filter((item) => item.category === "FIELD");
    else if (eventTab === "tabs")
      rows = rows.filter((item) => item.category === "TAB");
    else if (eventTab === "bpf")
      rows = rows.filter((item) => item.category === "BPF");
    else if (eventTab === "enabled") rows = rows.filter((item) => item.enabled);
    else if (eventTab === "disabled")
      rows = rows.filter((item) => !item.enabled);
    if (search)
      rows = rows.filter((item) =>
        JSON.stringify(item).toLowerCase().includes(search),
      );
    return rows;
  }
  function eventTable(rows) {
    return `<table><thead><tr><th>Event</th><th>Category</th><th>Target</th><th>Function</th><th>Library</th><th>Enabled</th><th>Context</th><th>Parameters</th></tr></thead><tbody>${rows.map((item, index) => `<tr><td>${escapeHtml(item.eventType)}</td><td>${escapeHtml(item.category)}</td><td><span class="link field" data-i="${index}">${escapeHtml(item.targetName)}</span></td><td><span class="link function" data-i="${index}">${escapeHtml(item.functionName)}</span></td><td><span class="link library" data-i="${index}">${escapeHtml(item.libraryName)}</span></td><td>${escapeHtml(item.enabled)}</td><td>${escapeHtml(item.passExecutionContext)}</td><td>${escapeHtml(item.parameters)}</td></tr>`).join("")}</tbody></table>`;
  }
  function groupedEventTable(rows, key) {
    const groups = new Map();
    for (const row of rows) {
      const name = row[key] || "(unresolved)";
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(row);
    }
    return (
      [...groups]
        .map(
          ([name, values], index) =>
            `<details open class="eventGroup" data-group="${index}"><summary><b>${escapeHtml(name)}</b> Â· ${values.length} registration${values.length === 1 ? "" : "s"}</summary>${eventTable(values)}</details>`,
        )
        .join("") || '<div class="muted">No matching events.</div>'
    );
  }
  function bindEvents(rows, container = byId("body")) {
    container
      .querySelectorAll(".field")
      .forEach(
        (item) =>
          (item.onclick = () => openField(rows[+item.dataset.i].targetName)),
      );
    container
      .querySelectorAll(".function")
      .forEach(
        (item) => (item.onclick = () => openFunction(rows[+item.dataset.i])),
      );
    container
      .querySelectorAll(".library")
      .forEach(
        (item) =>
          (item.onclick = () => openLibrary(rows[+item.dataset.i].libraryName)),
      );
  }
  function bindGroupedEvents(rows, key) {
    const groups = new Map();
    for (const row of rows) {
      const name = row[key] || "(unresolved)";
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(row);
    }
    const values = [...groups.values()];
    byId("body")
      .querySelectorAll(".eventGroup")
      .forEach((element, index) => bindEvents(values[index] || [], element));
  }

  async function ensureScan() {
    if (scan) return scan;
    const map = {};
    eventRows()
      .filter((item) => item.libraryName && !item.internal)
      .forEach((item) =>
        (map[item.libraryName] ??= new Set()).add(item.functionName),
      );
    for (const libraryName of report?.formLibraries || [])
      map[libraryName] ??= new Set();
    const response = await send("scan", {
      libraries: Object.entries(map).map(([libraryName, functions]) => ({
        libraryName,
        functions: [...functions],
      })),
    });
    if (!response.ok) throw Error(response.error);
    scan = response.results || [];
    return scan;
  }
  function definitions() {
    return (scan || []).flatMap((library) =>
      library.ok
        ? (library.definitions || []).map((definition) => ({
            functionName: definition.name,
            libraryName: library.libraryName,
            line: definition.line,
          }))
        : [],
    );
  }
  function functions() {
    const defs = definitions();
    return (scan || []).flatMap((library) =>
      library.ok
        ? (library.registeredFunctions || []).map((item) => {
            const exact = defs.find(
              (definition) =>
                definition.libraryName === library.libraryName &&
                (definition.functionName === item.functionName ||
                  definition.functionName.endsWith("." + item.functionName)),
            );
            return {
              ...item,
              libraryName: library.libraryName,
              definitionLine: exact?.line || item.definitionLines?.[0] || null,
            };
          })
        : [],
    );
  }
  async function renderJavaScript() {
    if (!scan) {
      byId("status").textContent = "";
      byId("body").innerHTML = '<div class="status">Loading registered JavaScript libraries and functions...</div>';
    }
    await ensureScan();
    const tabs = ["libraries", "functions", "definitions", "occurrences"];
    byId("subtabs").innerHTML = tabs
      .map(
        (tab) =>
          `<button class="b jsTab ${tab === jsTab ? "active" : ""}" data-tab="${tab}">${tab}</button>`,
      )
      .join("");
    byId("subtabs")
      .querySelectorAll(".jsTab")
      .forEach(
        (button) =>
          (button.onclick = () => {
            jsTab = button.dataset.tab;
            render();
          }),
      );
    let rows = [];
    if (jsTab === "libraries")
      rows = scan.filter(
        (item) => !search || item.libraryName.toLowerCase().includes(search),
      );
    else if (jsTab === "functions")
      rows = functions().filter(
        (item) =>
          !search || JSON.stringify(item).toLowerCase().includes(search),
      );
    else if (jsTab === "definitions")
      rows = definitions().filter(
        (item) =>
          !search || JSON.stringify(item).toLowerCase().includes(search),
      );
    else
      rows = functions()
        .flatMap((item) =>
          (item.occurrenceLines || []).map((line) => ({ ...item, line })),
        )
        .filter(
          (item) =>
            !search || JSON.stringify(item).toLowerCase().includes(search),
        );
    if (jsTab === "libraries")
      byId("body").innerHTML = rows
        .map(
          (item, index) =>
            `<div class="card link jsLibrary" data-i="${index}">${escapeHtml(item.libraryName)} Â· ${item.lineCount || 0} lines Â· ${item.definitions?.length || 0} definitions</div>`,
        )
        .join("");
    else
      byId("body").innerHTML =
        `<table><thead><tr><th>Function</th><th>Library</th><th>Exact definition line</th><th>Registered</th></tr></thead><tbody>${rows.map((item, index) => `<tr class="link jsFunction" data-i="${index}"><td>${escapeHtml(item.functionName)}</td><td>${escapeHtml(item.libraryName)}</td><td>${escapeHtml(item.line || item.definitionLine || "not located")}</td><td>${escapeHtml(item.defined ?? "")}</td></tr>`).join("")}</tbody></table>`;
    byId("body")
      .querySelectorAll(".jsLibrary")
      .forEach(
        (item) =>
          (item.onclick = () => openLibrary(rows[+item.dataset.i].libraryName)),
      );
    byId("body")
      .querySelectorAll(".jsFunction")
      .forEach((item) => {
        const fn = rows[+item.dataset.i];
        item.onclick = () =>
          fn.line || fn.definitionLine
            ? openSourceLine(
                fn.libraryName,
                fn.line || fn.definitionLine,
                `Function: ${fn.functionName}`,
              )
            : openFunction(fn);
      });    byId("status").textContent = "";
  }
  async function ensureAllFields() {
    if (allFieldsData) return allFieldsData;
    const r = await send("allFieldsReport");
    if (!r.ok) throw Error(r.error);
    return (allFieldsData = r);
  }
  const fieldBadge = (t, c = "") =>
    `<span class="badge ${c}">${escapeHtml(t)}</span>`;
  function allFieldsCard(field, index) {
    const badges = [
      fieldBadge(
        field.metadataOnly ? "METADATA ONLY" : field.onForm ? (field.visible ? "VISIBLE" : "HIDDEN") : "NOT ON FORM",
        field.metadataOnly ? "warn" : field.onForm ? (field.visible ? "good" : "warn") : "bad",
      ),
      field.dirty ? fieldBadge("DIRTY", "warn") : "",
      field.empty ? fieldBadge("EMPTY") : "",
      field.readOnly ? fieldBadge("READONLY", "bad") : "",
      field.requiredLevel !== "none"
        ? fieldBadge(field.requiredLevel.toUpperCase(), "warn")
        : "",
      field.multiControl ? fieldBadge("MULTI CONTROL", "warn") : "",
      field.metadata?.isGlobalChoice ? fieldBadge("GLOBAL CHOICE", "good") : "",
    ].join("");
    const locations = (field.locations || [])
      .map((x) =>
        [
          x.tabLabel || x.tabName || "(no tab)",
          x.sectionLabel || x.sectionName || "(no section)",
          x.controlName || "(control)",
        ]
          .map(escapeHtml)
          .join(" / "),
      )
      .join("<br>");
    return `<article class="card fieldCard"><b>${escapeHtml(field.displayName || field.logicalName)}</b><div class="muted">${escapeHtml(field.logicalName)}${field.schemaName ? ` Â· ${escapeHtml(field.schemaName)}` : ""} Â· ${escapeHtml(field.attributeType)}</div><div class="fieldValue">${field.metadataOnly ? "(not available in runtime context)" : field.empty ? "(empty)" : escapeHtml(field.displayValue)}</div>${field.rawValue && field.rawValue !== field.displayValue ? `<div class="muted">Raw: ${escapeHtml(field.rawValue)}</div>` : ""}<div class="badges">${badges}</div><div class="locationList">${locations || "No bound form control."}</div><div class="muted">Required: ${escapeHtml(field.requiredLevel)} Â· Submit: ${escapeHtml(field.submitMode)} Â· Controls: ${field.controlCount}${field.metadata?.isGlobalChoice ? ` Â· Global Choice: ${escapeHtml(field.metadata.globalChoiceName || "Yes")}` : ""}</div><div class="fieldActions"><button class="b fieldAction" data-a="logical" data-i="${index}">Copy Logical</button>${field.schemaName ? `<button class="b fieldAction" data-a="schema" data-i="${index}">Copy Schema</button>` : ""}<button class="b fieldAction" data-a="value" data-i="${index}">Copy Value</button>${field.onForm ? `<button class="b fieldAction" data-a="focus" data-i="${index}">Highlight</button>` : ""}<button class="b fieldAction" data-a="metadata" data-i="${index}">Metadata</button><button class="b fieldAction" data-a="deps" data-i="${index}">Dependencies</button></div></article>`;
  }
  function renderFieldGroups(rows, key) {
    const groups = new Map();
    for (const f of rows) {
      const names = [
        ...new Set(
          (f.locations || [])
            .map((x) =>
              key === "tab"
                ? x.tabLabel || x.tabName
                : x.sectionLabel || x.sectionName,
            )
            .filter(Boolean),
        ),
      ];
      if (!names.length) names.push("Not On Form");
      for (const n of names) {
        if (!groups.has(n)) groups.set(n, []);
        groups.get(n).push(f);
      }
    }
    return [...groups]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(
        ([n, fs]) =>
          `<details open class="fieldGroup"><summary><b>${escapeHtml(n)}</b> Â· ${fs.length} fields</summary><div class="grid">${fs.map((f) => allFieldsCard(f, f.__index)).join("")}</div></details>`,
      )
      .join("");
  }
  async function copyFieldText(button, text) {
    await navigator.clipboard.writeText(String(text ?? ""));
    const o = button.textContent;
    button.textContent = "Copied";
    button.classList.add("copyOk");
    setTimeout(() => {
      button.textContent = o;
      button.classList.remove("copyOk");
    }, 1200);
  }
  function metadataValue(value) {
    if (Array.isArray(value)) return value.join(", ");
    if (value === true) return "Yes";
    if (value === false) return "No";
    return value == null || value === "" ? "Not specified" : String(value);
  }
  function openFieldMetadata(field) {
    const metadata = field.metadata || {};
    const rows = [
      ["Logical Name", field.logicalName], ["Schema Name", field.schemaName || metadata.schemaName],
      ["Display Name", field.displayName || metadata.displayName], ["Attribute Type", field.attributeType || metadata.attributeType],
      ["Metadata Type", metadata.metadataType], ["Description", metadata.description], ["Format", metadata.format],
      ["Required Level", metadata.requiredLevel || field.requiredLevel], ["Audit", metadata.audit], ["Secured", metadata.secured],
      ["Targets", metadata.targets], ["Precision", metadata.precision], ["Length", metadata.maxLength],
      ["Default Value", metadata.defaultValue], ["Custom", metadata.isCustom], ["Managed", metadata.isManaged],
    ];
    openDrawer(`Field Metadata: ${field.logicalName}`, `<table><thead><tr><th>Property</th><th>Value</th></tr></thead><tbody>${rows.map(([name,value]) => `<tr><td><b>${escapeHtml(name)}</b></td><td>${escapeHtml(metadataValue(value))}</td></tr>`).join("")}</tbody></table><div class="row"><button id="openFullMetadata" class="b pri">Open Full Metadata Browser</button></div>`, (drawerRoot) => {
      drawerRoot.querySelector("#openFullMetadata").onclick = async () => {
        closeDrawer(); view = "metadata"; search = ""; byId("query").value = "";
        shadow.querySelectorAll(".top").forEach((item) => item.classList.toggle("active", item.dataset.view === "metadata"));
        await render();
        if (typeof window.D365MetadataView?.openColumn === "function") await window.D365MetadataView.openColumn(allFieldsData.entityName, field.logicalName);
        else byId("status").textContent = "Metadata Browser column navigation is unavailable.";
      };
    });
  }
  function bindAllFieldsActions(root, all) {
    root.querySelectorAll(".fieldAction").forEach(
      (b) =>
        (b.onclick = async () => {
          const f = all[+b.dataset.i],
            a = b.dataset.a;
          if (a === "logical") return copyFieldText(b, f.logicalName);
          if (a === "schema") return copyFieldText(b, f.schemaName);
          if (a === "value")
            return copyFieldText(b, f.rawValue || f.displayValue || "");
          if (a === "focus") {
            const r = await send("tool", {
              action: "focusField",
              field: f.logicalName,
            });
            byId("status").textContent = r.message || r.error;
            return;
          }
          if (a === "deps") {
            window.D365ImpactView.open(
              await window.D365ImpactAnalyzer.analyze(f.logicalName),
            );
            return;
          }
          if (a === "metadata") { openFieldMetadata(f); return; }
        }),
    );
  }
  async function renderAllFields() {
    try {
      if (!allFieldsData) {
        byId("status").textContent = "";
        byId("body").innerHTML = '<div class="status">Loading merged runtime and Dataverse field metadata...</div>';
      }
      const data = await ensureAllFields(),
        modes = [
          ["flat", "Flat"],
          ["tabs", "Tabs"],
          ["sections", "Sections"],
          ["hidden", "Hidden"],
          ["notOnForm", "Not On Form"],
          ["metadataOnly", "Metadata Only"],
        ];
      byId("subtabs").innerHTML = modes
        .map(
          ([k, l]) =>
            `<button class="b allFieldsMode ${allFieldsMode === k ? "active" : ""}" data-mode="${k}">${l}</button>`,
        )
        .join("");
      byId("subtabs")
        .querySelectorAll(".allFieldsMode")
        .forEach(
          (b) =>
            (b.onclick = () => {
              allFieldsMode = b.dataset.mode;
              search = "";
              byId("query").value = "";
              fieldFilters.clear();
              render();
            }),
        );
      const all = (data.fields || []).map((f, i) => ({ ...f, __index: i })),
        summary = {
          total: all.length,
          visible: all.filter((f) => f.visible).length,
          hidden: all.filter((f) => f.onForm && !f.visible).length,
          dirty: all.filter((f) => f.dirty).length,
          notOnForm: all.filter((f) => f.runtimeAvailable && !f.onForm).length,
          metadataOnly: all.filter((f) => f.metadataOnly).length,
          multi: all.filter((f) => f.multiControl).length,
        };
      let rows = all.filter(
        (f) => !search || JSON.stringify(f).toLowerCase().includes(search),
      );
      if (allFieldsMode === "hidden")
        rows = rows.filter((f) => f.onForm && !f.visible);
      if (allFieldsMode === "notOnForm") rows = rows.filter((f) => f.runtimeAvailable && !f.onForm);
      if (allFieldsMode === "metadataOnly") rows = rows.filter((f) => f.metadataOnly);
      const vf = ["visible", "hidden"].filter((k) => fieldFilters.has(k));
      rows = rows.filter(
        (f) =>
          (!vf.length ||
            vf.some((k) =>
              k === "visible" ? f.visible : f.onForm && !f.visible,
            )) &&
          (!fieldFilters.has("dirty") || f.dirty) &&
          (!fieldFilters.has("empty") || f.empty) &&
          (!fieldFilters.has("readOnly") || f.readOnly === true) &&
          (!fieldFilters.has("required") || ["required", "systemrequired", "applicationrequired"].includes(String(f.requiredLevel || "").toLowerCase())) &&
          (!fieldFilters.has("globalChoice") || f.metadata?.isGlobalChoice === true),
      );
      const sums = [
        [summary.total, "Total"],
        [summary.visible, "Visible"],
        [summary.hidden, "Hidden"],
        [summary.dirty, "Dirty"],
        [summary.notOnForm, "Not On Form"],
        [summary.metadataOnly, "Metadata Only"],
        [summary.multi, "Multi Control"],
      ]
        .map((x) => `<div class="fieldStat"><b>${x[0]}</b>${x[1]}</div>`)
        .join("");
      const filters = [
        ["visible", "Visible"],
        ["hidden", "Hidden"],
        ["dirty", "Dirty"],
        ["empty", "Empty"],
        ["readOnly", "Read Only"],
        ["required", "Required"],
        ["globalChoice", "Global Choices"],
      ]
        .map(
          ([k, l]) =>
            `<button class="b fieldFilter ${fieldFilters.has(k) ? "active" : ""}" data-filter="${k}">${l}</button>`,
        )
        .join("");
      let content =
        allFieldsMode === "tabs"
          ? renderFieldGroups(rows, "tab")
          : allFieldsMode === "sections"
            ? renderFieldGroups(rows, "section")
            : `<div class="grid">${rows.map((f) => allFieldsCard(f, f.__index)).join("")}</div>`;
      if (!rows.length)
        content =
          '<div class="muted">No fields match the selected mode, search, and filters.</div>';
      byId("body").innerHTML =
        `<div class="fieldSummary">${sums}</div><div class="row">${filters}</div>${content}`;
      byId("body")
        .querySelectorAll(".fieldFilter")
        .forEach(
          (b) =>
            (b.onclick = () => {
              const k = b.dataset.filter;
              fieldFilters.has(k)
                ? fieldFilters.delete(k)
                : fieldFilters.add(k);
              if(k==="globalChoice"&&fieldFilters.has(k))allFieldsData=null;
              render();
            }),
        );
      bindAllFieldsActions(byId("body"), all);
      byId("status").textContent =
        `${summary.total} merged table fields Â· ${rows.length} shown Â· ${data.formName || data.entityName}.`;
    } catch (e) {
      byId("body").innerHTML =
        `<div class="bad">${escapeHtml(e.message || e)}</div>`;
    }
  }
  function codeHtml(source, line) {
    return `<div class="code">${String(source || "")
      .split("\n")
      .map(
        (value, index) =>
          `<span class="line ${line === index + 1 ? "mark" : ""}"><span class="ln">${index + 1}</span>${escapeHtml(value)}</span>`,
      )
      .join("")}</div>`;
  }
  function openDrawer(title, html, after) {
    drawers.push({ title, html, after });
    renderDrawer();
  }
  function replaceDrawer(title, html, after) {
    if (drawers.length) drawers[drawers.length - 1] = { title, html, after };
    else drawers.push({ title, html, after });
    renderDrawer();
  }
  function renderDrawer() {
    const item = drawers.at(-1);
    if (!item) return closeDrawer();
    byId("drawer").classList.add("open");
    byId("drawerTitle").textContent = item.title;
    byId("drawerBody").innerHTML = item.html;
    byId("back").style.display = drawers.length > 1 ? "" : "none";
    item.after?.(byId("drawerBody"));
  }
  function closeDrawer() {
    cancelAnalysis();
    drawers = [];
    byId("drawer").classList.remove("open");
  }
  async function openLibrary(name) {
    const libraries = await ensureScan(),
      library = libraries.find((item) => item.libraryName === name);
    if (library)
      openDrawer(
        `Library: ${name}`,
        library.ok
          ? codeHtml(library.source)
          : `<div class="bad">${escapeHtml(library.error)}</div>`,
      );
  }
  async function openSourceLine(name, line, title) {
    const libraries = await ensureScan(),
      library = libraries.find((item) => item.libraryName === name);
    if (library?.ok)
      openDrawer(title, codeHtml(library.source, line), (root) =>
        root.querySelector(".mark")?.scrollIntoView({ block: "center" }),
      );
  }
  async function openFunction(row) {
    const fn = functions().find(
      (item) =>
        item.libraryName === row.libraryName &&
        item.functionName === row.functionName,
    );
    if (fn?.definitionLine)
      return openSourceLine(
        fn.libraryName,
        fn.definitionLine,
        `Function: ${fn.functionName}`,
      );
    openLibrary(row.libraryName);
  }
  function openField(name) {
    const rows = eventRows().filter(
      (item) => isFieldTarget(item) && item.targetName === name,
    );
    openDrawer(`Field: ${name}`, eventTable(rows), (root) =>
      bindEvents(rows, root),
    );
  }

  async function snapshots() { if (extensionUnavailable() || !chrome.storage?.local) return []; try { return (await chrome.storage.local.get("devLensSnapshots")).devLensSnapshots || []; } catch { return []; } }
  async function saveSnapshot() {
    const items = await snapshots();
    items.push({
      id: crypto.randomUUID(),
      name: prompt("Snapshot name", report.formName) || report.formName,
      savedOn: new Date().toISOString(),
      formName: report.formName,
      eventCount: eventRows().length,
      rows: structuredClone(eventRows()),
    });
    if (!extensionUnavailable() && chrome.storage?.local) { try { await chrome.storage.local.set({ devLensSnapshots: items }); } catch {} }
    byId("status").textContent = "Snapshot saved.";
  }
  async function compareSnapshots() {
    const items = await snapshots();
    if (items.length < 2)
      return '<div class="card">Save at least two snapshots.</div>';
    const first = items.at(-2),
      second = items.at(-1),
      identify = (item) =>
        [
          item.eventType,
          item.targetName,
          item.functionName,
          item.libraryName,
        ].join("|"),
      mapA = new Map(first.rows.map((item) => [identify(item), item])),
      mapB = new Map(second.rows.map((item) => [identify(item), item])),
      added = [...mapB]
        .filter(([key]) => !mapA.has(key))
        .map((item) => item[1]),
      removed = [...mapA].filter(([key]) => !mapB.has(key)).map((item) => item[1]),
      normalize = (item) => ({ enabled: item?.enabled ?? true, passExecutionContext: item?.passExecutionContext ?? true, parameters: item?.parameters ?? "", internal: item?.internal ?? false }),
      changed = [...mapB].filter(([key, value]) => mapA.has(key) && JSON.stringify(normalize(mapA.get(key))) !== JSON.stringify(normalize(value))).map(([key, after]) => ({ before: normalize(mapA.get(key)), after: normalize(after), event: after })),
      changedTable = `<table><thead><tr><th>Event</th><th>Target</th><th>Function</th><th>Library</th><th>Before Enabled</th><th>After Enabled</th><th>Before Execution Context</th><th>After Execution Context</th><th>Before Parameters</th><th>After Parameters</th></tr></thead><tbody>${changed.map((change) => `<tr><td>${escapeHtml(change.event.eventType)}</td><td>${escapeHtml(change.event.targetName)}</td><td>${escapeHtml(change.event.functionName)}</td><td>${escapeHtml(change.event.libraryName)}</td><td>${escapeHtml(change.before.enabled)}</td><td>${escapeHtml(change.after.enabled)}</td><td>${escapeHtml(change.before.passExecutionContext)}</td><td>${escapeHtml(change.after.passExecutionContext)}</td><td>${escapeHtml(change.before.parameters)}</td><td>${escapeHtml(change.after.parameters)}</td></tr>`).join("")}</tbody></table>`;
    return `<div class="card">${escapeHtml(first.name)} to ${escapeHtml(second.name)} Â· Added ${added.length} Â· Removed ${removed.length} Â· Changed ${changed.length}</div><h3>Added</h3>${eventTable(added)}<h3>Removed</h3>${eventTable(removed)}<h3>Changed</h3>${changed.length ? changedTable : '<div class="muted">No changed handler settings.</div>'}`;
  }

  const toolkitSections = [
    {
      name: "Navigation",
      description:
        "Open current Dataverse context in related platform experiences.",
      tools: [
        [
          "Open Record API",
          "recordApi",
          "Open the current saved record through the Dataverse Web API.",
        ],
        [
          "Open Table in Power Apps",
          "maker",
          "Search and open a table in the Power Apps table designer.",
        ],
        [
          "Edit Current Form",
          "formEditor",
          "Open the current form in the Power Apps form designer.",
        ],
        [
          "Advanced Find",
          "advancedFind",
          "Open Advanced Find for the current Dynamics environment.",
        ],
      ],
    },
    {
      name: "Form Actions",
      description: "Inspect or temporarily change the current form.",
      tools: [
        [
          "All Fields",
          "allFields",
          "Retrieve every returned Web API property for the current saved record.",
        ],
        [
          "Show Hidden Fields",
          "showFields",
          "Make hidden form controls visible.",
        ],
        [
          "Show Hidden Tabs & Sections",
          "showTabs",
          "Make hidden tabs and sections visible.",
        ],
        [
          "Find and Highlight Field",
          "findField",
          "Search form fields and focus the selected control.",
        ],
        [
          "Show Logical Names",
          "logical",
          "Append logical names beside fields.",
        ],
        [
          "Clear Logical Names",
          "clearLogical",
          "Remove appended logical names.",
        ],
        [
          "Show Choice Values",
          "choices",
          "Show runtime choice labels and values.",
        ],
        [
          "Restore Original State",
          "restore",
          "Restore UI state captured by DevLens.",
        ],
      ],
    },
    {
      name: "Processes",
      description: "Inspect processes related to the current table.",
      tools: [
        [
          "Table Processes",
          "processes",
          "Business rules, workflows, flows, BPFs, custom actions, and custom APIs.",
        ],
      ],
    },
    {
      name: "Administration",
      description: "Developer administration utilities.",
      tools: [
        [
          "Security and Audit Toolkit",
          "securityAudit",
          "Inspect user roles, table access, role privileges, roles by privilege, and record audit history.",
        ],
        [
          "Impersonation",
          "impersonation",
          "Select a user for DevLens Web API requests.",
        ],
        [
          "God Mode",
          "god",
          "Temporarily show and unlock form elements and remove required levels.",
        ],
      ],
    },
    {
      name: "Debug",
      description: "Dependency and runtime diagnostics.",
      tools: [
        [
          "Dependency Impact Analyzer",
          "impact",
          "Analyze field reads, writes, UI changes, and function calls.",
        ],
        [
          "Function Dependency Hierarchy",
          "hierarchy",
          "Build a bounded business-function hierarchy.",
        ],
        ["Ribbon Debug", "ribbon", "Reload with ribbon debugging enabled."],
      ],
    },
  ];

  function toolMarkup() {
    return toolkitSections
      .map((section) => {
        const tools = section.tools.filter(
          (tool) =>
            !search ||
            `${tool[0]} ${tool[2]} ${section.name}`
              .toLowerCase()
              .includes(search),
        );
        if (!tools.length) return "";
        return `<section class="toolSection"><h3>${escapeHtml(section.name)}</h3><div class="muted">${escapeHtml(section.description)}</div><div class="grid">${tools.map((tool) => `<button class="b tool toolCard" data-action="${tool[1]}"><b>${escapeHtml(tool[0])}</b><span>${escapeHtml(tool[2])}</span></button>`).join("")}</div></section>`;
      })
      .join("");
  }

  function genericRows(rows, columns) {
    return `<table><thead><tr>${columns.map((column) => `<th>${escapeHtml(column[0])}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(column[2] ? column[2](row[column[1]], row) : row[column[1]])}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }
  function searchableDrawer(title, rows, placeholder, renderRows) {
    openDrawer(
      title,
      `<div class="row"><input id="drawerSearch" class="i search" placeholder="${escapeHtml(placeholder)}"><span id="drawerCount" class="muted"></span></div><div id="drawerRows"></div>`,
      (root) => {
        const query = root.querySelector("#drawerSearch"),
          output = root.querySelector("#drawerRows"),
          count = root.querySelector("#drawerCount");
        function draw() {
          const value = query.value.toLowerCase(),
            filtered = rows.filter(
              (row) =>
                !value || JSON.stringify(row).toLowerCase().includes(value),
            );
          count.textContent = `${filtered.length} results`;
          output.innerHTML = renderRows(filtered);
        }
        query.oninput = draw;
        draw();
        query.focus();
      },
    );
  }

  async function openAllFields() {
    byId("status").textContent = "Loading all record fields...";
    const response = await send("tool", { action: "allFields" });
    byId("status").textContent = response.ok
      ? `${response.data.length} fields loaded.`
      : response.error;
    if (!response.ok) return;
    searchableDrawer(
      `All Fields: ${response.entityName}`,
      response.data,
      "Search field, value, formatted value, or type",
      (rows) =>
        genericRows(rows, [
          ["Field", "field"],
          ["Raw Value", "value"],
          ["Formatted Value", "formatted"],
          ["Type", "type"],
        ]),
    );
  }

  function processMarkup(data) {
    const total = (data.groups || []).reduce(
      (sum, group) => sum + group.items.length,
      0,
    );
    return `${data.impersonation ? `<div class="banner impersonating">Web API request executed as ${escapeHtml(data.impersonation.fullname || data.impersonation.domainname)}</div>` : ""}${data.warning ? `<div class="card warn">${escapeHtml(data.warning)}</div>` : ""}<div class="card">Current table: <b>${escapeHtml(data.entityName)}</b> Â· ${total} process records</div>${(data.groups || []).map((group, index) => `<details ${group.items.length ? "open" : ""}><summary><b>${escapeHtml(group.title)}</b><span class="processCount">${group.items.length}</span></summary>${group.items.length ? `<table><thead><tr><th>Name</th><th>Description / Unique Name</th><th>Modified</th><th></th></tr></thead><tbody>${group.items.map((item, itemIndex) => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.description || item.uniqueName || "")}</td><td>${escapeHtml(item.modifiedon || "")}</td><td><button class="b openProcess" data-g="${index}" data-i="${itemIndex}">Open</button></td></tr>`).join("")}</tbody></table>` : '<div class="muted">None found.</div>'}</details>`).join("")}`;
  }
  async function openProcesses() {
    byId("status").textContent = "Loading table processes...";
    openDrawer(
      "Table Processes",
      '<div class="status">Loading business rules, workflows, BPFs, actions, and APIs...</div>',
    );
    const response = await send("tool", { action: "processes" });
    byId("status").textContent = response.ok
      ? "Processes loaded."
      : response.error;
    if (!response.ok)
      return replaceDrawer(
        "Table Processes",
        `<div class="bad">${escapeHtml(response.error)}</div>`,
      );
    replaceDrawer(
      `Processes: ${response.entityName}`,
      processMarkup(response),
      (root) =>
        root.querySelectorAll(".openProcess").forEach(
          (button) =>
            (button.onclick = () => {
              const item =
                response.groups[+button.dataset.g].items[+button.dataset.i];
              window.open(item.openUrl, "_blank", "noopener");
            }),
        ),
    );
  }

  async function runTool(action) {
    if (action === "securityAudit") {
      if (typeof window.D365SecurityAuditView?.open !== "function") {
        byId("status").textContent = "Security and Audit Toolkit is unavailable. Reload the Dynamics tab.";
        return;
      }
      byId("status").textContent = "";
      window.D365SecurityAuditView.open();
      return;
    }
    if (action === "allFields") return openAllFields();
    if (action === "processes") return openProcesses();
    if (action === "impact") {
      const fields = [
        ...new Set(
          eventRows()
            .filter((item) => isFieldTarget(item))
            .map((item) => item.targetName),
        ),
      ];
      openDrawer(
        "Dependency Impact",
        fields.length
          ? `<div class="grid">${fields.map((name) => `<button class="b impactField" data-field="${escapeHtml(name)}">${escapeHtml(name)}</button>`).join("")}</div>`
          : '<div class="bad">No registered fields found.</div>',
        (root) =>
          root
            .querySelectorAll(".impactField")
            .forEach(
              (button) =>
                (button.onclick = async () =>
                  window.D365ImpactView.open(
                    await window.D365ImpactAnalyzer.analyze(
                      button.dataset.field,
                    ),
                  )),
            ),
      );
      return;
    }
    if (action === "hierarchy") {
      const libraries = await ensureScan(),
        defs = window.D365CallGraphIndexer.catalog(libraries).defs;
      openDrawer(
        "Function Dependency Hierarchy",
        `<div class="row"><input id="hierarchySearch" class="i search" placeholder="Search function or library"><span id="hierarchyCount" class="muted"></span></div><div id="hierarchyList" class="grid"></div>`,
        (root) => {
          const query = root.querySelector("#hierarchySearch"),
            output = root.querySelector("#hierarchyList"),
            count = root.querySelector("#hierarchyCount");
          function draw() {
            const value = query.value.toLowerCase(),
              filtered = defs.filter(
                (item) =>
                  !value ||
                  `${item.functionName} ${item.libraryName}`
                    .toLowerCase()
                    .includes(value),
              );
            count.textContent = `${filtered.length} functions`;
            output.innerHTML = filtered
              .slice(0, 150)
              .map(
                (item) =>
                  `<button class="b hierarchyFunction" data-key="${escapeHtml(item.libraryName + "|" + item.functionName + "|" + item.line)}">${escapeHtml(item.functionName)}<br><span class="muted">${escapeHtml(item.libraryName)}</span></button>`,
              )
              .join("");
          }
          query.oninput = draw;
          output.onclick = async (event) => {
            const button = event.target.closest(".hierarchyFunction");
            if (!button) return;
            const selected = defs.find(
              (item) =>
                item.libraryName + "|" + item.functionName + "|" + item.line ===
                button.dataset.key,
            );
            const result = await window.D365FunctionDependencyService.analyze(
              selected,
              (countValue, max) =>
                (byId("status").textContent =
                  `Building hierarchy: ${countValue} of maximum ${max} nodes...`),
            );
            byId("status").textContent = "";
            window.D365FunctionDependencyView.open(result);
          };
          draw();
        },
      );
      return;
    }
    if (action === "maker") {
      byId("status").textContent = "Table is loading...";
      openDrawer(
        "Open Table in Power Apps",
        '<div class="status">Table is loading...</div>',
      );
      const response = await send("metadataTables");
      if (!response.ok) return (byId("status").textContent = response.error);
      const data = response.data || [];
      replaceDrawer(
        "Open Table in Power Apps",
        `<div class="row"><input id="makerSearch" class="i search" placeholder="Search display, logical or schema name"><span id="makerCount" class="muted"></span></div><div id="makerRows" class="grid"></div>`,
        (root) => {
          const query = root.querySelector("#makerSearch"),
            output = root.querySelector("#makerRows"),
            count = root.querySelector("#makerCount");
          function draw() {
            const value = query.value.toLowerCase(),
              filtered = data.filter(
                (item) => !value || item.search.includes(value),
              );
            count.textContent = `${filtered.length} tables`;
            output.innerHTML = filtered
              .slice(0, 300)
              .map(
                (item) =>
                  `<button class="b makerTable" data-name="${escapeHtml(item.logicalName)}"><b>${escapeHtml(item.displayName || item.logicalName)}</b><br><span class="muted">${escapeHtml(item.logicalName)} Â· ${escapeHtml(item.schemaName)}</span></button>`,
              )
              .join("");
          }
          query.oninput = draw;
          output.onclick = async (event) => {
            const button = event.target.closest(".makerTable");
            if (!button) return;
            const result = await send("tool", {
              action: "maker",
              logicalName: button.dataset.name,
            });
            byId("status").textContent =
              result.message || result.error || "Completed";
          };
          draw();
          query.focus();
        },
      );
      return;
    }
    if (action === "findField") {
      const response = await send("tool", { action: "listFields" });
      if (!response.ok) return (byId("status").textContent = response.error);
      searchableDrawer(
        "Find and Highlight Field",
        response.data || [],
        "Search field, type, tab, or section",
        (rows) =>
          `<table><thead><tr><th>Field</th><th>Type</th><th>Tab</th><th>Section</th><th>Visible</th><th>Required</th><th></th></tr></thead><tbody>${rows
            .map((item) => {
              const location = item.locations?.[0] || {};
              return `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.type)}</td><td>${escapeHtml(location.tabLabel || location.tab)}</td><td>${escapeHtml(location.sectionLabel || location.section)}</td><td>${escapeHtml(location.visible)}</td><td>${escapeHtml(item.required)}</td><td><button class="b focusField" data-field="${escapeHtml(item.name)}">Highlight</button></td></tr>`;
            })
            .join("")}</tbody></table>`,
      );
      setTimeout(
        () =>
          byId("drawerBody")
            .querySelectorAll(".focusField")
            .forEach(
              (button) =>
                (button.onclick = async () => {
                  const result = await send("tool", {
                    action: "focusField",
                    field: button.dataset.field,
                  });
                  byId("status").textContent = result.message || result.error;
                }),
            ),
        0,
      );
      return;
    }
    if (action === "choices") {
      const response = await send("tool", { action: "choices" });
      if (!response.ok) return (byId("status").textContent = response.error);
      const rows = (response.data || []).flatMap((item) =>
        (item.options || []).map((option) => ({
          field: item.field,
          current: item.text,
          value: option.value,
          label: option.text,
          selected: String(item.value) === String(option.value),
        })),
      );
      searchableDrawer(
        "Choice Values",
        rows,
        "Search field, label, or value",
        (items) =>
          genericRows(items, [
            ["Field", "field"],
            ["Option Text", "label"],
            ["Value", "value"],
            [
              "Current / Selected",
              "current",
              (value, row) =>
                `${row.selected ? "Selected Â· " : ""}${value || ""}`,
            ],
          ]),
      );
      return;
    }
    const response = await send("tool", { action });
    byId("status").textContent =
      response.message || response.error || "Completed";
  }

  function openCommandPalette() {
    if (!host) init();
    visible = true; minimized = false; host.style.display = "";
    byId("panel").classList.remove("min");
    byId("minimize").textContent = "Minimize";
    byId("minimize").title = "Minimize DevLens (Alt+P)";
    byId("minimize").setAttribute("aria-label", byId("minimize").title);
    const commands = [["Events", "view", "events"], ["JS Explorer", "view", "js"], ["Fields Explorer", "view", "fields"], ["Metadata Browser", "view", "metadata"], ["Process Explorer", "view", "processes"], ["Developer Toolkit", "view", "tools"], ["Refresh all data", "refresh", ""], ...toolkitSections.flatMap((section) => section.tools.map((tool) => [tool[0], "tool", tool[1]]))];
    openDrawer("Command Palette", `<div class="row"><input id="paletteSearch" class="i search" placeholder="Search commands"><span id="paletteCount" class="muted"></span></div><div id="paletteRows" class="grid"></div>`, (drawerRoot) => {
      const input = drawerRoot.querySelector("#paletteSearch"), output = drawerRoot.querySelector("#paletteRows"), count = drawerRoot.querySelector("#paletteCount");
      const draw = () => { const term = input.value.toLowerCase(), rows = commands.filter((command) => !term || command.join(" ").toLowerCase().includes(term)); count.textContent = `${rows.length} commands`; output.innerHTML = rows.map((command,index) => `<button class="b paletteCommand" data-i="${index}">${escapeHtml(command[0])}</button>`).join(""); output.querySelectorAll(".paletteCommand").forEach((button) => button.onclick = async () => { const command = rows[+button.dataset.i]; closeDrawer(); if (command[1] === "refresh") return load(true); if (command[1] === "tool") { view = "tools"; await render(); return runTool(command[2]); } view = command[2]; search = ""; fieldFilters.clear(); allFieldsMode = "flat"; byId("query").value = ""; shadow.querySelectorAll(".top").forEach((item) => item.classList.toggle("active", item.dataset.view === view)); return render(); }); };
      input.oninput = draw; input.onkeydown = (event) => { if (event.key === "Escape") closeDrawer(); }; draw(); input.focus();
    });
  }
  function about() {
    const sections = [
      ["Quick Start", `Open a saved model-driven app record, open DevLens, and select a top-level explorer. Use Refresh after changing forms, solutions, scripts, security, or metadata. Use Alt+P to minimize or restore DevLens and Alt+Shift+D to open the Command Palette.`],
      ["Events Explorer", `Reads published Form XML registrations for form OnLoad/OnSave handlers, field OnChange handlers, tab state handlers, and BPF events. Filter registrations, search targets/functions/libraries, open fields, inspect functions, and export event data as CSV or JSON.`],
      ["JS Explorer", `Loads registered JavaScript web resources and indexes libraries, registered functions, definitions, and occurrences. Open a library or jump to an exact function line when DevLens can resolve it.`],
      ["Fields Explorer", `Merges runtime attributes with Dataverse column metadata. Review visible, hidden, dirty, required, read-only, not-on-form, metadata-only, and multi-control fields. Copy names and values, highlight controls, open metadata, or run dependency analysis.`],
      ["Snapshots and Compare", `Save event-registration snapshots and compare the latest two snapshots for added, removed, or changed handler settings.`],
      ["Metadata Browser", `Explore tables, columns, keys, choices, and relationships using Dataverse metadata. Search by display, logical, or schema name and open detailed metadata views.`],
      ["Process Explorer", `Inspect table-related real-time workflows, background workflows, business rules, cloud flows, BPFs, custom actions, custom APIs, and plug-in steps. Plug-in details include messages, stages, modes, filtering attributes, assemblies, and images when returned.`],
      ["Custom Control Inspector", `Inspect runtime controls and published Form XML evidence, classify Custom Controls and Dataset Controls, and review primary or configured field bindings.`],
      ["Security and Audit Toolkit", `Search users and direct roles, inspect user table access, review a root role privilege matrix, find roles by table privilege, and investigate record audit history. Security results include role business units and access levels.`],
      ["Audit Explorer", `Select a table, search a record by record ID, primary name, or configured alternate-key field, then load grouped Audit History cards. Expand an event to review field changes, filter by field/value/user/event/date, and open lookup records when audit metadata contains a valid table and record ID.`],
      ["Developer Toolkit", `Use navigation, form actions, process tools, administration tools, impact analysis, function hierarchy, impersonation, Ribbon Debug, Custom Control Inspector, and Security and Audit Toolkit. Form mutations are temporary and can be restored with Restore Original State.`],
      ["Command Palette", `Press Alt+Shift+D and search available explorers, refresh, and Developer Toolkit actions. Press Escape to close the palette.`],
      ["Impersonation", `Applies CallerObjectId to DevLens fetch-based Dataverse Web API requests in a dedicated Dynamics tab. It does not impersonate the visible Dynamics UI session.`],
      ["Keyboard Shortcuts", `Alt+P: minimize or restore DevLens. Alt+Shift+D: open the Command Palette. Browser-managed extension shortcuts can be reviewed or reassigned from the browser extension shortcuts page if another extension or browser feature reserves the same combination.`],
      ["Safety and Privacy", `DevLens runs in the authenticated Dynamics context. It does not store passwords or access tokens. Form visibility, required-level, and disabled-state changes are temporary. Security and audit results depend on the current caller's Dataverse privileges.`],
    ];
    return `<div class="card"><h2>Dynamics 365 & Dataverse DevLens</h2><p><b>Version ${APP_VERSION}</b></p><p>Developer diagnostics and investigation tools for Dynamics 365 model-driven apps and Microsoft Dataverse.</p><p><b>Author: ${escapeHtml(APP_AUTHOR)}</b></p></div>${sections.map(([title, description], index) => `<details ${index < 2 ? "open" : ""}><summary><b>${escapeHtml(title)}</b></summary><p>${description}</p></details>`).join("")}<div class="card muted">Dynamics 365 & Dataverse DevLens v${APP_VERSION} Â· Created by ${escapeHtml(APP_AUTHOR)}</div>`;
  }
  async function render() {
    configure();
    const hasFormReport = !!report?.formId;
    if (view === "sqlstudio") {
      byId("subtabs").innerHTML = "";
      byId("status").textContent = "Read-only SQL4CDS integration (local companion required).";
      window.DevLensSqlStudioView?.renderInto?.(byId("body"));
      if (!window.DevLensSqlStudioView) byId("body").innerHTML = '<div class="card">Query Studio view failed to load. Reload the Dynamics tab.</div>';
      return;
    }
    if (!hasFormReport && ["events", "js", "fields"].includes(view)) {
      byId("subtabs").innerHTML = "";
      byId("body").innerHTML =
        '<div class="card">Open a model-driven record form to use this view.</div>';
      return;
    }
    if (view === "events") {
      const allRows = eventRows();
      const counts = {
        all: allRows.length,
        load: allRows.filter((item) => item.eventType === "ONLOAD").length,
        save: allRows.filter((item) => item.eventType === "ONSAVE").length,
        fields: new Set(
          allRows
            .filter((item) => item.category === "FIELD")
            .map((item) => item.targetName),
        ).size,
        tabs: new Set(
          allRows
            .filter((item) => item.category === "TAB")
            .map((item) => item.targetName),
        ).size,
        bpf: allRows.filter((item) => item.category === "BPF").length,
        enabled: allRows.filter((item) => item.enabled).length,
        disabled: allRows.filter((item) => !item.enabled).length,
      };
      const tabs = [
        ["all", "All"],
        ["load", "OnLoad"],
        ["save", "OnSave"],
        ["fields", "Fields"],
        ["tabs", "Tabs"],
        ["bpf", "BPF"],
        ["enabled", "Enabled"],
        ["disabled", "Disabled"],
      ];
      byId("subtabs").innerHTML = tabs
        .map(
          (tab) =>
            `<button class="b eventTab ${eventTab === tab[0] ? "active" : ""}" data-tab="${tab[0]}">${tab[1]} ${counts[tab[0]]}</button>`,
        )
        .join("");
      byId("subtabs")
        .querySelectorAll(".eventTab")
        .forEach(
          (button) =>
            (button.onclick = () => {
              eventTab = button.dataset.tab;
              render();
            }),
        );
      const rows = filteredEvents();
      byId("body").innerHTML = ["fields", "tabs"].includes(eventTab)
        ? groupedEventTable(rows, "targetName")
        : eventTable(rows);
      ["fields", "tabs"].includes(eventTab)
        ? bindGroupedEvents(rows, "targetName")
        : bindEvents(rows);
      byId("status").textContent =
        `${allRows.length} registrations cached Â· ${rows.length} shown.`;
    } else if (view === "js") await renderJavaScript();
    else if (view === "fields") await renderAllFields();
    else if (view === "snapshots") {
      const items = (await snapshots()).filter(
        (item) =>
          !search || JSON.stringify(item).toLowerCase().includes(search),
      );
      byId("subtabs").innerHTML = "";
      byId("body").innerHTML = genericRows(items, [
        ["Name", "name"],
        ["Form", "formName"],
        ["Saved", "savedOn"],
        ["Events", "eventCount"],
      ]);
    } else if (view === "compare")
      byId("body").innerHTML = await compareSnapshots();
    else if (view === "metadata") {
      byId("status").textContent = "";
      await window.D365MetadataView.render(byId("body"));
      byId("status").textContent = "";
    } else if (view === "processes") {
      byId("subtabs").innerHTML = "";
      byId("status").textContent = "";
      await window.D365ProcessView.render(byId("body"));
      byId("status").textContent = "";
    } else if (view === "tools") {
      byId("subtabs").innerHTML = "";
      byId("body").innerHTML = toolMarkup();
      byId("body")
        .querySelectorAll(".tool")
        .forEach(
          (button) => (button.onclick = () => runTool(button.dataset.action)),
        );
    } else byId("body").innerHTML = about();
  }

  async function load(force = false) {
    if (report && !force) return render();
    byId("status").textContent = "";
    byId("body").innerHTML = '<div class="status">Loading registered form events and Dynamics context...</div>';
    if (force) {
      window.D365MetadataView.reset?.();
      window.D365ProcessView?.reset?.();
      await send("clearMetadataCache");
    }
    const response = await send("report");
    if (response.ok) {
      report = response;
      scan = null;
      allFieldsData = null;
      byId("context").textContent=`${response.entityName} Â· ${response.formName}`;
      byId("status").textContent=response.surface?.kind==="sidePane"?`Side pane Â· ${response.surface.mode==="internal"?"Internal UCI form-state inspection":"Persisted inspection"}`:"";
      warmSecondaryExplorers();ensureDirtyPolling();
      return render();
    }
    const shell = await send("shellContext");
    report = { rows: [], formId: null, formName: "", entityName: null };
    scan = null;
    allFieldsData = null;
    byId("context").textContent = shell.ok
      ? "Dynamics context Â· no record form"
      : "Dynamics context unavailable";
    byId("status").textContent = response.error;
    render();
  }
  let dirtyPollTimer=null,dirtyPollBusy=false;
  async function pollDirtyFields(){
    if(dirtyPollBusy||view!=="fields"||!allFieldsData||!Array.isArray(allFieldsData.fields))return;
    dirtyPollBusy=true;
    try{
      const state=await send("dirtyFieldState");
      if(!state?.ok||!Array.isArray(state.rows))return;
      const map=new Map(state.rows.filter(x=>x?.logicalName).map(x=>[String(x.logicalName).toLowerCase(),x]));
      let changed=false;
      for(const field of allFieldsData.fields){
        if(!field?.logicalName)continue;
        const live=map.get(String(field.logicalName).toLowerCase());
        if(!live)continue;
        if(field.dirty!==live.dirty){field.dirty=live.dirty;changed=true}
        if(JSON.stringify(field.value)!==JSON.stringify(live.value)){field.value=live.value;field.formattedValue=live.formattedValue;field.empty=live.value==null||live.value==="";changed=true}
      }
      if(changed)await renderAllFields();
    }catch(error){console.warn("[DevLens] dirty polling failed",error)}
    finally{dirtyPollBusy=false}
  }
  function ensureDirtyPolling(){if(dirtyPollTimer)return;dirtyPollTimer=setInterval(()=>void pollDirtyFields(),700)}
  function warmSecondaryExplorers(){void ensureScan().catch(()=>{});void send("processExplorer",{force:false}).catch(()=>{})}
  function saveFile(name, blob) {
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
  function download(kind) {
    const rows = filteredEvents(),
      content =
        kind === "json"
          ? JSON.stringify(rows, null, 2)
          : [
              Object.keys(rows[0] || {}).join(","),
              ...rows.map((row) =>
                Object.values(row)
                  .map(
                    (value) => `"${String(value ?? "").replace(/"/g, '""')}"`,
                  )
                  .join(","),
              ),
            ].join("\r\n");
    saveFile(
      `devlens-events.${kind}`,
      new Blob([content], {
        type: kind === "json" ? "application/json" : "text/csv",
      }),
    );
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "DEVLENS_TOGGLE") toggle();
    else if (message.type === "DEVLENS_PALETTE") openCommandPalette();
    else if (message.type === "DEVLENS_MINIMIZE") {
      if (!host) init();
      if (!visible) {
        visible = true;
        host.style.display = "";
      }
      toggleMinimize();
    }
  });
  window.D365AnalyzerApi = Object.freeze({
    version: APP_VERSION,
    escape: escapeHtml,
    send,
    getReport: () => structuredClone(report),
    getActiveSurface: () => { const surface=activeSurfacePayload(); return surface ? structuredClone(surface) : null; },
    getJavaScriptScan: async () => structuredClone(await ensureScan()),
    openDrawer,
    openLibrary,
    openFunction,
    openSourceLine,
    openFunctionByName: (libraryName, functionName, line) =>
      line
        ? openSourceLine(libraryName, line, `Function: ${functionName}`)
        : openFunction({ libraryName, functionName }),
    saveFile,
  });
  void send("startMetadataIndex", { mode: "automatic" });
})();

