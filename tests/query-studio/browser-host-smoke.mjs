import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const baseUrl = (process.env.DATAVERSE_URL || "").replace(/\/+$/, "");
const appUrl = process.env.DYNAMICS_APP_URL || (baseUrl ? baseUrl + "/main.aspx" : "");
const statePath = process.env.DYNAMICS_PLAYWRIGHT_STORAGE_STATE_PATH || "";

function safeOrigin(value) {
  const parsed = new URL(value);
  assert.equal(parsed.protocol, "https:", "Dynamics app URL must use HTTPS.");
  assert.match(parsed.hostname, /\.crm(?:\d+)?\.dynamics\.com$|\.crm\.microsoftdynamics\.us$|\.crm\.dynamics\.cn$/i,
    "Dynamics app URL must point to a Dataverse organization.");
  return parsed.origin;
}

assert.ok(baseUrl, "DATAVERSE_URL secret is required.");
assert.ok(statePath, "DYNAMICS_PLAYWRIGHT_STORAGE_STATE_PATH must point to a local Playwright storage-state JSON file.");
assert.ok(fs.existsSync(statePath), "The configured local Playwright storage-state file does not exist.");
const appOrigin = safeOrigin(appUrl);
assert.equal(appOrigin, safeOrigin(baseUrl), "DYNAMICS_APP_URL must use the same Dataverse origin as DATAVERSE_URL.");

let storageState;
try {
  storageState = JSON.parse(fs.readFileSync(statePath, "utf8"));
} catch {
  throw new Error("The configured local Playwright storage-state file is not valid JSON. Re-capture it using the helper.");
}
assert.ok(Array.isArray(storageState.cookies), "Storage state must contain a cookies array.");
assert.ok(Array.isArray(storageState.origins), "Storage state must contain an origins array.");

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "devlens-chromium-"));
let context;
try {
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    viewport: { width: 1440, height: 1000 },
    args: [
      `--disable-extensions-except=${process.cwd()}`,
      `--load-extension=${process.cwd()}`,
      "--no-first-run",
      "--no-default-browser-check"
    ]
  });
  if (storageState.cookies.length) await context.addCookies(storageState.cookies);
  const localStorageByOrigin = Object.fromEntries(storageState.origins.map(item => [
    item.origin,
    (item.localStorage || []).map(entry => [entry.name, entry.value])
  ]));
  await context.addInitScript((entries) => {
    const pairs = entries[location.origin];
    if (!pairs || location.protocol !== "https:") return;
    try {
      for (const [key, value] of pairs) localStorage.setItem(key, value);
    } catch { /* Storage may be unavailable on unrelated origins. */ }
  }, localStorageByOrigin);

  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message.slice(0, 200)));
  await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
  await page.waitForTimeout(2500);

  assert.equal(new URL(page.url()).origin, appOrigin, "Navigation left the configured Dataverse organization.");
  assert.doesNotMatch(page.url(), /login\.microsoftonline\.com|login\.windows\.net/i,
    "Browser was redirected to sign-in; refresh the saved test-user storage state.");
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
      status: root?.querySelector(".ss-status")?.textContent?.slice(0, 200) || "",
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
    scope: "authenticated Chromium + unpacked extension + Query Studio UI + background queryExecute + Dataverse read-only SQL",
    organization: appOrigin,
    query: "SELECT TOP 1 accountid FROM account",
    returnedRows: outcome.rowCount,
    requestedColumnPresent: true,
    pageErrors: 0
  }));
} finally {
  if (context) await context.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}
