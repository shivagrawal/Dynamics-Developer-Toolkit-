"use strict";

const DevLensImpersonationService = (() => {
  const sessions = new Map();
  let nextRuleId = 100000;
  const storageKey = "devLensImpersonationSessions";
  async function readStored() {
    try { return (await chrome.storage.session.get(storageKey))[storageKey] || {}; } catch { return {}; }
  }
  async function persist() {
    const value = Object.fromEntries([...sessions].map(([tabId, session]) => [String(tabId), publicSession(session)]));
    try { await chrome.storage.session.set({ [storageKey]: value }); } catch {}
  }

  function initials(name) {
    const parts = String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    return parts.length > 1
      ? (parts[0][0] + parts[1][0]).toUpperCase()
      : (parts[0] || "IM").slice(0, 2).toUpperCase();
  }

  async function setBadge(tabId, user) {
    await chrome.action.setBadgeText({
      tabId,
      text: initials(user.fullname || user.domainname),
    });
    await chrome.action.setBadgeBackgroundColor({ tabId, color: "#d97706" });
    await chrome.action.setTitle({
      tabId,
      title: `DevLens impersonating ${user.fullname || user.domainname}`,
    });
  }

  async function clearBadge(tabId) {
    try {
      await chrome.action.setBadgeText({ tabId, text: "" });
    } catch {}
    try {
      await chrome.action.setTitle({
        tabId,
        title: "Dynamics 365 & Dataverse DevLens",
      });
    } catch {}
  }

  async function reconstruct() {
    sessions.clear();
    const rules = await chrome.declarativeNetRequest.getSessionRules();
    const stored = await readStored();
    let maxId = 99999;
    for (const rule of rules) {
      maxId = Math.max(maxId, rule.id || 0);
      const tabId = rule.condition?.tabIds?.[0];
      const header = rule.action?.requestHeaders?.find(
        (item) => String(item.header).toLowerCase() === "callerobjectid",
      );
      if (!tabId || !header?.value) continue;
      const host =
        String(rule.condition?.urlFilter || "").match(
          /^https:\/\/([^/]+)/i,
        )?.[1] || "";
      let session = null;
      try {
        await chrome.tabs.get(tabId);

        session = {
          tabId,
          ruleId: rule.id,
          hostname: host,
          originalUrl: stored[String(tabId)]?.originalUrl || "",
          createdAt: stored[String(tabId)]?.createdAt || Date.now(),
          user: stored[String(tabId)]?.user || {
            azureactivedirectoryobjectid: header.value,
            fullname: "Unknown user",
          },
        };

        sessions.set(tabId, session);
      } catch {
        try {
          await chrome.declarativeNetRequest.updateSessionRules({
            removeRuleIds: [rule.id],
          });
        } catch {}
      }
      if (session) await setBadge(tabId, session.user);
    }
    nextRuleId = maxId + 1;
    await persist();
  }

  async function remove(tabId) {
    const session = sessions.get(tabId);
    if (session) {
      try {
        await chrome.declarativeNetRequest.updateSessionRules({
          removeRuleIds: [session.ruleId],
        });
      } catch {}
      sessions.delete(tabId);
    }
    await clearBadge(tabId);
    await persist();
  }

  async function createSession(user, sourceUrl) {
    if (!user?.azureactivedirectoryobjectid)
      throw new Error(
        "The selected user does not have a Microsoft Entra object ID.",
      );
    const url = new URL(sourceUrl);
    if (!url.hostname.endsWith(".dynamics.com"))
      throw new Error("Impersonation is supported only for Dynamics 365 tabs.");

    const loadingUrl = chrome.runtime.getURL("impersonation-loading.html");
    const tab = await chrome.tabs.create({ url: loadingUrl, active: true });
    if (!tab.id) throw new Error("The impersonated tab could not be created.");

    const ruleId = nextRuleId++;
    const session = {
      tabId: tab.id,
      ruleId,
      hostname: url.hostname,
      originalUrl: sourceUrl,
      createdAt: Date.now(),
      user,
    };
    const rule = {
      id: ruleId,
      priority: 1,
      action: {
        type: chrome.declarativeNetRequest.RuleActionType.MODIFY_HEADERS,
        requestHeaders: [
          {
            operation: chrome.declarativeNetRequest.HeaderOperation.SET,
            header: "CallerObjectId",
            value: user.azureactivedirectoryobjectid,
          },
        ],
      },
      condition: {
        tabIds: [tab.id],
        urlFilter: `https://${url.hostname}/api/data/v*`,
        resourceTypes: [
          chrome.declarativeNetRequest.ResourceType.XMLHTTPREQUEST,
          chrome.declarativeNetRequest.ResourceType.MAIN_FRAME,
          chrome.declarativeNetRequest.ResourceType.SUB_FRAME,
        ],
      },
    };

    try {
      await chrome.declarativeNetRequest.updateSessionRules({
        addRules: [rule],
      });
      sessions.set(tab.id, session);
      await persist();
      await setBadge(tab.id, user);
      await chrome.tabs.update(tab.id, { url: sourceUrl, active: true });
      return session;
    } catch (error) {
      await remove(tab.id);
      try {
        await chrome.tabs.remove(tab.id);
      } catch {}
      throw error;
    }
  }

  function publicSession(session) {
    return session
      ? {
          tabId: session.tabId,
          hostname: session.hostname,
          originalUrl: session.originalUrl,
          createdAt: session.createdAt,
          user: session.user,
        }
      : null;
  }

  chrome.tabs.onRemoved.addListener((tabId) => void remove(tabId));
  chrome.runtime.onStartup.addListener(() => void reconstruct());
  chrome.runtime.onInstalled.addListener(() => void reconstruct());
  void reconstruct();

  return { sessions, createSession, remove, publicSession };
})();

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (message?.type !== "DEVLENS_IMPERSONATION") return;
  (async () => {
    if (message.action === "searchUsers") {
      const tabId = sender.tab?.id;
      if (!tabId) throw new Error("No Dynamics tab was found.");
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: async (query) => {
          const term = String(query || "").trim();
          if (term.length < 2)
            throw new Error("Enter at least two characters.");
          const clientUrl = Xrm.Utility.getGlobalContext().getClientUrl();
          const escaped = term.replace(/'/g, "''");
          const filter = `(contains(fullname,'${escaped}') or contains(internalemailaddress,'${escaped}') or contains(domainname,'${escaped}')) and isdisabled eq false`;
          const url = `${clientUrl}/api/data/v9.2/systemusers?$select=systemuserid,azureactivedirectoryobjectid,fullname,internalemailaddress,domainname&$filter=${encodeURIComponent(filter)}&$orderby=fullname asc&$top=20`;
          const response = await fetch(url, {
            credentials: "same-origin",
            headers: {
              Accept: "application/json",
              "OData-MaxVersion": "4.0",
              "OData-Version": "4.0",
            },
          });
          if (!response.ok)
            throw new Error(`User search failed: ${response.status}`);
          return (await response.json()).value || [];
        },
        args: [message.query],
      });
      return { ok: true, data: results[0]?.result || [] };
    }
    if (message.action === "startNewTab") {
      const sourceTab = sender.tab;
      if (!sourceTab?.url)
        throw new Error("The current Dynamics URL could not be resolved.");
      const session = await DevLensImpersonationService.createSession(
        message.user,
        sourceTab.url,
      );
      return {
        ok: true,
        data: DevLensImpersonationService.publicSession(session),
        message: `Opened an impersonated tab for ${message.user.fullname || message.user.domainname}.`,
      };
    }
    if (message.action === "list") {
      const validSessions = [];

      for (const session of DevLensImpersonationService.sessions.values()) {
        try {
          await chrome.tabs.get(session.tabId);

          validSessions.push(
            DevLensImpersonationService.publicSession(session),
          );
        } catch {
          await DevLensImpersonationService.remove(session.tabId);
        }
      }

      return {
        ok: true,
        data: validSessions,
      };
    }
    if (message.action === "open") {
      await chrome.tabs.update(message.tabId, { active: true });
      return { ok: true };
    }
    if (message.action === "stopRestore") {
      await DevLensImpersonationService.remove(message.tabId);
      await chrome.tabs.reload(message.tabId);
      return {
        ok: true,
        message: "Impersonation stopped and the tab was reloaded.",
      };
    }
    if (message.action === "stopClose") {
      await DevLensImpersonationService.remove(message.tabId);
      await chrome.tabs.remove(message.tabId);
      return {
        ok: true,
        message: "Impersonation stopped and the tab was closed.",
      };
    }
    throw new Error("Unsupported impersonation action.");
  })()
    .then(reply)
    .catch((error) =>
      reply({ ok: false, error: error.message || String(error) }),
    );
  return true;
});
