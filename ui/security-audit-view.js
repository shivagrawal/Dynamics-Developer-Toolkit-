(() => {
  "use strict";
  if (window.D365SecurityAuditView?.version === "5.15.1") return;
  let envs = [], envTabId = 0, ctx = null, requestToken = 0;
  const E = v => window.D365AnalyzerApi.escape(v);
  const send = (action, payload = {}) => new Promise(resolve => chrome.runtime.sendMessage({ type: "DEVLENS_SECURITY_AUDIT", action, payload: { ...payload, environmentTabId: envTabId } }, resolve));
  const fail = (root, result) => { const target = root.querySelector("#saResult"); if (target) target.innerHTML = `<div class="card bad">${E(result?.error || "Request failed.")}</div>`; };
  function sortableTable(rows, columns) {
    if (!rows.length) return '<div class="card muted">No matching rows were returned.</div>';
    return `<table class="saSortable"><thead><tr>${columns.map((c, i) => `<th><button class="b saSort" data-col="${i}">${E(c[0])} ↕</button></th>`).join("")}</tr></thead><tbody>${rows.map(row => `<tr>${columns.map(c => `<td>${E(row[c[1]] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  }
  function wireSorting(root) {
    root.querySelectorAll("table.saSortable").forEach(table => {
      if (table.dataset.sortReady) return;
      table.dataset.sortReady = "1";
      table.querySelectorAll(".saSort").forEach(button => button.onclick = () => {
        const index = Number(button.dataset.col), ascending = button.dataset.direction !== "asc", rows = [...table.tBodies[0].rows];
        rows.sort((a, b) => a.cells[index].textContent.trim().localeCompare(b.cells[index].textContent.trim(), undefined, { numeric: true, sensitivity: "base" }) * (ascending ? 1 : -1));
        rows.forEach(row => table.tBodies[0].appendChild(row));
        button.dataset.direction = ascending ? "asc" : "desc";
        button.textContent = button.textContent.replace(/[↕▲▼]/g, "").trim() + (ascending ? " ▲" : " ▼");
      });
    });
  }
  const submit = (form, handler) => form.addEventListener("submit", event => { event.preventDefault(); handler(); });
  function shell(root) {
    root.innerHTML = `<div class="banner"><div class="row"><b>Environment</b><select id="saEnv" class="i search">${envs.map(x => `<option value="${x.tabId}">${E(x.organizationName)} · ${E(x.clientUrl)}</option>`).join("")}</select></div><span class="muted">Authenticated Dynamics tabs only. No credentials are stored.</span></div><div class="row"><button class="b saTab active" data-tab="roles">User Roles</button><button class="b saTab" data-tab="userTable">User Table Access</button><button class="b saTab" data-tab="rolePrivileges">Role Privileges</button><button class="b saTab" data-tab="rolesByPrivilege">Roles by Privilege</button><button class="b saTab" data-tab="audit">Record Audit</button></div><div id="saBody"></div>`;
    envTabId = envs[0]?.tabId || 0;
    root.querySelector("#saEnv").onchange = async () => { envTabId = Number(root.querySelector("#saEnv").value); const r = await send("context"); if (r.ok) { ctx = r.data; renderTab(root, "roles"); } };
    root.querySelectorAll(".saTab").forEach(button => button.onclick = () => { root.querySelectorAll(".saTab").forEach(x => x.classList.toggle("active", x === button)); renderTab(root, button.dataset.tab); });
    send("context").then(r => { if (r.ok) ctx = r.data; renderTab(root, "roles"); });
    new MutationObserver(() => wireSorting(root)).observe(root, { childList: true, subtree: true });
  }
  function userSearch() {
    return `<form id="saUserForm" class="card"><div class="row"><input id="saUserQuery" class="i search" placeholder="User full name"><button class="b" type="submit">Find User</button></div><div id="saUsers" class="row"></div><div id="saSelectedUser" class="muted">No user selected.</div></form>`;
  }
  function wireUsers(body) {
    const form = body.querySelector("#saUserForm"), input = body.querySelector("#saUserQuery"), list = body.querySelector("#saUsers"), selected = body.querySelector("#saSelectedUser");
    submit(form, async () => {
      list.innerHTML = '<span class="status">Searching users…</span>';
      const r = await send("users", { query: input.value.trim() }); if (!r.ok) { list.innerHTML = `<span class="bad">${E(r.error)}</span>`; return; }
      list.innerHTML = (r.data || []).map(x => `<button type="button" class="b saUser" data-id="${E(x.id)}" data-name="${E(x.name)}" data-email="${E(x.email)}" data-bu="${E(x.businessUnit)}">${E(x.name)} · ${E(x.businessUnit)} · ${E(x.email)}</button>`).join("") || '<span class="muted">No user found.</span>';
      list.querySelectorAll(".saUser").forEach(button => button.onclick = () => {
        body.dataset.userId = button.dataset.id; input.value = button.dataset.name; list.innerHTML = "";
        selected.innerHTML = `<b>${E(button.dataset.name)}</b> · ${E(button.dataset.bu)} · ${E(button.dataset.email)} <button type="button" id="saChangeUser" class="b">Change User</button>`;
        selected.querySelector("#saChangeUser").onclick = () => { body.dataset.userId = ""; selected.textContent = "No user selected."; input.focus(); };
      });
    });
  }
  function roleSearch() {
    return `<form id="saRoleForm" class="card"><div class="row"><input id="saRoleQuery" class="i search" placeholder="Root security role name"><button class="b" type="submit">Find Role</button></div><div id="saRoles" class="row"></div><div id="saSelectedRole" class="muted">No role selected.</div></form>`;
  }
  function wireRoles(body) {
    const form = body.querySelector("#saRoleForm"), input = body.querySelector("#saRoleQuery"), list = body.querySelector("#saRoles"), selected = body.querySelector("#saSelectedRole");
    submit(form, async () => {
      list.innerHTML = '<span class="status">Searching root roles…</span>';
      const r = await send("roles", { query: input.value.trim() }); if (!r.ok) { list.innerHTML = `<span class="bad">${E(r.error)}</span>`; return; }
      list.innerHTML = (r.data || []).map(x => `<button type="button" class="b saRole" data-id="${E(x.roleId)}" data-name="${E(x.name)}" data-bu="${E(x.businessUnit)}">${E(x.name)} · ${E(x.businessUnit)}</button>`).join("") || '<span class="muted">No root role found.</span>';
      list.querySelectorAll(".saRole").forEach(button => button.onclick = () => {
        body.dataset.roleId = button.dataset.id; input.value = button.dataset.name; list.innerHTML = "";
        selected.innerHTML = `<b>${E(button.dataset.name)}</b> · ${E(button.dataset.bu)} <button type="button" id="saChangeRole" class="b">Change Role</button>`;
        selected.querySelector("#saChangeRole").onclick = () => { body.dataset.roleId = ""; selected.textContent = "No role selected."; input.focus(); };
      });
    });
  }
  function tableSearch(id = "saTable") {
    return `<form id="${id}Form" class="card"><div class="row"><input id="${id}" class="i search" placeholder="Search table display, logical, or schema name"><button class="b" type="submit">Find Table</button></div><div id="${id}Results" class="row"></div><div id="${id}Selected" class="muted">No table selected.</div></form>`;
  }
  function wireTables(body, id = "saTable") {
    const form = body.querySelector(`#${id}Form`), input = body.querySelector(`#${id}`), list = body.querySelector(`#${id}Results`), selected = body.querySelector(`#${id}Selected`);
    submit(form, async () => {
      list.innerHTML = '<span class="status">Loading table metadata…</span>';
      const r = await send("tables", { query: input.value.trim() }); if (!r.ok) { list.innerHTML = `<span class="bad">${E(r.error)}</span>`; return; }
      list.innerHTML = (r.data || []).map(x => `<button type="button" class="b saTableChoice" data-logical="${E(x.logicalName)}" data-label="${E(x.displayName)}" data-schema="${E(x.schemaName)}">${E(x.displayName)} · ${E(x.logicalName)} · ${E(x.schemaName)}</button>`).join("") || '<span class="muted">No table found.</span>';
      list.querySelectorAll(".saTableChoice").forEach(button => button.onclick = () => {
        body.dataset.table = button.dataset.logical; input.value = `${button.dataset.label} (${button.dataset.logical})`; list.innerHTML = "";
        selected.innerHTML = `<b>${E(button.dataset.label)}</b> · ${E(button.dataset.logical)} · ${E(button.dataset.schema)} <button type="button" id="${id}Change" class="b">Change Table</button>`;
        selected.querySelector(`#${id}Change`).onclick = () => { body.dataset.table = ""; selected.textContent = "No table selected."; input.focus(); };
      });
    });
  }
  function matrix(rows) {
    const tableRows = rows.filter(x => x.table), operations = ["Create", "Read", "Write", "Delete", "Append", "AppendTo", "Assign", "Share"], map = new Map();
    for (const row of tableRows) {
      const value = map.get(row.table) || { table: row.table, displayName: row.tableDisplayName || row.table, ...Object.fromEntries(operations.map(x => [x, "None"])) };
      if (operations.includes(row.operation)) value[row.operation] = row.depth;
      map.set(row.table, value);
    }
    return sortableTable([...map.values()].sort((a, b) => a.displayName.localeCompare(b.displayName)), [["Table", "displayName"], ["Logical Name", "table"], ...operations.map(x => [x === "AppendTo" ? "Append To" : x, x])]);
  }
  const compactValue = value => {
    const text = String(value ?? "");
    if (!text) return '<span class="muted">Empty</span>';
    if (text.length <= 120) return `<span>${E(text)}</span>`;
    return `<details><summary class="b">View value (${text.length} characters)</summary><pre style="white-space:pre-wrap;word-break:break-word">${E(text)}</pre></details>`;
  };
  const safeGuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value || ""));
  const safeLogicalName = value => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(String(value || ""));
  function lookupUrl(clientUrl, lookup) {
    if (!lookup || !safeGuid(lookup.id) || !safeLogicalName(lookup.entity)) return "";
    return `${String(clientUrl || "").replace(/\/$/, "")}/main.aspx?pagetype=entityrecord&etn=${encodeURIComponent(lookup.entity)}&id=${encodeURIComponent(lookup.id)}`;
  }
  function renderLookupValue(lookup, fallback, clientUrl) {
    if (!lookup) return compactValue(fallback);
    const display = lookup.name || lookup.id || "Lookup value unavailable";
    const link = lookupUrl(clientUrl, lookup);
    const details = [lookup.entity ? `Table: ${lookup.entity}` : "", lookup.id ? `ID: ${lookup.id}` : ""].filter(Boolean).join(" · ");
    return `<div><b>${E(display)}</b>${details ? `<div class="muted">${E(details)}</div>` : ""}${link ? `<a class="b" href="${E(link)}" target="_blank" rel="noopener noreferrer">Open Record</a>` : '<div class="muted">Record link unavailable because lookup table or ID was not returned.</div>'}</div>`;
  }
  function renderAuditGroups(root, groups) {
    const query = (root.querySelector("#saAuditFilter")?.value || "").trim().toLowerCase();
    const event = root.querySelector("#saAuditEvent")?.value || "All";
    const filtered = groups.filter(group => (!query || group.search.includes(query)) && (event === "All" || group.event === event));
    const count = root.querySelector("#saAuditCount");
    if (count) count.textContent = `${filtered.length} audit event${filtered.length === 1 ? "" : "s"}`;
    const target = root.querySelector("#saAuditGroups");
    if (!target) return;
    target.innerHTML = filtered.length ? filtered.map((group, index) => {
      const date = group.createdOn ? new Date(group.createdOn).toLocaleString() : "Unknown time";
      const changes = group.changes || [];
      return `<details class="card auditGroup" ${index === 0 ? "open" : ""}><summary><span class="badge">${E(group.event || "Event")}</span> <b>${E(date)}</b> <span class="muted">${E(group.changedBy || "Unknown user")} · ${changes.length} field${changes.length === 1 ? "" : "s"} changed</span></summary><div class="row"><span class="muted">Audit ID: ${E(group.auditId || "Not returned")}</span></div>${changes.length ? `<table class="saSortable"><thead><tr><th><button class="b saSort" data-col="0">Changed Field ↕</button></th><th><button class="b saSort" data-col="1">Old Value ↕</button></th><th><button class="b saSort" data-col="2">New Value ↕</button></th></tr></thead><tbody>${changes.map(change => `<tr><td><b>${E(change.field)}</b>${change.type === "lookup" ? '<div class="muted">Lookup</div>' : ""}</td><td>${change.type === "lookup" ? renderLookupValue(change.oldLookup, change.oldValue, root.auditClientUrl) : compactValue(change.oldValue)}</td><td>${change.type === "lookup" ? renderLookupValue(change.newLookup, change.newValue, root.auditClientUrl) : compactValue(change.newValue)}</td></tr>`).join("")}</tbody></table>` : '<div class="muted">This event did not return field-level values.</div>'}</details>`;
    }).join("") : '<div class="card muted">No audit events match the current filters.</div>';
    wireSorting(root);
  }
  async function loadAuditSearchMetadata(body) {
    if (!body.dataset.table) return;
    const target = body.querySelector("#saAuditSearchFields");
    target.innerHTML = '<span class="status">Loading primary name and alternate keys…</span>';
    const result = await send("tableSearchMetadata", { table: body.dataset.table });
    if (!result.ok) { target.innerHTML = `<span class="bad">${E(result.error)}</span>`; return; }
    body.auditMetadata = result.data;
    target.innerHTML = `<div class="row"><select id="saAuditField" class="i">${(result.data.fields || []).map(field => `<option value="${E(field.logicalName)}" data-mode="${E(field.mode)}">${E(field.label)} · ${E(field.logicalName)} · ${E(field.source)}</option>`).join("")}</select><input id="saAuditValue" class="i search" placeholder="Enter record ID, primary name, order number, or alternate key"><button id="saAuditFindRecord" class="b" type="button">Find Records</button></div><div id="saAuditRecords" class="row"></div><div id="saSelectedRecord" class="muted">No record selected.</div>`;
    const find = async () => {
      const option = target.querySelector("#saAuditField").selectedOptions[0], value = target.querySelector("#saAuditValue").value.trim();
      if (!value) return;
      const records = target.querySelector("#saAuditRecords");
      records.innerHTML = '<span class="status">Searching matching records…</span>';
      const response = await send("recordSearch", { table: body.dataset.table, field: option.value, value, mode: option.dataset.mode });
      if (!response.ok) { records.innerHTML = `<span class="bad">${E(response.error)}</span>`; return; }
      records.innerHTML = (response.data.rows || []).map(row => `<button type="button" class="b saAuditRecord" data-id="${E(row.id)}" data-name="${E(row.name)}" data-match="${E(row.match)}">${E(row.name)} · ${E(row.match || row.id)}</button>`).join("") || '<span class="muted">No matching record found.</span>';
      records.querySelectorAll(".saAuditRecord").forEach(button => button.onclick = () => {
        body.dataset.recordId = button.dataset.id; records.innerHTML = "";
        target.querySelector("#saSelectedRecord").innerHTML = `<b>${E(button.dataset.name)}</b> · ${E(button.dataset.id)} <button id="saChangeRecord" type="button" class="b">Change Record</button>`;
        target.querySelector("#saChangeRecord").onclick = () => { body.dataset.recordId = ""; target.querySelector("#saSelectedRecord").textContent = "No record selected."; };
      });
    };
    target.querySelector("#saAuditFindRecord").onclick = find;
    target.querySelector("#saAuditValue").addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); find(); } });
  }
  async function renderTab(root, tab) {
    const body = root.querySelector("#saBody");
    if (tab === "roles") {
      body.innerHTML = `${userSearch()}<button id="saRun" class="b">Show Direct User Roles</button><div id="saResult"></div>`; wireUsers(body);
      body.querySelector("#saRun").onclick = async () => { if (!body.dataset.userId) return fail(body, { error: "Select a user first." }); body.querySelector("#saResult").innerHTML = '<div class="status">Loading direct user roles…</div>'; const r = await send("userRoles", { userId: body.dataset.userId }); if (!r.ok) return fail(body, r); body.querySelector("#saResult").innerHTML = sortableTable(r.data || [], [["Role", "name"], ["Role BU", "businessUnit"], ["Role ID", "roleId"]]); };
      return;
    }
    if (tab === "userTable") {
      body.innerHTML = `${userSearch()}${tableSearch()}<button id="saRun" class="b">Show Role Contributions</button><div id="saResult"></div>`; wireUsers(body); wireTables(body);
      body.querySelector("#saRun").onclick = async () => { if (!body.dataset.userId || !body.dataset.table) return fail(body, { error: "Select a user and table first." }); const token = ++requestToken; body.querySelector("#saResult").innerHTML = '<div class="status">Executing the validated user-role-family privilege query for the selected table…</div>'; const r = await send("userTable", { userId: body.dataset.userId, table: body.dataset.table }); if (token !== requestToken) return; if (!r.ok) return fail(body, r); body.querySelector("#saResult").innerHTML = sortableTable(r.data || [], [["Role", "roleName"], ["Role BU", "roleBusinessUnit"], ["Privilege", "privilegeName"], ["Access Level", "depth"]]); };
      return;
    }
    if (tab === "rolePrivileges") {
      body.innerHTML = `${roleSearch()}<button id="saRun" class="b">Show Root Role Privileges</button><div id="saResult"></div>`; wireRoles(body);
      body.querySelector("#saRun").onclick = async () => { if (!body.dataset.roleId) return fail(body, { error: "Select a root role first." }); body.querySelector("#saResult").innerHTML = '<div class="status">Loading role privileges, table metadata, and access levels…</div>'; const r = await send("rolePrivileges", { roleId: body.dataset.roleId }); if (!r.ok) return fail(body, r); body.querySelector("#saResult").innerHTML = matrix(r.data || []); };
      return;
    }
    if (tab === "rolesByPrivilege") {
      body.innerHTML = `${tableSearch("saPrivilegeTable")}<div class="row"><select id="saOperation" class="i"><option>Create</option><option selected>Read</option><option>Write</option><option>Delete</option><option>Append</option><option>AppendTo</option><option>Assign</option><option>Share</option></select><button id="saRun" class="b">Find Roles</button></div><div id="saResult"></div>`; wireTables(body, "saPrivilegeTable");
      body.querySelector("#saRun").onclick = async () => { if (!body.dataset.table) return fail(body, { error: "Select a table first." }); body.querySelector("#saResult").innerHTML = '<div class="status">Executing the validated table-to-privilege-to-role query…</div>'; const r = await send("rolesByPrivilege", { table: body.dataset.table, operation: body.querySelector("#saOperation").value }); if (!r.ok) return fail(body, r); body.querySelector("#saResult").innerHTML = sortableTable(r.data || [], [["Role", "roleName"], ["Role BU", "roleBusinessUnit"], ["Privilege", "privilegeName"], ["Access Level", "depth"]]); };
      return;
    }
    body.innerHTML = `<div class="banner"><b>Record Audit Explorer</b><br>Search by record ID, primary name, or configured alternate-key fields. Audit events are grouped like the model-driven app Audit History experience.</div>${tableSearch("saAuditTablePicker")}<div id="saAuditSearchFields" class="card muted">Select a table to load record-search categories.</div><div class="row"><button id="saLoadAudit" class="b">Load Audit History</button></div><div id="saResult"></div>`;
    wireTables(body, "saAuditTablePicker");
    const tableObserver = new MutationObserver(() => { if (body.dataset.table && body.dataset.auditPrepared !== body.dataset.table) { body.dataset.auditPrepared = body.dataset.table; loadAuditSearchMetadata(body); } });
    tableObserver.observe(body.querySelector("#saAuditTablePickerSelected"), { childList: true, subtree: true });
    if (ctx?.currentTable && ctx?.currentRecordId) {
      body.dataset.table = ctx.currentTable; body.dataset.recordId = ctx.currentRecordId; body.dataset.auditPrepared = ctx.currentTable;
      body.querySelector("#saAuditTablePicker").value = `${ctx.currentTable} (current record)`;
      body.querySelector("#saAuditTablePickerSelected").innerHTML = `<b>Current record</b> · ${E(ctx.currentTable)} · ${E(ctx.currentRecordId)}`;
      loadAuditSearchMetadata(body).then(() => { const selected = body.querySelector("#saSelectedRecord"); if (selected) selected.innerHTML = `<b>Current record</b> · ${E(ctx.currentRecordId)}`; });
    }
    body.querySelector("#saLoadAudit").onclick = async () => {
      if (!body.dataset.table || !body.dataset.recordId) return fail(body, { error: "Select a table and matching record first." });
      const result = body.querySelector("#saResult");
      result.innerHTML = '<div class="status">Loading and grouping audit history…</div>';
      const response = await send("audit", { table: body.dataset.table, recordId: body.dataset.recordId });
      if (!response.ok) return fail(body, response);
      body.auditGroups = response.data.groups || [];
      result.auditClientUrl = response.data.clientUrl || ctx?.clientUrl || "";
      result.innerHTML = `<div class="row"><input id="saAuditFilter" class="i search" placeholder="Search changed field, old value, new value, user, event, or date"><select id="saAuditEvent" class="i"><option>All</option><option>Create</option><option>Update</option><option>Delete</option><option>Access</option></select><button id="saAuditExpand" class="b">Expand All</button><button id="saAuditCollapse" class="b">Collapse All</button><span id="saAuditCount" class="muted"></span></div><div id="saAuditGroups"></div>${response.data.moreRecords ? '<div class="banner warn">More audit history exists in Dataverse. This release displays the first retrieved page.</div>' : ""}`;
      const redraw = () => renderAuditGroups(result, body.auditGroups);
      result.querySelector("#saAuditFilter").oninput = redraw;
      result.querySelector("#saAuditEvent").onchange = redraw;
      result.querySelector("#saAuditExpand").onclick = () => result.querySelectorAll(".auditGroup").forEach(x => x.open = true);
      result.querySelector("#saAuditCollapse").onclick = () => result.querySelectorAll(".auditGroup").forEach(x => x.open = false);
      redraw();
    };
  }
  async function open() {
    window.D365AnalyzerApi.openDrawer("Security and Audit Toolkit", '<div class="status">Discovering authenticated Dynamics environments…</div>', async root => {
      const r = await send("environments"); if (!r.ok || !r.data?.length) { root.innerHTML = `<div class="card bad">${E(r.error || "No authenticated Dynamics environment tab was found.")}</div>`; return; }
      envs = r.data; shell(root);
    });
  }
  window.D365SecurityAuditView = Object.freeze({ version: "5.15.1", open, reset: () => { envs = []; envTabId = 0; ctx = null; requestToken++; } });
})();
