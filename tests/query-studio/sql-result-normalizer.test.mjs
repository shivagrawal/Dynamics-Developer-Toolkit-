import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const normalizer = require("../../sqlstudio/js/sql-result-normalizer.js");

test("normalizes native SQL rows while preserving order, alias casing, SQL NULL and provider metadata", () => {
  const result = normalizer.normalizeResult({
    ok: true,
    provider: "dataverse-native-sql",
    columns: ["AccountId", "DisplayName", "AliasCase"],
    rows: [
      { AccountId: "a1", DisplayName: null, AliasCase: "Alpha" },
      { AccountId: "a2", DisplayName: "Second", AliasCase: null }
    ],
    rowCount: 2,
    durationMs: 18,
    totalRecordCount: 2,
    warnings: ["Native provider warning"],
    compatibilityMode: "native-sql"
  });

  assert.equal(result.ok, true);
  assert.equal(result.provider, "dataverse-native-sql");
  assert.deepEqual(result.columns, [
    { name: "AccountId", label: "AccountId" },
    { name: "DisplayName", label: "DisplayName" },
    { name: "AliasCase", label: "AliasCase" }
  ]);
  assert.deepEqual(result.rows, [
    { AccountId: "a1", DisplayName: null, AliasCase: "Alpha" },
    { AccountId: "a2", DisplayName: "Second", AliasCase: null }
  ]);
  assert.equal(result.durationMs, 18);
  assert.equal(result.totalRecordCount, 2);
  assert.deepEqual(result.warnings, ["Native provider warning"]);
  assert.equal(result.compatibilityMode, "native-sql");
});

test("preserves descriptor labels, alias casing, logical names and data types", () => {
  const result = normalizer.normalizeResult({
    provider: "dataverse-fetchxml-js-engine",
    columns: [
      { name: "ContactName", label: "ContactName", logicalName: "fullname", dataType: "String" },
      { name: "AccountLabel", label: "Account Label", logicalName: "name", dataType: "String" }
    ],
    rows: [{ ContactName: "Alex", AccountLabel: "Contoso" }]
  });

  assert.deepEqual(result.columns, [
    { name: "ContactName", label: "ContactName", logicalName: "fullname", dataType: "String" },
    { name: "AccountLabel", label: "Account Label", logicalName: "name", dataType: "String" }
  ]);
  assert.deepEqual(result.rows, [{ ContactName: "Alex", AccountLabel: "Contoso" }]);
});

test("duplicate output labels retain distinct canonical row keys and values", () => {
  const result = normalizer.normalizeResult({
    provider: "dataverse-security-query-adapter",
    columns: [
      { name: "user_fullname", label: "Name" },
      { name: "role_name", label: "Name" }
    ],
    rows: [{ user_fullname: "Taylor", role_name: "Sales Representative" }]
  });

  assert.deepEqual(result.columns, [
    { name: "user_fullname", label: "Name" },
    { name: "role_name", label: "Name" }
  ]);
  assert.deepEqual(result.rows, [{
    user_fullname: "Taylor",
    role_name: "Sales Representative"
  }]);
});

test("handles prototype-like column keys as ordinary data in canonical and legacy rows", () => {
  const sourceRow = Object.create(null);
  sourceRow["__proto__"] = "literal column value";
  const canonical = normalizer.normalizeResult({
    columns: ["__proto__"],
    rows: [sourceRow]
  });
  const legacy = normalizer.toLegacyResult(canonical);

  assert.equal(Object.hasOwn(canonical.rows[0], "__proto__"), true);
  assert.equal(canonical.rows[0]["__proto__"], "literal column value");
  assert.equal(Object.hasOwn(legacy.rows[0], "__proto__"), true);
  assert.equal(legacy.rows[0]["__proto__"], "literal column value");
});

test("legacy adapter disambiguates duplicate labels without losing either value", () => {
  const canonical = normalizer.normalizeResult({
    provider: "dataverse-security-query-adapter",
    columns: [
      { name: "user_fullname", label: "Name" },
      { name: "role_name", label: "Name" },
      { name: "business_unit", label: "Name (2)" }
    ],
    rows: [{
      user_fullname: "Taylor",
      role_name: "Sales Representative",
      business_unit: "West"
    }]
  });
  const legacy = normalizer.toLegacyResult(canonical);

  assert.deepEqual(legacy.columns, ["Name", "Name (2)", "Name (2) (2)"]);
  assert.deepEqual(legacy.rows, [{
    Name: "Taylor",
    "Name (2)": "Sales Representative",
    "Name (2) (2)": "West"
  }]);
  assert.deepEqual(legacy.columnDescriptors, canonical.columns);
});

test("preserves known columns for empty and null-only results", () => {
  const empty = normalizer.normalizeResult({
    provider: "dataverse-fetchxml-js-engine",
    columns: [{ name: "fullname", label: "FullName", dataType: "String" }],
    rows: [],
    totalRecordCount: 0
  });
  const nullOnly = normalizer.normalizeResult({
    provider: "dataverse-native-sql",
    columns: ["optional_value"],
    rows: [{ optional_value: null }]
  });

  assert.deepEqual(empty.columns, [{ name: "fullname", label: "FullName", dataType: "String" }]);
  assert.deepEqual(empty.rows, []);
  assert.equal(empty.totalRecordCount, 0);
  assert.deepEqual(nullOnly.columns, [{ name: "optional_value", label: "optional_value" }]);
  assert.deepEqual(nullOnly.rows, [{ optional_value: null }]);
});

test("does not conflate unknown total count with an exact zero", () => {
  const unknown = normalizer.normalizeResult({
    provider: "dataverse-native-sql",
    columns: ["id"],
    rows: []
  });
  const zero = normalizer.normalizeResult({
    provider: "dataverse-native-sql",
    columns: ["id"],
    rows: [],
    totalRecordCount: 0
  });
  const invalid = normalizer.normalizeResult({
    provider: "dataverse-native-sql",
    columns: ["id"],
    rows: [],
    totalRecordCount: -1
  });

  assert.equal(Object.hasOwn(unknown, "totalRecordCount"), false);
  assert.equal(zero.totalRecordCount, 0);
  assert.equal(Object.hasOwn(invalid, "totalRecordCount"), false);
});

test("accepts explicit count aliases but never infers a count from returned rows", () => {
  const explicit = normalizer.normalizeResult({
    columns: ["id"], rows: [{ id: 1 }], totalCount: "7"
  });
  const inferred = normalizer.normalizeResult({
    columns: ["id"], rows: [{ id: 1 }, { id: 2 }]
  });

  assert.equal(explicit.totalRecordCount, 7);
  assert.equal(Object.hasOwn(inferred, "totalRecordCount"), false);
});

test("keeps truncation distinct from paging and always supplies a warning when partial", () => {
  const result = normalizer.normalizeResult({
    provider: "dataverse-security-query-adapter",
    columns: ["id"],
    rows: [{ id: 1 }],
    truncated: true,
    totalRecordCount: 100
  });
  const paged = normalizer.normalizeResult({
    provider: "dataverse-fetchxml-js-engine",
    columns: ["id"],
    rows: [{ id: 1 }],
    pagesFetched: 2,
    moreRecords: false
  });

  assert.equal(result.truncated, true);
  assert.match(result.warnings[0], /incomplete/i);
  assert.equal(paged.truncated, false);
  assert.equal(paged.diagnostics.pagesRead, 2);
});

test("normalizes warning arrays, removes duplicates, and bounds warning text", () => {
  const result = normalizer.normalizeResult({
    columns: [], rows: [],
    warnings: ["One warning", "One warning", "  Another\nwarning  ", "x".repeat(600)]
  });

  assert.equal(result.warnings.length, 3);
  assert.equal(result.warnings[0], "One warning");
  assert.equal(result.warnings[1], "Another warning");
  assert.equal(result.warnings[2].length, 500);
});

test("uses an explicit measured duration when provided and rejects invalid durations", () => {
  assert.equal(normalizer.normalizeResult({ columns: [], rows: [], durationMs: 9 }, { durationMs: 27 }).durationMs, 27);
  assert.equal(normalizer.normalizeResult({ columns: [], rows: [], durationMs: -2 }).durationMs, 0);
  assert.equal(normalizer.normalizeResult({ columns: [], rows: [] }).durationMs, 0);
});

test("only retains plan summaries explicitly marked safe and preserves page diagnostics", () => {
  const hidden = normalizer.normalizeResult({
    columns: [], rows: [],
    diagnostics: { planSummary: "SELECT customer secret FROM account", pagesRead: 3 }
  });
  const safe = normalizer.normalizeResult({
    columns: [], rows: [],
    diagnostics: { safe: true, planSummary: "native SQL, one page", pagesRead: 3 }
  });

  assert.deepEqual(hidden.diagnostics, { pagesRead: 3 });
  assert.deepEqual(safe.diagnostics, { pagesRead: 3, planSummary: "native SQL, one page" });
});

test("native SQL, FetchXML and security adapter fixtures normalize to the same result envelope", () => {
  const fixtures = [
    {
      provider: "dataverse-native-sql",
      columns: ["id", "name"],
      rows: [{ id: "n1", name: null }]
    },
    {
      provider: "dataverse-fetchxml-js-engine",
      columns: [{ name: "id", label: "id", logicalName: "accountid", dataType: "Uniqueidentifier" }, "name"],
      rows: [{ id: "f1", name: null }],
      pagesFetched: 1
    },
    {
      provider: "dataverse-security-query-adapter",
      compatibilityMode: "user-roles",
      columns: ["fullname", "role_name"],
      rows: [{ fullname: "Taylor", role_name: "Sales" }],
      truncated: true,
      warning: "Results may be incomplete."
    }
  ];

  for (const fixture of fixtures) {
    const result = normalizer.normalizeResult(fixture);
    assert.equal(result.ok, true);
    assert.equal(typeof result.provider, "string");
    assert.ok(Array.isArray(result.columns));
    assert.ok(Array.isArray(result.rows));
    assert.equal(typeof result.truncated, "boolean");
    assert.equal(typeof result.durationMs, "number");
    assert.ok(Array.isArray(result.warnings));
    for (const column of result.columns) {
      assert.equal(typeof column.name, "string");
      assert.equal(typeof column.label, "string");
    }
  }
});

test("legacy adapter preserves provider, context, warning, truncation and unknown-count semantics", () => {
  const result = normalizer.normalizeResult({
    provider: "dataverse-security-query-adapter",
    compatibilityMode: "record-audit",
    clientUrl: "https://example.crm.dynamics.com/path?token=ignored",
    environmentId: "env-123",
    currentUser: { id: "user-1", name: "QA User" },
    columns: ["auditid"],
    rows: [{ auditid: "audit-1" }],
    truncated: true,
    warning: "Refine this query."
  });
  const legacy = normalizer.toLegacyResult(result);

  assert.equal(legacy.provider, "dataverse-security-query-adapter");
  assert.equal(legacy.compatibilityMode, "record-audit");
  assert.equal(legacy.clientUrl, "https://example.crm.dynamics.com");
  assert.equal(legacy.environmentId, "env-123");
  assert.deepEqual(legacy.currentUser, { id: "user-1", name: "QA User" });
  assert.equal(legacy.truncated, true);
  assert.equal(legacy.warning, "Refine this query.");
  assert.equal(Object.hasOwn(legacy, "totalRecordCount"), false);
});

const errorCases = [
  ["SQL_SYNTAX", "SQL_SYNTAX_ERROR", false],
  ["SQL_UNSUPPORTED", "UNSUPPORTED_SECURITY_SQL_SHAPE", false],
  ["READ_ONLY_POLICY", "QUERY_LIMIT_EXCEEDED", false],
  ["METADATA", "METADATA_ERROR", false],
  ["AUTHENTICATION", "AUTHENTICATION_FAILED", false],
  ["AUTHORIZATION", "FORBIDDEN", false],
  ["THROTTLED", "SERVICE_PROTECTION", true],
  ["TIMEOUT", "ETIMEDOUT", true],
  ["TRANSPORT", "NETWORK_ERROR", true],
  ["DATAVERSE", "DATAVERSE_ERROR", false],
  ["INTERNAL", "INTERNAL_ERROR", false]
];

test("normalizes every canonical error category with stable safe messages", async t => {
  for (const [category, code, retryable] of errorCases) {
    await t.test(category, () => {
      const error = normalizer.normalizeError({
        code,
        provider: "dataverse-native-sql",
        message: "Sensitive row value: TOPSECRET; bearer token: abc123",
        stack: "TOPSECRET stack trace",
        details: { body: "TOPSECRET" },
        requestId: "request-123"
      });
      assert.equal(error.ok, false);
      assert.equal(error.category, category);
      assert.equal(error.retryable, retryable);
      assert.equal(error.fallbackEligible, false);
      assert.equal(error.provider, "dataverse-native-sql");
      assert.equal(error.detailsSafe.requestId, "request-123");
      assert.doesNotMatch(JSON.stringify(error), /TOPSECRET|abc123|stack trace/i);
      assert.ok(error.message.length > 0);
    });
  }
});

test("retryability is independent of fallback eligibility", () => {
  const timeout = normalizer.normalizeError({ code: "TIMEOUT" });
  const syntax = normalizer.normalizeError({ code: "SQL_SYNTAX" });
  assert.equal(timeout.retryable, true);
  assert.equal(timeout.fallbackEligible, false);
  assert.equal(syntax.retryable, false);
  assert.equal(syntax.fallbackEligible, false);
});

test("classifies only explicit status codes and timeout names, not message text", () => {
  assert.equal(normalizer.normalizeError({ status: 401, message: "unauthorized" }).category, "AUTHENTICATION");
  assert.equal(normalizer.normalizeError({ statusCode: 403 }).category, "AUTHORIZATION");
  assert.equal(normalizer.normalizeError({ status: 429 }).category, "THROTTLED");
  assert.equal(normalizer.normalizeError({ name: "AbortError" }).category, "TIMEOUT");
  assert.equal(normalizer.normalizeError({ message: "HTTP 401 timeout" }).category, "INTERNAL");
});

test("unknown provider errors become safe INTERNAL errors without copying payloads", () => {
  const error = normalizer.normalizeError({
    code: "SOME_PRIVATE_BACKEND_CODE",
    message: "Customer Name: Alice; response body includes secret data",
    stack: "private stack",
    response: { body: "private body" }
  });

  assert.equal(error.category, "INTERNAL");
  assert.equal(error.code, "INTERNAL");
  assert.equal(error.message, "Query Studio could not complete the request.");
  assert.doesNotMatch(JSON.stringify(error), /Alice|secret data|private stack|private body|SOME_PRIVATE_BACKEND_CODE/);
});

test("preserves safe correlation IDs and discards unsafe diagnostic identifiers", () => {
  const error = normalizer.normalizeError({
    code: "DATAVERSE",
    correlationId: "corr-123:abc",
    requestId: "Bearer-secret"
  });

  assert.deepEqual(error.detailsSafe, { correlationId: "corr-123:abc" });
});

test("normalizeOutcome selects success or safe error normalization", () => {
  const success = normalizer.normalizeOutcome({
    ok: true, provider: "dataverse-native-sql", columns: ["id"], rows: []
  });
  const failure = normalizer.normalizeOutcome({
    ok: false, code: "AUTHENTICATION_FAILED", message: "raw service message"
  });

  assert.equal(success.ok, true);
  assert.equal(failure.ok, false);
  assert.equal(failure.category, "AUTHENTICATION");
  assert.doesNotMatch(failure.message, /raw service message/i);
});

test("normalizer rejects failure inputs passed to the success-only and legacy adapters", () => {
  assert.throws(() => normalizer.normalizeResult({ ok: false, error: "failed" }), /successful provider result/);
  assert.throws(() => normalizer.toLegacyResult({ ok: false }), /normalized successful result/);
});
