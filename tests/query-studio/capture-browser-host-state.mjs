import readline from "node:readline/promises";
import fs from "node:fs";
import { stdin, stderr } from "node:process";
import { chromium } from "playwright";

const baseUrl = (process.env.DATAVERSE_URL || "").replace(/\/+$/, "");
const appUrl = process.env.DYNAMICS_APP_URL || (baseUrl ? baseUrl + "/main.aspx" : "");
if (!baseUrl || !appUrl) throw new Error("Set DATAVERSE_URL and optionally DYNAMICS_APP_URL before capturing a browser session.");

const base = new URL(baseUrl);
const app = new URL(appUrl);
if (base.protocol !== "https:" || app.protocol !== "https:" || base.origin !== app.origin) {
  throw new Error("Both URLs must use HTTPS and point to the same Dataverse organization.");
}

const browser = await chromium.launch({ headless: false });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
  console.error("Sign in to the dedicated Dynamics test user in the opened Chromium window.");
  console.error("Complete any MFA prompts, then return here after the model-driven app has loaded.");
  const rl = readline.createInterface({ input: stdin, output: stderr });
  await rl.question("Press Enter only after you can see the authenticated Dynamics app: ");
  rl.close();

  const authenticated = await page.evaluate(() => Boolean(window.Xrm?.Utility?.getGlobalContext));
  if (!authenticated || new URL(page.url()).origin !== base.origin) {
    throw new Error("Dynamics authentication was not confirmed. No storage state was emitted.");
  }
  const fullState = await context.storageState();
  // Keep only cookies scoped to this Dataverse organization / Dynamics domain and
  // localStorage for the organization origin. Avoid carrying unrelated Microsoft
  // sign-in, telemetry, and other application sessions into the CI secret.
  const organizationHost = base.hostname.toLowerCase();
  const relevantCookies = fullState.cookies.filter(cookie => {
    const domain = cookie.domain.replace(/^\./, "").toLowerCase();
    return organizationHost === domain ||
      organizationHost.endsWith("." + domain) ||
      domain === "dynamics.com" ||
      domain.endsWith(".dynamics.com") && organizationHost.endsWith("." + domain);
      domain === "login.microsoftonline.com" ||
      domain.endsWith(".login.microsoftonline.com") ||
      domain === "login.windows.net" ||
      domain.endsWith(".login.windows.net");
  });
  const state = {
    cookies: relevantCookies,
    origins: fullState.origins.filter(entry => {
      try { return new URL(entry.origin).origin === base.origin; }
      catch { return false; }
    })
  };
  const outputPath = process.env.DYNAMICS_PLAYWRIGHT_STORAGE_STATE_PATH;
  if (!outputPath) throw new Error("Set DYNAMICS_PLAYWRIGHT_STORAGE_STATE_PATH to a protected path outside the repository, for example D:\\query-studio-browser-state.json.");
  // This file contains bearer session cookies. Keep it outside source control and restrict
  // filesystem access to the Windows account that runs the self-hosted runner.
  fs.writeFileSync(outputPath, JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
  console.error(`Filtered session state saved locally: ${state.cookies.length} organization-related cookies, ${state.origins.length} origin(s).`);
  console.error("Session state was not printed. Treat the file as a password; it may expire and must be deleted when no longer needed.");
} finally {
  await browser.close();
}
