(async()=>{const[t]=await chrome.tabs.query({active:true,currentWindow:true});if(t?.id)chrome.tabs.sendMessage(t.id,{type:"DEVLENS_TOGGLE"},()=>void chrome.runtime.lastError);window.close()})();
