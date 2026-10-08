"use strict";

function devLensProcessExplorerBridge(action, payload) {
  "use strict";
  const requestedSurface = payload?.__devlensSurface || null;
  const selectedSidePane = requestedSurface?.kind === "sidePane" && requestedSurface?.entityName ? requestedSurface : null;
  const label = (value) => value?.UserLocalizedLabel?.Label || value?.LocalizedLabels?.[0]?.Label || "";
  const clean = (value) => value ? String(value).replace(/[{}]/g, "") : "";
  async function json(url) {
    const response = await fetch(url, { credentials: "same-origin", headers: { Accept: "application/json", "OData-MaxVersion": "4.0", "OData-Version": "4.0" } });
    if (!response.ok) {
      let detail = "";
      try { detail = (await response.json())?.error?.message || ""; } catch {}
      throw Error(detail || `Dataverse request failed: ${response.status} ${response.statusText}`);
    }
    return response.json();
  }
  async function context() {
    if (typeof Xrm === "undefined" || !Xrm.Utility?.getGlobalContext) throw Error("Xrm is unavailable in this frame.");
    const global = Xrm.Utility.getGlobalContext();
    return { clientUrl: global.getClientUrl(), currentTable: selectedSidePane?.entityName || Xrm.Page?.data?.entity?.getEntityName?.() || "", surfaceKind:selectedSidePane?"sidePane":"mainForm", surfaceProvider:selectedSidePane?.internal?.provider||selectedSidePane?.provider||"main-form-xrm", surfaceRecordId:selectedSidePane?.recordId||selectedSidePane?.internal?.recordId||"" };
  }
  const cache = (window.__DEVLENS_PROCESS_EXPLORER_V2_CACHE ??= new Map());
  async function tableList(ctx) {
    const key = `${ctx.clientUrl}|tables`;
    if (cache.has(key)) return cache.get(key);
    const data = await json(`${ctx.clientUrl}/api/data/v9.2/EntityDefinitions?$select=LogicalName,SchemaName,DisplayName,IsCustomEntity&$filter=IsPrivate eq false`);
    const rows = (data.value || []).map((x) => ({ logicalName: x.LogicalName, schemaName: x.SchemaName, displayName: label(x.DisplayName) || x.LogicalName, isCustom: x.IsCustomEntity })).sort((a,b) => a.displayName.localeCompare(b.displayName));
    cache.set(key, rows);
    return rows;
  }
  async function load(ctx, table, force) {
    if (!table) throw Error("Select a Dataverse table first.");
    const key = `${ctx.clientUrl}|${table}`.toLowerCase();
    if (!force && cache.has(key)) return cache.get(key);
    const escaped = String(table).replace(/'/g, "''");
    const category = async (id, title, loader) => {
      try { const items = await loader(); return { id, title, ok: true, count: items.length, items, error: "" }; }
      catch (error) { return { id, title, ok: false, count: 0, items: [], error: error.message || String(error) }; }
    };
    let workflowRequest;
    const workflows = () => (workflowRequest ??= json(`${ctx.clientUrl}/api/data/v9.2/workflows?$select=workflowid,name,description,category,type,mode,scope,statecode,statuscode,createdon,modifiedon,primaryentity&$filter=primaryentity eq '${escaped}'&$orderby=name asc`));
    const workflowItems = async (predicate, kind) => (await workflows()).value.filter(predicate).map((item) => ({ id:item.workflowid, kind, name:item.name || "(unnamed)", description:item.description || "", primaryTable:item.primaryentity || table, statecode:item.statecode, statuscode:item.statuscode, mode:item.mode, scope:item.scope, createdon:item.createdon, modifiedon:item.modifiedon, openUrl:item.category === 2 ? `${ctx.clientUrl}/tools/systemcustomization/businessrules/businessRulesDesigner.aspx?BRlaunchpoint=BRGrid&id=%7B${item.workflowid}%7D` : `${ctx.clientUrl}/sfa/workflow/edit.aspx?id=%7b${item.workflowid}%7d` }));
    const pluginSteps = async () => {
      const filterData = await json(`${ctx.clientUrl}/api/data/v9.2/sdkmessagefilters?$select=sdkmessagefilterid,primaryobjecttypecode,secondaryobjecttypecode&$filter=primaryobjecttypecode eq '${escaped}'`);
      const filters = filterData.value || [];
      if (!filters.length) return [];
      const filterMap = new Map(filters.map(x => [clean(x.sdkmessagefilterid).toLowerCase(),x]));
      const filterClause = filters.map(x => `_sdkmessagefilterid_value eq ${clean(x.sdkmessagefilterid)}`).join(" or ");
      const stepData = await json(`${ctx.clientUrl}/api/data/v9.2/sdkmessageprocessingsteps?$select=sdkmessageprocessingstepid,name,description,stage,mode,rank,supporteddeployment,filteringattributes,statecode,statuscode,configuration,ismanaged,ismanaged,iscustomizable,_sdkmessageid_value,_sdkmessagefilterid_value,_eventhandler_value,_plugintypeid_value,_sdkmessageprocessingstepsecureconfigid_value&$filter=${encodeURIComponent(filterClause)}&$orderby=rank asc`);
      const steps = stepData.value || [], typeIds = [...new Set(steps.map(x => clean(x._plugintypeid_value || x._eventhandler_value)).filter(Boolean))];
      const typeMap = new Map(), assemblyMap = new Map(), messageMap = new Map(), imageMap = new Map();
      if (typeIds.length) {
        const typeData = await json(`${ctx.clientUrl}/api/data/v9.2/plugintypes?$select=plugintypeid,name,typename,friendlyname,isworkflowactivity,ismanaged,_pluginassemblyid_value&$filter=${encodeURIComponent(typeIds.map(id => `plugintypeid eq ${id}`).join(" or "))}`);
        for (const x of typeData.value || []) typeMap.set(clean(x.plugintypeid).toLowerCase(),x);
        const assemblyIds = [...new Set((typeData.value || []).map(x => clean(x._pluginassemblyid_value)).filter(Boolean))];
        if (assemblyIds.length) {
          const assemblyData = await json(`${ctx.clientUrl}/api/data/v9.2/pluginassemblies?$select=pluginassemblyid,name,version,culture,publickeytoken,isolationmode,ismanaged&$filter=${encodeURIComponent(assemblyIds.map(id => `pluginassemblyid eq ${id}`).join(" or "))}`);
          for (const x of assemblyData.value || []) assemblyMap.set(clean(x.pluginassemblyid).toLowerCase(),x);
        }
      }
      const messageIds = [...new Set(steps.map(x => clean(x._sdkmessageid_value)).filter(Boolean))];
      if (messageIds.length) {
        const messageData = await json(`${ctx.clientUrl}/api/data/v9.2/sdkmessages?$select=sdkmessageid,name&$filter=${encodeURIComponent(messageIds.map(id => `sdkmessageid eq ${id}`).join(" or "))}`);
        for (const x of messageData.value || []) messageMap.set(clean(x.sdkmessageid).toLowerCase(),x);
      }
      const stepIds = steps.map(x => clean(x.sdkmessageprocessingstepid)).filter(Boolean);
      if (stepIds.length) {
        try {
          const imageData = await json(`${ctx.clientUrl}/api/data/v9.2/sdkmessageprocessingstepimages?$select=sdkmessageprocessingstepimageid,name,description,imagetype,attributes,entityalias,messagepropertyname,relatedattributename,_sdkmessageprocessingstepid_value&$filter=${encodeURIComponent(stepIds.map(id => `_sdkmessageprocessingstepid_value eq ${id}`).join(" or "))}`);
          for (const image of imageData.value || []) { const id=clean(image._sdkmessageprocessingstepid_value).toLowerCase(); if(!imageMap.has(id)) imageMap.set(id,[]); imageMap.get(id).push({ name:image.name || "(unnamed image)", description:image.description || "", imageType:image.imagetype, attributes:(image.attributes || "").split(",").map(x=>x.trim()).filter(Boolean), alias:image.entityalias || "", messageProperty:image.messagepropertyname || "", relatedAttribute:image.relatedattributename || "" }); }
        } catch {}
      }
      const stages={10:"Pre-validation",20:"Pre-operation",30:"Main operation",40:"Post-operation",50:"Post-operation (deprecated)"}, modes={0:"Synchronous",1:"Asynchronous"}, deployments={0:"Server only",1:"Offline only",2:"Server and offline"};
      return steps.map(step => {
        const type=typeMap.get(clean(step._plugintypeid_value || step._eventhandler_value).toLowerCase()) || {}, assembly=assemblyMap.get(clean(type._pluginassemblyid_value).toLowerCase()) || {}, filter=filterMap.get(clean(step._sdkmessagefilterid_value).toLowerCase()) || {}, images=imageMap.get(clean(step.sdkmessageprocessingstepid).toLowerCase()) || [], message=messageMap.get(clean(step._sdkmessageid_value).toLowerCase())?.name || "Unknown message";
        const assemblyName=assembly.name || "", typeName=type.typename || type.name || "", identity=`${assemblyName} ${typeName} ${step.name || ""}`.toLowerCase();
        const classification=/^(microsoft\.|msdyn\.)|\bmicrosoft\.|\bobjectmodel\b/.test(identity) ? "Microsoft" : (assembly.ismanaged || step.ismanaged ? "ISV / managed" : assemblyName || typeName ? "Custom" : "Unknown");
        const filteringAttributes=(step.filteringattributes || "").split(",").map(x=>x.trim()).filter(Boolean), preImages=images.filter(x=>x.imageType===0||x.imageType===2), postImages=images.filter(x=>x.imageType===1||x.imageType===2);
        return { id:clean(step.sdkmessageprocessingstepid), kind:"pluginStep", name:step.name || `${message} step`, description:step.description || "", classification, developerRelevant:classification !== "Microsoft", pluginAssembly:assemblyName || "Not resolved", pluginAssemblyVersion:assembly.version || "", pluginType:typeName || "Not resolved", sdkMessage:message, operation:message, primaryTable:filter.primaryobjecttypecode || table, secondaryTable:filter.secondaryobjecttypecode || "", pipelineStage:stages[step.stage] || valueOr(step.stage), executionMode:modes[step.mode] || valueOr(step.mode), rank:step.rank, deploymentType:deployments[step.supporteddeployment] || valueOr(step.supporteddeployment), filteringAttributes, triggerSummary:triggerSummary(message,filteringAttributes), statecode:step.statecode, statuscode:step.statuscode, preImages, postImages, hasSecureConfiguration:!!step._sdkmessageprocessingstepsecureconfigid_value, hasUnsecureConfiguration:!!String(step.configuration || "").trim(), relatedPluginKey:`${assemblyName}|${typeName}`.toLowerCase() };
      });
    };
    function valueOr(value) { return value == null ? "Not specified" : value; }
    function triggerSummary(message, attrs) { return String(message).toLowerCase()==="update" ? attrs.length ? `Runs when an Update request includes at least one filtering attribute: ${attrs.join(", ")}. This is registration criteria, not proof of execution or a value change.` : "Registered for Update with no filtering attributes returned. Any Update request may qualify, subject to other registration conditions." : `Registered for the ${message} message. This describes configuration, not proof of execution.`; }
    const categories = await Promise.all([
      category("realtime","Real-time workflows",()=>workflowItems(x=>x.category===0&&x.type===1&&x.mode===1,"realtimeWorkflow")), category("background","Background workflows",()=>workflowItems(x=>x.category===0&&x.type===1&&x.mode===0,"backgroundWorkflow")), category("rules","Business rules",()=>workflowItems(x=>x.category===2,"businessRule")), category("flows","Cloud flows",()=>workflowItems(x=>x.category===5,"cloudFlow")), category("bpf","Business process flows",()=>workflowItems(x=>x.category===4,"businessProcessFlow")), category("actions","Custom actions",()=>workflowItems(x=>x.category===3,"customAction")),
      category("apis","Custom APIs",async()=>{ const d=await json(`${ctx.clientUrl}/api/data/v9.2/customapis?$select=customapiid,uniquename,displayname,description,bindingtype,boundentitylogicalname,isfunction,isprivate,statecode,statuscode&$filter=bindingtype eq 1 and boundentitylogicalname eq '${escaped}'&$orderby=uniquename asc`); return (d.value||[]).map(x=>({id:x.customapiid,kind:"customApi",name:x.displayname||x.uniquename||"(unnamed)",uniqueName:x.uniquename||"",description:x.description||"",primaryTable:x.boundentitylogicalname||table,isFunction:x.isfunction,isPrivate:x.isprivate,statecode:x.statecode,statuscode:x.statuscode})); }),
      category("plugins","Plug-in steps",pluginSteps),
    ]);
    const output={ok:true,entityName:table,tables:await tableList(ctx),categories,partial:categories.some(x=>!x.ok),generatedOn:new Date().toISOString(),surfaceKind:ctx.surfaceKind,surfaceProvider:ctx.surfaceProvider,surfaceRecordId:ctx.surfaceRecordId}; cache.set(key,output); return output;
  }
  return (async()=>{ const ctx=await context(); if(action==="tables") return {ok:true,tables:await tableList(ctx),currentTable:ctx.currentTable,surfaceKind:ctx.surfaceKind,surfaceProvider:ctx.surfaceProvider,surfaceRecordId:ctx.surfaceRecordId}; const table=payload?.table||selectedSidePane?.entityName||ctx.currentTable||""; return load(ctx,table,!!payload?.force); })().catch(error=>({ok:false,error:error.message||String(error)}));
}

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== "DEVLENS_PROCESS_EXPLORER_V2") return;
  chrome.scripting.executeScript({ target:{tabId:sender.tab.id,allFrames:true}, world:"MAIN", func:devLensProcessExplorerBridge, args:[message.action||"load",message.payload||{}] }).then(results=>reply(results.map(x=>x.result).find(x=>x?.ok)||results.map(x=>x.result).find(Boolean)||{ok:false,error:"Process Explorer returned no result."})).catch(error=>reply({ok:false,error:error.message||String(error)}));
  return true;
});
