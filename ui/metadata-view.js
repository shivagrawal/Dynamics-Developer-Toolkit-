(() => {
  "use strict";
  if (window.D365MetadataView) return;
  const E = (v) => D365AnalyzerApi.escape(v),
    S = { tables: null, entity: null, globalChoices: null };
  let root;
  const text = (v) => (v == null ? "" : String(v)),
    grid = (cols, rows) =>
      `<table><thead><tr>${cols.map((c) => `<th>${E(c[0])}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td>${E(c[2] ? c[2](r[c[1]], r) : r[c[1]])}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  async function render(r) {
    root = r;
    if (!S.tables) {
      root.innerHTML = "<div class=status>Loading Dataverse tables…</div>";
      const x = await D365AnalyzerApi.send("metadataTables");
      if (!x.ok) {
        root.innerHTML = `<div class=bad>${E(x.error)}</div>`;
        return;
      }
      S.tables = x.data || [];
    }
    void D365AnalyzerApi.send("startMetadataIndex", { mode: "automatic" });
    showTables();
  }
  function showTables() {
    root.innerHTML = `<div class=row><button class="b active">Tables</button><button id=global class=b>Global Choices</button><input id=tq class="i search" placeholder="Search display, logical, schema, object type, ownership, custom or managed"><span id=count class=muted></span></div><div id=tableRows></div>`;
    const q = root.querySelector("#tq"),
      o = root.querySelector("#tableRows"),
      c = root.querySelector("#count");
    function draw() {
      const v = q.value.toLowerCase(),
        a = v ? S.tables.filter((x) => x.search.includes(v)) : S.tables;
      c.textContent = `${a.length} table${a.length === 1 ? "" : "s"}`;
      o.innerHTML = grid(
        [
          ["Display", "displayName"],
          ["Logical", "logicalName"],
          ["Schema", "schemaName"],
          ["Object Type", "objectTypeCode"],
          ["Ownership", "ownershipType"],
          ["Custom", "isCustom"],
          ["Managed", "isManaged"],
        ],
        a.slice(0, 500),
      );
      o.querySelectorAll("tbody tr").forEach((tr, i) => {
        tr.classList.add("link");
        tr.onclick = () => load(a[i].logicalName);
      });
    }
    q.oninput = draw;
    root.querySelector("#global").onclick = showGlobal;
    draw();
    q.focus();
  }
  function exportGlobalChoices(){const xmlEscape=x=>text(x).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"),cell=x=>`<Cell><Data ss:Type="String">${xmlEscape(typeof x==="object"&&x!==null?JSON.stringify(x):x)}</Data></Cell>`,sheet=(name,rows)=>`<Worksheet ss:Name="${xmlEscape(name)}"><Table>${rows.map(row=>`<Row>${row.map(cell).join("")}</Row>`).join("")}</Table></Worksheet>`,definitions=[["Global Choice Name","Display Name","Metadata ID","Type","Description","Custom","Managed","Used By Count"]],options=[["Global Choice Name","Display Name","Option Text","Option Value","Color","Description"]],usage=[["Global Choice Name","Display Name","Table Display","Table Logical","Column Display","Column Logical"]];for(const x of S.globalChoices||[]){definitions.push([x.name,x.displayName,x.metadataId,x.type,x.description,x.isCustom,x.isManaged,(x.usedBy||[]).length]);for(const v of x.options||[])options.push([x.name,x.displayName,v.label,v.value,v.color,v.description]);for(const u of x.usedBy||[])usage.push([x.name,x.displayName,u.tableDisplayName,u.tableLogicalName,u.columnDisplayName,u.columnLogicalName])}const xml=`<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${sheet("Global Choices",definitions)}${sheet("Options",options)}${sheet("Used By",usage)}</Workbook>`;D365AnalyzerApi.saveFile("global-choices-with-usage.xls",new Blob([xml],{type:"application/vnd.ms-excel"}))}
  async function openChoiceColumn(logicalName,columnName){if(!root)throw Error("Metadata Browser is not ready.");await load(logicalName);showEntity("Choices");const query=root.querySelector("#mq");if(query){query.value=columnName||"";query.dispatchEvent(new Event("input"));query.focus()}}
  async function openColumn(logicalName, columnName) {
    if (!root) throw Error("Metadata Browser is not ready.");

    await load(logicalName);

    showEntity("Columns");

    const query = root.querySelector("#mq");

    if (query) {
      query.value = columnName || "";
      query.dispatchEvent(new Event("input"));
      query.focus();
    }
  }
  async function showGlobal() {
    if(!S.globalChoices){root.innerHTML="<div class=status>Loading global choices…</div>";const x=await D365AnalyzerApi.send("globalChoices");if(!x?.ok){root.innerHTML=`<div class=bad>${E(x?.error||"Global Choices returned no response.")}</div>`;return}S.globalChoices=x.data||[]}
    if(!S.tables){const t=await D365AnalyzerApi.send("metadataTables");S.tables=t?.data||[]}
    const a=S.globalChoices;root.innerHTML=`<div class=row><button id=back class=b>Tables</button><button class="b active">Global Choices</button><input id=gq class="i search" placeholder="Search choice or option"><input id=tableFilter class="i search" placeholder="Search and select one exact table"><button id=clearTable class=b hidden>Clear Table</button><button id=selectAll class=b>Select All</button><button id=clearSelected class=b>Clear Selection</button><button id=refreshUsage class=b>Refresh Choice Usage</button><button id=cancelIndex class="b danger" hidden>Cancel Indexing</button><button id=downloadGlobals class="b pri">Download Global Choices</button><span id=gc class=muted></span></div><div id=tablePickerResults class=tablePickerResults hidden></div><div id=indexStatus class=muted></div><div id=globalRows></div>`;
    root.querySelector("#back").onclick=showTables;root.querySelector("#downloadGlobals").onclick=exportGlobalChoices;const q=root.querySelector("#gq"),tf=root.querySelector("#tableFilter"),o=root.querySelector("#globalRows"),c=root.querySelector("#gc"),status=root.querySelector("#indexStatus"),cancel=root.querySelector("#cancelIndex");let selected=new Set();
    function draw(){const v=q.value.toLowerCase(),tv=tf.value.toLowerCase(),visible=a.filter(x=>(!v||JSON.stringify({name:x.name,displayName:x.displayName,options:x.options}).toLowerCase().includes(v))&&(!tv||(x.usedBy||[]).some(u=>`${u.tableDisplayName} ${u.tableLogicalName}`.toLowerCase().includes(tv))));c.textContent=`${visible.length} choices · ${selected.size} selected`;o.innerHTML=visible.map((x,choiceIndex)=>{const usedBy=x.usedBy||[],usage=usedBy.length?`<table><thead><tr><th>Table</th><th>Column</th></tr></thead><tbody>${usedBy.map((u,i)=>`<tr class="link usageRow" data-choice="${choiceIndex}" data-usage="${i}"><td>${E(u.tableDisplayName||u.tableLogicalName)}<div class=muted>${E(u.tableLogicalName)}</div></td><td>${E(u.columnDisplayName||u.columnLogicalName)}<div class=muted>${E(u.columnLogicalName)}</div></td></tr>`).join("")}</tbody></table>`:'<div class=muted>Dependency indexing has not reached this choice yet, or no dependent columns were returned.</div>';return `<details><summary><input type=checkbox class=choiceSelect data-name="${E(x.name)}" ${selected.has(x.name)?"checked":""}> <b>${E(x.displayName||x.name)}</b> · ${E(x.name)} · ${E(x.type)} · <b>Used By ${usedBy.length} Column${usedBy.length===1?"":"s"}</b></summary><div class=card>Metadata ID: ${E(x.metadataId||"Not returned")}</div><details><summary><b>Options</b> (${(x.options||[]).length})</summary>${grid([["Option Text","label"],["Value","value"],["Color","color"],["Description","description"]],x.options||[])}</details><details><summary><b>Used By (${usedBy.length} Columns)</b></summary>${usage}</details></details>`}).join("")||"<div class=muted>No matching Global Choices.</div>";o.querySelectorAll(".choiceSelect").forEach(box=>box.onchange=()=>{box.checked?selected.add(box.dataset.name):selected.delete(box.dataset.name);c.textContent=`${visible.length} choices · ${selected.size} selected`});o.querySelectorAll(".usageRow").forEach(row=>row.onclick=()=>{const usage=visible[+row.dataset.choice]?.usedBy?.[+row.dataset.usage];if(usage)openChoiceColumn(usage.tableLogicalName,usage.columnLogicalName)})}
    const sync=async()=>{const r=await D365AnalyzerApi.send("metadataIndexStatus"),p=r?.data;if(r?.usage?.usageByName){for(const choice of a){const rows=r.usage.usageByName[String(choice.name||"").toLowerCase()];if(rows){choice.usedBy=rows;choice.usedByCount=rows.length}}draw()}if(p){const pct=p.total?Math.round(p.completed*100/p.total):0;status.className=p.state==="error"?"bad":p.state==="complete"?"good":p.state==="cancelled"?"warn":"status";status.textContent=p.state==="running"?`Metadata indexing: ${p.phase} · ${p.completed} of ${p.total} (${pct}%) · warnings ${p.warnings}`:`${p.message||p.state} · warnings ${p.warnings}`;cancel.hidden=!(p.state==="running"&&p.mode==="manual");if(p.state==="running")setTimeout(sync,800)}};
    root.querySelector("#selectAll").onclick=()=>{a.forEach(x=>selected.add(x.name));draw()};root.querySelector("#clearSelected").onclick=()=>{selected.clear();draw()};root.querySelector("#refreshUsage").onclick=async()=>{await D365AnalyzerApi.send("clearMetadataCache");S.tables=null;S.globalChoices=null;await D365AnalyzerApi.send("startMetadataIndex",{mode:"manual"});cancel.hidden=false;status.textContent="Refreshing metadata dependency index…";void sync()};cancel.onclick=async()=>{const r=await D365AnalyzerApi.send("cancelMetadataIndex");status.textContent=r?.message||r?.error};q.oninput=draw;tf.oninput=draw;draw();void sync();q.focus();
  }
  async function load(n) {
    root.innerHTML =
      "<div class=status>Loading table metadata and typed choices…</div>";
    const x = await D365AnalyzerApi.send("metadataEntity", { logicalName: n });
    if (!x.ok) {
      root.innerHTML = `<div class=bad>${E(x.error)}</div>`;
      return;
    }
    S.entity = x.data;
    showEntity("Table");
  }
  const tabs = [
    "Table",
    "Columns",
    "Keys",
    "Choices",
    "OneToManyRelationships",
    "ManyToOneRelationships",
    "ManyToManyRelationships",
  ];
  function showEntity(tab) {
    const d = S.entity;
    root.innerHTML = `<div class=row><button id=tables class=b>Tables</button><button id=globals class=b>Global Choices</button><b>${E(d.displayName || d.logicalName)}</b><span class=grow></span><button id=export class="b pri">Download Complete Table Metadata</button></div><div class=row>${tabs.map((x) => `<button class="b mt ${x === tab ? "active" : ""}" data-tab="${x}">${x}</button>`).join("")}</div><div id=pane></div>`;
    root.querySelector("#tables").onclick = showTables;
    root.querySelector("#globals").onclick = showGlobal;
    root
      .querySelectorAll(".mt")
      .forEach((x) => (x.onclick = () => showEntity(x.dataset.tab)));
    root.querySelector("#export").onclick = exportColumns;
    drawPane(tab);
  }
  function searchable(rows, placeholder, renderer) {
    const p = root.querySelector("#pane");
    p.innerHTML = `<div class=row><input id=mq class="i search" placeholder="${E(placeholder)}"><span id=mc class=muted></span></div><div id=mr></div>`;
    const q = p.querySelector("#mq"),
      o = p.querySelector("#mr"),
      c = p.querySelector("#mc");
    function draw() {
      const v = q.value.toLowerCase(),
        f = rows.filter(
          (x) => !v || JSON.stringify(x).toLowerCase().includes(v),
        );
      c.textContent = `${f.length} result${f.length === 1 ? "" : "s"}`;
      o.innerHTML = renderer(f);
    }
    q.oninput = draw;
    draw();
    q.focus();
  }
  function drawPane(tab) {
    const d = S.entity,
      p = root.querySelector("#pane");
    if (tab === "Table") {
      const a = [
        ["Logical name", d.logicalName],
        ["Schema name", d.schemaName],
        ["Display name", d.displayName],
        ["Collection name", d.collectionName],
        ["Description", d.description],
        ["Entity set", d.entitySetName],
        ["Object type code", d.objectTypeCode],
        ["Ownership", d.ownershipType],
        ["Primary ID", d.primaryIdAttribute],
        ["Primary name", d.primaryNameAttribute],
        ["Custom", d.isCustom],
        ["Managed", d.isManaged],
        ["Audit", d.auditEnabled],
        ["Change tracking", d.changeTracking],
        ["BPF table", d.isBpf],
        ["Business process enabled", d.businessProcessEnabled],
        ["Activity", d.isActivity],
        ["Metadata ID", d.metadataId],
      ];
      p.innerHTML = `<table>
          <thead>
            <tr>
              <th style="width:240px">Property</th>
              <th>Value</th>
            </tr>
          </thead>
          <tbody>
            ${a
              .map(
                (item) => `
              <tr>
                <td><b>${E(item[0])}</b></td>
                <td>${E(item[1])}</td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
        </table>`;
    } else if (tab === "Columns")
      searchable(
        d.columns,
        "Search column logical, schema, label, type or description",
        (a) =>
          grid(
            [
              ["Logical", "logicalName"],
              ["Schema", "schemaName"],
              ["Display", "displayName"],
              ["Attribute Type", "attributeType"],
              ["Metadata Type", "metadataType"],
              ["Is Global", "isGlobalChoice", (v) => v ? "Yes" : "No"],
              ["Global Choice Name", "globalChoiceName"],
              ["Format", "format"],
              ["Max Length", "maxLength"],
              ["Min Value", "minValue"],
              ["Max Value", "maxValue"],
              ["Precision", "precision"],
              ["Default", "defaultValue"],
              ["Required", "requiredLevel"],
              ["Advanced Find", "advancedFind"],
              ["Audit", "audit"],
              ["Secured", "secured"],
              ["Create", "validForCreate"],
              ["Read", "validForRead"],
              ["Update", "validForUpdate"],
              ["Targets", "targets", (v) => (v || []).join(", ")],
              ["Lookup Value", "lookupValueColumn"],
              ["Custom", "isCustom"],
              ["Managed", "isManaged"],
              ["Description", "description"],
            ],
            a,
          ),
      );
    else if (tab === "Keys")
      searchable(d.keys, "Search keys and key attributes", (a) =>
        grid(
          [
            ["Schema", "SchemaName"],
            ["Logical", "LogicalName"],
            [
              "Display",
              "DisplayName",
              (v) => v?.UserLocalizedLabel?.Label || "",
            ],
            ["Key Attributes", "KeyAttributes", (v) => (v || []).join(", ")],
            ["Metadata ID", "MetadataId"],
            ["Managed", "IsManaged"],
          ],
          a,
        ),
      );
    else if (tab === "Choices") {
      const p=root.querySelector("#pane");p.innerHTML=`<div class=row><label><b>Choice Filter</b></label><select id=choiceMode class=i><option value=all>All Choices</option><option value=global>Global Choices</option><option value=nonGlobal>Non-Global Choices</option></select><input id=mq class="i search" placeholder="Search choice field, option text, or numeric value"><span id=mc class=muted></span></div><div id=mr></div>`;const mode=p.querySelector("#choiceMode"),q=p.querySelector("#mq"),o=p.querySelector("#mr"),c=p.querySelector("#mc");const renderChoices=(a)=>{
          const bo = a.filter(
              (x) =>
                x.choiceKind === "Boolean" ||
                String(x.metadataType).includes("Boolean") ||
                x.attributeType === "Boolean",
            ),
            os = a.filter((x) => !bo.includes(x)),
            section = (t, v) =>
              `<details open><summary><b>${t}</b> (${v.length})</summary>${
                v
                  .map(
                    (x) =>
                      `<details><summary><b>${E(x.displayName || x.logicalName)}</b> · ${E(x.logicalName)} · ${E(x.metadataType)} · <span class="globalChoiceBadge">Global Choice: ${x.isGlobalChoice ? "Yes" : "No"}</span>${x.globalChoiceName ? ` · ${E(x.globalChoiceName)}` : ""}</summary>${grid([["Default","defaultValue"],["Global Choice","isGlobalChoice",v=>v?"Yes":"No"],["Global Choice Name","globalChoiceName"],["Global Choice Metadata ID","globalChoiceMetadataId"]],[x])}${grid(
                        [
                          ["Option Text", "label"],
                          ["Value", "value"],
                          ["Color", "color"],
                          ["Description", "description"],
                        ],
                        x.options || [],
                      )}</details>`,
                  )
                  .join("") || "<div class=muted>None.</div>"
              }</details>`;
          return section("Option Sets", os) + section("Boolean Choices", bo);
        };function redraw(){const f=mode.value,term=q.value.toLowerCase(),rows=(d.choices||[]).filter(x=>f==="all"||(f==="global"?x.isGlobalChoice===true:x.isGlobalChoice!==true)).filter(x=>!term||JSON.stringify(x).toLowerCase().includes(term));c.textContent=`${rows.length} result${rows.length===1?"":"s"}`;o.innerHTML=renderChoices(rows)}mode.onchange=redraw;q.oninput=redraw;redraw();q.focus();
    }
    else {
      const kind = tab.startsWith("One")
          ? "1:N"
          : tab.startsWith("ManyToOne")
            ? "N:1"
            : "N:N",
        rows = d.relationships.filter((x) => x.kind === kind);
      searchable(
        rows,
        `Search ${kind} relationship schema, table or attribute`,
        (a) =>
          kind === "N:N"
            ? grid(
                [
                  ["Schema", "SchemaName"],
                  ["Entity 1", "Entity1LogicalName"],
                  ["Entity 1 Attribute", "Entity1IntersectAttribute"],
                  ["Entity 2", "Entity2LogicalName"],
                  ["Entity 2 Attribute", "Entity2IntersectAttribute"],
                  ["Intersect Table", "IntersectEntityName"],
                  ["Managed", "IsManaged"],
                ],
                a,
              )
            : grid(
                [
                  ["Schema", "SchemaName"],
                  ["Referencing Table", "ReferencingEntity"],
                  ["Referencing Attribute", "ReferencingAttribute"],
                  ["Referenced Table", "ReferencedEntity"],
                  ["Referenced Attribute", "ReferencedAttribute"],
                  [
                    "Cascade Assign",
                    "CascadeConfiguration",
                    (v, r) => r.CascadeConfiguration?.Assign,
                  ],
                  [
                    "Cascade Delete",
                    "CascadeConfiguration",
                    (v, r) => r.CascadeConfiguration?.Delete,
                  ],
                  [
                    "Cascade Share",
                    "CascadeConfiguration",
                    (v, r) => r.CascadeConfiguration?.Share,
                  ],
                  ["Managed", "IsManaged"],
                ],
                a,
              ),
      );
    }
  }
  function exportColumns() {
    const d = S.entity,
      xmlEscape = (x) =>
        text(x)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;"),
      cell = (x) =>
        `<Cell><Data ss:Type="String">${xmlEscape(typeof x === "object" && x !== null ? JSON.stringify(x) : x)}</Data></Cell>`,
      sheet = (name, rows) =>
        `<Worksheet ss:Name="${xmlEscape(name)}"><Table>${rows.map((row) => `<Row>${row.map(cell).join("")}</Row>`).join("")}</Table></Worksheet>`;
    const tableRows = [
      ["Property", "Value"],
      ["Logical name", d.logicalName],
      ["Schema name", d.schemaName],
      ["Display name", d.displayName],
      ["Collection name", d.collectionName],
      ["Description", d.description],
      ["Entity set", d.entitySetName],
      ["Object type code", d.objectTypeCode],
      ["Ownership", d.ownershipType],
      ["Primary ID", d.primaryIdAttribute],
      ["Primary name", d.primaryNameAttribute],
      ["Custom", d.isCustom],
      ["Managed", d.isManaged],
      ["Audit", d.auditEnabled],
      ["Change tracking", d.changeTracking],
      ["BPF table", d.isBpf],
      ["Business process enabled", d.businessProcessEnabled],
      ["Activity", d.isActivity],
      ["Metadata ID", d.metadataId],
    ];
    const columnRows = [
      [
        "Logical",
        "Schema",
        "Display",
        "Attribute Type",
        "Metadata Type",
        "Format",
        "Max Length",
        "Min Value",
        "Max Value",
        "Precision",
        "Default",
        "Required",
        "Advanced Find",
        "Audit",
        "Secured",
        "Create",
        "Read",
        "Update",
        "Targets",
        "Lookup Value",
        "Custom",
        "Managed",
        "Description",
      ],
      ...(d.columns || []).map((x) => [
        x.logicalName,
        x.schemaName,
        x.displayName,
        x.attributeType,
        x.metadataType,
        x.format,
        x.maxLength,
        x.minValue,
        x.maxValue,
        x.precision,
        x.defaultValue,
        x.requiredLevel,
        x.advancedFind,
        x.audit,
        x.secured,
        x.validForCreate,
        x.validForRead,
        x.validForUpdate,
        (x.targets || []).join(", "),
        x.lookupValueColumn,
        x.isCustom,
        x.isManaged,
        x.description,
      ]),
    ];
    const choiceRows = [
      [
        "Field Logical",
        "Field Schema",
        "Field Display",
        "Choice Type",
        "Global Choice",
        "Global Choice Name",
        "Global Choice Metadata ID",
        "Default",
        "Option Text",
        "Option Value",
        "Color",
        "Description",
      ],
    ];
    for (const x of d.choices || [])
      for (const o of x.options || [])
        choiceRows.push([
          x.logicalName,
          x.schemaName,
          x.displayName,
          x.metadataType,
          x.isGlobalChoice ? "Yes" : "No",
          x.globalChoiceName,
          x.globalChoiceMetadataId,
          x.defaultValue,
          o.label,
          o.value,
          o.color,
          o.description,
        ]);
    const keyRows = [
      [
        "Schema",
        "Logical",
        "Display",
        "Key Attributes",
        "Metadata ID",
        "Managed",
      ],
      ...(d.keys || []).map((x) => [
        x.SchemaName,
        x.LogicalName,
        x.DisplayName?.UserLocalizedLabel?.Label || "",
        (x.KeyAttributes || []).join(", "),
        x.MetadataId,
        x.IsManaged,
      ]),
    ];
    const one = [
        [
          "Schema",
          "Referencing Table",
          "Referencing Attribute",
          "Referenced Table",
          "Referenced Attribute",
          "Cascade Assign",
          "Cascade Delete",
          "Cascade Share",
          "Managed",
        ],
      ],
      manyOne = [...one],
      manyMany = [
        [
          "Schema",
          "Entity 1",
          "Entity 1 Attribute",
          "Entity 2",
          "Entity 2 Attribute",
          "Intersect Table",
          "Managed",
        ],
      ];
    for (const x of d.relationships || []) {
      if (x.kind === "1:N")
        one.push([
          x.SchemaName,
          x.ReferencingEntity,
          x.ReferencingAttribute,
          x.ReferencedEntity,
          x.ReferencedAttribute,
          x.CascadeConfiguration?.Assign,
          x.CascadeConfiguration?.Delete,
          x.CascadeConfiguration?.Share,
          x.IsManaged,
        ]);
      else if (x.kind === "N:1")
        manyOne.push([
          x.SchemaName,
          x.ReferencingEntity,
          x.ReferencingAttribute,
          x.ReferencedEntity,
          x.ReferencedAttribute,
          x.CascadeConfiguration?.Assign,
          x.CascadeConfiguration?.Delete,
          x.CascadeConfiguration?.Share,
          x.IsManaged,
        ]);
      else if (x.kind === "N:N")
        manyMany.push([
          x.SchemaName,
          x.Entity1LogicalName,
          x.Entity1IntersectAttribute,
          x.Entity2LogicalName,
          x.Entity2IntersectAttribute,
          x.IntersectEntityName,
          x.IsManaged,
        ]);
    }
    const xml = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${sheet("Table", tableRows)}${sheet("Columns", columnRows)}${sheet("Choices", choiceRows)}${sheet("Keys", keyRows)}${sheet("OneToMany", one)}${sheet("ManyToOne", manyOne)}${sheet("ManyToMany", manyMany)}</Workbook>`;
    D365AnalyzerApi.saveFile(
      `complete-metadata-${d.logicalName}.xls`,
      new Blob([xml], { type: "application/vnd.ms-excel" }),
    );
  }
  function exportGlobalChoices(){const xmlEscape=x=>text(x).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"),cell=x=>`<Cell><Data ss:Type="String">${xmlEscape(typeof x==="object"&&x!==null?JSON.stringify(x):x)}</Data></Cell>`,sheet=(name,rows)=>`<Worksheet ss:Name="${xmlEscape(name)}"><Table>${rows.map(row=>`<Row>${row.map(cell).join("")}</Row>`).join("")}</Table></Worksheet>`,definitions=[["Global Choice Name","Display Name","Metadata ID","Type","Description","Custom","Managed","Used By Count"]],options=[["Global Choice Name","Display Name","Option Text","Option Value","Color","Description"]],usage=[["Global Choice Name","Display Name","Table Display","Table Logical","Column Display","Column Logical"]];for(const x of S.globalChoices||[]){definitions.push([x.name,x.displayName,x.metadataId,x.type,x.description,x.isCustom,x.isManaged,(x.usedBy||[]).length]);for(const v of x.options||[])options.push([x.name,x.displayName,v.label,v.value,v.color,v.description]);for(const u of x.usedBy||[])usage.push([x.name,x.displayName,u.tableDisplayName,u.tableLogicalName,u.columnDisplayName,u.columnLogicalName])}const xml=`<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">${sheet("Global Choices",definitions)}${sheet("Options",options)}${sheet("Used By",usage)}</Workbook>`;D365AnalyzerApi.saveFile("global-choices-with-usage.xls",new Blob([xml],{type:"application/vnd.ms-excel"}))}
  async function openChoiceColumn(logicalName,columnName){if(!root)throw Error("Metadata Browser is not ready.");await load(logicalName);showEntity("Choices");const query=root.querySelector("#mq");if(query){query.value=columnName||"";query.dispatchEvent(new Event("input"));query.focus()}}
  async function openColumn(logicalName, columnName) {
    if (!root) throw Error("Metadata Browser is not ready.");
    await load(logicalName);
    showEntity("Columns");
    const query = root.querySelector("#mq");
    if (query) {
      query.value = columnName || "";
      query.dispatchEvent(new Event("input"));
      query.focus();
    }
  }
  window.D365MetadataView = Object.freeze({
    render,
    openColumn,
    reset: () => {
      S.tables = null;
      S.entity = null;
      S.globalChoices = null;
    },
  });
})();
