(() => {
  "use strict";
  if (window.__DEVLENS_IMPERSONATION_UI) return;
  window.__DEVLENS_IMPERSONATION_UI = true;
  const send = (action, data = {}) => new Promise((resolve) => chrome.runtime.sendMessage({ type: "DEVLENS_IMPERSONATION", action, ...data }, resolve));
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;");

  function findDevLens() {
    for (const element of document.querySelectorAll("*")) {
      const root = element.shadowRoot;
      if (root?.querySelector('[data-action="impersonation"]')) return root;
    }
    return null;
  }

  async function render(root) {
    const drawer = root.getElementById("drawer"), title = root.getElementById("drawerTitle"), body = root.getElementById("drawerBody"), back = root.getElementById("back");
    if (!drawer || !body) return;
    drawer.classList.add("open");
    title.textContent = "Impersonated Dataverse Sessions";
    if (back) back.style.display = "none";
    const status = await send("list");
    const sessions = status.ok ? status.data || [] : [];
    body.innerHTML = `<div class="card warn"><b>Tab-scoped impersonation</b><br>DevLens opens a separate Dynamics tab and adds CallerObjectId only to matching Dataverse Web API requests in that tab. The original tab remains unchanged.</div>${sessions.length ? `<h3>Active Sessions</h3><div class="grid">${sessions.map((s, i) => `<div class="card"><b>${esc(s.user?.fullname || s.user?.domainname || "Unknown user")}</b><br><span class="muted">${esc(s.user?.internalemailaddress || s.user?.domainname || "")}</span><br><span class="muted">Tab ${esc(s.tabId)} · ${esc(s.hostname)}</span><div class="row"><button class="b openSession" data-i="${i}">Open</button><button class="b stopRestore" data-i="${i}">Stop & Restore</button><button class="b danger stopClose" data-i="${i}">Stop & Close</button></div></div>`).join("")}</div>` : '<div class="muted">No active impersonated tabs.</div>'}<h3>Open New Impersonated Session</h3><div class="row"><input id="devlensImpSearch" class="i search" placeholder="Search user name, email, or domain"><button id="devlensImpFind" class="b pri">Search</button></div><div id="devlensImpResults"></div>`;

    body.querySelectorAll(".openSession").forEach((button) => button.onclick = () => send("open", { tabId: sessions[+button.dataset.i].tabId }));
    body.querySelectorAll(".stopRestore").forEach((button) => button.onclick = async () => { const response = await send("stopRestore", { tabId: sessions[+button.dataset.i].tabId }); const statusNode = root.getElementById("status"); if (statusNode) statusNode.textContent = response.message || response.error; render(root); });
    body.querySelectorAll(".stopClose").forEach((button) => button.onclick = async () => { const response = await send("stopClose", { tabId: sessions[+button.dataset.i].tabId }); const statusNode = root.getElementById("status"); if (statusNode) statusNode.textContent = response.message || response.error; render(root); });

    const query = body.querySelector("#devlensImpSearch"), find = body.querySelector("#devlensImpFind"), output = body.querySelector("#devlensImpResults");
    find.onclick = async () => {
      output.innerHTML = '<div class="status">Searching enabled Dataverse users...</div>';
      const response = await send("searchUsers", { query: query.value });
      if (!response.ok) { output.innerHTML = `<div class="bad">${esc(response.error)}</div>`; return; }
      const users = response.data || [];
      output.innerHTML = users.length ? `<div class="grid">${users.map((user, i) => `<button class="b devlensImpUser toolCard" data-i="${i}" ${user.azureactivedirectoryobjectid ? "" : "disabled"}><b>${esc(user.fullname || user.domainname)}</b><span>${esc(user.internalemailaddress || user.domainname || "")}${user.azureactivedirectoryobjectid ? "" : " · No Entra object ID"}</span></button>`).join("")}</div>` : '<div class="muted">No matching enabled users found.</div>';
      output.querySelectorAll(".devlensImpUser").forEach((button) => button.onclick = async () => {
        button.disabled = true;
        const result = await send("startNewTab", { user: users[+button.dataset.i] });
        const statusNode = root.getElementById("status");
        if (statusNode) statusNode.textContent = result.message || result.error;
        button.disabled = false;
        if (result.ok) render(root);
      });
    };
    query.onkeydown = (event) => { if (event.key === "Enter") find.click(); };
    query.focus();
  }

  function attach(root) {
    if (root.__devLensImpersonationAttached) return;
    root.__devLensImpersonationAttached = true;
    root.addEventListener("click", (event) => {
      const button = event.composedPath().find((item) => item?.dataset?.action === "impersonation");
      if (!button) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      render(root);
    }, true);
  }

  const observer = new MutationObserver(() => { const root = findDevLens(); if (root) attach(root); });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  const root = findDevLens(); if (root) attach(root);
})();
