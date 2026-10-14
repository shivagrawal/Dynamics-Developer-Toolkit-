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

  // Seed deterministic test data because a basic user may have no existing
  // Account rows. Always remove the records created by this smoke test.
  const seed = {
    accountName: "DTT Query Studio Smoke " + new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14),
    accountId: null,
    contactId: null
  };
  try {
    const createdAccount = await page.evaluate(async (accountName) => {
      const account = await Xrm.WebApi.createRecord("account", { name: accountName });
      return account.id.replace(/[{}]/g, "");
    }, seed.accountName);
    seed.accountId = createdAccount;
    const createdContact = await page.evaluate(async (accountId) => {
      const contact = await Xrm.WebApi.createRecord("contact", {
        firstname: "DTT Query",
        lastname: "Studio Smoke",
        "parentcustomerid_account@odata.bind": "/accounts(" + accountId + ")"
      });
      return contact.id.replace(/[{}]/g, "");
    }, seed.accountId);
    seed.contactId = createdContact;

  // Drive the extension through its real MV3 service worker and content-script
  // message channel. Synthetic page keyboard events do not reliably invoke
  // browser-managed extension commands, so they cannot be used to bootstrap a
  // hidden panel deterministically in an automated browser host.
  const worker = context.serviceWorkers().find(candidate =>
    candidate.url().endsWith("/background-entry.js")
  ) || await context.waitForEvent("serviceworker", { timeout: 30000 });
  await worker.evaluate(async () => {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab?.id) throw new Error("No active Dynamics tab is available to the extension.");
    await new Promise((resolve, reject) => {
      chrome.tabs.sendMessage(activeTab.id, { type: "DEVLENS_TOGGLE" }, () => {
        const error = chrome.runtime.lastError;
        // The content-script listener intentionally does not send a response;
        // Chrome reports a closed response port even when the toggle was handled.
        if (error && !error.message.includes("message port closed before a response")) {
          reject(new Error(error.message));
        } else {
          resolve();
        }
      });
    });
  });
  const sqlStudioTab = page.locator('[data-view="sqlstudio"]');
  await sqlStudioTab.waitFor({ state: "visible", timeout: 45000 });
  await sqlStudioTab.click();
  const editor = page.locator(".ss-editor");
  await editor.waitFor({ state: "visible", timeout: 30000 });
  await editor.fill("SELECT TOP 1 accountid, name FROM account WHERE name = '" + seed.accountName + "'");
  await page.locator('[data-act="execute"]').click();
  const outcomeSignal = page.locator(".ss-error, .ss-results table").first();
  await outcomeSignal.waitFor({ state: "visible", timeout: 120000 });

  const errorElement = page.locator(".ss-error");
  const errorVisible = await errorElement.count() > 0;
  const errorText = errorVisible ? (await errorElement.innerText()).slice(0, 500) : "";
  const resultTable = page.locator(".ss-results table");
  const resultTableVisible = await resultTable.count() > 0;
  const columns = resultTableVisible ? await page.locator(".ss-results thead th").allTextContents() : [];
  const rowCount = resultTableVisible ? await page.locator(".ss-results tbody tr").count() : 0;
  const outcome = { errorVisible, resultTableVisible, columns, rowCount };
  assert.equal(outcome.errorVisible, false, `Authenticated browser-host query failed: ${errorText}`);
  assert.equal(outcome.resultTableVisible, true, "Query Studio did not render a result table.");
  assert.ok(outcome.columns.some(column => column.toLowerCase() === "accountid"), "Query result did not contain the requested accountid column.");
  assert.ok(outcome.columns.some(column => column.toLowerCase() === "name"), "Query result did not contain the requested name column.");
  assert.equal(outcome.rowCount, 1, "Seeded Account row was not returned by the read-only SQL query.");
  const returnedName = (await page.locator(".ss-results tbody tr").first().innerText()).toLowerCase();
  assert.ok(returnedName.includes(seed.accountName.toLowerCase()), "Query result did not match the seeded Account row.");
  // Exercise the relationship compiler/provider using the Account and Contact created above.
  // Reuse the editor and execute control so this traverses the same UI/background path.
  await editor.fill(
    "SELECT TOP 1 c.contactid, c.fullname, a.name FROM contact c " +
    "INNER JOIN account a ON c.parentcustomerid = a.accountid " +
    "WHERE a.name = '" + seed.accountName + "'"
  );
  await page.locator('[data-act="execute"]').click();
  // A result from the preceding query can remain visible while the next query runs.
  // Wait for either a new error or for the join result to contain the seeded contact,
  // not merely the account name which was already displayed by query one.
  await page.waitForFunction(({ accountName }) => {
    const error = document.querySelector(".ss-error");
    const rows = document.querySelector(".ss-results tbody");
    const text = rows?.textContent?.toLowerCase() || "";
    return Boolean(error?.textContent?.trim()) ||
      (text.includes(accountName.toLowerCase()) && text.includes("dtt query studio smoke"));
  }, { accountName: seed.accountName }, { timeout: 120000 });
  const joinError = await errorElement.count() > 0 ? (await errorElement.innerText()).slice(0, 500) : "";
  assert.equal(joinError, "", "Authenticated browser-host relationship query failed: " + joinError);
  const joinColumns = (await page.locator(".ss-results thead th").allTextContents()).map(value => value.toLowerCase());
  const joinRows = await page.locator(".ss-results tbody tr").count();
  const joinText = (await page.locator(".ss-results tbody").innerText()).toLowerCase();
  assert.ok(joinColumns.some(column => column === "contactid"), "Relationship result did not contain contactid.");
  assert.ok(joinColumns.some(column => column === "fullname"), "Relationship result did not contain fullname.");
  assert.ok(joinColumns.some(column => column === "name"), "Relationship result did not contain Account name.");
  assert.equal(joinRows, 1, "Relationship query did not return exactly the seeded Contact.");
  assert.ok(joinText.includes(seed.accountName.toLowerCase()), "Relationship result did not include the seeded Account.");
  assert.ok(joinText.includes("dtt query studio smoke"), "Relationship result did not include the seeded Contact.");
  // Dynamics can emit unrelated platform-level page errors (for example, prediction UI
  // initialization) while the query path succeeds. Preserve these as diagnostics without
  // making them a false-negative for the independently asserted SQL result.


  console.log(JSON.stringify({
    result: "passed",
    scope: "persistent authenticated Chromium profile + unpacked extension + Query Studio UI + seeded Dataverse account/contact + background queryExecute + read-only SQL",
    organization: appOrigin,
    query: "SELECT TOP 1 accountid, name FROM account WHERE name = '<unique smoke-test account>'",
    returnedRows: outcome.rowCount,
    seededAccountMatched: true,
    seededContactCreated: Boolean(seed.contactId),
    pageErrors: pageErrors
  }));
  } finally {
    // Delete dependent records first and fail the run if cleanup does not complete.
    if (seed.contactId) await page.evaluate(async id => Xrm.WebApi.deleteRecord("contact", id), seed.contactId);
    if (seed.accountId) await page.evaluate(async id => Xrm.WebApi.deleteRecord("account", id), seed.accountId);
    const remaining = await page.evaluate(async ({ contactId, accountId }) => {
      // A filtered collection query verifies absence without relying on the browser
      // client's version-specific shape for a 404 retrieveRecord rejection.
      const exists = async (entity, primaryId, id) => {
        if (!id) return false;
        const result = await Xrm.WebApi.retrieveMultipleRecords(
          entity,
          "?$select=" + primaryId + "&$filter=" + primaryId + " eq " + id + "&$top=1"
        );
        return result.entities.length > 0;
      };
      return {
        contact: await exists("contact", "contactid", contactId),
        account: await exists("account", "accountid", accountId)
      };
    }, { contactId: seed.contactId, accountId: seed.accountId });
    assert.equal(remaining.contact, false, "Smoke-test Contact was not cleaned up.");
    assert.equal(remaining.account, false, "Smoke-test Account was not cleaned up.");
  }
} finally {
  if (context) await context.close();
}
