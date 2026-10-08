(() => {
  "use strict";
  if (globalThis.__DEVLENS_SURFACE_BOOTSTRAP_5206) return;
  globalThis.__DEVLENS_SURFACE_BOOTSTRAP_5206 = true;
  const KEY="__devlens_surface_registry_5206", state={panes:new Map(),selectedPaneId:null,lastInternalHash:""};
  const clean=v=>v?String(v).replace(/[{}]/g,"").toLowerCase():null;
  const paneId=p=>String(p?.paneId||p?._paneId||"");
  const jsonSafe=v=>{try{return JSON.parse(JSON.stringify(v))}catch{return null}};
  const inputEntity=i=>String(i?.entityTypeName||i?.entityName||i?.etn||"").toLowerCase();
  const inputId=i=>clean(i?.id||i?.entityId||i?.recordId);
  const emit=extra=>{const selected=state.selectedPaneId?state.panes.get(state.selectedPaneId)||null:null;const payload={selectedPaneId:state.selectedPaneId,selectedSurface:selected,panes:[...state.panes.values()],capturedOn:new Date().toISOString(),...extra};try{sessionStorage.setItem(KEY,JSON.stringify(payload))}catch{}globalThis.postMessage({source:"DEVLENS_SURFACE_BOOTSTRAP",type:"SURFACE_STATE",payload},location.origin)};
  const remember=(pane,input,provider="AppSidePane.navigate")=>{if(String(input?.pageType||"").toLowerCase()!=="entityrecord"||!inputEntity(input))return;const id=paneId(pane);if(!id)return;state.panes.set(id,{surfaceId:`sidePane:${id}`,kind:"sidePane",paneId:id,pageType:"entityrecord",entityName:inputEntity(input),recordId:inputId(input),formId:clean(input.formId),provider,confidence:provider==="AppSidePane.navigate"?100:70,capturedOn:new Date().toISOString()});emit()};
  const findInput=(v,d=0,seen=new Set())=>{if(!v||typeof v!=="object"||d>3||seen.has(v))return null;seen.add(v);try{if((v.pageType==="entityrecord"||v.entityTypeName)&&inputEntity(v))return v;for(const k of Reflect.ownKeys(v)){const q=Object.getOwnPropertyDescriptor(v,k);if(!q||!("value" in q))continue;const f=findInput(q.value,d+1,seen);if(f)return f}}catch{}return null};
  const wrapPane=p=>{if(!p)return p;const found=findInput(p);if(found&&!state.panes.has(paneId(p)))remember(p,found,"AppSidePane.internal-pageInput");if(p.__devlens5206Wrapped||typeof p.navigate!=="function")return p;try{const original=p.navigate.bind(p);p.navigate=input=>{remember(p,input);return original(input)};Object.defineProperty(p,"__devlens5206Wrapped",{value:true})}catch{}return p};
  const patchPanes=()=>{const api=globalThis.Xrm?.App?.sidePanes;if(!api)return;try{api.getAllPanes?.().forEach?.(wrapPane)}catch{}if(!api.__devlens5206Wrapped&&typeof api.createPane==="function")try{const original=api.createPane.bind(api);api.createPane=async o=>wrapPane(await original(o));Object.defineProperty(api,"__devlens5206Wrapped",{value:true})}catch{}};
  const pageEntries=pages=>Array.isArray(pages)?pages.map((v,i)=>[String(i),v]):Object.entries(pages||{});
  const summarizeInternal=async selected=>{
    if(!selected||typeof globalThis._getModelFormComponent!=="function")return null;
    try{
      const M=await globalThis._getModelFormComponent();const root=M?._store?.getState?.();if(!root)return null;
      const pages=pageEntries(root.pages);const candidates=pages.map(([key,page])=>{const input=page?.input||{};return{key,page,input,entityName:inputEntity(input),recordId:inputId(input)}}).filter(x=>x.entityName===selected.entityName);
      let match=candidates.find(x=>x.recordId&&x.recordId===selected.recordId)||candidates.find(x=>x.recordId===selected.recordId)||candidates[candidates.length-1]||null;
      if(!match)return{provider:"uci-redux",matched:false,pageCount:pages.length};
      const form=match.page?.forms?.[selected.entityName]||null;const controls=form?.controls||{};
      const metadataForms=root.metadata?.forms||{};
      const metadataEntries=Object.entries(metadataForms);
      const requestedFormId=clean(form?.formId||form?.id||form?.FormId||match.input?.formId||selected.formId);
      const metadataMatch=(requestedFormId&&metadataForms[requestedFormId])
        ? [requestedFormId,metadataForms[requestedFormId]]
        : metadataEntries.find(([,value])=>String(value?.EntityLogicalName||value?.entityLogicalName||"").toLowerCase()===selected.entityName) || null;
      const metadataForm=metadataMatch?.[1]||null;
      const entityBucket=root.data?.entities?.[selected.entityName]||{};const cached=selected.recordId?entityBucket[selected.recordId]||entityBucket[selected.recordId.toUpperCase?.()]||null:null;
      const browsing=Object.entries(root.browsingContexts||{}).map(([key,c])=>{const h=c?.history||[];const last=h[h.length-1]?.state?.input||h[0]?.state?.input||{};return{key,entityName:inputEntity(last),recordId:inputId(last)}}).find(x=>x.entityName===selected.entityName&&(!selected.recordId||x.recordId===selected.recordId))||null;
      const command=Object.entries(root.commands||{}).map(([key,v])=>({key,value:v})).find(x=>String(x.value?.ruleContext?.EntityLogicalName||x.value?.contextToken?.entityTypeName||"").toLowerCase()===selected.entityName&&String(x.value?.ruleContext?.RibbonId||"").startsWith("Form:"))||null;
      return{provider:"uci-redux",matched:true,pageKey:match.key,entityName:match.entityName,recordId:match.recordId||selected.recordId,formId:requestedFormId||clean(metadataMatch?.[0]),pageInput:jsonSafe(match.input),form:{keys:Reflect.ownKeys(form||{}).map(String),controlCount:Object.keys(controls).length,controls:jsonSafe(controls),attributes:jsonSafe(form?.attributes||form?.Attributes||null)},metadataForm:{id:clean(metadataMatch?.[0]),name:metadataForm?.Name||metadataForm?.name||metadataForm?.FormName||"",entityLogicalName:metadataForm?.EntityLogicalName||metadataForm?.entityLogicalName||selected.entityName,eventHandlers:jsonSafe(metadataForm?.EventHandlers||metadataForm?.eventHandlers||[]),formLibraries:jsonSafe(metadataForm?.FormLibraries||metadataForm?.formLibraries||[]),businessLogic:metadataForm?.BusinessLogic||metadataForm?.businessLogic||"",keys:Reflect.ownKeys(metadataForm||{}).map(String)},cachedEntity:jsonSafe(cached),browsingContext:browsing,commandContext:command?{key:command.key,ruleContext:jsonSafe(command.value?.ruleContext),contextToken:jsonSafe(command.value?.contextToken),ribbonId:command.value?.ribbonId||null}:null};
    }catch(error){return{provider:"uci-redux",matched:false,error:error?.message||String(error)}}
  };
  window.addEventListener("message",event=>{if(event.source!==window||event.origin!==location.origin||event.data?.source!=="DEVLENS_FORM_AGENT"||event.data?.type!=="SURFACE_SNAPSHOT")return;const snap=event.data.payload;if(!snap?.entityName||!snap?.recordId)return;for(const [id,pane] of state.panes){if(pane.entityName===String(snap.entityName).toLowerCase()&&pane.recordId===clean(snap.recordId))state.panes.set(id,{...pane,agentSnapshot:jsonSafe(snap)})}emit()},true);
  try{const saved=JSON.parse(sessionStorage.getItem(KEY)||"null");for(const p of saved?.panes||[])if(p?.paneId)state.panes.set(p.paneId,p)}catch{}
  let busy=false;setInterval(async()=>{patchPanes();const api=globalThis.Xrm?.App?.sidePanes;if(api)try{api.getAllPanes?.().forEach?.(wrapPane);const next=paneId(api.getSelectedPane?.())||null;if(next!==state.selectedPaneId){state.selectedPaneId=next;emit()}}catch{}if(busy)return;busy=true;try{const selected=state.selectedPaneId?state.panes.get(state.selectedPaneId):null;const internal=await summarizeInternal(selected);const hash=JSON.stringify([internal?.matched,internal?.pageKey,internal?.recordId,internal?.formId,internal?.form?.controlCount,internal?.metadataForm?.eventHandlers?.length,internal?.metadataForm?.formLibraries?.length]);if(hash!==state.lastInternalHash){state.lastInternalHash=hash;if(selected&&internal?.matched)state.panes.set(selected.paneId,{...selected,mode:"internal",internal});emit({internal})}}finally{busy=false}},250);
  patchPanes();emit();
})();
