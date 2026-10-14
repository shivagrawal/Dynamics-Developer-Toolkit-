import readline from "node:readline/promises";
import fs from "node:fs";
import path from "node:path";
import { stdin, stderr } from "node:process";
import { chromium } from "playwright";

const baseUrl = (process.env.DATAVERSE_URL || "").replace(/\/+$/, "");
const appUrl = process.env.DYNAMICS_APP_URL || (baseUrl ? baseUrl + "/main.aspx" : "");
const statePath = process.env.DYNAMICS_PLAYWRIGHT_STORAGE_STATE_PATH || "";
const profilePath = process.env.DYNAMICS_PLAYWRIGHT_PROFILE_PATH ||
  (statePath ? path.join(path.dirname(path.resolve(statePath)), "query-studio-browser-profile") : "");
if (!baseUrl || !appUrl) throw new Error("Set DATAVERSE_URL and optionally DYNAMICS_APP_URL before capturing a browser session.");
if (!statePath) throw new Error("Set DYNAMICS_PLAYWRIGHT_STORAGE_STATE_PATH to a protected path outside the repository.");
if (!profilePath) throw new Error("Set DYNAMICS_PLAYWRIGHT_PROFILE_PATH to a protected profile directory outside the repository.");

const base = new URL(baseUrl);
const app = new URL(appUrl);
if (base.protocol !== "https:" || app.protocol !== "https:" || base.origin !== app.origin) {
  throw new Error("Both URLs must use HTTPS and point to the same Dataverse organization.");
}
if (path.resolve(profilePath).startsWith(path.resolve(process.cwd()) + path.sep)) {
  throw new Error("The browser profile must be outside the repository to prevent committing authentication material.");
}

fs.mkdirSync(path.dirname(path.resolve(profilePath)), { recursive: true });
const context = await chromium.launchPersistentContext(path.resolve(profilePath), {
  headless: false,
  viewport: { width: 1440, height: 1000 },
  args: ["--no-first-run", "--no-default-browser-check"]
});
try {
  const page = await context.newPage();
  await page.goto(appUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
  console.error("Sign in to the dedicated Dynamics test user in the opened Chromium window.");
  console.error("Complete any MFA prompts, then return here after the model-driven app has loaded.");
  const rl = readline.createInterface({ input: stdin, output: stderr });
  await rl.question("Press Enter only after you can see the authenticated Dynamics app: ");
  rl.close();

  const authenticated = await page.evaluate(() => Boolean(window.Xrm?.Utility?.getGlobalContext));
  if (!authenticated || new URL(page.url()).origin !== base.origin) {
    throw new Error("Dynamics authentication was not confirmed. The browser profile was retained for diagnosis.");
  }

  // Keep a filtered diagnostic snapshot for compatibility, but the smoke test now
  // reuses the persistent Chromium profile so browser-managed authentication state
  // (including storage not represented by Playwright storageState) is preserved.
  const fullState = await context.storageState();
  const organizationHost = base.hostname.toLowerCase();
  const relevantCookies = fullState.cookies.filter(cookie => {
    const domain = cookie.domain.replace(/^\./, "").toLowerCase();
    return organizationHost === domain ||
      organizationHost.endsWith("." + domain) ||
      domain === "dynamics.com" ||
      (domain.endsWith(".dynamics.com") && organizationHost.endsWith("." + domain)) ||
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
  fs.writeFileSync(path.resolve(statePath), JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
  console.error("Authenticated persistent Chromium profile saved locally; diagnostic storage-state snapshot also refreshed.");
  console.error("The profile contains authentication material. Keep it outside source control, restrict filesystem access, and delete it when no longer needed.");
} finally {
  await context.close();
}
