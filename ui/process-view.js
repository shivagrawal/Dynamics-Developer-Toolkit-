(() => {
  "use strict";
  if (window.D365ProcessView?.version === "5.11.2") return;

  let root;
  let data = null;
  let table = "";
  let activeCategory = "all";
  let query = "";
  let groupBy = "operation";
  let showMicrosoft = false;
  let tablePickerOpen = false;
  let tableQuery = "";
  let searchTimer = 0;

  const E = (value) => D365AnalyzerApi.escape(value);
  const send = (action, payload = {}) =>
    new Promise((resolve) =>
      chrome.runtime.sendMessage(
        { type: "DEVLENS_PROCESS_EXPLORER_V2", action, payload },
        resolve,
      ),
    );
  const text = (value) =>
    value == null || value === ""
      ? "Not specified"
      : Array.isArray(value)
        ? value.join(", ")
        : typeof value === "boolean"
          ? value
            ? "Yes"
            : "No"
          : String(value);
  const chips = (values, empty = "None configured") =>
    values?.length
      ? `<div class="badges">${values.map((value) => `<span class="badge">${E(value)}</span>`).join("")}</div>`
      : `<span class="muted">${E(empty)}</span>`;
  const pluginCategory = () =>
    (data?.categories || []).find((category) => category.id === "plugins");
  const allPlugins = () => pluginCategory()?.items || [];
  const selectedTable = () =>
    (data?.tables || []).find((item) => item.logicalName === table);

  function matches(item) {
    if (!query) return true;
    const term = query.toLowerCase();
    const searchable = [
      item.name,
      item.description,
      item.sdkMessage,
      item.operation,
      item.pluginAssembly,
      item.pluginType,
      item.primaryTable,
      item.secondaryTable,
      item.pipelineStage,
      item.executionMode,
      ...(item.filteringAttributes || []),
      ...(item.preImages || []).flatMap((image) => [image.name, image.alias, ...(image.attributes || [])]),
      ...(item.postImages || []).flatMap((image) => [image.name, image.alias, ...(image.attributes || [])]),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return searchable.includes(term);
  }

  function pluginGroups(items) {
    const groups = new Map();
    for (const item of items) {
      let keys = [item.sdkMessage || "Unknown operation"];
      if (groupBy === "triggerField" && String(item.sdkMessage).toLowerCase() === "update")
        keys = item.filteringAttributes?.length
          ? item.filteringAttributes
          : ["Update: no filtering attributes"];
      for (const key of keys) {
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(item);
      }
    }
    return [...groups].sort((left, right) => left[0].localeCompare(right[0]));
  }

  function summaryRow(item) {
    const filters = String(item.sdkMessage).toLowerCase() === "update"
      ? `<div class="muted">Trigger fields: ${E(item.filteringAttributes?.join(", ") || "No filtering attributes")}</div>`
      : "";
    return `<article class="card processSummary" data-id="${E(item.id)}">
      <div class="row" style="border:0;padding:0;align-items:flex-start">
        <div class="grow">
          <b>${E(item.name)}</b>
          <div>${E(item.pluginType)} <span class="muted">· ${E(item.pluginAssembly)}</span></div>
          <div class="badges">
            <span class="badge">${E(item.classification)}</span>
            <span class="badge">${E(item.sdkMessage)}</span>
            <span class="badge">${E(item.pipelineStage)}</span>
            <span class="badge">${E(item.executionMode)}</span>
            <span class="badge">Rank ${E(text(item.rank))}</span>
          </div>
          ${filters}
          <div class="muted">Pre-image fields: ${(item.preImages || []).reduce((sum, image) => sum + (image.attributes || []).length, 0)} · Post-image fields: ${(item.postImages || []).reduce((sum, image) => sum + (image.attributes || []).length, 0)}</div>
        </div>
        <button class="b pri pluginDetails" data-id="${E(item.id)}">Details</button>
      </div>
    </article>`;
  }

  function imageDetails(title, images) {
    return `<section class="card"><h3>${E(title)} (${images.length} registrations, ${images.reduce((sum, image) => sum + (image.attributes || []).length, 0)} selected fields)</h3>
      ${images.length
        ? images
            .map(
              (image) => `<details open><summary><b>${E(image.name)}</b> · ${E(text(image.alias))} · ${(image.attributes || []).length} fields</summary>
                <div class="muted">Message property: ${E(text(image.messageProperty))}${image.relatedAttribute ? ` · Related attribute: ${E(image.relatedAttribute)}` : ""}</div>
                <div style="margin-top:8px">${chips(image.attributes, "All attributes or none explicitly returned")}</div>
                ${image.description ? `<p>${E(image.description)}</p>` : ""}
              </details>`,
            )
            .join("")
        : '<div class="muted">No registered images returned.</div>'}
    </section>`;
  }

  function openPluginDetails(item) {
    const related = allPlugins().filter(
      (candidate) =>
        candidate.id !== item.id &&
        candidate.relatedPluginKey &&
        candidate.relatedPluginKey === item.relatedPluginKey,
    );
    const updateFields = String(item.sdkMessage).toLowerCase() === "update"
      ? `<section class="card"><h3>Update trigger fields (${item.filteringAttributes?.length || 0})</h3>
          ${chips(item.filteringAttributes, "No filtering attributes returned")}
          <div class="banner" style="margin-top:10px"><b>Registration interpretation</b><br>${E(item.triggerSummary)}</div>
        </section>`
      : `<section class="card"><div class="banner"><b>Registration interpretation</b><br>${E(item.triggerSummary)}</div></section>`;
    const body = `<div class="grid">
        <section class="card"><h3>Plug-in</h3><b>${E(item.pluginType)}</b><div>${E(item.pluginAssembly)} ${E(item.pluginAssemblyVersion)}</div><div class="badges"><span class="badge">${E(item.classification)}</span></div></section>
        <section class="card"><h3>Operation</h3><div>${E(item.sdkMessage)} · ${E(item.pipelineStage)}</div><div>${E(item.executionMode)} · Rank ${E(text(item.rank))}</div></section>
        <section class="card"><h3>Tables</h3><div>Primary: ${E(item.primaryTable)}</div><div>Secondary: ${E(text(item.secondaryTable))}</div></section>
        <section class="card"><h3>Configuration</h3><div>Secure configured: ${E(text(item.hasSecureConfiguration))}</div><div>Unsecure configured: ${E(text(item.hasUnsecureConfiguration))}</div></section>
      </div>
      ${item.description ? `<section class="card"><h3>Description</h3><p>${E(item.description)}</p></section>` : ""}
      ${updateFields}
      ${imageDetails("Pre-images", item.preImages || [])}
      ${imageDetails("Post-images", item.postImages || [])}
      <section class="card"><h3>Registration details</h3><table><tbody>
        <tr><td><b>Deployment</b></td><td>${E(text(item.deploymentType))}</td></tr>
        <tr><td><b>State / Status</b></td><td>${E(text(item.statecode))} / ${E(text(item.statuscode))}</td></tr>
        <tr><td><b>Filtering attributes</b></td><td style="white-space:normal;overflow-wrap:anywhere">${E(text(item.filteringAttributes))}</td></tr>
        <tr><td><b>Step ID</b></td><td style="overflow-wrap:anywhere">${E(item.id)}</td></tr>
      </tbody></table></section>
      <section class="card"><h3>Other returned steps using the same plug-in type (${related.length})</h3>
        ${related.length
          ? related
              .map(
                (relatedItem) => `<div class="card"><b>${E(relatedItem.name)}</b><div>${E(relatedItem.sdkMessage)} · ${E(relatedItem.primaryTable)} · ${E(relatedItem.pipelineStage)} · Rank ${E(text(relatedItem.rank))}</div></div>`,
              )
              .join("")
          : '<div class="muted">No other returned registrations use this plug-in type.</div>'}
      </section>`;
    D365AnalyzerApi.openDrawer(`Plug-in Step: ${item.name}`, body);
  }

  function ordinaryCard(item) {
    return `<details class="card"><summary><b>${E(item.name)}</b> <span class="badge">${E(item.kind)}</span></summary>
      ${item.description ? `<p>${E(item.description)}</p>` : ""}
      <table><tbody>${Object.entries(item)
        .filter(([key]) => !["id", "name", "kind", "description", "openUrl"].includes(key))
        .map(([key, value]) => `<tr><td><b>${E(key.replace(/([A-Z])/g, " $1"))}</b></td><td>${E(text(value))}</td></tr>`)
        .join("")}</tbody></table>
      ${item.openUrl ? `<button class="b openProcess" data-url="${E(encodeURIComponent(item.openUrl))}">Open configuration</button>` : ""}
    </details>`;
  }

  function renderResults() {
    const output = root.querySelector(".processResults");
    if (!output || !data) return;
    const categories = data.categories || [];
    const plugins = allPlugins();
    const displayedPlugins = plugins
      .filter((item) => showMicrosoft || item.classification !== "Microsoft")
      .filter(matches);
    let html = "";
    if (activeCategory === "all") {
      for (const category of categories.filter((item) => item.id !== "plugins")) {
        const items = (category.items || []).filter(matches);
        if (items.length)
          html += `<section><h3>${E(category.title)} (${items.length})</h3>${items.map(ordinaryCard).join("")}</section>`;
      }
    } else if (activeCategory !== "plugins") {
      const category = categories.find((item) => item.id === activeCategory);
      const items = (category?.items || []).filter(matches);
      html = items.length
        ? `<section><h3>${E(category.title)} (${items.length})</h3>${items.map(ordinaryCard).join("")}</section>`
        : '<div class="card muted">No matching definitions returned.</div>';
    }
    if (activeCategory === "all" || activeCategory === "plugins") {
      const hidden = plugins.filter((item) => item.classification === "Microsoft").length;
      html += `<section><h3>Plug-in steps (${displayedPlugins.length}${!showMicrosoft ? ` shown of ${plugins.length}; ${hidden} Microsoft/platform hidden` : ""})</h3>
        ${displayedPlugins.length
          ? pluginGroups(displayedPlugins)
              .map(
                ([name, items]) => `<details open class="pluginGroup"><summary><b>${E(groupBy === "triggerField" ? "Trigger field: " : "Operation: ")}${E(name)}</b> (${items.length})</summary><div>${items.map(summaryRow).join("")}</div></details>`,
              )
              .join("")
          : '<div class="card muted">No matching developer-relevant plug-in steps returned.</div>'}
      </section>`;
    }
    output.innerHTML = html || '<div class="card muted">No matching process definitions returned.</div>';
    output.querySelectorAll(".pluginDetails").forEach((button) => {
      button.onclick = () => {
        const item = plugins.find((candidate) => candidate.id === button.dataset.id);
        if (item) openPluginDetails(item);
      };
    });
    output.querySelectorAll(".openProcess").forEach((button) => {
      button.onclick = () => {
        const url = decodeURIComponent(button.dataset.url || "");
        if (/^https:\/\//i.test(url)) window.open(url, "_blank", "noopener,noreferrer");
      };
    });
  }

  function renderTableResults() {
    const container = root.querySelector(".tableResults");
    if (!container) return;
    const term = tableQuery.trim().toLowerCase();
    const rows = (data?.tables || [])
      .filter((item) =>
        !term ||
        item.logicalName.toLowerCase().includes(term) ||
        item.displayName.toLowerCase().includes(term) ||
        String(item.schemaName || "").toLowerCase().includes(term),
      )
      .slice(0, 100);
    container.hidden = !tablePickerOpen;
    container.innerHTML = rows.length
      ? rows
          .map(
            (item) => `<button class="b tableResult" data-table="${E(item.logicalName)}" style="display:block;width:100%;text-align:left;margin:4px 0"><b>${E(item.displayName)}</b><br><span class="muted">${E(item.logicalName)} · ${E(item.schemaName || "")}</span></button>`,
          )
          .join("")
      : '<div class="card muted">No matching table.</div>';
    container.querySelectorAll(".tableResult").forEach((button) => {
      button.onclick = () => {
        tablePickerOpen = false;
        tableQuery = "";
        load(button.dataset.table, false);
      };
    });
  }

  function bindShell() {
    root.querySelector(".tableSearch").onclick = () => {
      tablePickerOpen = true;
      renderTableResults();
    };
    root.querySelector(".tableSearch").oninput = (event) => {
      tableQuery = event.target.value;
      tablePickerOpen = true;
      renderTableResults();
    };
    root.querySelector(".refreshProcesses").onclick = () => load(table, true);
    root.querySelector(".processSearch").oninput = (event) => {
      query = event.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(renderResults, 80);
    };
    root.querySelectorAll(".processTab").forEach((button) => {
      button.onclick = () => {
        activeCategory = button.dataset.tab;
        root.querySelectorAll(".processTab").forEach((item) =>
          item.classList.toggle("active", item === button),
        );
        const controls = root.querySelector(".pluginControls");
        if (controls) controls.hidden = !["all", "plugins"].includes(activeCategory);
        renderResults();
      };
    });
    root.querySelector(".showMicrosoft").onchange = (event) => {
      showMicrosoft = event.target.checked;
      renderResults();
    };
    root.querySelector(".groupPlugins").onchange = (event) => {
      groupBy = event.target.value;
      renderResults();
    };
  }

  function renderShell() {
    const categories = data?.categories || [];
    const selected = selectedTable();
    root.innerHTML = `<div class="row" style="align-items:flex-start">
      <div class="grow" style="position:relative;min-width:320px">
        <input class="i search tableSearch" value="" placeholder="Search another table by display, logical, or schema name">
        <div class="muted">Selected: <b>${E(selected?.displayName || table)}</b> (${E(table)})</div>
        <div class="tableResults" hidden style="position:absolute;z-index:8;left:0;right:0;max-height:360px;overflow:auto;background:#0b1224;border:1px solid #475569;border-radius:8px;padding:8px"></div>
      </div>
      <button class="b refreshProcesses">Refresh</button>
      <input class="i search processSearch" value="${E(query)}" placeholder="Search step, message, assembly, type, or field">
    </div>
    <div class="row"><button class="b processTab ${activeCategory === "all" ? "active" : ""}" data-tab="all">All</button>${categories
      .map(
        (category) => `<button class="b processTab ${activeCategory === category.id ? "active" : ""}" data-tab="${E(category.id)}">${E(category.title)} ${category.ok ? category.count : "!"}</button>`,
      )
      .join("")}</div>
    <div class="row pluginControls" ${!["all", "plugins"].includes(activeCategory) ? "hidden" : ""}>
      <label><input type="checkbox" class="showMicrosoft" ${showMicrosoft ? "checked" : ""}> Show Microsoft/platform steps (${allPlugins().filter((item) => item.classification === "Microsoft").length})</label>
      <select class="i groupPlugins"><option value="operation">Group plug-ins by operation</option><option value="triggerField">Group Update plug-ins by triggering field</option></select>
    </div>
    ${data.partial ? '<div class="card warn"><b>Partial results</b><br>One or more categories could not be read. Available categories remain usable.</div>' : ""}
    ${categories.filter((category) => !category.ok).map((category) => `<div class="card bad"><b>${E(category.title)}</b><br>${E(category.error)}</div>`).join("")}
    <div class="processResults"></div>`;
    root.querySelector(".groupPlugins").value = groupBy;
    bindShell();
    renderResults();
  }

  async function load(selectedTableName, force) {
    table = selectedTableName;
    root.innerHTML = '<div class="status">Loading process and plug-in registration details…</div>';
    const response = await send("load", { table, force });
    if (!response?.ok) {
      root.innerHTML = `<div class="card bad">${E(response?.error || "Process Explorer could not be loaded.")}</div>`;
      return;
    }
    data = response;
    table = response.entityName;
    query = "";
    tableQuery = "";
    tablePickerOpen = false;
    renderShell();
  }

  async function render(target, force = false) {
    root = target;
    if (data && !force) {
      renderShell();
      return;
    }
    root.innerHTML = '<div class="status">Resolving available Dataverse tables…</div>';
    const tables = await send("tables");
    if (!tables?.ok) {
      root.innerHTML = `<div class="card bad">${E(tables?.error || "Tables could not be loaded.")}</div>`;
      return;
    }
    table = table || tables.currentTable || tables.tables?.[0]?.logicalName || "";
    await load(table, force);
  }

  function reset() {
    data = null;
    table = "";
    activeCategory = "all";
    query = "";
    groupBy = "operation";
    showMicrosoft = false;
    tablePickerOpen = false;
    tableQuery = "";
  }

  window.D365ProcessView = Object.freeze({ version: "5.11.2", render, reset });
})();
