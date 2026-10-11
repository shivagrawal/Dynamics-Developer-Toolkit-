/**
 * Shared, pure read-only policy gate for Query Studio execution.
 *
 * The SQL engine remains the sole parser. This module applies cross-provider
 * hard limits to its trusted plan and returns a typed decision; it never calls
 * a provider or mutates the input.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DevLensSqlPolicy = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const LIMITS = Object.freeze({
    sqlCharacters: 100000,
    tokens: 20000,
    astDepth: 64,
    predicateNodes: 512,
    joins: 8,
    inListItems: 1000,
    rows: 10000,
    pages: 100,
    pageSize: 500,
    fetchXmlCharacters: 1000000
  });

  function denied(code, message) {
    return { ok: false, code, error: message, route: null, plan: null };
  }

  const COMPARISON_OPERATORS = new Set(["eq", "ne", "gt", "ge", "lt", "le"]);
  const LITERAL_TYPES = new Set(["string", "number", "boolean"]);

  function validLiteral(value) {
    return !!value && typeof value === "object" &&
      (LITERAL_TYPES.has(value.type) || (value.type === "null" && value.value === null));
  }

  function validPredicateLeaf(node) {
    if (!node.field || typeof node.field !== "object" ||
        typeof node.field.column !== "string" || !node.field.column.trim()) return false;
    switch (node.type) {
      case "compare":
        return COMPARISON_OPERATORS.has(node.operator) && validLiteral(node.value) && node.value.type !== "null";
      case "null":
        return typeof node.not === "boolean";
      case "in":
        return typeof node.not === "boolean" && Array.isArray(node.values) &&
          node.values.every(value => validLiteral(value) && value.type !== "null");
      case "between":
        return typeof node.not === "boolean" && validLiteral(node.lower) &&
          validLiteral(node.upper) && node.lower.type !== "null" && node.upper.type !== "null";
      case "like":
        return typeof node.not === "boolean" && typeof node.value === "string";
      default:
        return false;
    }
  }

  function predicateStats(root) {
    if (!root) return { depth: 0, nodes: 0, valid: true };
    const stack = [{ node: root, depth: 1 }];
    let depth = 0, nodes = 0, valid = true;
    while (stack.length) {
      const current = stack.pop();
      const node = current.node;
      if (!node || typeof node !== "object" || Array.isArray(node)) {
        valid = false;
        continue;
      }
      nodes++;
      depth = Math.max(depth, current.depth);
      if (node.type === "and" || node.type === "or") {
        if (!node.left || !node.right) valid = false;
        stack.push({ node: node.left, depth: current.depth + 1 });
        stack.push({ node: node.right, depth: current.depth + 1 });
      } else if (!validPredicateLeaf(node)) {
        valid = false;
      }
    }
    return { depth, nodes, valid };
  }

  function validatePlan(plan) {
    if (!plan || plan.type !== "select") return denied("READ_ONLY_POLICY", "Only a single SELECT statement is allowed.");
    if (!Array.isArray(plan.joins) || plan.joins.length > LIMITS.joins) {
      return denied("QUERY_LIMIT_EXCEEDED", "Query exceeds the maximum of " + LIMITS.joins + " joins.");
    }
    const stats = predicateStats(plan.where);
    if (!stats.valid) {
      return denied("READ_ONLY_POLICY", "The parsed predicate is malformed or contains unsupported nodes.");
    }
    if (stats.depth > LIMITS.astDepth) {
      return denied("QUERY_LIMIT_EXCEEDED", "Predicate nesting exceeds the maximum depth of " + LIMITS.astDepth + ".");
    }
    if (stats.nodes > LIMITS.predicateNodes) {
      return denied("QUERY_LIMIT_EXCEEDED", "Query exceeds the maximum of " + LIMITS.predicateNodes + " predicate nodes.");
    }
    const stack = [plan.where];
    while (stack.length) {
      const node = stack.pop();
      if (!node || typeof node !== "object") continue;
      if (node.type === "in" && (!Array.isArray(node.values) || node.values.length > LIMITS.inListItems)) {
        return denied("QUERY_LIMIT_EXCEEDED", "IN lists are limited to " + LIMITS.inListItems + " values.");
      }
      if (node.type === "and" || node.type === "or") {
        stack.push(node.left, node.right);
      }
    }
    if (plan.top != null && (!Number.isInteger(plan.top) || plan.top < 1 || plan.top > 5000)) {
      return denied("QUERY_LIMIT_EXCEEDED", "TOP must be between 1 and 5,000.");
    }
    if (plan.offset != null && (!Number.isInteger(plan.offset) || plan.offset < 0 || plan.offset >= LIMITS.rows)) {
      return denied("QUERY_LIMIT_EXCEEDED", "OFFSET must be between 0 and 9,999.");
    }
    if (plan.fetch != null && (!Number.isInteger(plan.fetch) || plan.fetch < 1 || plan.fetch > 5000 || (plan.offset || 0) + plan.fetch > LIMITS.rows)) {
      return denied("QUERY_LIMIT_EXCEEDED", "FETCH NEXT must fit within the 10,000-row safety cap.");
    }
    return null;
  }

  function evaluate(sql, engine, options) {
    options = options || {};
    if (typeof sql !== "string" || !sql.trim()) return denied("SQL_SYNTAX", "Enter a SQL SELECT query.");
    if (sql.length > LIMITS.sqlCharacters) return denied("QUERY_LIMIT_EXCEEDED", "Query exceeds the 100,000 character limit.");
    if (!engine || typeof engine.parse !== "function" || typeof engine.tokenize !== "function") {
      return denied("POLICY_UNAVAILABLE", "The read-only SQL policy is unavailable; execution was stopped.");
    }
    const isSecurityAdapter = options.specializedSecurity === true;
    if (isSecurityAdapter) {
      let tokens;
      try { tokens = engine.tokenize(sql); }
      catch (error) { return denied(error?.code || "SQL_SYNTAX", error?.message || "SQL could not be tokenized."); }
      if (tokens.length > LIMITS.tokens) return denied("QUERY_LIMIT_EXCEEDED", "Query exceeds the " + LIMITS.tokens + " token limit.");
      // The named adapter retains its stricter projection/join/predicate checks
      // before any Dataverse data request. This envelope rejects batches and
      // non-SELECT input before dispatch to that adapter.
      if (!tokens.length || tokens[0].value.toUpperCase() !== "SELECT") return denied("READ_ONLY_POLICY", "Read-only mode accepts SELECT statements only.");
      const semicolons = tokens.filter(token => token.value === ";");
      if (semicolons.length > 1 || (semicolons.length === 1 && tokens[tokens.length - 1] !== semicolons[0])) {
        return denied("READ_ONLY_POLICY", "Run one SQL statement at a time.");
      }
      return { ok: true, code: "OK", error: null, route: "security-audit", plan: null, limits: LIMITS };
    }
    let plan;
    try {
      // The SQL engine is the sole parser and enforces its token cap while
      // tokenizing. Calling parse once yields the trusted internal plan.
      plan = engine.parse(sql);
    } catch (error) {
      return denied(error?.code || "SQL_UNSUPPORTED", error?.message || "SQL is not supported by the read-only policy.");
    }
    const invalid = validatePlan(plan);
    if (invalid) return invalid;
    return { ok: true, code: "OK", error: null, route: "native-sql", plan, limits: LIMITS };
  }

  function validateFetchXml(fetchXml, tableName) {
    if (typeof fetchXml !== "string" || !fetchXml.trim()) return denied("SQL_SYNTAX", "A compiled FetchXML query is required.");
    if (fetchXml.length > LIMITS.fetchXmlCharacters) return denied("QUERY_LIMIT_EXCEEDED", "Compiled query exceeds the 1,000,000 character limit.");
    const table = String(tableName || "").trim().toLowerCase();
    if (!/^[a-z_][a-z0-9_]*$/.test(table)) return denied("READ_ONLY_POLICY", "Invalid Dataverse table logical name.");
    if (!/^\s*<fetch(?:\s|>)/i.test(fetchXml)) return denied("READ_ONLY_POLICY", "Only FetchXML queries are accepted.");
    const entityMatch = fetchXml.match(/<entity\s+[^>]*name\s*=\s*["']([a-z_][a-z0-9_]*)["']/i);
    if (!entityMatch || entityMatch[1].toLowerCase() !== table) return denied("READ_ONLY_POLICY", "FetchXML base entity does not match the requested table.");
    if (/<(?:update|delete|create|upsert|insert)\b/i.test(fetchXml)) return denied("READ_ONLY_POLICY", "Only read-only FetchXML is accepted.");
    return { ok: true, code: "OK", error: null, route: "fetchxml", plan: null, limits: LIMITS };
  }

  return { LIMITS, evaluate, validatePlan, validateFetchXml };
});
