(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module && module.exports) module.exports = api;
  if (root) root.DevLensSqlResultNormalizer = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CATEGORIES = Object.freeze([
    "SQL_SYNTAX", "SQL_UNSUPPORTED", "READ_ONLY_POLICY", "METADATA",
    "AUTHENTICATION", "AUTHORIZATION", "THROTTLED", "TIMEOUT",
    "TRANSPORT", "DATAVERSE", "INTERNAL"
  ]);
  const ERROR_MESSAGES = Object.freeze({
    SQL_SYNTAX: "The SQL statement could not be parsed.",
    SQL_UNSUPPORTED: "This SQL query uses syntax or a query shape that is not supported.",
    READ_ONLY_POLICY: "The query was blocked by the read-only policy.",
    METADATA: "Dataverse metadata could not be retrieved or validated.",
    AUTHENTICATION: "Dataverse authentication failed. Sign in again and retry.",
    AUTHORIZATION: "You do not have permission to run this query in the current Dataverse environment.",
    THROTTLED: "Dataverse is limiting requests. Wait before retrying.",
    TIMEOUT: "The query timed out. It was not automatically replayed.",
    TRANSPORT: "The Dataverse service could not be reached. Check connectivity before retrying.",
    DATAVERSE: "Dataverse could not complete the query.",
    INTERNAL: "Query Studio could not complete the request."
  });
  const CODE_MAP = Object.freeze({
    SQL_SYNTAX: ["SQL_SYNTAX", "SQL_SYNTAX_ERROR", "SYNTAX_ERROR", "PARSE_ERROR"],
    SQL_UNSUPPORTED: ["SQL_UNSUPPORTED", "UNSUPPORTED_SQL", "UNSUPPORTED_SECURITY_SQL_SHAPE", "UNSUPPORTED_QUERY_SHAPE"],
    READ_ONLY_POLICY: ["READ_ONLY_POLICY", "QUERY_LIMIT_EXCEEDED", "POLICY_UNAVAILABLE", "MULTIPLE_STATEMENTS"],
    METADATA: ["METADATA", "METADATA_ERROR", "METADATA_UNAVAILABLE"],
    AUTHENTICATION: ["AUTHENTICATION", "AUTHENTICATION_FAILED", "UNAUTHENTICATED"],
    AUTHORIZATION: ["AUTHORIZATION", "AUTHORIZATION_FAILED", "FORBIDDEN"],
    THROTTLED: ["THROTTLED", "THROTTLING", "SERVICE_PROTECTION", "RATE_LIMITED"],
    TIMEOUT: ["TIMEOUT", "ETIMEDOUT", "ABORT_ERR", "ABORTERROR"],
    TRANSPORT: ["TRANSPORT", "TRANSPORT_ERROR", "NETWORK_ERROR", "FAILED_TO_FETCH"],
    DATAVERSE: ["DATAVERSE", "DATAVERSE_ERROR", "PROVIDER_ERROR"],
    INTERNAL: ["INTERNAL", "INTERNAL_ERROR", "UNEXPECTED_ERROR"]
  });
  const CODE_TO_CATEGORY = Object.create(null);
  for (const category of CATEGORIES) {
    for (const code of CODE_MAP[category]) CODE_TO_CATEGORY[code] = category;
  }

  function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function safeIdentifier(value, maxLength = 100) {
    if (typeof value !== "string") return "";
    const text = value.trim();
    return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(text) ? text.slice(0, maxLength) : "";
  }

  function nonNegativeInteger(value) {
    if (typeof value === "string" && /^\d+$/.test(value)) value = Number(value);
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  function safeWarning(value) {
    if (typeof value !== "string") return "";
    return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
  }

  function uniqueKey(baseValue, used) {
    const base = typeof baseValue === "string" && baseValue.length ? baseValue : "column";
    if (!used.has(base)) {
      used.add(base);
      return base;
    }
    let index = 2;
    let candidate = base + "__" + index;
    while (used.has(candidate)) candidate = base + "__" + (++index);
    used.add(candidate);
    return candidate;
  }

  function columnSource(column, index) {
    if (typeof column === "string") {
      const label = column.length ? column : "column_" + (index + 1);
      return { name: label, label, sourceKey: label };
    }
    const item = isRecord(column) ? column : {};
    const sourceKey = typeof item.sourceKey === "string" && item.sourceKey.length
      ? item.sourceKey
      : typeof item.name === "string" && item.name.length
        ? item.name
        : typeof item.label === "string" && item.label.length
          ? item.label
          : "column_" + (index + 1);
    const label = typeof item.label === "string" ? item.label : sourceKey;
    return {
      name: sourceKey,
      label: label.length ? label : "column_" + (index + 1),
      sourceKey,
      logicalName: typeof item.logicalName === "string" ? item.logicalName : undefined,
      dataType: typeof item.dataType === "string" ? item.dataType : undefined
    };
  }

  function inferColumns(input) {
    if (Array.isArray(input.columns)) return input.columns;
    const firstRow = Array.isArray(input.rows) ? input.rows.find(isRecord) : null;
    return firstRow ? Object.keys(firstRow) : [];
  }

  function normalizeResult(input, options = {}) {
    if (!isRecord(input) || input.ok === false) {
      throw new TypeError("normalizeResult expects a successful provider result object.");
    }
    const rawColumns = inferColumns(input);
    const usedNames = new Set();
    const sourceColumns = rawColumns.map(columnSource);
    const columns = sourceColumns.map(source => {
      const name = uniqueKey(source.name, usedNames);
      const descriptor = { name, label: source.label };
      if (source.logicalName !== undefined) descriptor.logicalName = source.logicalName;
      if (source.dataType !== undefined) descriptor.dataType = source.dataType;
      return { descriptor, sourceKey: source.sourceKey };
    });
    const rawRows = Array.isArray(input.rows) ? input.rows : [];
    const rows = rawRows.map(rawRow => {
      const row = {};
      columns.forEach((column, index) => {
        let value;
        if (Array.isArray(rawRow)) {
          value = rawRow[index];
        } else if (isRecord(rawRow)) {
          if (Object.prototype.hasOwnProperty.call(rawRow, column.sourceKey)) {
            value = rawRow[column.sourceKey];
          } else if (Object.prototype.hasOwnProperty.call(rawRow, column.descriptor.name)) {
            value = rawRow[column.descriptor.name];
          }
        }
        row[column.descriptor.name] = value === undefined ? null : value;
      });
      return row;
    });

    const result = {
      ok: true,
      provider: safeIdentifier(input.provider || options.provider) || "unknown",
      columns: columns.map(column => column.descriptor),
      rows,
      truncated: input.truncated === true ||
        input.totalRecordCountLimitExceeded === true ||
        input.moreRecords === true ||
        input.diagnostics?.truncated === true,
      durationMs: nonNegativeInteger(options.durationMs) ??
        nonNegativeInteger(input.durationMs) ?? 0,
      warnings: []
    };

    const countCandidates = [input.totalRecordCount, input.totalCount, input["@odata.count"]];
    for (const candidate of countCandidates) {
      const count = nonNegativeInteger(candidate);
      if (count !== null) {
        result.totalRecordCount = count;
        break;
      }
    }

    const warningValues = [];
    if (Array.isArray(input.warnings)) warningValues.push(...input.warnings);
    if (typeof input.warning === "string") warningValues.push(input.warning);
    for (const candidate of warningValues) {
      const warning = safeWarning(candidate);
      if (warning && !result.warnings.includes(warning) && result.warnings.length < 50) {
        result.warnings.push(warning);
      }
    }
    if (result.truncated && result.warnings.length === 0) {
      result.warnings.push("The result may be incomplete because a configured safety limit was reached.");
    }

    const diagnostics = isRecord(input.diagnostics) ? input.diagnostics : {};
    const pagesRead = nonNegativeInteger(diagnostics.pagesRead) ??
      nonNegativeInteger(input.pagesRead) ??
      nonNegativeInteger(input.pagesFetched);
    const planSummary = diagnostics.safe === true ? safeWarning(diagnostics.planSummary) : "";
    if (pagesRead !== null || planSummary) {
      result.diagnostics = {};
      if (pagesRead !== null) result.diagnostics.pagesRead = pagesRead;
      if (planSummary) result.diagnostics.planSummary = planSummary;
    }

    const compatibilityMode = safeIdentifier(input.compatibilityMode, 120);
    if (compatibilityMode) result.compatibilityMode = compatibilityMode;
    const clientUrl = typeof input.clientUrl === "string" ? input.clientUrl : "";
    if (clientUrl) {
      try {
        const parsed = new URL(clientUrl);
        if (parsed.protocol === "https:" || parsed.protocol === "http:") result.clientUrl = parsed.origin;
      } catch { /* Ignore malformed environment metadata. */ }
    }
    const environmentId = safeIdentifier(input.environmentId, 120);
    if (environmentId) result.environmentId = environmentId;
    if (isRecord(input.currentUser)) {
      const currentUser = {};
      const id = safeIdentifier(input.currentUser.id, 120);
      const name = typeof input.currentUser.name === "string" ? safeWarning(input.currentUser.name) : "";
      if (id) currentUser.id = id;
      if (name) currentUser.name = name;
      if (Object.keys(currentUser).length) result.currentUser = currentUser;
    }
    return result;
  }

  function uniqueLegacyLabels(columns) {
    const used = new Set();
    return columns.map(column => {
      const label = column.label || column.name || "column";
      if (!used.has(label)) {
        used.add(label);
        return label;
      }
      let suffix = 2;
      let candidate = label + " (" + suffix + ")";
      while (used.has(candidate)) candidate = label + " (" + (++suffix) + ")";
      used.add(candidate);
      return candidate;
    });
  }

  function toLegacyResult(normalized) {
    if (!isRecord(normalized) || normalized.ok !== true || !Array.isArray(normalized.columns) || !Array.isArray(normalized.rows)) {
      throw new TypeError("toLegacyResult expects a normalized successful result.");
    }
    const legacyColumns = uniqueLegacyLabels(normalized.columns);
    const rows = normalized.rows.map(row => {
      const legacyRow = {};
      normalized.columns.forEach((column, index) => {
        legacyRow[legacyColumns[index]] = isRecord(row) && Object.prototype.hasOwnProperty.call(row, column.name)
          ? row[column.name]
          : null;
      });
      return legacyRow;
    });
    const legacy = {
      ok: true,
      columns: legacyColumns,
      columnDescriptors: normalized.columns.map(column => ({ ...column })),
      rows,
      provider: normalized.provider,
      truncated: normalized.truncated === true,
      warning: normalized.warnings.join(" "),
      warnings: normalized.warnings.slice(),
      durationMs: normalized.durationMs
    };
    if (normalized.totalRecordCount !== undefined) legacy.totalRecordCount = normalized.totalRecordCount;
    if (normalized.compatibilityMode) legacy.compatibilityMode = normalized.compatibilityMode;
    if (normalized.clientUrl) legacy.clientUrl = normalized.clientUrl;
    if (normalized.environmentId) legacy.environmentId = normalized.environmentId;
    if (normalized.currentUser) legacy.currentUser = { ...normalized.currentUser };
    if (normalized.diagnostics) legacy.diagnostics = { ...normalized.diagnostics };
    return legacy;
  }

  function normalizeError(input, options = {}) {
    const error = isRecord(input) ? input : { message: typeof input === "string" ? input : "" };
    const rawCode = safeIdentifier(error.code || error.errorCode, 80).toUpperCase();
    let category = CATEGORIES.includes(error.category) ? error.category : CODE_TO_CATEGORY[rawCode];
    const status = nonNegativeInteger(error.status ?? error.statusCode);
    if (!category && status === 401) category = "AUTHENTICATION";
    if (!category && status === 403) category = "AUTHORIZATION";
    if (!category && status === 429) category = "THROTTLED";
    if (!category && (status === 408 || status === 504)) category = "TIMEOUT";
    if (!category && (error.name === "AbortError" || error.name === "TimeoutError")) category = "TIMEOUT";
    if (!category) category = "INTERNAL";

    let code = CODE_TO_CATEGORY[rawCode] === category ? rawCode : category;
    if (category === "READ_ONLY_POLICY" && ["QUERY_LIMIT_EXCEEDED", "POLICY_UNAVAILABLE", "MULTIPLE_STATEMENTS"].includes(rawCode)) {
      code = rawCode;
    }
    const result = {
      ok: false,
      category,
      code,
      message: ERROR_MESSAGES[category],
      provider: safeIdentifier(error.provider || options.provider) || undefined,
      retryable: ["THROTTLED", "TIMEOUT", "TRANSPORT"].includes(category),
      fallbackEligible: false
    };
    const details = isRecord(error.detailsSafe) ? error.detailsSafe : {};
    const correlationId = safeIdentifier(details.correlationId || error.correlationId, 120);
    const requestId = safeIdentifier(details.requestId || error.requestId, 120);
    if (correlationId || requestId) {
      result.detailsSafe = {};
      if (correlationId) result.detailsSafe.correlationId = correlationId;
      if (requestId) result.detailsSafe.requestId = requestId;
    }
    return result;
  }

  function normalizeOutcome(input, options = {}) {
    if (isRecord(input) && input.ok === false) return normalizeError(input, options);
    return normalizeResult(input, options);
  }

  return Object.freeze({
    categories: CATEGORIES.slice(),
    normalizeResult,
    normalizeError,
    normalizeOutcome,
    toLegacyResult
  });
});
