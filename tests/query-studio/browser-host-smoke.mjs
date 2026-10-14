import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const baseUrl = (process.env.DATAVERSE_URL || "").replace(/\/+$/, "");
const appUrl = process.env.DYNAMICS_APP_URL || (baseUrl ? baseUrl + "/main.aspx" : "");
const statePath = process.env.DYNAMICS_PLAYWRIGHT_STORAGE_STATE_PATH || "";
const profilePath = process.env.DYNAMICS_PLAYWRIGHT_PROFILE_PATH ||
  (statePath ? path.join(path.dirname(path.resolve(statePath)), "query-studio-browser-profile") : "");

function safeOrigin(value) {
  const parsed = new URL(value);
  assert.equal(parsed.protocol, "https:", "Dynamics app URL must use HTTPS.");
  assert.match(parsed.hostname, /\.crm(?:\d+)?\.dynamics\.com$|\.crm\.microsoftdynamics\.us$|\.crm\.dynamics\.cn$/i,
    "Dynamics app URL must point to a Dataverse organization.");
  return parsed.origin;
}

assert.ok(baseUrl, "DATAVERSE_URL secret is required.");
assert.ok(statePath && fs.existsSync(statePath), "The diagnostic storage-state file is missing; run capture-browser-host-state.mjs first.");
assert.ok(profilePath, "DYNAMICS_PLAYWRIGHT_PROFILE_PATH must point to the persistent Chromium profile directory.");
assert.ok(fs.existsSync(profilePath), "The persistent Chromium profile is missing. Run capture-browser-host-state.mjs on this runner account first.");
const appOrigin = safeOrigin(appUrl);
assert.equal(appOrigin, safeOrigin(baseUrl), "DYNAMICS_APP_URL must use the same Dataverse origin as DATAVERSE_URL.");
assert.equal(path.resolve(profilePath).startsWith(path.resolve(process.cwd()) + path.sep), false,
  "The persistent browser profile must be outside the repository.");

let context;
try {
  // Use the exact profile authenticated by the interactive capture helper. This
  // preserves browser-managed auth/session state that storageState can omit.
  context = await chromium.launchPersistentContext(path.resolve(profilePath), {
    headless: true,
    viewport: { width: 1440, height: 1000 },
    args: [
      `--disable-extensions-except=${process.cwd()}`,
      `--load-extension=${process.cwd()}`,
      "--no-first-run",
      "--no-default-browser-check"
    ]
  });

  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message.slice(0, 200)));
  await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(2500);

  const finalUrl = new URL(page.url());
  assert.equal(finalUrl.origin, appOrigin,
    finalUrl.hostname.includes("login.microsoftonline.com") || finalUrl.hostname.includes("login.windows.net")
      ? "Persistent Chromium profile redirected to Microsoft sign-in. Re-run capture helper interactively under the same Windows account as the Actions runner."
      : "Navigation left the configured Dataverse organization.");
  await page.waitForFunction(() => Boolean(window.Xrm?.Utility?.getGlobalContext && window.D365AnalyzerApi?.send && window.DevLensSqlStudioView), null, { timeout: 45000 });

  const host = await page.evaluate(() => {
    const element = document.createElement("section");
    element.id = "devlens-browser-host-smoke";
    element.style.cssText = "position:fixed;inset:10px;z-index:2147483647;overflow:auto;background:#0f172a;padding:16px";
    document.body.appendChild(element);
    window.DevLensSqlStudioView.renderInto(element);
    return {
      clientUrl: window.Xrm.Utility.getGlobalContext().getClientUrl(),
      bridgeReady: Boolean(window.D365AnalyzerApi?.send),
      viewReady: Boolean(window.DevLensSqlStudioView?.isAvailable())
    };
  });
  assert.equal(host.bridgeReady, true, "DevLens page-to-background bridge did not initialize.");
  assert.equal(host.viewReady, true, "Query Studio view did not initialize.");
  assert.equal(safeOrigin(host.clientUrl), appOrigin, "Xrm reports a different Dataverse organization.");

  await page.locator("#devlens-browser-host-smoke .ss-editor").fill("SELECT TOP 1 accountid FROM account");
  await page.locator('#devlens-browser-host-smoke [data-act="execute"]').click();
  await page.waitForFunction(() => {
    const root = document.querySelector("#devlens-browser-host-smoke");
    return root && (root.querySelector(".ss-error") || root.querySelector(".ss-results table"));
  }, null, { timeout: 120000 });

  const outcome = await page.evaluate(() => {
    const root = document.querySelector("#devlens-browser-host-smoke");
    return {
      errorVisible: Boolean(root?.querySelector(".ss-error")),
      resultTableVisible: Boolean(root?.querySelector(".ss-results table")),
      columns: Array.from(root?.querySelectorAll(".ss-results thead th") || []).map(cell => cell.textContent),
      rowCount: root?.querySelectorAll(".ss-results tbody tr").length || 0
    };
  });
  assert.equal(outcome.errorVisible, false, "Authenticated browser-host query failed; inspect the redacted Actions logs and test outcome.");
  assert.equal(outcome.resultTableVisible, true, "Query Studio did not render a result table.");
  assert.ok(outcome.columns.some(column => column.toLowerCase() === "accountid"), "Query result did not contain the requested accountid column.");
  assert.ok(outcome.rowCount <= 1, "TOP 1 query returned more than one row.");
  assert.equal(pageErrors.length, 0, "The Dynamics page emitted an uncaught JavaScript error during the smoke test.");

  console.log(JSON.stringify({
    result: "passed",
    scope: "persistent authenticated Chromium profile + unpacked extension + Query Studio UI + background queryExecute + Dataverse read-only SQL",
    organization: appOrigin,
    query: "SELECT TOP 1 accountid FROM account",
    returnedRows: outcome.rowCount,
    requestedColumnPresent: true,
    pageErrors: 0
  }));
} finally {
  if (context) await context.close();
}
