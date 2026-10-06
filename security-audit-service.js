"use strict";
function devLensSecurityAuditBridge(action, p) {
  "use strict";
  const S = v => v == null ? "" : String(v);
  const G = v => S(v).replace(/[{}]/g, "");
  const X = v => S(v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&apos;");
  const functionDepth = v => ({ 0: "User", 1: "Business Unit", 2: "Parent:Child Business Unit", 3: "Organization", 4: "Record Filter", Basic: "User", Local: "Business Unit", Deep: "Parent:Child Business Unit", Global: "Organization", RecordFilter: "Record Filter" }[v] || ({ 0: "User", 1: "Business Unit", 2: "Parent:Child Business Unit", 3: "Organization", 4: "Record Filter" }[Number(v)]) || S(v || "None"));
  const maskDepth = v => ({ 1: "User", 2: "Business Unit", 4: "Parent:Child Business Unit", 8: "Organization" }[Number(v)] || S(v || "None"));
  const base = Xrm.Utility.getGlobalContext().getClientUrl();
  const cache = (window.__DEVLENS_SECURITY_AUDIT_CACHE_5143 ??= {
    userRoles: new Map(), rolePrivileges: new Map(), privileges: null, tables: null
  });
  async function get(path) {
    const response = await fetch(`${base}/api/data/v9.2/${path}`, {
      credentials: "same-origin",
      headers: { Accept: "application/json", "OData-MaxVersion": "4.0", "OData-Version": "4.0", Prefer: 'odata.include-annotations="*"' }
    });
    if (!response.ok) {
      let message = "";
      try { message = (await response.json())?.error?.message || ""; } catch { }
      throw Error(message || `${response.status} ${response.statusText}`);
    }
    return response.json();
  }
  async function all(path) {
    const rows = [];
    let next = path;
    while (next) {
      const data = await get(next.replace(`${base}/api/data/v9.2/`, ""));
      rows.push(...(data.value || []));
      next = data["@odata.nextLink"] || "";
    }
    return rows;
  }
  const fxAll = xml => all(`roles?fetchXml=${encodeURIComponent(xml)}`);
  async function context() {
    const g = Xrm.Utility.getGlobalContext();
    return {
      clientUrl: base,
      environmentId: G(g.organizationSettings?.bapEnvironmentId),
      organizationName: g.organizationSettings?.friendlyName || g.organizationSettings?.uniqueName || new URL(base).hostname,
      currentTable: Xrm.Page?.data?.entity?.getEntityName?.() || "",
      currentRecordId: G(Xrm.Page?.data?.entity?.getId?.())
    };
  }
  async function tableCatalog() {
    if (cache.tables) return cache.tables;
    const rows = await all("EntityDefinitions?$select=LogicalName,SchemaName,ObjectTypeCode,EntitySetName,PrimaryNameAttribute,PrimaryIdAttribute,DisplayName,DisplayCollectionName&$filter=IsPrivate eq false");
    cache.tables = rows.map(x => ({
      logicalName: x.LogicalName, schemaName: x.SchemaName, objectTypeCode: x.ObjectTypeCode,
      entitySetName: x.EntitySetName, primaryNameAttribute: x.PrimaryNameAttribute, primaryIdAttribute: x.PrimaryIdAttribute,
      displayName: x.DisplayName?.UserLocalizedLabel?.Label || x.LogicalName,
      displayCollectionName: x.DisplayCollectionName?.UserLocalizedLabel?.Label || ""
    })).filter(x => x.logicalName && x.schemaName).sort((a, b) => a.displayName.localeCompare(b.displayName));
    return cache.tables;
  }
  async function privilegeCatalog() {
    if (cache.privileges) return cache.privileges;
    const rows = await all("privileges?$select=privilegeid,name");
    cache.privileges = new Map(rows.map(x => [G(x.privilegeid).toLowerCase(), { id: G(x.privilegeid), name: x.name || "" }]));
    return cache.privileges;
  }
  function operationOf(name) {
    const match = /^prv(Create|Read|Write|Delete|AppendTo|Append|Assign|Share)(.+)$/i.exec(name || "");
    return match ? { operation: match[1].replace(/^./, c => c.toUpperCase()), token: match[2] } : null;
  }
  async function mappedPrivileges() {
    const privileges = await privilegeCatalog(), tables = await tableCatalog();
    const byToken = new Map();
    for (const table of tables) {
      for (const token of [table.schemaName, table.logicalName]) {
        const key = S(token).replace(/[^a-z0-9]/gi, "").toLowerCase();
        if (key && !byToken.has(key)) byToken.set(key, table);
      }
    }
    const mapped = new Map();
    for (const [id, privilege] of privileges) {
      const parsed = operationOf(privilege.name), token = parsed?.token?.replace(/[^a-z0-9]/gi, "").toLowerCase();
      const table = token ? byToken.get(token) : null;
      mapped.set(id, { ...privilege, operation: parsed?.operation || "Other", table: table || null });
    }
    return mapped;
  }
  async function users(query) {
    const xml = `<fetch top='50'><entity name='systemuser'><attribute name='systemuserid'/><attribute name='fullname'/><attribute name='internalemailaddress'/><filter><condition attribute='fullname' operator='like' value='%${X(query || "")}%' /></filter><link-entity name='businessunit' from='businessunitid' to='businessunitid' alias='bu'><attribute name='name'/></link-entity><order attribute='fullname'/></entity></fetch>`;
    const data = await get(`systemusers?fetchXml=${encodeURIComponent(xml)}`);
    return (data.value || []).map(x => ({ id: x.systemuserid, name: x.fullname, email: x.internalemailaddress || "", businessUnit: x["bu.name"] || "" }));
  }
  async function userRoles(userId) {
    const key = G(userId).toLowerCase();
    if (cache.userRoles.has(key)) return cache.userRoles.get(key);
    const xml = `<fetch distinct='true'><entity name='role'><attribute name='roleid'/><attribute name='name'/><attribute name='parentrootroleid'/><link-entity name='systemuserroles' from='roleid' to='roleid'><filter><condition attribute='systemuserid' operator='eq' value='${G(userId)}'/></filter></link-entity><link-entity name='businessunit' from='businessunitid' to='businessunitid' alias='bu'><attribute name='name'/></link-entity><order attribute='name'/></entity></fetch>`;
    const rows = (await fxAll(xml)).map(x => ({ roleId: G(x.roleid), rootRoleId: G(x._parentrootroleid_value) || G(x.roleid), name: x.name, businessUnit: x["bu.name"] || "" }));
    cache.userRoles.set(key, rows);
    return rows;
  }
  async function rootRoles(query) {
    const xml = `<fetch distinct='true'><entity name='role'><attribute name='roleid'/><attribute name='name'/><filter><condition attribute='name' operator='like' value='%${X(query || "")}%' /></filter><link-entity name='businessunit' from='businessunitid' to='businessunitid' alias='bu'><attribute name='name'/><filter><condition attribute='parentbusinessunitid' operator='null'/></filter></link-entity><order attribute='name'/></entity></fetch>`;
    return (await fxAll(xml)).map(x => ({ roleId: G(x.roleid), name: x.name, businessUnit: x["bu.name"] || "Root Business Unit" }));
  }
  async function rolePrivilegeRows(role) {
    const rootId = G(role.rootRoleId || role.roleId).toLowerCase();
    if (!cache.rolePrivileges.has(rootId)) {
      const data = await get(`RetrieveRolePrivilegesRole(RoleId=${rootId})`);
      cache.rolePrivileges.set(rootId, data.RolePrivileges || []);
    }
    const catalog = await mappedPrivileges();
    return cache.rolePrivileges.get(rootId).map(x => {
      const id = G(x.PrivilegeId || x.privilegeid).toLowerCase(), metadata = catalog.get(id) || {};
      return {
        roleId: role.roleId, rootRoleId: rootId, roleName: role.name || "", roleBusinessUnit: role.businessUnit || "",
        privilegeId: id, privilegeName: metadata.name || "", operation: metadata.operation || "Other",
        table: metadata.table?.logicalName || "", tableDisplayName: metadata.table?.displayName || "",
        rawDepth: S(x.Depth ?? x.PrivilegeDepth ?? x.depth), depth: functionDepth(x.Depth ?? x.PrivilegeDepth ?? x.depth)
      };
    });
  }
  async function userTable(userId, logicalName) {
    const xml = `<fetch distinct='true'><entity name='systemuserroles'><attribute name='systemuserroleid'/><filter><condition attribute='systemuserid' operator='eq' value='${G(userId)}'/></filter><link-entity name='systemuser' to='systemuserid' from='systemuserid' alias='su' link-type='inner'><attribute name='fullname'/><attribute name='systemuserid'/></link-entity><link-entity name='role' to='roleid' from='roleid' alias='ur' link-type='inner'><attribute name='name'/><attribute name='roleid'/><link-entity name='businessunit' to='businessunitid' from='businessunitid' alias='bu' link-type='inner'><attribute name='name'/></link-entity><link-entity name='role' to='parentrootroleid' from='parentrootroleid' alias='pr' link-type='inner'><attribute name='roleid'/><link-entity name='roleprivileges' to='roleid' from='roleid' alias='rp' link-type='inner'><attribute name='privilegedepthmask'/><attribute name='roleprivilegeid'/><link-entity name='privilege' to='privilegeid' from='privilegeid' alias='p' link-type='inner'><attribute name='name'/><attribute name='privilegeid'/><link-entity name='privilegeobjecttypecodes' to='privilegeid' from='privilegeid' alias='potc' link-type='inner'><link-entity name='entity' to='objecttypecode' from='objecttypecode' alias='e' link-type='inner'><attribute name='logicalname'/><filter><condition attribute='logicalname' operator='eq' value='${X(logicalName)}'/></filter></link-entity></link-entity></link-entity></link-entity></link-entity></link-entity></entity></fetch>`;
    const data = await get(`systemuserrolescollection?fetchXml=${encodeURIComponent(xml)}`);
    return (data.value || []).map(row => ({
      userName: row["su.fullname"] || "", roleId: G(row["ur.roleid"]), roleName: row["ur.name"] || "",
      roleBusinessUnit: row["bu.name"] || "", privilegeId: G(row["p.privilegeid"]),
      privilegeName: row["p.name"] || "", depth: maskDepth(row["rp.privilegedepthmask"]),
      table: row["e.logicalname"] || logicalName
    }));
  }
  async function rolePrivileges(roleId) {
    const role = (await rootRoles("")).find(item => item.roleId.toLowerCase() === G(roleId).toLowerCase()) || { roleId, rootRoleId: roleId };
    return rolePrivilegeRows(role);
  }
  async function rolesByPrivilege(logicalName, operation) {
    const operationPrefix = { Create: "prvCreate", Read: "prvRead", Write: "prvWrite", Delete: "prvDelete", Append: "prvAppend", AppendTo: "prvAppendTo", Assign: "prvAssign", Share: "prvShare" }[operation];
    if (!operationPrefix) throw Error(`Unsupported privilege operation: ${operation}`);
    const xml = `<fetch distinct='true'><entity name='roleprivileges'><attribute name='privilegedepthmask'/><attribute name='roleprivilegeid'/><link-entity name='role' to='roleid' from='roleid' alias='r' link-type='inner'><attribute name='roleid'/><attribute name='name'/><link-entity name='businessunit' to='businessunitid' from='businessunitid' alias='bu' link-type='inner'><attribute name='name'/></link-entity></link-entity><link-entity name='privilege' to='privilegeid' from='privilegeid' alias='p' link-type='inner'><attribute name='privilegeid'/><attribute name='name'/><filter><condition attribute='name' operator='like' value='${operationPrefix}%' /></filter><link-entity name='privilegeobjecttypecodes' to='privilegeid' from='privilegeid' alias='potc' link-type='inner'><link-entity name='entity' to='objecttypecode' from='objecttypecode' alias='e' link-type='inner'><attribute name='logicalname'/><filter><condition attribute='logicalname' operator='eq' value='${X(logicalName)}'/></filter></link-entity></link-entity></link-entity></entity></fetch>`;
    const data = await get(`roleprivilegescollection?fetchXml=${encodeURIComponent(xml)}`);
    return (data.value || []).filter(row => operation !== "Append" || !S(row["p.name"]).toLowerCase().startsWith("prvappendto")).map(row => ({
      roleId: G(row["r.roleid"]), roleName: row["r.name"] || "", roleBusinessUnit: row["bu.name"] || "",
      privilegeId: G(row["p.privilegeid"]), privilegeName: row["p.name"] || "",
      depth: maskDepth(row.privilegedepthmask), table: row["e.logicalname"] || logicalName
    }));
  }
  async function tables(query) {
    const q = S(query).trim().toLowerCase();
    return (await tableCatalog()).filter(x => !q || [x.displayName, x.displayCollectionName, x.logicalName, x.schemaName].some(v => S(v).toLowerCase().includes(q))).slice(0, 50);
  }
  function auditValue(v) {
    if (v == null) return "";
    if (typeof v !== "object") return S(v);
    return v.FormattedValue || v.Name || v.Value || v.Id || JSON.stringify(v);
  }
  async function tableSearchMetadata(logicalName) {
    const table = (await tableCatalog()).find(x => x.logicalName === logicalName);
    if (!table) throw Error(`Table metadata was not found for ${logicalName}.`);
    const data = await get(`EntityDefinitions(LogicalName='${encodeURIComponent(logicalName)}')?$select=LogicalName,SchemaName,EntitySetName,PrimaryIdAttribute,PrimaryNameAttribute&$expand=Keys($select=LogicalName,SchemaName,KeyAttributes,DisplayName)`);
    const fields = [{ logicalName: data.PrimaryIdAttribute, label: "Record ID", mode: "guid", source: "Primary key" }];
    if (data.PrimaryNameAttribute) fields.push({ logicalName: data.PrimaryNameAttribute, label: "Primary name", mode: "contains", source: "Primary name" });
    for (const key of data.Keys || []) for (const attribute of key.KeyAttributes || []) {
      if (!fields.some(x => x.logicalName === attribute)) fields.push({ logicalName: attribute, label: key.DisplayName?.UserLocalizedLabel?.Label || key.SchemaName || key.LogicalName || "Alternate key", mode: "exact", source: "Alternate key" });
    }
    return { ...table, primaryIdAttribute: data.PrimaryIdAttribute, primaryNameAttribute: data.PrimaryNameAttribute, fields };
  }
  const odataLiteral = value => `'${S(value).replace(/'/g, "''")}'`;
  async function recordSearch(logicalName, field, value, mode) {
    const metadata = await tableSearchMetadata(logicalName), search = S(value).trim();
    if (!search) return { metadata, rows: [] };
    let filter;
    if (mode === "guid") filter = `${field} eq ${G(search)}`;
    else if (mode === "contains") filter = `contains(${field},${odataLiteral(search)})`;
    else filter = `${field} eq ${odataLiteral(search)}`;
    const selects = [...new Set([metadata.primaryIdAttribute, metadata.primaryNameAttribute, field].filter(Boolean))].join(",");
    const data = await get(`${metadata.entitySetName}?$select=${selects}&$filter=${encodeURIComponent(filter)}&$top=25`);
    return { metadata, rows: (data.value || []).map(row => ({ id: G(row[metadata.primaryIdAttribute]), name: S(row[metadata.primaryNameAttribute]) || G(row[metadata.primaryIdAttribute]), match: S(row[field]), raw: row })) };
  }
  function lookupBundle(attributes, key) {
    const match = /^_(.+)_value$/.exec(key);
    if (!match) return null;
    const name = attributes[`${key}@OData.Community.Display.V1.FormattedValue`] || "";
    const entity = attributes[`${key}@Microsoft.Dynamics.CRM.lookuplogicalname`] || "";
    const navigation = attributes[`${key}@Microsoft.Dynamics.CRM.associatednavigationproperty`] || "";
    const id = G(attributes[key]);
    if (!id && !name && !entity) return null;
    return { field: match[1], id, name: S(name), entity: S(entity), navigation: S(navigation) };
  }
  function lookupDisplay(value) {
    if (!value) return "";
    return value.name || value.id || "";
  }
  async function audit(table, id) {
    const target = JSON.stringify({ "@odata.type": `Microsoft.Dynamics.CRM.${table}`, [`${table}id`]: G(id) });
    const paging = JSON.stringify({ PageNumber: 1, Count: 100, ReturnTotalRecordCount: false });
    const data = await get(`RetrieveRecordChangeHistory(Target=@p1,PagingInfo=@p2)?@p1=${encodeURIComponent(target)}&@p2=${encodeURIComponent(paging)}`), collection = data.AuditDetailCollection || {}, groups = [];
    for (const item of collection.AuditDetails || []) {
      const a = item.AuditRecord || {}, old = item.OldValue?.Attributes || item.OldValue || {}, now = item.NewValue?.Attributes || item.NewValue || {};
      const rawKeys = new Set([...Object.keys(old), ...Object.keys(now)].filter(key => !key.startsWith("@")));
      const lookupBases = new Set([...rawKeys].filter(key => /^_.+_value$/.test(key)));
      const annotationBase = key => key.split("@")[0];
      for (const key of rawKeys) if (key.includes("@")) lookupBases.add(annotationBase(key));
      const consumed = new Set();
      const changes = [];
      for (const key of lookupBases) {
        const oldLookup = lookupBundle(old, key), newLookup = lookupBundle(now, key);
        if (!oldLookup && !newLookup) continue;
        consumed.add(key);
        for (const suffix of ["@OData.Community.Display.V1.FormattedValue", "@Microsoft.Dynamics.CRM.lookuplogicalname", "@Microsoft.Dynamics.CRM.associatednavigationproperty"]) consumed.add(`${key}${suffix}`);
        changes.push({
          field: (newLookup || oldLookup).field,
          type: "lookup",
          oldValue: lookupDisplay(oldLookup),
          newValue: lookupDisplay(newLookup),
          oldLookup,
          newLookup
        });
      }
      for (const key of rawKeys) {
        if (consumed.has(key) || key.includes("@")) continue;
        changes.push({ field: key, type: "value", oldValue: auditValue(old[key]), newValue: auditValue(now[key]) });
      }
      const auditId = G(a.AuditId || a.auditid || item.AuditDetailId || ""), createdOn = a.CreatedOn || a.createdon || "", changedBy = a["_userid_value@OData.Community.Display.V1.FormattedValue"] || a.UserId?.Name || a.userid?.Name || "", event = ({ 1: "Create", 2: "Update", 3: "Delete", 4: "Access" })[Number(a.Operation ?? a.operation)] || S(a.Operation ?? a.operation);
      groups.push({ auditId, createdOn, changedBy, event, changes, changeCount: changes.length, search: JSON.stringify({ createdOn, changedBy, event, changes }).toLowerCase() });
    }
    return { groups, moreRecords: !!collection.MoreRecords, pagingCookie: collection.PagingCookie || "", clientUrl: base };
  }
  return (async () => {
    if (action === "context") return { ok: true, data: await context() };
    if (action === "tables") return { ok: true, data: await tables(p.query) };
    if (action === "users") return { ok: true, data: await users(p.query) };
    if (action === "userRoles") return { ok: true, data: await userRoles(p.userId) };
    if (action === "roles") return { ok: true, data: await rootRoles(p.query) };
    if (action === "userTable") return { ok: true, data: await userTable(p.userId, p.table) };
    if (action === "rolePrivileges") return { ok: true, data: await rolePrivileges(p.roleId) };
    if (action === "rolesByPrivilege") return { ok: true, data: await rolesByPrivilege(p.table, p.operation) };
    if (action === "tableSearchMetadata") return { ok: true, data: await tableSearchMetadata(p.table) };
    if (action === "recordSearch") return { ok: true, data: await recordSearch(p.table, p.field, p.value, p.mode) };
    if (action === "audit") return { ok: true, data: await audit(p.table, p.recordId) };
    throw Error("Unsupported action");
  })().catch(error => ({ ok: false, error: error.message || S(error) }));
}
async function environmentInfo(tab) {
  try {
    const result = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", func: () => { const g = Xrm.Utility.getGlobalContext(); return { clientUrl: g.getClientUrl(), environmentId: String(g.organizationSettings?.bapEnvironmentId || "").replace(/[{}]/g, ""), organizationName: g.organizationSettings?.friendlyName || g.organizationSettings?.uniqueName || new URL(g.getClientUrl()).hostname }; } });
    return { ...result[0].result, tabId: tab.id };
  } catch { return null; }
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== "DEVLENS_SECURITY_AUDIT") return;
  if (message.action === "environments") {
    chrome.tabs.query({ url: ["https://*.dynamics.com/*"] }).then(async tabs => reply({ ok: true, data: (await Promise.all(tabs.map(environmentInfo))).filter(Boolean) })).catch(error => reply({ ok: false, error: error.message }));
    return true;
  }
  const tabId = Number(message.payload?.environmentTabId) || sender.tab?.id;
  if (!tabId) { reply({ ok: false, error: "No Dynamics environment tab was found." }); return; }
  chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: devLensSecurityAuditBridge, args: [message.action || "context", message.payload || {}] }).then(results => reply(results[0]?.result || { ok: false, error: "No result." })).catch(error => reply({ ok: false, error: error.message || String(error) }));
  return true;
});
