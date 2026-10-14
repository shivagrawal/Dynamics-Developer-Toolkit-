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
  // Chromium extension loading is not reliable in headless mode; the runner is a dedicated Windows browser host.
  context = await chromium.launchPersistentContext(path.resolve(profilePath), {
    headless: false,
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
  // Xrm is a page-world API, but extension content scripts run in an isolated
  // JavaScript world. Verify Xrm in page.evaluate and exercise DevLens through its
  // actual injected UI instead of expecting extension globals on the page window.
  await page.waitForFunction(() => Boolean(window.Xrm?.Utility?.getGlobalContext), null, { timeout: 45000 });
  const clientUrl = await page.evaluate(() => window.Xrm.Utility.getGlobalContext().getClientUrl());
  assert.equal(safeOrigin(clientUrl), appOrigin, "Xrm reports a different Dataverse organization.");

  // The registered Alt+P command sends DEVLENS_MINIMIZE. When the panel is
  // initially hidden, the first invocation creates it in minimized state; the
  // second invocation restores the full panel so its navigation tabs are visible.
  await page.keyboard.press("Alt+p");
  await page.waitForTimeout(500);
  await page.keyboard.press("Alt+p");
  const sqlStudioTab = page.locator('[data-view="sqlstudio"]');
  await sqlStudioTab.waitFor({ state: "visible", timeout: 45000 });
  await sqlStudioTab.click();
  const editor = page.locator(".ss-editor");
  await editor.waitFor({ state: "visible", timeout: 30000 });
  await editor.fill("SELECT TOP 1 accountid FROM account");
  await page.locator('[data-act="execute"]').click();
  const outcomeSignal = page.locator(".ss-error, .ss-results table").first();
  await outcomeSignal.waitFor({ state: "visible", timeout: 120000 });

  const errorVisible = await page.locator(".ss-error").count() > 0;
  const resultTable = page.locator(".ss-results table");
  const resultTableVisible = await resultTable.count() > 0;
  const columns = resultTableVisible ? await page.locator(".ss-results thead th").allTextContents() : [];
  const rowCount = resultTableVisible ? await page.locator(".ss-results tbody tr").count() : 0;
  const outcome = { errorVisible, resultTableVisible, columns, rowCount };
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
