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

  function validXmlReferences(value) {
    const named = new Set(["amp", "lt", "gt", "apos", "quot"]);
    let cursor = 0;
    while (cursor < value.length) {
      const amp = value.indexOf("&", cursor);
      if (amp < 0) return true;
      const semi = value.indexOf(";", amp + 1);
      if (semi < 0) return false;
      const reference = value.slice(amp + 1, semi);
      if (!named.has(reference)) {
        let codePoint;
        if (/^#[0-9]+$/.test(reference)) codePoint = Number(reference.slice(1));
        else if (/^#x[0-9a-f]+$/i.test(reference)) codePoint = Number.parseInt(reference.slice(2), 16);
        else return false;
        const validCodePoint = codePoint === 0x9 || codePoint === 0xA || codePoint === 0xD ||
          (codePoint >= 0x20 && codePoint <= 0xD7FF) ||
          (codePoint >= 0xE000 && codePoint <= 0xFFFD) ||
          (codePoint >= 0x10000 && codePoint <= 0x10FFFF);
        if (!validCodePoint) return false;
      }
      cursor = semi + 1;
    }
    return true;
  }

  // Bounded structural XML scan: avoid trusting regex matches in comments,
  // attributes, or nested entities when identifying the FetchXML base entity.
  function inspectFetchXml(xml) {
    const stack = [];
    let rootName = null;
    let rootEntity = null;
    let rootEntityCount = 0;
    let rootClosed = false;
    let i = 0;
    const namePattern = /^[A-Za-z_][A-Za-z0-9_.:-]*/;
    while (i < xml.length) {
      const open = xml.indexOf("<", i);
      if (open < 0) {
        if (xml.slice(i).includes(">")) return null;
        break;
      }
      const text = xml.slice(i, open);
      if (text.includes("]]>") || (!stack.length && text.trim()) || !validXmlReferences(text)) return null;
      i = open;
      if (xml.startsWith("<!--", i)) {
        const end = xml.indexOf("-->", i + 4);
        if (end < 0 || xml.slice(i + 4, end).includes("--")) return null;
        i = end + 3;
        continue;
      }
      if (xml.startsWith("<![CDATA[", i)) {
        if (!stack.length) return null;
        const end = xml.indexOf("]]>", i + 9);
        if (end < 0) return null;
        i = end + 3;
        continue;
      }
      if (xml.startsWith("<?", i)) {
        const end = xml.indexOf("?>", i + 2);
        if (end < 0 || stack.length || rootName !== null) return null;
        i = end + 2;
        continue;
      }
      if (xml.startsWith("<!", i)) return null;
      if (xml.startsWith("</", i)) {
        const match = namePattern.exec(xml.slice(i + 2));
        if (!match) return null;
        const name = match[0];
        let end = i + 2 + name.length;
        while (/\s/.test(xml[end] || "")) end++;
        if (xml[end] !== ">" || stack.pop() !== name) return null;
        i = end + 1;
        if (!stack.length) rootClosed = true;
        continue;
      }
      const match = namePattern.exec(xml.slice(i + 1));
      if (!match) return null;
      const name = match[0];
      if (rootClosed) return null;
      const parent = stack.length ? stack[stack.length - 1] : null;
      if (!parent) {
        if (rootName !== null || name.toLowerCase() !== "fetch") return null;
        rootName = name;
      }
      let cursor = i + 1 + name.length;
      let selfClosing = false;
      const attributes = Object.create(null);
      while (cursor < xml.length) {
        while (/\s/.test(xml[cursor] || "")) cursor++;
        if (xml[cursor] === ">") { cursor++; break; }
        if (xml[cursor] === "/" && xml[cursor + 1] === ">") {
          selfClosing = true;
          cursor += 2;
          break;
        }
        const attrMatch = namePattern.exec(xml.slice(cursor));
        if (!attrMatch) return null;
        const attrName = attrMatch[0].toLowerCase();
        cursor += attrMatch[0].length;
        while (/\s/.test(xml[cursor] || "")) cursor++;
        if (xml[cursor] !== "=") return null;
        cursor++;
        while (/\s/.test(xml[cursor] || "")) cursor++;
        const quote = xml[cursor];
        if (quote !== '"' && quote !== "'") return null;
        const end = xml.indexOf(quote, cursor + 1);
        if (end < 0) return null;
        const value = xml.slice(cursor + 1, end);
        if (value.includes("<") || !validXmlReferences(value) || Object.prototype.hasOwnProperty.call(attributes, attrName)) return null;
        attributes[attrName] = value;
        cursor = end + 1;
      }
      if (cursor > xml.length || xml[cursor - 1] !== ">" || (xml[cursor - 2] === "/" && !selfClosing)) return null;
      if (parent === rootName && name.toLowerCase() === "entity") {
        rootEntityCount++;
        if (rootEntityCount > 1) return null;
        rootEntity = attributes.name || null;
      }
      if (["update", "delete", "create", "upsert", "insert"].includes(name.toLowerCase())) return null;
      if (!selfClosing) stack.push(name);
      else if (!stack.length) rootClosed = true;
      i = cursor;
    }
    if (!rootName || !rootClosed || stack.length) return null;
    if (rootEntityCount !== 1) return null;
    return { root: rootName.toLowerCase(), entity: rootEntity };
  }

  function validateFetchXml(fetchXml, tableName) {
    if (typeof fetchXml !== "string" || !fetchXml.trim()) return denied("SQL_SYNTAX", "A compiled FetchXML query is required.");
    if (fetchXml.length > LIMITS.fetchXmlCharacters) return denied("QUERY_LIMIT_EXCEEDED", "Compiled query exceeds the 1,000,000 character limit.");
    const table = String(tableName || "").trim().toLowerCase();
    if (!/^[a-z_][a-z0-9_]*$/.test(table)) return denied("READ_ONLY_POLICY", "Invalid Dataverse table logical name.");
    const inspected = inspectFetchXml(fetchXml);
    if (!inspected) return denied("READ_ONLY_POLICY", "Malformed or unsupported FetchXML structure.");
    if (!inspected.entity || !/^[a-z_][a-z0-9_]*$/i.test(inspected.entity) || inspected.entity.toLowerCase() !== table) {
      return denied("READ_ONLY_POLICY", "FetchXML base entity does not match the requested table.");
    }
    return { ok: true, code: "OK", error: null, route: "fetchxml", plan: null, limits: LIMITS };
  }

  return { LIMITS, evaluate, validatePlan, validateFetchXml };
});
