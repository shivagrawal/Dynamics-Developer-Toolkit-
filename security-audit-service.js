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
  async function allBounded(path, maxRows = 10000) {
    const rows = [];
    let next = path;
    while (next && rows.length < maxRows) {
      const data = await get(next.replace(base + "/api/data/v9.2/", ""));
      const pageRows = Array.isArray(data.value) ? data.value : [];
      const room = maxRows - rows.length;
      rows.push(...pageRows.slice(0, room));
      next = data["@odata.nextLink"] || "";
      if (rows.length >= maxRows) return { rows, truncated: true };
    }
    return { rows, truncated: false };
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

  function sqlUnquote(value) {
    return String(value || "").replace(/''/g, "'");
  }
  function sqlLiteral(sql, pattern) {
    const match = String(sql).match(pattern);
    return match ? sqlUnquote(match[1]) : null;
  }
  function sqlLikeTerm(sql, pattern) {
    const value = sqlLiteral(sql, pattern);
    return value == null ? null : value.replace(/^%|%$/g, "").replace(/\\%/g, "%").replace(/\\_/g, "_");
  }
  function sqlDepth(mask) {
    return ({ 1: "User", 2: "Business Unit", 4: "Parent:Child BU", 8: "Organization" })[Number(mask)] || null;
  }
  function sqlDistinct(rows, keys) {
    const seen = new Set();
    return rows.filter(row => {
      const key = JSON.stringify(keys.map(name => row[name] ?? null));
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  function sqlSort(rows, fields) {
    return rows.sort((a, b) => {
      for (const [field, direction] of fields) {
        const av = a[field] == null ? "" : String(a[field]);
        const bv = b[field] == null ? "" : String(b[field]);
        const cmp = av.localeCompare(bv, undefined, { numeric: false, sensitivity: "base" });
        if (cmp) return direction === "desc" ? -cmp : cmp;
      }
      return 0;
    });
  }
  async function sqlUsersByName(term) {
    const xml = "<fetch top='5000'><entity name='systemuser'><attribute name='systemuserid'/><attribute name='fullname'/><filter><condition attribute='fullname' operator='like' value='%" + X(term) + "%' /></filter><order attribute='fullname'/></entity></fetch>";
    return (await all("systemusers?fetchXml=" + encodeURIComponent(xml))).map(row => ({
      id: G(row.systemuserid), name: row.fullname || "", raw: row
    }));
  }

  async function sqlUserRolesByName(term) {
    const xml = "<fetch top='5000'><entity name='role'><attribute name='roleid'/><attribute name='name'/><link-entity name='systemuserroles' from='roleid' to='roleid' link-type='inner'><link-entity name='systemuser' from='systemuserid' to='systemuserid' alias='SU' link-type='inner'><attribute name='systemuserid'/><attribute name='fullname'/><filter><condition attribute='fullname' operator='like' value='%" + X(term) + "%'/></filter></link-entity></link-entity><link-entity name='businessunit' from='businessunitid' to='businessunitid' alias='BU' link-type='inner'><attribute name='name'/></link-entity></entity></fetch>";
    const result = await allBounded("roles?fetchXml=" + encodeURIComponent(xml), 5000);
    return { rows: result.rows.map(row => ({
      fullname: row["SU.fullname"] || row["su.fullname"] || "",
      systemuserid: G(row["SU.systemuserid"] || row["su.systemuserid"]),
      role_name: row.name || row["R.name"] || row["r.name"] || "",
      role_businessunit: row["BU.name"] || row["bu.name"] || ""
    })), truncated: result.truncated };
  }
  async function sqlUserTableByName(term, logicalName) {
    const table = S(logicalName).toLowerCase();
    if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw Error("Invalid table logical name in user privilege query.");
    const xml = "<fetch top='5000' distinct='true'><entity name='systemuserroles'><attribute name='systemuserroleid'/><link-entity name='systemuser' to='systemuserid' from='systemuserid' alias='su' link-type='inner'><attribute name='fullname'/><attribute name='systemuserid'/><filter><condition attribute='fullname' operator='like' value='%" + X(term) + "%'/></filter></link-entity><link-entity name='role' to='roleid' from='roleid' alias='ur' link-type='inner'><attribute name='name'/><attribute name='roleid'/><link-entity name='businessunit' to='businessunitid' from='businessunitid' alias='bu' link-type='inner'><attribute name='name'/></link-entity><link-entity name='role' to='parentrootroleid' from='parentrootroleid' alias='pr' link-type='inner'><attribute name='roleid'/><link-entity name='roleprivileges' to='roleid' from='roleid' alias='rp' link-type='inner'><attribute name='privilegedepthmask'/><attribute name='roleprivilegeid'/><link-entity name='privilege' to='privilegeid' from='privilegeid' alias='p' link-type='inner'><attribute name='name'/><attribute name='privilegeid'/><link-entity name='privilegeobjecttypecodes' to='privilegeid' from='privilegeid' alias='potc' link-type='inner'><link-entity name='entity' to='objecttypecode' from='objecttypecode' alias='e' link-type='inner'><attribute name='logicalname'/><filter><condition attribute='logicalname' operator='eq' value='" + X(table) + "'/></filter></link-entity></link-entity></link-entity></link-entity></link-entity></link-entity></entity></fetch>";
    const result = await allBounded("systemuserrolescollection?fetchXml=" + encodeURIComponent(xml), 5000);
    return { rows: result.rows.map(row => ({
      fullname: row["su.fullname"] || "",
      role_name: row["ur.name"] || "",
      role_businessunit: row["bu.name"] || "",
      privilege_name: row["p.name"] || "",
      depth: sqlDepth(row["rp.privilegedepthmask"]) || (row["rp.privilegedepthmask"] == null ? "" : S(row["rp.privilegedepthmask"]))
    })), truncated: result.truncated };
  }

  async function sqlPrivilegesForTable(logicalName) {
    const table = S(logicalName).toLowerCase();
    if (!/^[a-z_][a-z0-9_]*$/.test(table)) throw Error("Invalid table logical name in security query.");
    const xml = "<fetch distinct='true'><entity name='privilege'><attribute name='name'/><link-entity name='privilegeobjecttypecodes' from='privilegeid' to='privilegeid' link-type='inner'><link-entity name='entity' from='objecttypecode' to='objecttypecode' alias='e' link-type='inner'><attribute name='logicalname'/><filter><condition attribute='logicalname' operator='eq' value='" + X(table) + "'/></filter></link-entity></link-entity><order attribute='name'/></entity></fetch>";
    const result = await allBounded("privileges?fetchXml=" + encodeURIComponent(xml), 10000);
    return { rows: sqlDistinct(result.rows.map(row => ({ privilege_name: row.name || "" })), ["privilege_name"]), truncated: result.truncated };
  }
  async function sqlRolesByPrivilegeName(privilegeName) {
    const xml = "<fetch distinct='true'><entity name='roleprivileges'><attribute name='privilegedepthmask'/><link-entity name='role' to='roleid' from='roleid' alias='r' link-type='inner'><attribute name='roleid'/><attribute name='name'/><link-entity name='businessunit' to='businessunitid' from='businessunitid' alias='bu' link-type='inner'><attribute name='name'/></link-entity></link-entity><link-entity name='privilege' to='privilegeid' from='privilegeid' alias='p' link-type='inner'><attribute name='name'/><filter><condition attribute='name' operator='eq' value='" + X(privilegeName) + "'/></filter></link-entity></entity></fetch>";
    const result = await allBounded("roleprivilegescollection?fetchXml=" + encodeURIComponent(xml), 10000);
    return { rows: result.rows.map(row => ({
      role_name: row["r.name"] || "",
      business_unit: row["bu.name"] || "",
      privilege_name: row["p.name"] || privilegeName,
      depth: sqlDepth(row.privilegedepthmask) || (row.privilegedepthmask == null ? "" : S(row.privilegedepthmask))
    })), truncated: result.truncated };
  }
  async function sqlRoleAccessRows(roleName) {
    const xml = "<fetch distinct='true'><entity name='roleprivileges'><attribute name='privilegedepthmask'/><link-entity name='role' to='roleid' from='roleid' alias='r' link-type='inner'><attribute name='roleid'/><attribute name='name'/><filter><condition attribute='name' operator='eq' value='" + X(roleName) + "'/></filter><link-entity name='businessunit' to='businessunitid' from='businessunitid' alias='bu' link-type='inner'><attribute name='name'/></link-entity></link-entity><link-entity name='privilege' to='privilegeid' from='privilegeid' alias='p' link-type='inner'><attribute name='name'/><link-entity name='privilegeobjecttypecodes' to='privilegeid' from='privilegeid' alias='potc' link-type='inner'><link-entity name='entity' to='objecttypecode' from='objecttypecode' alias='e' link-type='inner'><attribute name='logicalname'/></link-entity></link-entity></link-entity></entity></fetch>";
    const result = await allBounded("roleprivilegescollection?fetchXml=" + encodeURIComponent(xml), 10000);
    return { rows: result.rows.map(row => ({
      table_name: row["e.logicalname"] || "",
      privilege_name: row["p.name"] || "",
      depth: sqlDepth(row.privilegedepthmask),
      role_name: row["r.name"] || roleName,
      business_unit: row["bu.name"] || ""
    })), truncated: result.truncated };
  }
  function sqlAuditValue(values, key) {
    const formatted = values?.[key + "@OData.Community.Display.V1.FormattedValue"];
    return formatted !== undefined ? auditValue(formatted) : auditValue(values?.[key]);
  }
  async function sqlAuditRows(recordId) {
    const id = G(recordId).toLowerCase();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw Error("Audit query requires a valid record GUID in the objectid filter.");
    const auditResult = await allBounded("audits?$select=auditid,createdon,operation,_userid_value,objecttypecode&$filter=_objectid_value eq " + id + "&$orderby=createdon desc&$top=1001", 1001);
    const auditRows = auditResult.rows;
    const truncated = auditResult.truncated || auditRows.length > 1000;
    const output = [];
    for (const auditRow of auditRows.slice(0, 1000)) {
      const auditId = G(auditRow.auditid);
      if (!auditId) continue;
      const response = await get("audits(" + auditId + ")/Microsoft.Dynamics.CRM.RetrieveAuditDetails");
      const detail = response.AuditDetail || {};
      const oldValues = detail.OldValue?.Attributes || detail.OldValue || {};
      const newValues = detail.NewValue?.Attributes || detail.NewValue || {};
      const keys = [...new Set([...Object.keys(oldValues), ...Object.keys(newValues)])]
        .filter(key => !key.startsWith("@") && !key.includes("@"));
      const changedBy = auditRow["_userid_value@OData.Community.Display.V1.FormattedValue"] || "";
      const event = ({ 1: "Create", 2: "Update" })[Number(auditRow.operation)] || S(auditRow.operation);
      for (const key of keys) {
        const logicalName = key.startsWith("_") && key.endsWith("_value") ? key.slice(1, -6) : key;
        output.push({
          createdon: auditRow.createdon || "",
          ChangedBy: changedBy,
          Event: event,
          logicalname: logicalName,
          oldvalue: sqlAuditValue(oldValues, key),
          newvalue: sqlAuditValue(newValues, key)
        });
      }
    }
    return { rows: sqlSort(output, [["createdon", "desc"], ["logicalname", "asc"]]), truncated };
  }
  function stripSqlComments(sql) {
    let out = "", quote = "", line = false, block = false;
    for (let i = 0; i < String(sql).length; i++) {
      const ch = sql[i], next = sql[i + 1];
      if (line) { if (ch === "\n" || ch === "\r") { line = false; out += ch; } else out += " "; continue; }
      if (block) { if (ch === "*" && next === "/") { out += "  "; i++; block = false; } else out += ch === "\n" || ch === "\r" ? ch : " "; continue; }
      if (quote) { out += ch; if (ch === quote && next === quote) { out += next; i++; } else if (ch === quote) quote = ""; continue; }
      if (ch === "'" || ch === '"') { quote = ch; out += ch; continue; }
      if (ch === "[") { quote = "]"; out += ch; continue; }
      if (ch === "-" && next === "-") { line = true; out += "  "; i++; continue; }
      if (ch === "/" && next === "*") { block = true; out += "  "; i++; continue; }
      out += ch;
    }
    if (block) throw Error("Unterminated SQL block comment.");
    if (quote) throw Error("Unterminated SQL quoted value or identifier.");
    return out;
  }
  function hasMultipleSqlStatements(sql) {
    let quote = "", ended = false;
    for (let i = 0; i < sql.length; i++) {
      const ch = sql[i], next = sql[i + 1];
      if (quote) { if (ch === quote && next === quote) { i++; continue; } if (ch === quote) quote = ""; continue; }
      if (ch === "'" || ch === '"') { quote = ch; continue; }
      if (ch === "[") { quote = "]"; continue; }
      if (ch === ";") { ended = true; continue; }
      if (ended && !/\s/.test(ch)) return true;
    }
    return false;
  }

  function sqlProjectionAliases(sql) {
    const select = /\bSELECT\b/i.exec(sql);
    if (!select) throw Error("Security SQL must start with SELECT after comments.");
    let start = select.index + select[0].length;
    const distinct = /^\s*DISTINCT\b/i.exec(sql.slice(start));
    if (distinct) start += distinct[0].length;
    let depth = 0, quote = "", from = -1;
    for (let i = start; i < sql.length; i++) {
      const ch = sql[i], next = sql[i + 1];
      if (quote) {
        if (ch === quote && next === quote) { i++; continue; }
        if (ch === quote) quote = "";
        continue;
      }
      if (ch === "'" || ch === '"') { quote = ch; continue; }
      if (ch === "[") { quote = "]"; continue; }
      if (ch === "(") { depth++; continue; }
      if (ch === ")") { depth--; continue; }
      if (depth === 0 && sql.slice(i, i + 4).toUpperCase() === "FROM" &&
          (i === 0 || !/[A-Za-z0-9_$]/.test(sql[i - 1])) &&
          !/[A-Za-z0-9_$]/.test(sql[i + 4] || " ")) { from = i; break; }
    }
    if (from < 0 || quote || depth !== 0) throw Error("Could not parse the security SQL SELECT projection.");
    const list = sql.slice(start, from), parts = [];
    let begin = 0; depth = 0; quote = "";
    for (let i = 0; i < list.length; i++) {
      const ch = list[i], next = list[i + 1];
      if (quote) {
        if (ch === quote && next === quote) { i++; continue; }
        if (ch === quote) quote = "";
        continue;
      }
      if (ch === "'" || ch === '"') { quote = ch; continue; }
      if (ch === "[") { quote = "]"; continue; }
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (ch === "," && depth === 0) { parts.push(list.slice(begin, i).trim()); begin = i + 1; }
    }
    parts.push(list.slice(begin).trim());
    const unquote = value => {
      const v = String(value || "").trim();
      if (v.startsWith("[") && v.endsWith("]")) return v.slice(1, -1).replace(/]]/g, "]");
      if (v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1).replace(/""/g, '"');
      return v;
    };
    return parts.map(part => {
      const as = /\s+AS\s+(\[[^\]]+\]|"(?:""|[^"])*"|[A-Za-z_][A-Za-z0-9_$]*)\s*$/i.exec(part);
      if (as) return unquote(as[1]);
      if (/^(?:\[[^\]]+\]|"(?:""|[^"])*"|[A-Za-z_][A-Za-z0-9_$]*)(?:\.(?:\[[^\]]+\]|"(?:""|[^"])*"|[A-Za-z_][A-Za-z0-9_$]*))?$/.test(part)) return unquote(part.split(".").pop());
      return "";
    });
  }
  function assertSqlProjection(sql, expected, shape) {
    const actual = sqlProjectionAliases(sql);
    const got = actual.map(name => name.toLowerCase()), want = expected.map(name => name.toLowerCase());
    if (got.length !== want.length || got.some((name, index) => name !== want[index])) {
      throw Error("Unsupported SELECT projection for " + shape + ". Expected columns in order: " +
        expected.join(", ") + "; found: " + (actual.map(name => name || "(expression needs an alias)").join(", ") || "(none)") + ".");
    }
  }

  function assertSqlShape(sql, shape, requirements) {
    for (const [pattern, description] of requirements) {
      if (!pattern.test(sql)) throw Error("Unsupported SQL structure for " + shape + ": expected " + description + ".");
    }
  }

  async function sqlQuery(sql) {
    const original = S(sql);
    if (!original.trim()) throw Error("Read-only SQL mode accepts SELECT statements only.");
    if (original.length > 100000) throw Error("Query exceeds the 100,000 character limit.");
    const query = stripSqlComments(original).trim();
    if (!query || !/^SELECT\b/i.test(query)) throw Error("Read-only SQL mode accepts SELECT statements only.");
    if (hasMultipleSqlStatements(query)) throw Error("Run one SELECT statement at a time.");
    const columns = [], rows = [];
    let kind = "";
    let truncated = false;
    if (/\bFROM\s+systemuserroles\b/i.test(query) && /\bJOIN\s+systemuser\b/i.test(query)) {
      kind = "user-roles";
      assertSqlProjection(query, ["fullname", "systemuserid", "role_name", "role_businessunit"], kind);
      assertSqlShape(query, kind, [
        [/\bJOIN\s+systemuser\s+(?:AS\s+)?SU\b/i, "the SystemUser join"],
        [/\bJOIN\s+role\s+(?:AS\s+)?R\b/i, "the Role join"],
        [/\bJOIN\s+businessunit\s+(?:AS\s+)?BU\b/i, "the BusinessUnit join"],
        [/\bSUR\.systemuserid\s*=\s*SU\.systemuserid\b/i, "the user-role membership relationship"],
        [/\bSUR\.roleid\s*=\s*R\.roleid\b/i, "the role relationship"],
        [/\bR\.businessunitid\s*=\s*BU\.businessunitid\b/i, "the role business-unit relationship"]
      ]);
      const term = sqlLikeTerm(query, /\bSU\.fullname\s+LIKE\s+'((?:''|[^'])*)'/i);
      if (term == null) throw Error("User-role query requires a SU.fullname LIKE string filter.");
      const result = await sqlUserRolesByName(term);
      rows.push(...result.rows);
      truncated = result.truncated;
      columns.push("fullname", "systemuserid", "role_name", "role_businessunit");
    } else if (/\bFROM\s+privilege\b/i.test(query) && /\bprivilegeobjecttypecodes\b/i.test(query) && /\bentity\b/i.test(query)) {
      kind = "entity-privileges";
      assertSqlProjection(query, ["privilege_name"], kind);
      assertSqlShape(query, kind, [
        [/\bJOIN\s+privilegeobjecttypecodes\s+potc\s+ON\s+potc\.privilegeid\s*=\s*p\.privilegeid\b/i, "the privilege-object-type-code relationship"],
        [/\bJOIN\s+entity\s+e\s+ON\s+e\.objecttypecode\s*=\s*potc\.objecttypecode\b/i, "the entity mapping relationship"],
        [/\be\.logicalname\s*=\s*'((?:''|[^'])*)'/i, "an exact entity logical-name filter"]
      ]);
      const table = sqlLiteral(query, /\be\.logicalname\s*=\s*'((?:''|[^'])*)'/i);
      if (!table) throw Error("Privilege query requires an e.logicalname equality filter.");
      const result = await sqlPrivilegesForTable(table);
      rows.push(...result.rows);
      truncated = result.truncated;
      columns.push("privilege_name");
    } else if (/\bFROM\s+systemuser\b/i.test(query) && /\broleprivileges\b/i.test(query) && /\bprivilegeobjecttypecodes\b/i.test(query)) {
      kind = "user-entity-privileges";
      assertSqlProjection(query, ["fullname", "role_name", "role_businessunit", "privilege_name", "depth"], kind);
      assertSqlShape(query, kind, [
        [/\bJOIN\s+systemuserroles\s+sur\s+ON\s+sur\.systemuserid\s*=\s*su\.systemuserid\b/i, "the user-role membership relationship"],
        [/\bJOIN\s+role\s+ur\s+ON\s+ur\.roleid\s*=\s*sur\.roleid\b/i, "the user's role relationship"],
        [/\bJOIN\s+businessunit\s+bu\s+ON\s+bu\.businessunitid\s*=\s*ur\.businessunitid\b/i, "the role business-unit relationship"],
        [/\bJOIN\s+role\s+pr\s+ON\s+pr\.parentrootroleid\s*=\s*ur\.parentrootroleid\b/i, "the root-role inheritance relationship"],
        [/\bJOIN\s+roleprivileges\s+rp\s+ON\s+rp\.roleid\s*=\s*pr\.roleid\b/i, "the inherited role privilege relationship"],
        [/\bJOIN\s+privilege\s+p\s+ON\s+p\.privilegeid\s*=\s*rp\.privilegeid\b/i, "the privilege relationship"],
        [/\bJOIN\s+privilegeobjecttypecodes\s+potc\s+ON\s+potc\.privilegeid\s*=\s*p\.privilegeid\b/i, "the privilege entity mapping"],
        [/\bJOIN\s+entity\s+e\s+ON\s+e\.objecttypecode\s*=\s*potc\.objecttypecode\b/i, "the entity logical-name mapping"],
        [/\bCASE\s+rp\.privilegedepthmask\b/i, "the privilege-depth CASE mapping"]
      ]);
      const term = sqlLikeTerm(query, /\bsu\.fullname\s+LIKE\s+'((?:''|[^'])*)'/i);
      const table = sqlLiteral(query, /\be\.logicalname\s*=\s*'((?:''|[^'])*)'/i);
      if (term == null || !table) throw Error("User privilege query requires fullname LIKE and entity logicalname filters.");
      const result = await sqlUserTableByName(term, table);
      rows.push(...result.rows);
      truncated = result.truncated;
      columns.push("fullname", "role_name", "role_businessunit", "privilege_name", "depth");
    } else if (/\bFROM\s+role\b/i.test(query) && /\broleprivileges\b/i.test(query) && /\bp\.name\s*=\s*'/i.test(query)) {
      kind = "roles-by-privilege";
      assertSqlProjection(query, ["role_name", "business_unit", "privilege_name", "depth"], kind);
      assertSqlShape(query, kind, [
        [/\bJOIN\s+roleprivileges\s+rp\s+ON\s+rp\.roleid\s*=\s*r\.roleid\b/i, "the role-privilege relationship"],
        [/\bJOIN\s+privilege\s+p\s+ON\s+p\.privilegeid\s*=\s*rp\.privilegeid\b/i, "the privilege relationship"],
        [/\bJOIN\s+businessunit\s+bu\s+ON\s+bu\.businessunitid\s*=\s*r\.businessunitid\b/i, "the role business-unit relationship"],
        [/\bCASE\s+rp\.privilegedepthmask\b/i, "the privilege-depth CASE mapping"]
      ]);
      const privilegeName = sqlLiteral(query, /\bp\.name\s*=\s*'((?:''|[^'])*)'/i);
      if (privilegeName == null) throw Error("Role privilege query requires a p.name equality filter.");
      const result = await sqlRolesByPrivilegeName(privilegeName);
      rows.push(...result.rows);
      truncated = result.truncated;
      columns.push("role_name", "business_unit", "privilege_name", "depth");
    } else if (/\bFROM\s+role\b/i.test(query) && /\broleprivileges\b/i.test(query) && /\br\.name\s*=\s*'/i.test(query)) {
      kind = "role-table-access";
      assertSqlProjection(query, ["table_name", "CreateAccess", "ReadAccess", "WriteAccess", "DeleteAccess", "AppendAccess", "AppendToAccess", "AssignAccess", "ShareAccess"], kind);
      assertSqlShape(query, kind, [
        [/\bGROUP\s+BY\s+e\.logicalname\b/i, "GROUP BY e.logicalname"],
        [/\bISNULL\s*\(\s*MAX\s*\(\s*CASE\b/i, "ISNULL(MAX(CASE...) aggregate semantics"],
        [/'prvCreate%'/i, "the Create privilege prefix"],
        [/'prvRead%'/i, "the Read privilege prefix"],
        [/'prvWrite%'/i, "the Write privilege prefix"],
        [/'prvDelete%'/i, "the Delete privilege prefix"],
        [/'prvAppend%'/i, "the Append privilege prefix"],
        [/'prvAppendTo%'/i, "the AppendTo privilege prefix"],
        [/'prvAssign%'/i, "the Assign privilege prefix"],
        [/'prvShare%'/i, "the Share privilege prefix"]
      ]);
      const roleName = sqlLiteral(query, /\br\.name\s*=\s*'((?:''|[^'])*)'/i);
      if (roleName == null) throw Error("Role access query requires an r.name equality filter.");
      const accessResult = await sqlRoleAccessRows(roleName);
      const accessRows = accessResult.rows;
      truncated = accessResult.truncated;
      const grouped = new Map();
      const operationFor = name => {
        const match = /^prv(AppendTo|Create|Read|Write|Delete|Append|Assign|Share)/i.exec(String(name || ""));
        if (!match) return null;
        if (match[1].toLowerCase() === "appendto") return "AppendToAccess";
        return ({ create:"CreateAccess", read:"ReadAccess", write:"WriteAccess", delete:"DeleteAccess", append:"AppendAccess", assign:"AssignAccess", share:"ShareAccess" })[match[1].toLowerCase()] || null;
      };
      for (const item of accessRows) {
        if (!item.table_name) continue;
        if (!grouped.has(item.table_name)) grouped.set(item.table_name, { table_name: item.table_name });
        const outputColumn = operationFor(item.privilege_name);
        if (!outputColumn || !item.depth) continue;
        const current = grouped.get(item.table_name)[outputColumn];
        if (current == null || String(item.depth).localeCompare(String(current)) > 0) grouped.get(item.table_name)[outputColumn] = item.depth;
      }
      for (const row of grouped.values()) {
        for (const field of ["CreateAccess", "ReadAccess", "WriteAccess", "DeleteAccess", "AppendAccess", "AppendToAccess", "AssignAccess", "ShareAccess"]) row[field] = row[field] || "None";
        rows.push(row);
      }
      sqlSort(rows, [["table_name", "asc"]]);
      columns.push("table_name", "CreateAccess", "ReadAccess", "WriteAccess", "DeleteAccess", "AppendAccess", "AppendToAccess", "AssignAccess", "ShareAccess");
    } else if (/\bFROM\s+audit\b/i.test(query) && /\bobjectid\s*=\s*'/i.test(query)) {
      kind = "record-audit";
      assertSqlProjection(query, ["createdon", "ChangedBy", "Event", "logicalname", "oldvalue", "newvalue"], kind);
      assertSqlShape(query, kind, [
        [/\bCROSS\s+APPLY\s+OPENJSON\s*\(\s*a\.changedata/i, "audit changedata JSON expansion"],
        [/'\$\.changedAttributes'/i, "the changedAttributes JSON path"],
        [/\bLEFT\s+JOIN\s+systemuser\s+u\s+ON\s+a\.userid\s*=\s*u\.systemuserid\b/i, "the changed-by user relationship"],
        [/\bCASE\s+a\.operation\b/i, "the audit operation CASE mapping"]
      ]);
      const id = sqlLiteral(query, /\ba\.objectid\s*=\s*'((?:''|[^'])*)'/i);
      if (!id) throw Error("Audit query requires an objectid GUID filter.");
      const auditResult = await sqlAuditRows(id);
      rows.push(...auditResult.rows);
      truncated = auditResult.truncated;
      columns.push("createdon", "ChangedBy", "Event", "logicalname", "oldvalue", "newvalue");
    } else {
      throw Error("This security SQL shape is not implemented by the JavaScript compatibility adapter. Query was not sent to the Dataverse SQL endpoint.");
    }
    if (/\bDISTINCT\b/i.test(query)) rows.splice(0, rows.length, ...sqlDistinct(rows, columns));
    if (/\bORDER\s+BY\b/i.test(query)) {
      if (kind === "entity-privileges") sqlSort(rows, [["privilege_name", "asc"]]);
      else if (kind === "user-entity-privileges") sqlSort(rows, [["fullname", "asc"], ["role_name", "asc"], ["privilege_name", "asc"]]);
      else if (kind === "roles-by-privilege") sqlSort(rows, [["role_name", "asc"], ["business_unit", "asc"]]);
      else if (kind === "role-table-access") sqlSort(rows, [["table_name", "asc"]]);
      else if (kind === "record-audit") sqlSort(rows, [["createdon", "desc"]]);
    }
    const globalContext = Xrm.Utility.getGlobalContext();
    return {
      ok: true,
      provider: "dataverse-security-query-adapter",
      compatibilityMode: kind,
      clientUrl: base,
      environmentId: G(globalContext.organizationSettings?.bapEnvironmentId),
      currentUser: { id: G(globalContext.userSettings?.userId), name: globalContext.userSettings?.userName || "" },
      columns, rows, rowCount: rows.length, readOnly: true, truncated,
      warning: truncated ? "Results reached a configured safety limit and may be incomplete. Refine the query to avoid truncation." : ""
    };
  }

  return (async () => {
    if (action === "sqlQuery") return await sqlQuery(p.sql);
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
