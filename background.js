"use strict";

function pageBridge(action, payload) {
  "use strict";

  const clean = (value) => (value ? String(value).replace(/[{}]/g, "") : null);
  const localizedLabel = (value) =>
    value?.UserLocalizedLabel?.Label ||
    value?.LocalizedLabels?.[0]?.Label ||
    "";
  const escapeOData = (value) => String(value ?? "").replace(/'/g, "''");

  const requestedSurface=payload?.__devlensSurface||null;
  const sidePane=()=>requestedSurface?.kind==="sidePane"&&requestedSurface?.entityName;
  async function surfaceContext(requirements={}){if(!sidePane())return context(requirements);const gc=Xrm.Utility.getGlobalContext(),meta=await Xrm.Utility.getEntityMetadata(requestedSurface.entityName);return{entityName:requestedSurface.entityName,entitySetName:meta.EntitySetName||null,metadataId:clean(meta.MetadataId),formId:clean(requestedSurface.internal?.metadataForm?.id||requestedSurface.internal?.formId||requestedSurface.formId),formItem:null,recordId:clean(requestedSurface.recordId||requestedSurface.internal?.recordId),clientUrl:gc.getClientUrl(),environmentId:clean(gc.organizationSettings?.bapEnvironmentId),userId:clean(gc.userSettings?.userId),userName:gc.userSettings?.userName||"",languageId:gc.userSettings?.languageId,surface:requestedSurface};}
  const listify=value=>Array.isArray(value)?value:value&&typeof value==="object"?Object.values(value):[];
  const agentActionMap={logical:"showLogicalNames",clearLogical:"clearLogicalNames"};
  function requestFormAgent(actionName,actionPayload={}){return new Promise(resolve=>{const requestId=`devlens-${Date.now()}-${Math.random().toString(36).slice(2)}`,timer=setTimeout(()=>{cleanup();resolve({ok:false,code:"SIDE_PANE_LIVE_RUNTIME_REQUIRED",error:"Live side-pane Form Agent did not respond.",provider:"form-agent"})},1500);const listener=event=>{if(event.source!==window||event.origin!==location.origin)return;const d=event.data;if(d?.source!=="DEVLENS_FORM_AGENT"||d?.type!=="COMMAND_RESPONSE"||d.requestId!==requestId)return;cleanup();resolve(d)};function cleanup(){clearTimeout(timer);window.removeEventListener("message",listener,true)}window.addEventListener("message",listener,true);window.postMessage({source:"DEVLENS_EXTENSION",type:"COMMAND_REQUEST",requestId,action:agentActionMap[actionName]||actionName,identity:{entityName:requestedSurface?.entityName||requestedSurface?.internal?.entityName,recordId:requestedSurface?.recordId||requestedSurface?.internal?.recordId,formId:requestedSurface?.internal?.metadataForm?.id||requestedSurface?.internal?.formId||requestedSurface?.formId},payload:actionPayload},location.origin)})}

  const firstValue=(object,names,fallback="")=>{for(const name of names){const value=object?.[name];if(value!==undefined&&value!==null&&value!=="")return value}return fallback};
  function normalizeLibraries(metadataForm){return listify(metadataForm?.formLibraries).map(item=>typeof item==="string"?item:firstValue(item,["LibraryName","libraryName","Name","name","WebResourceName","webResourceName"])) .filter(Boolean).filter((value,index,array)=>array.indexOf(value)===index);}
  function normalizeEvents(metadataForm,entityName){return listify(metadataForm?.eventHandlers).map((handler,index)=>{const eventName=String(firstValue(handler,["EventName","eventName","EventType","eventType","Event","event","Type","type"],"INTERNAL")).toUpperCase().replace(/^ON/,"ON");const libraryName=firstValue(handler,["LibraryName","libraryName","WebResourceName","webResourceName","Library","library"]);const functionName=firstValue(handler,["FunctionName","functionName","Handler","handler","MethodName","methodName"]);const targetName=firstValue(handler,["AttributeName","attributeName","ControlName","controlName","TargetName","targetName"],entityName);const category=eventName.includes("CHANGE")?"FIELD":eventName.includes("TAB")||eventName.includes("EXPAND")||eventName.includes("COLLAPSE")?"TAB":eventName.includes("PROCESS")||eventName.includes("STAGE")?"BPF":"FORM";return{category,eventType:eventName,targetType:category==="FIELD"?"ATTRIBUTE":category,targetName,targetLabel:firstValue(handler,["TargetLabel","targetLabel"]),functionName,libraryName,enabled:firstValue(handler,["Enabled","enabled"],true)!==false,passExecutionContext:firstValue(handler,["PassExecutionContext","passExecutionContext"],false),parameters:firstValue(handler,["Parameters","parameters"],""),internal:false,source:"UCI Redux metadata.forms",eventIndex:index}}).filter(row=>row.functionName||row.libraryName);}
  function internalFields(){const internal=requestedSurface?.internal,controls=internal?.form?.controls||{},cached=internal?.cachedEntity||{},rows=[];for(const [key,c] of Object.entries(controls)){const logical=c?.dataFieldName||c?.DataFieldName||c?.name||c?.Name||null;if(!logical)continue;const field=cached?.fields?.[logical]||cached?.[logical]||{};const value=field?.value??field?.Value??field;rows.push({displayName:c?.label||c?.Label||logical,logicalName:logical,attributeType:c?.attributeType||c?.AttributeType||"unknown",displayValue:field?.formattedValue??field?.FormattedValue??(value==null?"":String(value)),rawValue:value==null?"":typeof value==="object"?JSON.stringify(value):String(value),empty:value==null||value==="",visible:c?.visible??c?.Visible??true,hidden:(c?.visible??c?.Visible)===false,disabled:c?.disabled??c?.Disabled??false,readOnly:c?.disabled??c?.Disabled??false,dirty:field?.isDirty??field?.dirty??false,requiredLevel:c?.requiredLevel||c?.RequiredLevel||"unknown",submitMode:"internal-state",onForm:true,runtimeAvailable:true,metadataAvailable:false,metadataOnly:false,controlCount:1,multiControl:false,controlName:key,locations:[],inspectionSource:"UCI internal Redux state"})}return rows;}
  async function context(requirements = {}) {
    const { requireEntity = true, requireForm = true } = requirements;
    if (typeof Xrm === "undefined" || !Xrm.Utility?.getGlobalContext) throw Error("Xrm is unavailable in this frame.");
    const globalContext = Xrm.Utility.getGlobalContext();
    const entityName = Xrm.Page?.data?.entity?.getEntityName?.() || null;
    if (requireEntity && !entityName) throw Error("Open a model-driven record form first.");
    let formItem = Xrm.Page?.ui?.formSelector?.getCurrentItem?.() || null;
    let formId = clean(formItem?.getId?.());
    if (!formId && entityName) { formItem = (Xrm.Page?.ui?.formSelector?.items?.get?.() || [])[0] || null; formId = clean(formItem?.getId?.()); }
    if (requireForm && !formId) throw Error("Current form ID could not be resolved.");
    let entityMetadata = null, metadataId = null;
    if (entityName) { entityMetadata = await Xrm.Utility.getEntityMetadata(entityName); metadataId = clean(entityMetadata?.MetadataId); }
    return { entityName, entitySetName: entityMetadata?.EntitySetName || null, metadataId, formId, formItem, recordId: clean(Xrm.Page?.data?.entity?.getId?.()), clientUrl: globalContext.getClientUrl(), environmentId: clean(globalContext.organizationSettings?.bapEnvironmentId), userId: clean(globalContext.userSettings?.userId), userName: globalContext.userSettings?.userName || "", languageId: globalContext.userSettings?.languageId };
  }
  const toolkitState = (window.__DEVLENS_TOOLKIT_STATE ??= {
    controls: new Map(),
    tabs: new Map(),
    sections: new Map(),
    attributes: new Map(),
    formKey: null,
  });

  const metadataCache = (window.__DEVLENS_METADATA_CACHE ??= {
    tables: null,
    tablesPromise: null,
    globalChoices: null,
    globalChoicesPromise: null,
    globalChoiceUsage: { usageByName: {}, warnings: [], partial: false },
    attributeCatalog: null,
    metadataIndexPromise: null,
    metadataIndexToken: null,
    metadataIndexStatus: { state: "idle", phase: "idle", completed: 0, total: 0, warnings: 0, message: "", mode: "automatic" },
    entities: new Map(),
    entityPromises: new Map(),
    stringMaps: new Map(),
    stringMapPromises: new Map(),
  });

  const clone = (value) =>
    value == null
      ? value
      : typeof structuredClone === "function"
        ? structuredClone(value)
        : JSON.parse(JSON.stringify(value));

  async function fetchJson(url, options = {}) {
    const headers = {
      Accept: "application/json",
      "Content-Type": "application/json; charset=utf-8",
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
      ...(options.headers || {}),
    };
    const response = await fetch(url, {
      credentials: "same-origin",
      ...options,
      headers,
    });
    if (!response.ok) {
      let detail = "";
      try {
        detail = (await response.json())?.error?.message || "";
      } catch {}
      throw Error(
        detail ||
          `Dataverse request failed: ${response.status} ${response.statusText}`,
      );
    }
    if (response.status === 204) return {};
    return response.json();
  }

  function tag(element) {
    return (
      element?.localName?.toLowerCase() || element?.tagName?.toLowerCase() || ""
    );
  }
  function all(root, expected) {
    return Array.from(root?.getElementsByTagName?.("*") || []).filter(
      (element) => tag(element) === expected,
    );
  }
  function xmlAttribute(element, names) {
    for (const name of names) {
      const value = element?.getAttribute?.(name);
      if (value != null && String(value).trim()) return String(value).trim();
    }
    return null;
  }
  function ancestor(element, names) {
    for (
      let parent = element?.parentElement;
      parent;
      parent = parent.parentElement
    )
      if (names.includes(tag(parent))) return parent;
    return null;
  }
  function eventType(raw) {
    return (
      {
        onload: "ONLOAD",
        onsave: "ONSAVE",
        onchange: "ONCHANGE",
        ontabstatechange: "ONTABSTATECHANGE",
        tabstatechange: "ONTABSTATECHANGE",
        onexpand: "ONEXPAND",
        onexpanded: "ONEXPAND",
        oncollapse: "ONCOLLAPSE",
        oncollapsed: "ONCOLLAPSE",
        onstagechange: "ONSTAGECHANGE",
        onstageselected: "ONSTAGESELECTED",
        stageselected: "ONSTAGESELECTED",
      }[
        String(raw || "")
          .toLowerCase()
          .replace(/[^a-z]/g, "")
      ] || null
    );
  }
  function eventTarget(event, type) {
    if (type === "ONCHANGE") {
      const names = [
        "attribute",
        "attributename",
        "attributeName",
        "datafieldname",
        "dataFieldName",
        "field",
        "fieldname",
        "fieldName",
      ];
      const control = ancestor(event, ["control"]);
      return {
        targetType: "field",
        targetName:
          xmlAttribute(event, names) ||
          xmlAttribute(event.parentElement, names) ||
          xmlAttribute(control, ["datafieldname", "attribute", "name"]) ||
          "(unresolved field)",
        targetLabel: null,
        targetId: xmlAttribute(control, ["id"]),
      };
    }
    if (["ONTABSTATECHANGE", "ONEXPAND", "ONCOLLAPSE"].includes(type)) {
      const tabElement = ancestor(event, ["tab"]);
      const labelElement = tabElement ? all(tabElement, "label")[0] : null;
      const tabName =
        xmlAttribute(tabElement, ["name", "id"]) ||
        xmlAttribute(event, ["tabname", "tabName"]) ||
        xmlAttribute(event.parentElement, ["tabname", "tabName"]);
      return {
        targetType: "tab",
        targetName: tabName || "(unresolved tab)",
        targetLabel: xmlAttribute(labelElement, ["description", "label"]),
        targetId: xmlAttribute(tabElement, ["id"]),
      };
    }
    if (["ONSTAGECHANGE", "ONSTAGESELECTED"].includes(type))
      return {
        targetType: "bpf",
        targetName: "(business process)",
        targetLabel: null,
        targetId: null,
      };
    return {
      targetType: "form",
      targetName: "(form)",
      targetLabel: null,
      targetId: null,
    };
  }
  function eventHandlers(event) {
    const output = [];
    Array.from(event.children || [])
      .filter((element) =>
        ["handlers", "internalhandlers"].includes(tag(element)),
      )
      .forEach((container) => {
        all(container, "handler").forEach((handler) =>
          output.push({
            functionName: handler.getAttribute("functionName") || "",
            libraryName: handler.getAttribute("libraryName") || "",
            enabled: handler.getAttribute("enabled") !== "false",
            passExecutionContext:
              handler.getAttribute("passExecutionContext") !== "false",
            parameters: handler.getAttribute("parameters") || "",
            internal: tag(container) === "internalhandlers",
          }),
        );
      });
    return output;
  }
  async function report() {
    if(sidePane()){const ctx=await surfaceContext({requireEntity:true,requireForm:false});const internal=requestedSurface.internal||{},metadataForm=internal.metadataForm||{};const rows=normalizeEvents(metadataForm,ctx.entityName),formLibraries=normalizeLibraries(metadataForm);for(const row of rows)if(row.libraryName&&!formLibraries.includes(row.libraryName))formLibraries.push(row.libraryName);return{ok:true,entityName:ctx.entityName,entitySetName:ctx.entitySetName,entityMetadataId:ctx.metadataId,environmentId:ctx.environmentId,formName:metadataForm.name||"Selected side-pane record",formId:ctx.formId||metadataForm.id,recordId:ctx.recordId,clientUrl:ctx.clientUrl,rows,formLibraries,generatedOn:new Date().toISOString(),surface:{...requestedSurface,internal:undefined},internalDiagnostics:{pageKey:internal.pageKey,controlCount:internal.form?.controlCount||0,eventHandlerCount:rows.length,formLibraryCount:formLibraries.length,metadataFormId:metadataForm.id||null,metadataFormKeys:metadataForm.keys||[],browsingContext:internal.browsingContext,commandContext:internal.commandContext}}}
    const ctx = await context();
    const form = await Xrm.WebApi.retrieveRecord(
      "systemform",
      ctx.formId,
      "?$select=name,formxml",
    );
    const xml = new DOMParser().parseFromString(
      form.formxml,
      "application/xml",
    );
    if (xml.querySelector("parsererror"))
      throw Error("Form XML could not be parsed.");
    const rows = [];
    all(xml, "event").forEach((event, index) => {
      const type = eventType(event.getAttribute("name"));
      if (!type) return;
      const category = ["ONLOAD", "ONSAVE"].includes(type)
        ? "FORM"
        : type === "ONCHANGE"
          ? "FIELD"
          : ["ONTABSTATECHANGE", "ONEXPAND", "ONCOLLAPSE"].includes(type)
            ? "TAB"
            : "BPF";
      const target = eventTarget(event, type);
      eventHandlers(event).forEach((handler) =>
        rows.push({
          category,
          eventType: type,
          ...target,
          ...handler,
          source: "Form XML",
          eventIndex: index,
        }),
      );
    });
    const seen = new Set();
    const unique = rows.filter((row) => {
      const key = [
        row.eventType,
        row.targetType,
        row.targetName,
        row.functionName,
        row.libraryName,
        row.parameters,
        row.internal,
      ].join("|");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return {
      ok: true,
      entityName: ctx.entityName,
      entitySetName: ctx.entitySetName,
      entityMetadataId: ctx.metadataId,
      environmentId: ctx.environmentId,
      formName: form.name || ctx.formItem?.getLabel?.() || "",
      formId: ctx.formId,
      recordId: ctx.recordId,
      clientUrl: ctx.clientUrl,
      rows: unique,
      generatedOn: new Date().toISOString(),
    };
  }

  const decode = (value) => {
    try {
      return new TextDecoder().decode(
        Uint8Array.from(atob(value || ""), (character) =>
          character.charCodeAt(0),
        ),
      );
    } catch {
      return atob(value || "");
    }
  };
  function analyze(name, source, registered) {
    const definitions = [];
    for (const regex of [
      /function\s+([A-Za-z_$][\w$]*)\s*\(/g,
      /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>)/g,
      /\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\s*=\s*(?:async\s*)?function\s*\(/g,
      /\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/g,
    ]) {
      let match;
      while ((match = regex.exec(source)))
        definitions.push({
          name: match[1],
          line: source.slice(0, match.index).split("\n").length,
          index: match.index,
        });
    }
    const unique = [
      ...new Map(
        definitions.map((item) => [item.name + "|" + item.line, item]),
      ).values(),
    ];
    return {
      libraryName: name,
      source,
      lineCount: source.split("\n").length,
      definitions: unique,
      registeredFunctions: registered.map((functionName) => {
        const exact = unique.filter(
          (item) =>
            item.name === functionName ||
            item.name.endsWith("." + functionName),
        );
        const occurrenceLines = [];
        let position = 0;
        while ((position = source.indexOf(functionName, position)) >= 0) {
          occurrenceLines.push(source.slice(0, position).split("\n").length);
          position += Math.max(1, functionName.length);
        }
        return {
          functionName,
          defined: !!exact.length,
          definitionLines: exact.map((item) => item.line),
          occurrenceLines: occurrenceLines.slice(0, 200),
        };
      }),
    };
  }
  async function scan(libraries) {
    const results = [];
    for (const item of libraries) {
      try {
        const name = item.libraryName.replace(/'/g, "''");
        const response = await Xrm.WebApi.retrieveMultipleRecords(
          "webresource",
          `?$select=name,displayname,content&$filter=name eq '${name}'&$top=1`,
        );
        const resource = response.entities[0];
        results.push(
          resource
            ? {
                ok: true,
                displayName: resource.displayname || "",
                ...analyze(
                  resource.name,
                  decode(resource.content),
                  item.functions,
                ),
              }
            : {
                ok: false,
                libraryName: item.libraryName,
                error: "Web resource not found",
              },
        );
      } catch (error) {
        results.push({
          ok: false,
          libraryName: item.libraryName,
          error: error.message || String(error),
        });
      }
    }
    return { ok: true, results };
  }

  const optionsFrom = (optionSet) => {
    if (!optionSet) return [];
    if (Array.isArray(optionSet.Options))
      return optionSet.Options.map((option) => ({
        value: option.Value,
        label: localizedLabel(option.Label),
        description: localizedLabel(option.Description),
        color: option.Color || "",
      }));
    return [optionSet.TrueOption, optionSet.FalseOption]
      .filter(Boolean)
      .map((option) => ({
        value: option.Value,
        label: localizedLabel(option.Label),
        description: localizedLabel(option.Description),
        color: option.Color || "",
      }));
  };
  async function runBatches(items, size, worker) {
    for (let index = 0; index < items.length; index += size)
      await Promise.all(items.slice(index, index + size).map(worker));
  }
  async function stringMapChoices(ctx, entityName, attributeName) {
    const key = `${ctx.clientUrl}|${entityName}|${attributeName}`.toLowerCase();
    if (metadataCache.stringMaps.has(key))
      return clone(metadataCache.stringMaps.get(key));
    if (metadataCache.stringMapPromises.has(key))
      return clone(await metadataCache.stringMapPromises.get(key));
    const request = (async () => {
      const data = await fetchJson(
        `${ctx.clientUrl}/api/data/v9.2/stringmaps?$select=attributevalue,value,langid&$filter=objecttypecode eq '${escapeOData(entityName)}' and attributename eq '${escapeOData(attributeName)}'`,
      );
      const grouped = new Map();
      for (const row of data.value || []) {
        if (row.attributevalue == null || !String(row.value || "").trim())
          continue;
        if (!grouped.has(row.attributevalue))
          grouped.set(row.attributevalue, []);
        grouped.get(row.attributevalue).push({
          value: row.attributevalue,
          label: String(row.value).trim(),
          languageCode: Number(row.langid),
        });
      }
      const options = [...grouped]
        .map(([value, rows]) => {
          const selected =
            rows.find((row) => row.languageCode === 1033) ||
            rows.find((row) => /^[\x00-\x7F]*$/.test(row.label)) ||
            rows[0];
          return { value, label: selected.label, description: "", color: "" };
        })
        .sort((left, right) => Number(left.value) - Number(right.value));
      metadataCache.stringMaps.set(key, clone(options));
      return options;
    })();
    metadataCache.stringMapPromises.set(key, request);
    try {
      return clone(await request);
    } finally {
      metadataCache.stringMapPromises.delete(key);
    }
  }
  async function metadataTables() {
    if (metadataCache.tables)
      return { ok: true, data: clone(metadataCache.tables), cached: true };
    if (metadataCache.tablesPromise)
      return {
        ok: true,
        data: clone(await metadataCache.tablesPromise),
        cached: true,
      };
    metadataCache.tablesPromise = (async () => {
      const ctx = await context({ requireEntity: false, requireForm: false });
      const data = await fetchJson(
        `${ctx.clientUrl}/api/data/v9.2/EntityDefinitions?$select=LogicalName,SchemaName,EntitySetName,MetadataId,IsCustomEntity,DisplayName,ObjectTypeCode,OwnershipType,PrimaryIdAttribute,PrimaryNameAttribute,IsAuditEnabled,ChangeTrackingEnabled,IsBPFEntity,IsBusinessProcessEnabled,IsActivity,IsManaged`,
      );
      const tables = (data.value || []).map((item) => ({
        logicalName: item.LogicalName,
        schemaName: item.SchemaName,
        displayName: localizedLabel(item.DisplayName),
        entitySetName: item.EntitySetName,
        metadataId: item.MetadataId,
        isCustom: item.IsCustomEntity,
        objectTypeCode: item.ObjectTypeCode,
        ownershipType: item.OwnershipType,
        primaryIdAttribute: item.PrimaryIdAttribute,
        primaryNameAttribute: item.PrimaryNameAttribute,
        auditEnabled: item.IsAuditEnabled?.Value,
        changeTracking: item.ChangeTrackingEnabled,
        isBpf: item.IsBPFEntity,
        businessProcessEnabled: item.IsBusinessProcessEnabled,
        isActivity: item.IsActivity,
        isManaged: item.IsManaged,
        search: [
          localizedLabel(item.DisplayName),
          item.LogicalName,
          item.SchemaName,
          item.ObjectTypeCode,
          item.OwnershipType,
          item.IsCustomEntity ? "custom customtype" : "standard",
          item.IsManaged ? "managed" : "unmanaged",
        ]
          .join(" ")
          .toLowerCase(),
      }));
      metadataCache.tables = clone(tables);
      return tables;
    })();
    try {
      return {
        ok: true,
        data: clone(await metadataCache.tablesPromise),
        cached: false,
      };
    } finally {
      metadataCache.tablesPromise = null;
    }
  }
  const choiceMetadataTypes = [
    ["PicklistAttributeMetadata", "OptionSet"], ["MultiSelectPicklistAttributeMetadata", "OptionSet"],
    ["StateAttributeMetadata", "OptionSet"], ["StatusAttributeMetadata", "OptionSet"], ["BooleanAttributeMetadata", "Boolean"],
  ];
  const globalChoiceKey=v=>String(v||"").trim().toLowerCase();
  const reusableChoiceMetadataType=metadataType=>/^(PicklistAttributeMetadata|MultiSelectPicklistAttributeMetadata)$/i.test(String(metadataType||""));
  const globalOptionSetFrom=(a,metadataType)=>reusableChoiceMetadataType(metadataType)&&(a?.GlobalOptionSet?.Name?a.GlobalOptionSet:(a?.OptionSet?.IsGlobal===true&&a?.OptionSet?.Name?a.OptionSet:null));
  const optionSetFrom=(a,metadataType)=>globalOptionSetFrom(a,metadataType)||a?.OptionSet||null;
  function applyDependencyEvidence(entity){
    if(!entity)return entity;const table=String(entity.logicalName||"").toLowerCase(),choices=metadataCache.globalChoices||[];
    for(const [name,rows] of Object.entries(metadataCache.globalChoiceUsage?.usageByName||{})){const choice=choices.find(x=>globalChoiceKey(x.name)===name);for(const row of rows||[]){if(String(row.tableLogicalName).toLowerCase()!==table)continue;const col=(entity.columns||[]).find(x=>String(x.logicalName).toLowerCase()===String(row.columnLogicalName).toLowerCase());if(col){col.isGlobalChoice=true;col.globalChoiceName=choice?.name||name;col.globalChoiceMetadataId=choice?.metadataId||"";if(choice?.options?.length&&!col.options?.length)col.options=clone(choice.options);}}}entity.choices=(entity.columns||[]).filter(x=>x.choiceKind==="OptionSet"||x.choiceKind==="Boolean"||/Picklist|MultiSelect|State|Status|Boolean/i.test(String(x.attributeType||x.metadataType||"")));return entity;
  }
  function publishUsage(choice,rows){
    const key=globalChoiceKey(choice.name);metadataCache.globalChoiceUsage.usageByName[key]=rows;
    if(metadataCache.globalChoices){const target=metadataCache.globalChoices.find(x=>globalChoiceKey(x.name)===key);if(target){target.usedBy=clone(rows);target.usedByCount=rows.length;}}
    for(const [key,entity] of metadataCache.entities){applyDependencyEvidence(entity);metadataCache.entities.set(key,entity)}
  }
  async function globalChoices(){
    if(metadataCache.globalChoices)return{ok:true,data:clone(metadataCache.globalChoices),cached:true};if(metadataCache.globalChoicesPromise)return{ok:true,data:clone(await metadataCache.globalChoicesPromise),cached:true};
    metadataCache.globalChoicesPromise=(async()=>{const ctx=await context({requireEntity:false,requireForm:false}),data=await fetchJson(`${ctx.clientUrl}/api/data/v9.2/GlobalOptionSetDefinitions`),usage=metadataCache.globalChoiceUsage.usageByName;const rows=(data.value||[]).map(x=>{const usedBy=usage[globalChoiceKey(x.Name)]||[];return{name:x.Name,metadataId:clean(x.MetadataId)||"",displayName:localizedLabel(x.DisplayName),description:localizedLabel(x.Description),type:x.OptionSetType,isCustom:x.IsCustomOptionSet,isManaged:x.IsManaged,options:optionsFrom(x),usedBy,usedByCount:usedBy.length}}).sort((a,b)=>(a.displayName||a.name).localeCompare(b.displayName||b.name));metadataCache.globalChoices=clone(rows);return rows})();
    try{return{ok:true,data:clone(await metadataCache.globalChoicesPromise),cached:false}}finally{metadataCache.globalChoicesPromise=null}
  }
  async function buildAttributeCatalog(ctx,token){
    metadataCache.metadataIndexStatus={...metadataCache.metadataIndexStatus,state:"running",phase:"attributes",completed:0,total:1,message:"Loading attribute catalog"};
    const data=await fetchJson(`${ctx.clientUrl}/api/data/v9.2/EntityDefinitions?$select=LogicalName,DisplayName&$expand=Attributes($select=MetadataId,LogicalName,DisplayName,AttributeType)`),map=new Map();if(token.cancelled)return map;
    for(const t of data.value||[])for(const a of t.Attributes||[]){const id=clean(a.MetadataId)?.toLowerCase();if(id)map.set(id,{tableLogicalName:t.LogicalName,tableDisplayName:localizedLabel(t.DisplayName)||t.LogicalName,columnLogicalName:a.LogicalName,columnDisplayName:localizedLabel(a.DisplayName)||a.LogicalName,attributeType:a.AttributeType})}metadataCache.attributeCatalog=map;return map;
  }
  async function dependencyRows(ctx,choice,catalog){
    const id=clean(choice.metadataId);if(!id)return[];const data=await fetchJson(`${ctx.clientUrl}/api/data/v9.2/RetrieveDependentComponents(ObjectId=${id},ComponentType=9)`),rows=[];
    for(const d of data.value||[]){if(Number(d.dependentcomponenttype??d.DependentComponentType)!==2)continue;const key=clean(d.dependentcomponentobjectid??d.DependentComponentObjectId)?.toLowerCase(),row=catalog.get(key);if(row)rows.push(row)}return[...new Map(rows.map(r=>[`${r.tableLogicalName}|${r.columnLogicalName}`.toLowerCase(),r])).values()].sort((a,b)=>(a.tableDisplayName||a.tableLogicalName).localeCompare(b.tableDisplayName||b.tableLogicalName)||a.columnLogicalName.localeCompare(b.columnLogicalName));
  }
  function intelligenceStorageKey(ctx){return `devlens.metadataIntelligence.v2.${String(ctx.environmentId||ctx.clientUrl||"default").toLowerCase()}`}
  function loadIntelligenceHistory(ctx){try{return JSON.parse(localStorage.getItem(intelligenceStorageKey(ctx))||"{}")||{}}catch{return{}}}
  function scoreTables(tables,ctx,limit=80){const counts=new Map();for(const rows of Object.values(metadataCache.globalChoiceUsage.usageByName||{}))for(const row of rows||[]){const k=String(row.tableLogicalName||"").toLowerCase();counts.set(k,(counts.get(k)||0)+1)}const history=loadIntelligenceHistory(ctx),current=String(ctx.entityName||"").toLowerCase();return [...tables].sort((a,b)=>{const score=t=>{const k=String(t.logicalName||"").toLowerCase(),h=history[k]||{};return(k===current?100000:0)+(t.isCustom?150:0)+(/user|team/i.test(String(t.ownershipType||""))?40:0)+(counts.get(k)||0)*10+Math.min(300,Number(h.opens||0)*15)};return score(b)-score(a)||(a.displayName||a.logicalName).localeCompare(b.displayName||b.logicalName)}).slice(0,limit)}
  async function recordTableVisit(logicalName){try{const ctx=await context({requireEntity:false,requireForm:false}),key=intelligenceStorageKey(ctx),history=loadIntelligenceHistory(ctx),name=String(logicalName||"").toLowerCase(),row=history[name]||{opens:0,lastOpened:""};row.opens++;row.lastOpened=new Date().toISOString();history[name]=row;localStorage.setItem(key,JSON.stringify(history))}catch{}}
  async function preloadIntelligence(tables,ctx,token,mode,warnings){const queue=[],seen=new Set(),add=n=>{const k=String(n||"").toLowerCase();if(k&&!seen.has(k)){seen.add(k);queue.push(k)}};add(ctx.entityName);scoreTables(tables,ctx).forEach(t=>add(t.logicalName));metadataCache.metadataIndexStatus={state:"running",phase:"intelligence",completed:0,total:queue.length,warnings:warnings.length,message:"Preloading intelligent table cache",mode};const worker=async()=>{while(queue.length&&!token.cancelled){const name=queue.shift();try{await metadataEntity(name,false)}catch(e){warnings.push(`${name}: ${e.message||e}`)}metadataCache.metadataIndexStatus.completed++}};await Promise.all(Array.from({length:Math.min(4,queue.length||1)},worker))}
  async function runMetadataIndex(ctx,token,mode){
    const [tableResult,cr]=await Promise.all([metadataTables(),globalChoices()]);if(token.cancelled)return{cancelled:true};const tables=tableResult.data||[],choices=cr.data||[],catalog=metadataCache.attributeCatalog||await buildAttributeCatalog(ctx,token);if(token.cancelled)return{cancelled:true};
    metadataCache.metadataIndexStatus={state:"running",phase:"dependencies",completed:0,total:choices.length,warnings:0,message:"Indexing Global Choice dependencies",mode};const queue=[...choices],warnings=[],workers=8;
    const worker=async()=>{while(queue.length&&!token.cancelled){const choice=queue.shift();try{publishUsage(choice,await dependencyRows(ctx,choice,catalog))}catch(e){warnings.push(`${choice.name}: ${e.message||e}`)}metadataCache.metadataIndexStatus.completed++;metadataCache.metadataIndexStatus.warnings=warnings.length}};await Promise.all(Array.from({length:Math.min(workers,choices.length||1)},worker));
    if(token.cancelled){metadataCache.metadataIndexStatus={...metadataCache.metadataIndexStatus,state:"cancelled",message:"Indexing cancelled"};return{cancelled:true}}metadataCache.globalChoiceUsage.warnings=warnings;metadataCache.globalChoiceUsage.partial=!!warnings.length;await preloadIntelligence(tables,ctx,token,mode,warnings);if(token.cancelled)return{cancelled:true};metadataCache.metadataIndexStatus={state:"complete",phase:"complete",completed:metadataCache.metadataIndexStatus.total,total:metadataCache.metadataIndexStatus.total,warnings:warnings.length,message:"Metadata Intelligence Phase 2 cache ready; remaining tables load on demand",mode};return metadataCache.globalChoiceUsage;
  }
  function startMetadataIndex(mode="automatic"){
    if(metadataCache.metadataIndexStatus.state==="complete")return Promise.resolve({ok:true,data:clone(metadataCache.metadataIndexStatus),cached:true});if(metadataCache.metadataIndexPromise)return Promise.resolve({ok:true,data:clone(metadataCache.metadataIndexStatus),running:true});const token={cancelled:false};metadataCache.metadataIndexToken=token;metadataCache.metadataIndexStatus.mode=mode;
    metadataCache.metadataIndexPromise=(async()=>runMetadataIndex(await context({requireEntity:false,requireForm:false}),token,mode))().catch(e=>{metadataCache.metadataIndexStatus={...metadataCache.metadataIndexStatus,state:"error",message:e.message||String(e)};return{error:e.message||String(e)}}).finally(()=>{metadataCache.metadataIndexPromise=null;metadataCache.metadataIndexToken=null});return Promise.resolve({ok:true,started:true});
  }
  function metadataIndexStatus(){return{ok:true,data:clone(metadataCache.metadataIndexStatus),usage:clone(metadataCache.globalChoiceUsage)}}
  function cancelMetadataIndex(){if(metadataCache.metadataIndexToken&&metadataCache.metadataIndexStatus.mode==="manual")metadataCache.metadataIndexToken.cancelled=true;return{ok:true,message:"Index cancellation requested."}}
  async function metadataEntity(logicalName,trackVisit=true) {
    const requested = String(logicalName || "").trim();
    if (!requested) throw Error("Table logical name is required.");
    const key = requested.toLowerCase();
    if (metadataCache.entities.has(key)){if(trackVisit)void recordTableVisit(key);return{ok:true,data:clone(applyDependencyEvidence(metadataCache.entities.get(key))),cached:true};}
    if (metadataCache.entityPromises.has(key))
      return {
        ok: true,
        data: clone(await metadataCache.entityPromises.get(key)),
        cached: true,
      };
    const request = (async () => {
      const ctx = await context({ requireEntity: false, requireForm: false });
      const base = `${ctx.clientUrl}/api/data/v9.2/EntityDefinitions(LogicalName='${escapeOData(requested)}')`;
      const definition = await fetchJson(
        `${base}?$select=LogicalName,SchemaName,EntitySetName,MetadataId,IsCustomEntity,DisplayName,DisplayCollectionName,Description,ObjectTypeCode,OwnershipType,PrimaryIdAttribute,PrimaryNameAttribute,IsAuditEnabled,ChangeTrackingEnabled,IsBPFEntity,IsBusinessProcessEnabled,IsActivity,IsManaged&$expand=Attributes,Keys,ManyToOneRelationships,OneToManyRelationships,ManyToManyRelationships`,
      );
      const types = choiceMetadataTypes;
      const choiceMap = new Map();
      const results = await Promise.all(
        types.map(async ([metadataType, choiceKind]) => {
          try {
            return {
              metadataType,
              choiceKind,
              data:
                (
                  await fetchJson(
                    `${base}/Attributes/Microsoft.Dynamics.CRM.${metadataType}?$select=LogicalName,SchemaName,MetadataId,AttributeType,DefaultValue&$expand=OptionSet,GlobalOptionSet`,
                  )
                ).value || [],
            };
          } catch {
            return { metadataType, choiceKind, data: [] };
          }
        }),
      );
      for (const result of results)
        for (const attribute of result.data)
          { const optionSet=optionSetFrom(attribute,result.metadataType),globalSet=globalOptionSetFrom(attribute,result.metadataType),isGlobalChoice=!!globalSet; choiceMap.set(attribute.LogicalName,{metadataType:result.metadataType,choiceKind:result.choiceKind,defaultValue:attribute.DefaultValue,options:optionsFrom(optionSet),isGlobalChoice,globalChoiceName:isGlobalChoice?String(globalSet.Name||""):"",globalChoiceMetadataId:isGlobalChoice?(clean(globalSet.MetadataId)||""):""}); }
      const columns = (definition.Attributes || []).map((attribute) => {
        const choice = choiceMap.get(attribute.LogicalName);
        const attributeType = String(attribute.AttributeType || "");
        const metadataType =
          choice?.metadataType ||
          attribute["@odata.type"]?.split(".").at(-1) ||
          attribute.AttributeType;
        return {
          logicalName: attribute.LogicalName,
          schemaName: attribute.SchemaName,
          displayName: localizedLabel(attribute.DisplayName),
          description: localizedLabel(attribute.Description),
          attributeType: attribute.AttributeType,
          metadataType,
          choiceKind:
            choice?.choiceKind ||
            (attributeType === "Boolean"
              ? "Boolean"
              : /Picklist|State|Status|MultiSelect/.test(attributeType)
                ? "OptionSet"
                : ""),
          isCustom: attribute.IsCustomAttribute,
          isManaged: attribute.IsManaged,
          requiredLevel: attribute.RequiredLevel?.Value,
          advancedFind: attribute.IsValidForAdvancedFind?.Value,
          audit: attribute.IsAuditEnabled?.Value,
          secured: attribute.IsSecured,
          validForCreate: attribute.IsValidForCreate,
          validForRead: attribute.IsValidForRead,
          validForUpdate: attribute.IsValidForUpdate,
          lookupValueColumn: /Lookup|Customer|Owner/.test(metadataType)
            ? `_${attribute.LogicalName}_value`
            : "",
          targets: attribute.Targets || [],
          format: attribute.Format,
          maxLength: attribute.MaxLength,
          minValue: attribute.MinValue,
          maxValue: attribute.MaxValue,
          precision: attribute.Precision,
          defaultValue: choice?.defaultValue ?? attribute.DefaultValue,
          options: choice?.options || optionsFrom(attribute.OptionSet),
          isGlobalChoice: choice?.isGlobalChoice === true, globalChoiceName: choice?.globalChoiceName || "", globalChoiceMetadataId: choice?.globalChoiceMetadataId || "",
        };
      });
      await runBatches(
        columns.filter(
          (column) =>
            column.choiceKind === "OptionSet" && !column.options?.length,
        ),
        8,
        async (column) => {
          try {
            const options = await stringMapChoices(
              ctx,
              definition.LogicalName || requested,
              column.logicalName,
            );
            if (options.length) column.options = options;
          } catch {}
        },
      );
      const relationships = [];
      for (const item of definition.OneToManyRelationships || [])
        relationships.push({ kind: "1:N", ...item });
      for (const item of definition.ManyToOneRelationships || [])
        relationships.push({ kind: "N:1", ...item });
      for (const item of definition.ManyToManyRelationships || [])
        relationships.push({ kind: "N:N", ...item });
      const result = {
        logicalName: definition.LogicalName,
        schemaName: definition.SchemaName,
        displayName: localizedLabel(definition.DisplayName),
        collectionName: localizedLabel(definition.DisplayCollectionName),
        description: localizedLabel(definition.Description),
        entitySetName: definition.EntitySetName,
        metadataId: definition.MetadataId,
        isCustom: definition.IsCustomEntity,
        objectTypeCode: definition.ObjectTypeCode,
        ownershipType: definition.OwnershipType,
        primaryIdAttribute: definition.PrimaryIdAttribute,
        primaryNameAttribute: definition.PrimaryNameAttribute,
        auditEnabled: definition.IsAuditEnabled?.Value,
        changeTracking: definition.ChangeTrackingEnabled,
        isBpf: definition.IsBPFEntity,
        businessProcessEnabled: definition.IsBusinessProcessEnabled,
        isActivity: definition.IsActivity,
        isManaged: definition.IsManaged,
        columns,
        keys: definition.Keys || [],
        relationships,
        choices: columns.filter((column) => column.choiceKind === "OptionSet" || column.choiceKind === "Boolean" || /Picklist|MultiSelect|State|Status|Boolean/i.test(String(column.attributeType || column.metadataType || ""))),
      };
      applyDependencyEvidence(result);
      metadataCache.entities.set(key, clone(result));
      return result;
    })();
    metadataCache.entityPromises.set(key, request);
    try {
      const data=clone(await request);if(trackVisit)void recordTableVisit(key);return { ok: true, data, cached: false };
    } finally {
      metadataCache.entityPromises.delete(key);
    }
  }

  function clearMetadataCache() { if(metadataCache.metadataIndexToken)metadataCache.metadataIndexToken.cancelled=true;metadataCache.tables=null;metadataCache.tablesPromise=null;metadataCache.globalChoices=null;metadataCache.globalChoicesPromise=null;metadataCache.globalChoiceUsage={usageByName:{},warnings:[],partial:false};metadataCache.attributeCatalog=null;metadataCache.metadataIndexPromise=null;metadataCache.metadataIndexToken=null;metadataCache.metadataIndexStatus={state:"idle",phase:"idle",completed:0,total:0,warnings:0,message:"",mode:"automatic"};metadataCache.entities.clear();metadataCache.entityPromises.clear();metadataCache.stringMaps.clear();metadataCache.stringMapPromises.clear();return{ok:true}; }

  async function dirtyFieldState(){if(sidePane())return{ok:true,entityName:requestedSurface.entityName,rows:internalFields(),surface:{...requestedSurface,internal:undefined}};
    const ctx=await context({requireEntity:true,requireForm:false}),rows=[];
    ctx.formContext.data.entity.attributes.forEach(attribute=>rows.push({logicalName:attribute.getName(),dirty:!!attribute.getIsDirty?.(),value:attribute.getValue?.(),text:attribute.getText?.(),formattedValue:attribute.getText?.()}));
    return{ok:true,entityName:ctx.entityName,rows};
  }
  async function shellContext() { const ctx=await context({requireEntity:false,requireForm:false}); return {ok:true,clientUrl:ctx.clientUrl,environmentId:ctx.environmentId,currentUser:{id:ctx.userId,name:ctx.userName}}; }
  async function schemaTable(logicalName) {
    const requested = String(logicalName || "").trim().toLowerCase();
    if (!/^[a-z_][a-z0-9_]*$/.test(requested))
      return { ok: false, error: "Enter a valid Dataverse table logical name." };
    const ctx = await context({ requireEntity: false, requireForm: false });
    const base = `${ctx.clientUrl}/api/data/v9.2/EntityDefinitions(LogicalName='${escapeOData(requested)}')`;
    const definition = await fetchJson(
      `${base}?$select=LogicalName,SchemaName,EntitySetName,MetadataId,DisplayName,PrimaryIdAttribute,PrimaryNameAttribute,IsCustomEntity&$expand=Attributes($select=LogicalName,SchemaName,DisplayName,AttributeType,IsCustomAttribute,IsValidForRead,IsValidForAdvancedFind,RequiredLevel)`,
    );
    const columns = (definition.Attributes || []).map((attribute) => ({
      logicalName: attribute.LogicalName || "",
      schemaName: attribute.SchemaName || "",
      displayName: localizedLabel(attribute.DisplayName) || attribute.LogicalName || "",
      attributeType: attribute.AttributeType || "Unknown",
      isCustom: attribute.IsCustomAttribute === true,
      validForRead: attribute.IsValidForRead?.Value ?? attribute.IsValidForRead ?? true,
      validForAdvancedFind: attribute.IsValidForAdvancedFind?.Value ?? attribute.IsValidForAdvancedFind ?? true,
      requiredLevel: attribute.RequiredLevel?.Value || "None",
      maxLength: null,
      precision: null,
      format: "",
      isPrimaryId: attribute.LogicalName === definition.PrimaryIdAttribute,
      isPrimaryName: attribute.LogicalName === definition.PrimaryNameAttribute
    })).sort((a, b) => a.logicalName.localeCompare(b.logicalName));
    return {
      ok: true,
      data: {
        logicalName: definition.LogicalName,
        schemaName: definition.SchemaName,
        displayName: localizedLabel(definition.DisplayName) || definition.LogicalName,
        entitySetName: definition.EntitySetName,
        metadataId: definition.MetadataId,
        isCustom: definition.IsCustomEntity === true,
        primaryIdAttribute: definition.PrimaryIdAttribute || "",
        primaryNameAttribute: definition.PrimaryNameAttribute || "",
        columns
      }
    };
  }
  function simpleSqlProjection(query) {
    // Only validate straightforward, unaliased single-table projections. More complex
    // queries are left to Dataverse's SQL parser rather than guessed at locally.
    const match = query.replace(/;\s*$/, "").match(/^\s*SELECT\s+(?:DISTINCT\s+)?(?:TOP\s+\d+\s+)?([\s\S]+?)\s+FROM\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?=WHERE\b|ORDER\s+BY\b|GROUP\s+BY\b|$)/i);
    if (!match) return null;
    const list = match[1].trim();
    if (!list || /\bAS\b/i.test(list) || /[()]/.test(list)) return null;
    if (list === "*") return ["*"];
    const columns = list.split(",").map(part => part.trim()).filter(Boolean);
    if (!columns.length || columns.some(part => !/^(?:[A-Za-z_][A-Za-z0-9_]*\.)?[A-Za-z_][A-Za-z0-9_]*$/.test(part))) return null;
    return columns.map(part => part.split(".").pop().toLowerCase());
  }

  function columnsFromODataContext(odataContext) {
    if (typeof odataContext !== "string") return null;
    const marker = odataContext.match(/#([A-Za-z_][A-Za-z0-9_]*)\(/);
    if (!marker || marker.index == null) return null;
    const openIndex = marker.index + marker[0].length - 1;
    let depth = 0;
    let closeIndex = -1;
    for (let i = openIndex; i < odataContext.length; i++) {
      if (odataContext[i] === "(") depth++;
      else if (odataContext[i] === ")") {
        depth--;
        if (depth === 0) {
          closeIndex = i;
          break;
        }
        if (depth < 0) return null;
      }
    }
    if (closeIndex < 0) return null;

    const parts = [];
    let start = openIndex + 1;
    depth = 0;
    for (let i = start; i < closeIndex; i++) {
      if (odataContext[i] === "(") depth++;
      else if (odataContext[i] === ")") depth--;
      else if (odataContext[i] === "," && depth === 0) {
        parts.push(odataContext.slice(start, i).trim());
        start = i + 1;
      }
    }
    parts.push(odataContext.slice(start, closeIndex).trim());

    // Navigation expansions can appear both as a bare name and as name().
    // Exclude the bare duplicate when the same name has a nested expansion.
    const expansions = new Set(parts.filter(part => /^[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(part))
      .map(part => part.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*\(/)[1].toLowerCase()));
    const columns = parts
      .filter(part => /^[A-Za-z_][A-Za-z0-9_]*$/.test(part))
      .filter(part => !expansions.has(part.toLowerCase()));
    return columns.length ? [...new Set(columns)] : null;
  }

  async function queryFetchXmlReadOnly(fetchXml, tableName, offsetValue = 0, limitValue = null) {
    if (typeof fetchXml !== "string" || !fetchXml.trim()) return { ok: false, error: "A compiled FetchXML query is required." };
    if (fetchXml.length > 1000000) return { ok: false, error: "Compiled query exceeds the 1,000,000 character limit." };
    const table = String(tableName || "").trim().toLowerCase();
    if (!/^[a-z_][a-z0-9_]*$/.test(table)) return { ok: false, error: "Invalid Dataverse table logical name." };
    if (!/^\s*<fetch(?:\s|>)/i.test(fetchXml)) {
      return { ok: false, error: "Only FetchXML queries are accepted." };
    }
    const entityMatch = fetchXml.match(/<entity\s+[^>]*name\s*=\s*["']([a-z_][a-z0-9_]*)["']/i);
    if (!entityMatch || entityMatch[1].toLowerCase() !== table) return { ok: false, error: "FetchXML base entity does not match the requested table." };
    if (/<(?:update|delete|create|upsert|insert)\b/i.test(fetchXml)) return { ok: false, error: "Only read-only FetchXML is accepted." };

    const hasTop = /<fetch\b[^>]*\btop\s*=\s*["']/i.test(fetchXml);
    const offset = Number(offsetValue || 0);
    const limit = limitValue == null ? null : Number(limitValue);
    if (!Number.isInteger(offset) || offset < 0 || offset >= 10000) return { ok: false, error: "OFFSET must be an integer from 0 to 9999." };
    if (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > 5000 || offset + limit > 10000)) return { ok: false, error: "FETCH NEXT must be an integer from 1 to 5000 and fit within the 10,000-row safety cap." };
    if (hasTop && (offset > 0 || limit !== null)) return { ok: false, error: "TOP cannot be combined with OFFSET/FETCH." };
    const pageSize = limit !== null ? Math.min(500, Math.max(1, offset + limit)) : 500;
    const maxPages = Math.ceil(10000 / pageSize);
    const escapeXmlAttribute = value => String(value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
    const setFetchAttribute = (xml, name, value) => {
      const match = xml.match(/<fetch\b([^>]*)>/i);
      if (!match) throw Error("Compiled FetchXML has no fetch root.");
      const attribute = new RegExp("\\s" + name + "\\s*=\\s*(['\"])[\\s\\S]*?\\1", "i");
      const attributes = match[1].replace(attribute, "").trim();
      return xml.slice(0, match.index) + "<fetch" + (attributes ? " " + attributes : "") + " " + name + "=\"" + escapeXmlAttribute(value) + "\">" + xml.slice(match.index + match[0].length);
    };
    const decodePagingCookie = cookieXml => {
      if (typeof cookieXml !== "string") return null;
      const match = cookieXml.match(/\bpagingcookie\s*=\s*["']([^"']+)["']/i);
      if (!match) return null;
      let decoded = match[1];
      try { decoded = decodeURIComponent(decodeURIComponent(decoded)); } catch { return null; }
      return decoded.startsWith("<") ? decoded : null;
    };

    const entities = [];
    let page = 1, pagingCookie = null, moreRecords = false, pagesFetched = 0;
    while (true) {
      let pageXml = fetchXml;
      if (!hasTop) {
        pageXml = setFetchAttribute(pageXml, "count", pageSize);
        pageXml = setFetchAttribute(pageXml, "page", page);
        if (pagingCookie) pageXml = setFetchAttribute(pageXml, "paging-cookie", pagingCookie);
      }
      const result = await Xrm.WebApi.retrieveMultipleRecords(table, "?fetchXml=" + pageXml, 5000);
      const pageEntities = Array.isArray(result?.entities) ? result.entities : [];
      entities.push(...pageEntities);
      pagesFetched++;
      if (hasTop) { moreRecords = !!result?.nextLink; break; }
      const nextCookie = decodePagingCookie(result?.fetchXmlPagingCookie);
      if (limit !== null && entities.length >= offset + limit) {
        moreRecords = entities.length > offset + limit || !!nextCookie || pageEntities.length === pageSize;
        break;
      }
      if (entities.length >= pageSize * maxPages) { moreRecords = true; break; }
      if (nextCookie) {
        pagingCookie = nextCookie;
        page++;
        continue;
      }
      if (pageEntities.length < pageSize) { moreRecords = false; break; }
      // Without a cookie, fall back to simple paging, still bounded by the 10,000-row engine cap.
      pagingCookie = null;
      page++;
    }
    const visibleEntities = entities.slice(offset, limit === null ? undefined : offset + limit);
    const columns = [...new Set(visibleEntities.flatMap(row => Object.keys(row).filter(key => !key.startsWith("@") && !key.includes("@"))))];
    const rows = visibleEntities.map(row => {
      const cleanRow = {};
      for (const [key, value] of Object.entries(row)) {
        if (key.startsWith("@") || key.includes("@")) continue;
        cleanRow[key] = value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "value") ? value.value : value;
      }
      return cleanRow;
    });
    return { ok: true, provider: "dataverse-fetchxml-js-engine", table, columns, rows, rowCount: rows.length, rowsFetched: entities.length, pagesFetched, moreRecords: hasTop || limit !== null ? false : moreRecords };
  }

  async function querySqlReadOnly(sql) {
    if (typeof sql !== "string" || !sql.trim()) return { ok: false, error: "Enter a SELECT query." };
    if (sql.length > 100000) return { ok: false, error: "Query exceeds the 100,000 character limit." };
    const query = sql.trim();
    if (!/^SELECT\b/i.test(query)) return { ok: false, error: "Read-only mode accepts SELECT statements only." };
    if (/;\s*\S/.test(query.replace(/;\s*$/, ""))) return { ok: false, error: "Run one SELECT statement at a time." };
    // The Dataverse SQL endpoint requires the entity set matching the query's base table.
    const match = query.match(/\bFROM\s+((?:[A-Za-z_][A-Za-z0-9_]*\.)?[A-Za-z_][A-Za-z0-9_]*)/i);
    if (!match) return { ok: false, error: "Could not identify the base table after FROM." };
    const tableName = match[1].split(".").pop().replace(/^[\[\"]|[\]\"]$/g, "");
    const expectedProjection = simpleSqlProjection(query);
    const ctx = await context({ requireEntity: false, requireForm: false });
    const metadata = await Xrm.Utility.getEntityMetadata(tableName);
    if (!metadata?.EntitySetName) return { ok: false, error: "Dataverse did not return an entity set for " + tableName + "." };
    const endpoint = new URL("/api/data/v9.2/" + metadata.EntitySetName, ctx.clientUrl);
    endpoint.searchParams.set("sql", query);
    const result = await fetchJson(endpoint.toString(), {
      method: "GET",
      headers: { Prefer: 'odata.include-annotations="*"' },
      cache: "no-store"
    });
    const maxRows = 10000;
    const maxPages = 100;
    const rawRows = [];
    let truncated = false;
    let nextLink = result["@odata.nextLink"] || null;
    const appendPageRows = pageRows => {
      const rows = Array.isArray(pageRows) ? pageRows : [];
      const remaining = maxRows - rawRows.length;
      rawRows.push(...rows.slice(0, Math.max(0, remaining)));
      if (rows.length > remaining) truncated = true;
    };
    appendPageRows(result.value);
    const seenPageLinks = new Set();
    let pagesFetched = 1;
    while (nextLink && rawRows.length < maxRows && pagesFetched < maxPages) {
      if (seenPageLinks.has(nextLink)) throw Error("Dataverse returned a repeated paging link; query execution stopped safely.");
      seenPageLinks.add(nextLink);
      const pageUrl = new URL(nextLink, ctx.clientUrl);
      const clientOrigin = new URL(ctx.clientUrl).origin;
      if (pageUrl.origin !== clientOrigin || !pageUrl.pathname.startsWith("/api/data/v9.2/")) {
        throw Error("Dataverse returned an invalid paging URL; query execution stopped safely.");
      }
      const page = await fetchJson(pageUrl.toString(), {
        method: "GET",
        headers: { Prefer: 'odata.include-annotations="*"' },
        cache: "no-store"
      });
      appendPageRows(page.value);
      nextLink = page["@odata.nextLink"] || null;
      pagesFetched++;
    }
    if (nextLink) truncated = true;
    const contextColumns = columnsFromODataContext(result["@odata.context"]);
    if (expectedProjection) {
      if (!contextColumns) {
        return {
          ok: false,
          error: "Dataverse did not return a verifiable SQL result projection. Query Studio has stopped this result rather than displaying potentially unrelated columns. Check whether the SQL query option is supported by this environment."
        };
      }
      // SELECT * is verified by the response context itself; it defines the retrievable result columns.
      if (!(expectedProjection.length === 1 && expectedProjection[0] === "*")) {
      const actual = new Set(contextColumns.map(column => column.toLowerCase()));
      const expected = new Set(expectedProjection);
      const primaryId = String(metadata.PrimaryIdAttribute || "").toLowerCase();
      const rowKeys = new Set(rawRows.flatMap(row => Object.keys(row).map(key => key.toLowerCase())));
      // Dataverse represents a logical lookup column (e.g. parentcustomerid) as
      // _<logicalname>_value. Require the context's navigation expansion and the
      // actual row backing field before treating it as a verified lookup mapping.
      const lookupMappings = expectedProjection
        .filter(column => !actual.has(column))
        .map(column => ({ column, backing: "_" + column + "_value" }))
        .filter(mapping =>
          actual.has(mapping.backing) &&
          rowKeys.has(mapping.backing) &&
          (result["@odata.context"] || "").toLowerCase().includes(mapping.column.toLowerCase() + "_")
        );
      const lookupBackingFields = new Set(lookupMappings.map(mapping => mapping.backing));
      const lookupColumns = new Set(lookupMappings.map(mapping => mapping.column));
      const missing = expectedProjection.filter(column => !actual.has(column) && !lookupColumns.has(column));
      // Some Dataverse SQL endpoint responses include extra context columns (for example,
      // ownerid) even when every requested column is present. Missing requested columns
      // remain a hard failure; extra columns are safely removed from the final projection below.
      if (missing.length) {
        return {
          ok: false,
          error: "Dataverse returned result metadata that does not match the SELECT projection. Requested: " +
            expectedProjection.join(", ") + ". Returned metadata: " + contextColumns.join(", ") +
            ". Missing from response metadata: " + missing.join(", ") +
            ". Query Studio stopped because a requested column could not be verified."
        };
      }
      }
    }
    const rows = rawRows.map(row => {
      const normalized = {};
      for (const [key, value] of Object.entries(row)) {
        // OData annotations can use namespaces beyond @OData (e.g. @Microsoft.Dynamics.CRM).
        // Exclude any annotated property while preserving ordinary data fields.
        if (key.startsWith("@") || key.includes("@")) continue;
        // Dataverse encodes dotted SQL table aliases in row keys, e.g. a_x002e_name.
        const displayKey = key.replace(/_x002e_/gi, ".");
        normalized[displayKey] = value;
      }
      return normalized;
    });
    // Present lookup values under the logical SQL column requested by the user.
    // Keep the backing Web API field when it was explicitly selected as well.
    const projectedLookupBackings = new Set();
    if (expectedProjection) {
      for (const column of expectedProjection) {
        const backing = "_" + column + "_value";
        const hasContextBacking = contextColumns?.some(name => name.toLowerCase() === backing);
        const hasRowBacking = rows.some(row => Object.prototype.hasOwnProperty.call(row, backing));
        const hasNavigationExpansion = (result["@odata.context"] || "").toLowerCase().includes(column.toLowerCase() + "_");
        if (hasContextBacking && hasRowBacking && hasNavigationExpansion && !expectedProjection.includes(backing)) {
          projectedLookupBackings.add(backing);
          for (const row of rows) {
            row[column] = row[backing] ?? null;
            delete row[backing];
          }
        }
      }
    }
    const rowColumns = [...new Set(rows.flatMap(row => Object.keys(row)))];
    // For a simple verified projection, expose only columns explicitly requested in SQL.
    // This safely handles endpoint-generated extras without weakening missing-column checks.
    const isSimpleProjection = expectedProjection && !(expectedProjection.length === 1 && expectedProjection[0] === "*");
    const outputRows = isSimpleProjection ? rows.map(row => {
      const projected = {};
      for (const column of expectedProjection) {
        const actualKey = Object.keys(row).find(key => key.toLowerCase() === column.toLowerCase());
        if (actualKey !== undefined) projected[column] = row[actualKey];
      }
      return projected;
    }) : rows;
    const columns = isSimpleProjection
      ? expectedProjection
      : [...new Set([...(contextColumns || []).filter(column => !projectedLookupBackings.has(column.toLowerCase())), ...rowColumns])];
    const totalRecordCount = result["@Microsoft.Dynamics.CRM.totalrecordcount"] ?? null;
    const totalRecordCountLimitExceeded = result["@Microsoft.Dynamics.CRM.totalrecordcountlimitexceeded"] ?? false;
    const resultTruncated = truncated || totalRecordCountLimitExceeded === true;
    return {
      ok: true,
      clientUrl: ctx.clientUrl,
      environmentId: ctx.environmentId,
      currentUser: { id: ctx.userId, name: ctx.userName },
      columns,
      rows: outputRows,
      responseContext: result["@odata.context"] || null,
      totalRecordCount,
      totalRecordCountLimitExceeded,
      truncated: resultTruncated,
      warning: resultTruncated ? "Results may be incomplete because a Dataverse count limit or the 10,000-row/100-page safety limit was reached. Refine the query to retrieve a smaller result set." : ""
    };
  }
  function formLocation(attribute) {
    const output = [];
    attribute.controls?.forEach?.((control) => {
      const section = control.getParent?.();
      const tab = section?.getParent?.();
      output.push({
        control: control.getName?.(),
        label: control.getLabel?.(),
        tab: tab?.getName?.(),
        tabLabel: tab?.getLabel?.(),
        section: section?.getName?.(),
        sectionLabel: section?.getLabel?.(),
        visible: control.getVisible?.(),
        disabled: control.getDisabled?.(),
      });
    });
    return output;
  }
  function openUrl(url, message = "Opened.") {
    Xrm.Navigation.openUrl(url);
    return { ok: true, message };
  }
  function runtimeFieldValue(attribute) {
    const value=attribute.getValue?.(), type=attribute.getAttributeType?.()||"unknown", text=attribute.getText?.();
    const empty=value==null||value===""||(Array.isArray(value)&&!value.length); let displayValue="",rawValue="";
    if(!empty){ if(type==="lookup"&&Array.isArray(value)){displayValue=value.map(x=>x?.name||x?.id||"").filter(Boolean).join(", ");rawValue=value.map(x=>`${x?.entityType||"lookup"}:${clean(x?.id)||""}`).join(", ");} else if(value instanceof Date){displayValue=value.toLocaleString();rawValue=value.toISOString();} else if(Array.isArray(value)){displayValue=Array.isArray(text)?text.join(", "):text||value.join(", ");rawValue=value.join(", ");} else {displayValue=text==null||text===""?String(value):String(text);rawValue=typeof value==="object"?JSON.stringify(value):String(value);} }
    return {displayValue,rawValue,empty};
  }
  async function allFieldsReport() {if(sidePane()){const ctx=await surfaceContext({requireEntity:true,requireForm:false});let fields=internalFields();try{const meta=await metadataEntity(ctx.entityName);const map=new Map(fields.map(x=>[x.logicalName,x]));for(const col of meta.data?.columns||[]){const x=map.get(col.logicalName);if(x){x.displayName=col.displayName||x.displayName;x.schemaName=col.schemaName||"";x.attributeType=col.attributeType||x.attributeType;x.metadata=col;x.metadataAvailable=true}else fields.push({displayName:col.displayName||col.logicalName,logicalName:col.logicalName,schemaName:col.schemaName||"",attributeType:col.attributeType||col.metadataType||"unknown",displayValue:"",rawValue:"",empty:true,visible:false,hidden:true,disabled:false,readOnly:!col.validForUpdate,dirty:false,requiredLevel:col.requiredLevel||"none",submitMode:"n/a",onForm:false,runtimeAvailable:false,metadataAvailable:true,metadataOnly:true,controlCount:0,multiControl:false,locations:[],metadata:col})}}catch{}fields.sort((a,b)=>(a.displayName||a.logicalName).localeCompare(b.displayName||b.logicalName));return{ok:true,entityName:ctx.entityName,formName:"Selected side-pane record",formId:ctx.formId,recordId:ctx.recordId,fields,generatedOn:new Date().toISOString(),fieldModel:"uci-redux-metadata-merged",surface:{...requestedSurface,internal:undefined}}}
    const ctx=await context(), fields=[];
    Xrm.Page.data.entity.attributes.forEach(attribute=>{ const logicalName=attribute.getName?.()||"",controls=[];attribute.controls?.forEach?.(c=>controls.push(c));const primaryControl=controls[0]||Xrm.Page.getControl?.(logicalName)||null;
      const locations=controls.map(control=>{const section=control.getParent?.(),tab=section?.getParent?.();return {controlName:control.getName?.()||"",controlLabel:control.getLabel?.()||"",visible:control.getVisible?.()!==false,disabled:control.getDisabled?.()===true,sectionName:section?.getName?.()||"",sectionLabel:section?.getLabel?.()||section?.getName?.()||"",tabName:tab?.getName?.()||"",tabLabel:tab?.getLabel?.()||tab?.getName?.()||""};});
      const onForm=locations.length>0,visible=onForm&&locations.some(x=>x.visible),disabled=onForm&&locations.every(x=>x.disabled),v=runtimeFieldValue(attribute),loc=locations[0]||{};
      fields.push({displayName:primaryControl?.getLabel?.()||logicalName,logicalName,attributeType:attribute.getAttributeType?.()||"unknown",displayValue:v.displayValue,rawValue:v.rawValue,empty:v.empty,visible,hidden:!visible,disabled,readOnly:disabled,dirty:attribute.getIsDirty?.()===true,requiredLevel:attribute.getRequiredLevel?.()||"none",submitMode:attribute.getSubmitMode?.()||"dirty",onForm,controlCount:locations.length,multiControl:locations.length>1,controlName:loc.controlName||"",tabName:loc.tabName||"",tabLabel:loc.tabLabel||"",sectionName:loc.sectionName||"",sectionLabel:loc.sectionLabel||"",locations}); });
    try {
      const meta = await metadataEntity(ctx.entityName);
      const columns = meta.data?.columns || [];
      const runtimeMap = new Map(fields.map((field) => [field.logicalName, field]));
      for (const column of columns) {
        const runtime = runtimeMap.get(column.logicalName);
        if (runtime) {
          runtime.schemaName = column.schemaName || "";
          runtime.runtimeAvailable = true;
          runtime.metadataAvailable = true;
          runtime.metadataOnly = false;
          runtime.metadata = column;
        } else {
          fields.push({ displayName: column.displayName || column.logicalName, logicalName: column.logicalName, schemaName: column.schemaName || "", attributeType: column.attributeType || column.metadataType || "unknown", displayValue: "", rawValue: "", empty: true, visible: false, hidden: false, disabled: false, readOnly: !column.validForUpdate, dirty: false, requiredLevel: column.requiredLevel || "none", submitMode: "n/a", onForm: false, runtimeAvailable: false, metadataAvailable: true, metadataOnly: true, controlCount: 0, multiControl: false, controlName: "", tabName: "", tabLabel: "", sectionName: "", sectionLabel: "", locations: [], metadata: column });
        }
      }
      for (const field of fields) {
        if (field.runtimeAvailable !== false) field.runtimeAvailable = true;
        if (field.metadataAvailable !== true) { field.metadataAvailable = false; field.metadataOnly = false; field.schemaName ||= ""; }
      }
    } catch {
      for (const field of fields) { field.schemaName = ""; field.runtimeAvailable = true; field.metadataAvailable = false; field.metadataOnly = false; }
    }
    fields.sort((a,b)=>(a.displayName||a.logicalName).localeCompare(b.displayName||b.logicalName));return {ok:true,entityName:ctx.entityName,formName:ctx.formItem?.getLabel?.()||"",formId:ctx.formId,recordId:ctx.recordId,fields,generatedOn:new Date().toISOString(),fieldModel:"metadata-runtime-merged"};
  }

  async function allFields(ctx) {
    if (!ctx.recordId)
      return { ok: false, error: "Save the record before loading all fields." };
    const data = await fetchJson(
      `${ctx.clientUrl}/api/data/v9.2/${ctx.entitySetName}(${ctx.recordId})`,
      { headers: { Prefer: 'odata.include-annotations="*"' } },
    );
    const rows = Object.keys(data)
      .filter((key) => !key.startsWith("@odata."))
      .map((key) => {
        const formatted =
          data[`${key}@OData.Community.Display.V1.FormattedValue`];
        const raw = data[key];
        return {
          field: key,
          value:
            raw == null
              ? "[NULL]"
              : typeof raw === "object"
                ? JSON.stringify(raw)
                : String(raw),
          formatted: formatted || "",
          type: Array.isArray(raw)
            ? "array"
            : raw === null
              ? "null"
              : typeof raw,
        };
      })
      .sort((left, right) => left.field.localeCompare(right.field));
    return {
      ok: true,
      data: rows,
      entityName: ctx.entityName,
      recordId: ctx.recordId,
    };
  }

  async function tableProcesses(ctx) {
    const logicalName = escapeOData(ctx.entityName);
    const workflows = await fetchJson(
      `${ctx.clientUrl}/api/data/v9.2/workflows?$select=workflowid,name,description,category,type,mode,scope,statecode,statuscode,createdon,modifiedon&$filter=primaryentity eq '${logicalName}' and statecode eq 1&$orderby=name asc`,
    );
    let customApis = { value: [] };
    try {
      customApis = await fetchJson(
        `${ctx.clientUrl}/api/data/v9.2/customapis?$select=customapiid,uniquename,displayname,description,bindingtype,boundentitylogicalname,isfunction,isprivate,createdon,modifiedon&$filter=bindingtype eq 1 and boundentitylogicalname eq '${logicalName}'&$orderby=uniquename asc`,
      );
    } catch (error) {
      customApis = { value: [], warning: error.message };
    }
    const processGroups = [
      [
        "Realtime Workflows",
        (item) => item.category === 0 && item.type === 1 && item.mode === 1,
      ],
      [
        "Background Workflows",
        (item) => item.category === 0 && item.type === 1 && item.mode === 0,
      ],
      ["Flows", (item) => item.category === 5 && item.type === 1],
      ["Business Rules", (item) => item.category === 2],
      ["Business Process Flows", (item) => item.category === 4],
      ["Custom Actions", (item) => item.category === 3],
    ].map(([title, predicate]) => ({
      title,
      items: (workflows.value || []).filter(predicate).map((item) => ({
        id: item.workflowid,
        name: item.name || "(unnamed)",
        description: item.description || "",
        category: item.category,
        mode: item.mode,
        statecode: item.statecode,
        statuscode: item.statuscode,
        modifiedon: item.modifiedon,
        openUrl:
          item.category === 2
            ? `${ctx.clientUrl}/tools/systemcustomization/businessrules/businessRulesDesigner.aspx?BRlaunchpoint=BRGrid&id=%7B${item.workflowid}%7D`
            : `${ctx.clientUrl}/sfa/workflow/edit.aspx?id=%7b${item.workflowid}%7d`,
      })),
    }));
    processGroups.push({
      title: "Custom APIs",
      items: (customApis.value || []).map((item) => ({
        id: item.customapiid,
        name: item.displayname || item.uniquename || "(unnamed)",
        uniqueName: item.uniquename || "",
        description: item.description || "",
        bindingType: item.bindingtype,
        isFunction: item.isfunction,
        isPrivate: item.isprivate,
        modifiedon: item.modifiedon,
        openUrl: `${ctx.clientUrl}/api/data/v9.2/customapis(${item.customapiid})`,
      })),
    });
    return {
      ok: true,
      entityName: ctx.entityName,
      groups: processGroups,
      warning: customApis.warning || "",
    };
  }

  async function processExplorer(ctx, force = false) {
    const cache = (window.__DEVLENS_PROCESS_CACHE ??= new Map());
    const key = `${ctx.clientUrl}|${ctx.entityName}`.toLowerCase();
    if (!force && cache.has(key)) return clone(cache.get(key));
    const logicalName = escapeOData(ctx.entityName);
    const result = { ok: true, entityName: ctx.entityName, generatedOn: new Date().toISOString(), categories: [] };
    const category = async (id, title, loader) => {
      try {
        const items = await loader();
        return { id, title, ok: true, count: items.length, items, error: "" };
      } catch (error) {
        return { id, title, ok: false, count: 0, items: [], error: error.message || String(error) };
      }
    };
    let workflowPromise;
    const workflows = () => (workflowPromise ??= fetchJson(`${ctx.clientUrl}/api/data/v9.2/workflows?$select=workflowid,name,description,category,type,mode,scope,statecode,statuscode,createdon,modifiedon,primaryentity&$filter=primaryentity eq '${logicalName}'&$orderby=name asc`));
    const workflowItems = async (predicate, kind) => (await workflows()).value.filter(predicate).map((item) => ({
      id: item.workflowid, kind, name: item.name || "(unnamed)", description: item.description || "", category: item.category,
      mode: item.mode, scope: item.scope, statecode: item.statecode, statuscode: item.statuscode, createdon: item.createdon,
      modifiedon: item.modifiedon, primaryTable: item.primaryentity || ctx.entityName,
      openUrl: item.category === 2 ? `${ctx.clientUrl}/tools/systemcustomization/businessrules/businessRulesDesigner.aspx?BRlaunchpoint=BRGrid&id=%7B${item.workflowid}%7D` : `${ctx.clientUrl}/sfa/workflow/edit.aspx?id=%7b${item.workflowid}%7d`,
    }));
    const pluginSteps = async () => {
      const filters = await fetchJson(`${ctx.clientUrl}/api/data/v9.2/sdkmessagefilters?$select=sdkmessagefilterid,primaryobjecttypecode,secondaryobjecttypecode&$filter=primaryobjecttypecode eq '${logicalName}'`);
      const filterRows = filters.value || [];
      if (!filterRows.length) return [];
      const filterMap = new Map(filterRows.map((x) => [String(x.sdkmessagefilterid).toLowerCase(), x]));
      const filterClause = filterRows.map((x) => `_sdkmessagefilterid_value eq ${x.sdkmessagefilterid}`).join(" or ");
      const steps = await fetchJson(`${ctx.clientUrl}/api/data/v9.2/sdkmessageprocessingsteps?$select=sdkmessageprocessingstepid,name,description,stage,mode,rank,supporteddeployment,filteringattributes,statecode,statuscode,configuration,_sdkmessageid_value,_sdkmessagefilterid_value,_eventhandler_value,_plugintypeid_value,_sdkmessageprocessingstepsecureconfigid_value&$filter=${encodeURIComponent(filterClause)}&$orderby=rank asc`);
      const rows = steps.value || [], typeIds = [...new Set(rows.map((x) => x._plugintypeid_value || x._eventhandler_value).filter(Boolean))];
      const typeMap = new Map(), assemblyMap = new Map(), messageMap = new Map(), imageMap = new Map();
      if (typeIds.length) {
        const typeClause = typeIds.map((id) => `plugintypeid eq ${id}`).join(" or ");
        const types = await fetchJson(`${ctx.clientUrl}/api/data/v9.2/plugintypes?$select=plugintypeid,name,typename,_pluginassemblyid_value&$filter=${encodeURIComponent(typeClause)}`);
        for (const type of types.value || []) typeMap.set(String(type.plugintypeid).toLowerCase(), type);
        const assemblyIds = [...new Set((types.value || []).map((x) => x._pluginassemblyid_value).filter(Boolean))];
        if (assemblyIds.length) {
          const clause = assemblyIds.map((id) => `pluginassemblyid eq ${id}`).join(" or ");
          const assemblies = await fetchJson(`${ctx.clientUrl}/api/data/v9.2/pluginassemblies?$select=pluginassemblyid,name,version,isolationmode&$filter=${encodeURIComponent(clause)}`);
          for (const assembly of assemblies.value || []) assemblyMap.set(String(assembly.pluginassemblyid).toLowerCase(), assembly);
        }
      }
      const messageIds = [...new Set(rows.map((x) => x._sdkmessageid_value).filter(Boolean))];
      if (messageIds.length) {
        const clause = messageIds.map((id) => `sdkmessageid eq ${id}`).join(" or ");
        const messages = await fetchJson(`${ctx.clientUrl}/api/data/v9.2/sdkmessages?$select=sdkmessageid,name&$filter=${encodeURIComponent(clause)}`);
        for (const message of messages.value || []) messageMap.set(String(message.sdkmessageid).toLowerCase(), message);
      }
      const stepIds = rows.map((x) => x.sdkmessageprocessingstepid);
      if (stepIds.length) {
        const clause = stepIds.map((id) => `_sdkmessageprocessingstepid_value eq ${id}`).join(" or ");
        try {
          const images = await fetchJson(`${ctx.clientUrl}/api/data/v9.2/sdkmessageprocessingstepimages?$select=sdkmessageprocessingstepimageid,name,imagetype,attributes,_sdkmessageprocessingstepid_value&$filter=${encodeURIComponent(clause)}`);
          for (const image of images.value || []) { const id = String(image._sdkmessageprocessingstepid_value).toLowerCase(); if (!imageMap.has(id)) imageMap.set(id, []); imageMap.get(id).push({ name: image.name || "(unnamed image)", imageType: image.imagetype, attributes: image.attributes || "" }); }
        } catch {}
      }
      const stages = { 10: "Pre-validation", 20: "Pre-operation", 30: "Main operation", 40: "Post-operation", 50: "Post-operation (deprecated)" }, modes = { 0: "Synchronous", 1: "Asynchronous" }, deployments = { 0: "Server only", 1: "Offline only", 2: "Server and offline" };
      return rows.map((step) => {
        const type = typeMap.get(String(step._plugintypeid_value || step._eventhandler_value || "").toLowerCase()) || {};
        const assembly = assemblyMap.get(String(type._pluginassemblyid_value || "").toLowerCase()) || {};
        const filter = filterMap.get(String(step._sdkmessagefilterid_value || "").toLowerCase()) || {};
        const images = imageMap.get(String(step.sdkmessageprocessingstepid).toLowerCase()) || [];
        return { id: step.sdkmessageprocessingstepid, kind: "pluginStep", name: step.name || "(unnamed step)", description: step.description || "", pluginAssembly: assembly.name || "", pluginAssemblyVersion: assembly.version || "", pluginType: type.typename || type.name || "", sdkMessage: messageMap.get(String(step._sdkmessageid_value || "").toLowerCase())?.name || "", primaryTable: filter.primaryobjecttypecode || ctx.entityName, secondaryTable: filter.secondaryobjecttypecode || "", pipelineStage: stages[step.stage] || step.stage, executionMode: modes[step.mode] || step.mode, rank: step.rank, deploymentType: deployments[step.supporteddeployment] || step.supporteddeployment, filteringAttributes: step.filteringattributes || "", statecode: step.statecode, statuscode: step.statuscode, preImages: images.filter((x) => x.imageType === 0 || x.imageType === 2), postImages: images.filter((x) => x.imageType === 1 || x.imageType === 2), hasSecureConfiguration: !!step._sdkmessageprocessingstepsecureconfigid_value, hasUnsecureConfiguration: !!String(step.configuration || "").trim(), openUrl: `${ctx.clientUrl}/main.aspx?pagetype=entityrecord&etn=sdkmessageprocessingstep&id=${step.sdkmessageprocessingstepid}` };
      });
    };
    result.categories = await Promise.all([
      category("realtime", "Real-time workflows", () => workflowItems((x) => x.category === 0 && x.type === 1 && x.mode === 1, "realtimeWorkflow")),
      category("background", "Background workflows", () => workflowItems((x) => x.category === 0 && x.type === 1 && x.mode === 0, "backgroundWorkflow")),
      category("rules", "Business rules", () => workflowItems((x) => x.category === 2, "businessRule")),
      category("flows", "Cloud flows", () => workflowItems((x) => x.category === 5, "cloudFlow")),
      category("bpf", "Business process flows", () => workflowItems((x) => x.category === 4, "businessProcessFlow")),
      category("actions", "Custom actions", () => workflowItems((x) => x.category === 3, "customAction")),
      category("apis", "Custom APIs", async () => {
        const data = await fetchJson(`${ctx.clientUrl}/api/data/v9.2/customapis?$select=customapiid,uniquename,displayname,description,bindingtype,boundentitylogicalname,isfunction,isprivate,allowedcustomprocessingsteptype,statecode,statuscode,createdon,modifiedon&$filter=bindingtype eq 1 and boundentitylogicalname eq '${logicalName}'&$orderby=uniquename asc`);
        return (data.value || []).map((item) => ({ id: item.customapiid, kind: "customApi", name: item.displayname || item.uniquename || "(unnamed)", uniqueName: item.uniquename || "", description: item.description || "", bindingType: item.bindingtype, primaryTable: item.boundentitylogicalname || ctx.entityName, isFunction: item.isfunction, isPrivate: item.isprivate, allowedCustomProcessingStepType: item.allowedcustomprocessingsteptype, statecode: item.statecode, statuscode: item.statuscode, createdon: item.createdon, modifiedon: item.modifiedon, openUrl: `${ctx.clientUrl}/main.aspx?pagetype=entityrecord&etn=customapi&id=${item.customapiid}` }));
      }),
      category("plugins", "Plug-in steps", pluginSteps),
    ]);
    result.partial = result.categories.some((x) => !x.ok);
    cache.set(key, clone(result));
    return result;
  }

  async function searchUsers(ctx, query) {
    const term = String(query || "").trim();
    if (term.length < 2)
      return { ok: false, error: "Enter at least two characters." };
    const escaped = escapeOData(term);
    const filter = `(contains(fullname,'${escaped}') or contains(internalemailaddress,'${escaped}') or contains(domainname,'${escaped}')) and isdisabled eq false`;
    const data = await fetchJson(
      `${ctx.clientUrl}/api/data/v9.2/systemusers?$select=systemuserid,azureactivedirectoryobjectid,fullname,internalemailaddress,domainname&$filter=${encodeURIComponent(filter)}&$orderby=fullname asc&$top=20`,
    );
    return { ok: true, data: data.value || [] };
  }

  async function tool(request) {
    const actionName = request.action;
    const GLOBAL_CONTEXT_ACTIONS = ["advancedFind","maker","searchUsers","ribbon"];
    const SELECTED_SURFACE_READ_ACTIONS = ["recordApi","formEditor","allFields","processes","listFields","choices"];
    const LIVE_RUNTIME_MUTATION_ACTIONS = ["showFields","showTabs","focusField","logical","clearLogical","restore","god"];
    const selectedPane = sidePane();
    if (selectedPane && LIVE_RUNTIME_MUTATION_ACTIONS.includes(actionName)) return requestFormAgent(actionName,request);
    if (selectedPane && actionName === "choices") { const live=await requestFormAgent("choices",request); if(live?.ok)return live; }
    if (selectedPane && actionName === "listFields") { const live=await requestFormAgent("listFields",request); if(live?.ok)return live; }

    const globalOnly = GLOBAL_CONTEXT_ACTIONS.includes(actionName);
    const selectedRead = SELECTED_SURFACE_READ_ACTIONS.includes(actionName);
    const ctx = selectedRead ? await surfaceContext({ requireEntity:true, requireForm:actionName === "formEditor" }) : await context(globalOnly ? { requireEntity:false, requireForm:false } : { requireEntity:true, requireForm:true });
    if (selectedPane && actionName === "listFields") return {ok:true,data:internalFields().map(row=>({...row,provider:"uci-redux"})),provider:"uci-redux",entityName:ctx.entityName,recordId:ctx.recordId};
    if (selectedPane && actionName === "choices") { const meta=await metadataEntity(ctx.entityName); const cached=requestedSurface?.internal?.cachedEntity||{}; const columns=(meta.data?.columns||[]).filter(column=>/picklist|multiselect|state|status|boolean/i.test(String(column.attributeType||column.metadataType||""))); return {ok:true,provider:"uci-redux",entityName:ctx.entityName,data:columns.map(column=>{const field=cached?.fields?.[column.logicalName]||cached?.[column.logicalName]||{};return{field:column.logicalName,type:column.attributeType||column.metadataType,value:field?.value??field?.Value??null,text:field?.formattedValue??field?.FormattedValue??null,options:column.options||column.optionSet?.options||[],provider:"uci-redux",valueEvidence:"cached internal state"}})}; }
    if (actionName === "recordApi")
      return ctx.recordId
        ? openUrl(
            `${ctx.clientUrl}/api/data/v9.2/${ctx.entitySetName}(${ctx.recordId})`,
            "Record API opened.",
          )
        : { ok: false, error: "Save the record first." };
    if (actionName === "maker") {
      let metadataId = ctx.metadataId;
      if (request.logicalName)
        metadataId = clean(
          (
            await fetchJson(
              `${ctx.clientUrl}/api/data/v9.2/EntityDefinitions(LogicalName='${escapeOData(request.logicalName)}')?$select=MetadataId`,
            )
          ).MetadataId,
        );
      if (!ctx.environmentId || !metadataId)
        return {
          ok: false,
          error: "Environment or table metadata ID could not be resolved.",
        };
      return openUrl(
        `https://make.powerapps.com/environments/${ctx.environmentId}/entities/${metadataId}`,
        "Table opened in Power Apps.",
      );
    }
    if (actionName === "advancedFind")
      return openUrl(
        `${ctx.clientUrl}/main.aspx?pagetype=advancedfind`,
        "Advanced Find opened.",
      );
    if (actionName === "formEditor") {
      if (selectedPane && !ctx.formId) return {ok:false,error:"The selected side-pane form ID could not be resolved.",provider:ctx.surface?.internal?.provider||ctx.surface?.provider||"uci-redux",surfaceKind:"sidePane",entityName:ctx.entityName,formId:null};
      if (!ctx.environmentId || !ctx.formId) return {ok:false,error:"Environment or current form ID could not be resolved."};
      const defaultSolutionId = "fd140aaf-4df4-11dd-bd17-0019b9312238";
      const result=openUrl(`https://make.powerapps.com/e/${clean(ctx.environmentId)}/s/${defaultSolutionId}/entity/${ctx.entityName}/form/edit/${clean(ctx.formId)}`,`Form editor opened for ${ctx.entityName}.`);
      return {...result,entityName:ctx.entityName,formId:clean(ctx.formId),provider:selectedPane?(ctx.surface?.internal?.provider||ctx.surface?.provider||"uci-redux"):"main-form-xrm",surfaceKind:selectedPane?"sidePane":"mainForm"};
    }
    if (actionName === "allFields") return allFields(ctx);
    if (actionName === "processes") return tableProcesses(ctx);
    if (actionName === "searchUsers") return searchUsers(ctx, request.query);
    if (actionName === "showFields" || actionName === "god") {
      Xrm.Page.data.entity.attributes.forEach((attribute) => {
        if (!toolkitState.attributes.has(attribute.getName()))
          toolkitState.attributes.set(
            attribute.getName(),
            attribute.getRequiredLevel?.(),
          );
        if (actionName === "god") attribute.setRequiredLevel?.("none");
      });
      Xrm.Page.ui.controls.forEach((control) => {
        const name = control.getName?.();
        if (name && !toolkitState.controls.has(name))
          toolkitState.controls.set(name, {
            visible: control.getVisible?.(),
            disabled: control.getDisabled?.(),
          });
        control.setVisible?.(true);
        if (actionName === "god") control.setDisabled?.(false);
      });
      if (actionName === "god")
        Xrm.Page.ui.tabs.forEach((tab) => {
          const name = tab.getName?.();
          if (!toolkitState.tabs.has(name))
            toolkitState.tabs.set(name, tab.getVisible?.());
          tab.setVisible?.(true);
          tab.sections?.forEach((section) => {
            const key = name + "|" + section.getName?.();
            if (!toolkitState.sections.has(key))
              toolkitState.sections.set(key, section.getVisible?.());
            section.setVisible?.(true);
          });
        });
      return {
        ok: true,
        message:
          actionName === "god"
            ? "God Mode enabled temporarily."
            : "Hidden fields shown.",
      };
    }
    if (actionName === "showTabs") {
      Xrm.Page.ui.tabs.forEach((tab) => {
        const name = tab.getName?.();
        if (!toolkitState.tabs.has(name))
          toolkitState.tabs.set(name, tab.getVisible?.());
        tab.setVisible?.(true);
        tab.sections?.forEach((section) => {
          const key = name + "|" + section.getName?.();
          if (!toolkitState.sections.has(key))
            toolkitState.sections.set(key, section.getVisible?.());
          section.setVisible?.(true);
        });
      });
      return { ok: true, message: "Hidden tabs and sections shown." };
    }
    if (actionName === "restore") {
      Xrm.Page.data.entity.attributes.forEach(
        (attribute) =>
          toolkitState.attributes.has(attribute.getName()) &&
          attribute.setRequiredLevel?.(
            toolkitState.attributes.get(attribute.getName()),
          ),
      );
      Xrm.Page.ui.controls.forEach((control) => {
        const saved = toolkitState.controls.get(control.getName?.());
        if (saved) {
          control.setVisible?.(saved.visible);
          control.setDisabled?.(saved.disabled);
        }
      });
      Xrm.Page.ui.tabs.forEach((tab) => {
        const name = tab.getName?.();
        if (toolkitState.tabs.has(name))
          tab.setVisible?.(toolkitState.tabs.get(name));
        tab.sections?.forEach((section) => {
          const key = name + "|" + section.getName?.();
          if (toolkitState.sections.has(key))
            section.setVisible?.(toolkitState.sections.get(key));
        });
      });
      toolkitState.controls.clear();
      toolkitState.tabs.clear();
      toolkitState.sections.clear();
      toolkitState.attributes.clear();
      return {
        ok: true,
        message: "Original UI and required-level state restored.",
      };
    }
    if (actionName === "listFields") {
      const data = [];
      Xrm.Page.data.entity.attributes.forEach((attribute) =>
        data.push({
          name: attribute.getName(),
          type: attribute.getAttributeType?.(),
          value: attribute.getValue?.(),
          text: attribute.getText?.(),
          dirty: attribute.getIsDirty?.(),
          required: attribute.getRequiredLevel?.(),
          locations: formLocation(attribute),
        }),
      );
      return { ok: true, data };
    }
    if (actionName === "focusField") {
      const attribute = Xrm.Page.getAttribute(request.field),
        location = attribute && formLocation(attribute)[0];
      if (!attribute || !location)
        return { ok: false, error: "Field is not present on the loaded form." };
      const tab = Xrm.Page.ui.tabs.get(location.tab),
        section = tab?.sections?.get(location.section),
        control = Xrm.Page.getControl(location.control);
      tab?.setVisible?.(true);
      tab?.setDisplayState?.("expanded");
      section?.setVisible?.(true);
      control?.setVisible?.(true);
      control?.setFocus?.();
      const element = document.querySelector(
        `[data-id^="${CSS.escape(location.control)}"]`,
      );
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
        element.style.outline = "4px solid #22d3ee";
        setTimeout(() => (element.style.outline = ""), 15000);
      }
      return {
        ok: true,
        message: `Highlighted ${request.field}.`,
        data: { field: request.field, ...location },
      };
    }
    if (actionName === "choices") {
      const data = [];
      Xrm.Page.data.entity.attributes.forEach((attribute) => {
        const options = attribute.getOptions?.();
        if (options)
          data.push({
            field: attribute.getName(),
            type: attribute.getAttributeType?.(),
            text: attribute.getText?.(),
            value: attribute.getValue?.(),
            options: options.map((option) => ({
              text: option.text,
              value: option.value,
            })),
          });
      });
      return { ok: true, data };
    }
    if (actionName === "logical") {
      Xrm.Page.ui.controls.forEach((control) => {
        const attribute = control.getAttribute?.(),
          name = control.getName?.(),
          element =
            name && document.querySelector(`[data-id^="${CSS.escape(name)}"]`);
        if (
          attribute &&
          element &&
          !element.querySelector(".devlens-logical")
        ) {
          const span = document.createElement("span");
          span.className = "devlens-logical";
          span.textContent = ` [${attribute.getName()}]`;
          span.style.color = "#22d3ee";
          (element.querySelector("label") || element).appendChild(span);
        }
      });
      return { ok: true, message: "Logical names shown." };
    }
    if (actionName === "clearLogical") {
      document
        .querySelectorAll(".devlens-logical")
        .forEach((element) => element.remove());
      return { ok: true, message: "Logical names cleared." };
    }
    if (actionName === "ribbon") {
      const url = new URL(location.href);
      url.searchParams.set("ribbondebug", "true");
      return openUrl(url.toString(), "Ribbon debug enabled.");
    }
    return { ok: false, error: "Unsupported action." };
  }

  const task =
    action === "report"
      ? report()
      : action === "allFieldsReport"
        ? allFieldsReport()
        : action === "dirtyFieldState"
          ? dirtyFieldState()
        : action === "shellContext"
          ? shellContext()
          : action === "clearMetadataCache"
            ? Promise.resolve(clearMetadataCache())
            : action === "scan"
        ? scan(payload?.libraries || [])
        : action === "metadataTables"
          ? metadataTables()
          : action === "globalChoices"
            ? globalChoices()
            : action === "startMetadataIndex"
              ? startMetadataIndex(payload?.mode || "automatic")
              : action === "metadataIndexStatus"
                ? Promise.resolve(metadataIndexStatus())
                : action === "cancelMetadataIndex"
                  ? Promise.resolve(cancelMetadataIndex())
            : action === "metadataEntity"
              ? metadataEntity(payload?.logicalName)
              : action === "schemaTable"
                ? schemaTable(payload?.logicalName)
                : action === "processExplorer"
                ? surfaceContext({ requireEntity: true, requireForm: false }).then((ctx) => processExplorer(ctx, !!payload?.force))
              : action === "queryFetchXml"
          ? queryFetchXmlReadOnly(payload?.fetchXml, payload?.tableName, payload?.offset, payload?.limit)
          : action === "querySql"
          ? querySqlReadOnly(payload?.sql)
          : action === "tool"
                ? tool(payload || {})
                : Promise.resolve({ ok: false, error: "Unknown action" });
  return task.catch((error) => ({
    ok: false,
    error: error.message || String(error),
  }));
}

function stripSqlLiteralsAndComments(sql) {
  const input = String(sql || "");
  let output = "";
  let inString = false;
  let inLineComment = false;
  let blockDepth = 0;
  for (let i = 0; i < input.length; i++) {
    const current = input[i];
    const next = input[i + 1];
    if (inLineComment) {
      if (current === "\n" || current === "\r") {
        inLineComment = false;
        output += current;
      } else output += " ";
      continue;
    }
    if (blockDepth > 0) {
      if (current === "/" && next === "*") {
        output += "  ";
        i++;
        blockDepth++;
      } else if (current === "*" && next === "/") {
        output += "  ";
        i++;
        blockDepth--;
      } else output += current === "\n" || current === "\r" ? current : " ";
      continue;
    }
    if (inString) {
      if (current === "'" && next === "'") {
        output += "  ";
        i++;
      } else if (current === "'") {
        output += " ";
        inString = false;
      } else output += current === "\n" || current === "\r" ? current : " ";
      continue;
    }
    if (current === "'") {
      inString = true;
      output += " ";
      continue;
    }
    if (current === "-" && next === "-") {
      inLineComment = true;
      output += "  ";
      i++;
      continue;
    }
    if (current === "/" && next === "*") {
      blockDepth = 1;
      output += "  ";
      i++;
      continue;
    }
    output += current;
  }
  return output;
}
function isSecuritySqlCandidate(sql) {
  const query = stripSqlLiteralsAndComments(sql);
  return /\bFROM\s+systemuserroles\b/i.test(query) ||
    (/\bFROM\s+privilege\b/i.test(query) && /\bJOIN\s+privilegeobjecttypecodes\b/i.test(query)) ||
    /\b(?:FROM|JOIN)\s+roleprivileges\b/i.test(query) ||
    (/\bFROM\s+audit\b/i.test(query) && /\bCROSS\s+APPLY\s+OPENJSON\b/i.test(query));
}
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== "DEVLENS_ACTION") return;
  if (message.action === "querySql") {
    const specializedSecurity = isSecuritySqlCandidate(message.payload?.sql) && typeof devLensSecurityAuditBridge === "function";
    const decision = globalThis.DevLensSqlPolicy?.evaluate(message.payload?.sql, globalThis.DevLensSqlEngine, { specializedSecurity });
    if (!decision?.ok) {
      reply({ ok: false, code: decision?.code || "POLICY_UNAVAILABLE", error: decision?.error || "The read-only SQL policy is unavailable; execution was stopped." });
      return;
    }
  }
  if (message.action === "queryFetchXml") {
    const decision = globalThis.DevLensSqlPolicy?.validateFetchXml(message.payload?.fetchXml, message.payload?.tableName);
    if (!decision?.ok) {
      reply({ ok: false, code: decision?.code || "POLICY_UNAVAILABLE", error: decision?.error || "The read-only query policy is unavailable; execution was stopped." });
      return;
    }
  }
  const securitySql = message.action === "querySql" &&
    isSecuritySqlCandidate(message.payload?.sql) &&
    typeof devLensSecurityAuditBridge === "function";
  chrome.scripting
    .executeScript({
      target: { tabId: sender.tab.id, allFrames: message.action !== "tool" },
      world: "MAIN",
      func: securitySql ? devLensSecurityAuditBridge : pageBridge,
      args: securitySql
        ? ["sqlQuery", { sql: message.payload.sql }]
        : [message.action, message.payload || {}],
    })
    .then((results) =>
      reply(
        results.find((item) => item.result?.ok)?.result ||
          results.find((item) => item.result?.error)?.result || {
            ok: false,
            error: "No Dynamics form frame found.",
          },
      ),
    )
    .catch((error) => reply({ ok: false, error: error.message }));
  return true;
});

chrome.commands.onCommand.addListener(async (command) => {
  const messageType =
    command === "command-palette"
      ? "DEVLENS_PALETTE"
      : command === "toggle-analyzer"
        ? "DEVLENS_MINIMIZE"
        : null;
  if (!messageType) return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  chrome.tabs.sendMessage(
    tab.id,
    { type: messageType },
    () => void chrome.runtime.lastError,
  );
});