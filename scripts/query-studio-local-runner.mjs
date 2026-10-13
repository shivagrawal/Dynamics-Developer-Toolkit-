#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const known = new Set(["--live", "--live-semantic", "--live-audit"]);
for (const arg of args) {
  if (!known.has(arg)) {
    console.error(`Unknown option: ${arg}`);
    process.exit(2);
  }
}
if (args.has("--live-semantic") && !args.has("--live")) {
  console.error("--live-semantic also requires --live.");
  process.exit(2);
}
if (args.has("--live-audit") && !args.has("--live")) {
  console.error("--live-audit also requires --live.");
  process.exit(2);
}
if (args.has("--live-audit") && process.env.ALLOW_LIVE_AUDIT_TESTS !== "1") {
  console.error("Audit tests are opt-in. Set ALLOW_LIVE_AUDIT_TESTS=1 for this invocation only after confirming dataverse-test is isolated and disposable.");
  process.exit(2);
}

const requiredSecrets = [
  "DATAVERSE_URL",
  "DATAVERSE_TENANT_ID",
  "DATAVERSE_CLIENT_ID",
  "DATAVERSE_CLIENT_SECRET"
];
const logDir = path.join(homedir(), "AppData", "Local", "DynamicsDeveloperToolkit", "QueryStudio", "logs");
mkdirSync(logDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const logFile = path.join(logDir, `query-studio-${stamp}.log`);
const write = (line) => {
  console.log(line);
  appendFileSync(logFile, line + "\n", "utf8");
};
const run = (label, command, commandArgs) => {
  write(`\n=== ${label} ===`);
  write(`Command: ${command} ${commandArgs.join(" ")}`);
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    env: process.env,
    encoding: "utf8",
    shell: false,
    windowsHide: true
  });
  if (result.stdout) write(result.stdout.trimEnd());
  if (result.stderr) write(result.stderr.trimEnd());
  if (result.error) write(`ERROR: ${result.error.message}`);
  const code = result.status ?? 1;
  write(`Exit code: ${code}`);
  return code === 0;
};

const syntaxFiles = [
  "background.js",
  "security-audit-service.js",
  "ui/sql-studio-view.js",
  "sqlstudio/js/sql-front-end.js",
  "sqlstudio/js/sql-engine.js",
  "sqlstudio/js/sql-policy.js",
  "sqlstudio/js/sql-result-normalizer.js",
  "tests/query-studio/on-demand-query.mjs",
  "tests/query-studio/live-semantic-matrix.mjs"
];
let passed = true;
for (const file of syntaxFiles) {
  if (!run(`Syntax: ${file}`, process.execPath, ["--check", file])) passed = false;
}
if (!run("Validate manifest JSON", process.execPath, [
  "-e",
  "JSON.parse(require('node:fs').readFileSync('manifest.json', 'utf8'))"
])) passed = false;

const suites = [
  "tests/query-studio/sql-engine.test.mjs",
  "tests/query-studio/sql-front-end.test.mjs",
  "tests/query-studio/query-studio-regression.test.mjs",
  "tests/query-studio/security-query-corpus.test.mjs",
  "tests/query-studio/security-query-adapter.test.mjs",
  "tests/query-studio/security-sql-routing.test.mjs",
  "tests/query-studio/sql-policy.test.mjs",
  "tests/query-studio/sql-studio-ui.test.mjs",
  "tests/query-studio/sql-result-normalizer.test.mjs"
];
if (!run("Offline Query Studio regression suite", process.execPath, ["--test", ...suites])) passed = false;

if (args.has("--live") || args.has("--live-semantic") || args.has("--live-audit")) {
  const missing = requiredSecrets.filter((key) => !process.env[key]);
  if (missing.length) {
    write(`LIVE TESTS NOT STARTED: missing required environment variables: ${missing.join(", ")}`);
    passed = false;
  } else {
    if (!run("Read-only Dataverse integration tests", process.execPath, [
      "--test", "tests/query-studio/dataverse-integration.test.mjs"
    ])) passed = false;

    if (args.has("--live-semantic")) {
      if (!process.env.SQL_QUERY) {
        write("LIVE SEMANTIC MATRIX NOT STARTED: set SQL_QUERY to a reviewed, bounded, read-only query.");
        passed = false;
      } else {
        if (!run("Bounded on-demand Dataverse SQL query", process.execPath, [
          "tests/query-studio/on-demand-query.mjs"
        ])) passed = false;
        if (!run("Dataverse live semantic matrix", process.execPath, [
          "tests/query-studio/live-semantic-matrix.mjs"
        ])) passed = false;
      }
    }

    if (args.has("--live-audit")) {
      write("WARNING: audit integration can alter persistent audit settings. Use only an isolated disposable Dataverse test environment and review the test file before enabling.");
      if (!run("Opt-in Dataverse security/audit integration tests", process.execPath, [
        "--test", "tests/query-studio/security-query-live.test.mjs"
      ])) passed = false;
    }
  }
} else {
  write("Live Dataverse tests were not requested; no Dataverse credentials were read or used.");
  write("To run read-only integration tests, pass --live. Semantic checks require --live --live-semantic and a reviewed SQL_QUERY. Audit tests require --live --live-audit and ALLOW_LIVE_AUDIT_TESTS=1.");
}

write(`\nRESULT: ${passed ? "PASS" : "FAIL"}`);
write(`Log file: ${logFile}`);
process.exit(passed ? 0 : 1);
