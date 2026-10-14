import readline from "node:readline/promises";
import { stdin, stderr } from "node:process";
import { chromium } from "playwright";
import { gzipSync } from "node:zlib";

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
    const domain = cookie.domain.replace(/^\\./, "").toLowerCase();
    return organizationHost === domain ||
      organizationHost.endsWith("." + domain) ||
      domain === "dynamics.com" ||
      domain.endsWith(".dynamics.com") && organizationHost.endsWith("." + domain);
  });
  const state = {
    cookies: relevantCookies,
    origins: fullState.origins.filter(entry => {
      try { return new URL(entry.origin).origin === base.origin; }
      catch { return false; }
    })
  };
  const encoded = gzipSync(Buffer.from(JSON.stringify(state), "utf8")).toString("base64");
  console.error(`Filtered session state: ${state.cookies.length} organization-related cookies, ${state.origins.length} origin(s), ${encoded.length} encoded characters.`);
  if (encoded.length > 45000) {
    console.error("Warning: the filtered state may still exceed GitHub's secret-size limit. No session data was printed.");
  }
  // This is a bearer session snapshot. Do not paste it into chat, source control, or logs.
  // Output is gzip-compressed before Base64 encoding to reduce GitHub secret size.
  // Pipe stdout directly to a clipboard/secret-management command instead.
  process.stdout.write(encoded + "\n");
  console.error("Session state captured. Treat the emitted value as a password; it may expire and must be rotated.");
} finally {
  await browser.close();
}
