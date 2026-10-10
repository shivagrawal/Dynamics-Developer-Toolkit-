/**
 * DevLens SQL Studio — JavaScript SQL front-end (phase 1).
 *
 * This is an original JavaScript implementation of SQL lexical/context analysis,
 * informed by the public behavior of SQL 4 CDS. It does not contain or execute
 * the upstream .NET engine. MIT upstream reference: https://github.com/MarkMpn/Sql4Cds
 *
 * Scope: lossless-enough tokenization, statement/clause discovery, and metadata-driven
 * completion context. Execution planning and FetchXML translation are separate phases.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DevLensSqlFrontEnd = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const KEYWORDS = new Set(("SELECT DISTINCT TOP FROM WHERE JOIN INNER LEFT RIGHT FULL OUTER CROSS ON " +
    "AS AND OR NOT NULL IS LIKE IN EXISTS BETWEEN GROUP BY HAVING ORDER ASC DESC OFFSET FETCH " +
    "UNION ALL INSERT INTO VALUES UPDATE SET DELETE EXEC EXECUTE WITH").split(/\s+/));

  function tokenize(sql) {
    sql = String(sql || "");
    const tokens = [];
    let i = 0;
    const push = (type, start, end) => tokens.push({ type, value: sql.slice(start, end), start, end });
    while (i < sql.length) {
      const start = i, c = sql[i], n = sql[i + 1];
      if (/\s/.test(c)) { i++; while (i < sql.length && /\s/.test(sql[i])) i++; push("whitespace", start, i); continue; }
      if (c === "-" && n === "-") { i += 2; while (i < sql.length && sql[i] !== "\n") i++; push("comment", start, i); continue; }
      if (c === "/" && n === "*") {
        i += 2; let depth = 1;
        while (i < sql.length && depth) {
          if (sql[i] === "/" && sql[i + 1] === "*") { depth++; i += 2; }
          else if (sql[i] === "*" && sql[i + 1] === "/") { depth--; i += 2; }
          else i++;
        }
        push("comment", start, i); continue;
      }
      if (c === "'" || c === '"') {
        const quote = c; i++;
        while (i < sql.length) {
          if (sql[i] === quote && sql[i + 1] === quote) { i += 2; continue; }
          if (sql[i] === quote) { i++; break; }
          i++;
        }
        push(quote === "'" ? "string" : "quotedIdentifier", start, i); continue;
      }
      if (c === "[" ) {
        i++;
        while (i < sql.length) { if (sql[i] === "]" && sql[i + 1] === "]") { i += 2; continue; } if (sql[i++] === "]") break; }
        push("quotedIdentifier", start, i); continue;
      }
      if (/[A-Za-z_@#]/.test(c)) {
        i++; while (i < sql.length && /[A-Za-z0-9_$@#]/.test(sql[i])) i++;
        const value = sql.slice(start, i);
        push(KEYWORDS.has(value.toUpperCase()) ? "keyword" : "word", start, i); continue;
      }
      if (/\d/.test(c)) { i++; while (i < sql.length && /[\d.]/.test(sql[i])) i++; push("number", start, i); continue; }
      const two = sql.slice(i, i + 2);
      if (["<=", ">=", "<>", "!=", "!<", "!>"].includes(two)) { i += 2; push("operator", start, i); continue; }
      i++; push("punctuation", start, i);
    }
    return tokens;
  }

  function significant(tokens) { return tokens.filter(t => t.type !== "whitespace" && t.type !== "comment"); }
  function unquoteIdentifier(value) {
    if (!value) return value;
    if (value[0] === "[" && value[value.length - 1] === "]") return value.slice(1, -1).replace(/]]/g, "]");
    if ((value[0] === '"' || value[0] === "'") && value[value.length - 1] === value[0]) return value.slice(1, -1).replace(new RegExp(value[0] + value[0], "g"), value[0]);
    return value;
  }

  function splitTopLevel(tokens, separator) {
    const parts = []; let start = 0, depth = 0;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (t.value === "(") depth++;
      else if (t.value === ")") depth = Math.max(0, depth - 1);
      else if (depth === 0 && t.value === separator) { parts.push(tokens.slice(start, i)); start = i + 1; }
    }
    parts.push(tokens.slice(start)); return parts;
  }

  function normalizeTokenText(tokens) {
    let out = "";
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i], prev = tokens[i - 1], next = tokens[i + 1];
      const v = t.value;
      if (v === ".") { out = out.trimEnd() + "."; continue; }
      if (prev && prev.value === ".") { out += v; continue; }
      if ([",", ")", ";"].includes(v)) { out = out.trimEnd() + v; continue; }
      if (v === "(") {
        const functionCall = prev && (prev.type === "word" || prev.type === "keyword" || prev.type === "quotedIdentifier");
        out = out.trimEnd() + (functionCall ? " " : "") + v;
        continue;
      }
      if (prev && ["(", "."].includes(prev.value)) { out += v; continue; }
      if (out && !out.endsWith(" ")) out += " ";
      out += v;
    }
    return out.replace(/\\s+/g, " ");
  }

  function parseSelect(sql) {
    const all = significant(tokenize(sql));
    if (!all.length) return { ok: false, error: "Enter a SQL query." };
    const first = all.find(t => t.type !== "comment");
    if (!first || first.value.toUpperCase() !== "SELECT") {
      return { ok: false, error: "Phase 1 parser currently accepts SELECT statements only.", statementType: first && first.value.toUpperCase() };
    }
    let depth = 0, clauses = {}, clauseTokens = [], current = "SELECT";
    const clauseWords = new Set(["FROM", "WHERE", "GROUP", "HAVING", "ORDER", "OFFSET", "UNION"]);
    for (let i = 1; i < all.length; i++) {
      const t = all[i], upper = t.value.toUpperCase();
      if (t.value === "(") depth++;
      if (t.value === ")") depth = Math.max(0, depth - 1);
      const next = all[i + 1] && all[i + 1].value.toUpperCase();
      const clause = depth === 0 && (clauseWords.has(upper) && (upper !== "GROUP" && upper !== "ORDER" || next === "BY"));
      if (clause) {
        clauses[current] = clauseTokens; current = upper === "GROUP" || upper === "ORDER" ? upper + " BY" : upper; clauseTokens = [];
        if (current.endsWith(" BY")) i++;
      } else clauseTokens.push(t);
    }
    clauses[current] = clauseTokens;
    const projectionTokens = clauses.SELECT || [];
    const projection = splitTopLevel(projectionTokens, ",").map(part => normalizeTokenText(part).trim()).filter(Boolean);
    const fromTokens = clauses.FROM || [];
    const table = fromTokens.length ? unquoteIdentifier(fromTokens[0].value) : null;
    const aliasToken = fromTokens.length > 1 && fromTokens[1].value.toUpperCase() === "AS" ? fromTokens[2] : fromTokens[1];
    const alias = aliasToken && !["WHERE","JOIN","INNER","LEFT","RIGHT","FULL","CROSS","ON"].includes(aliasToken.value.toUpperCase()) ? unquoteIdentifier(aliasToken.value) : null;
    return { ok: true, statementType: "SELECT", projection, table, alias,
      clauses: Object.fromEntries(Object.entries(clauses).map(([k,v]) => [k, normalizeTokenText(v)])),
      tokens: all.map(t => ({ type: t.type, value: t.value, start: t.start, end: t.end })) };
  }

  function completionContext(sql, cursor) {
    sql = String(sql || ""); cursor = Math.max(0, Math.min(Number.isFinite(cursor) ? cursor : sql.length, sql.length));
    const before = sql.slice(0, cursor);
    const tokens = significant(tokenize(before));
    const tail = tokens[tokens.length - 1];
    if (tail && (tail.type === "string" || tail.type === "comment") && tail.end === cursor) return { kind: "none", reason: tail.type };
    let depth = 0, lastClause = null, lastTable = null, aliasMap = {};
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i], u = t.value.toUpperCase();
      if (t.value === "(") depth++;
      if (t.value === ")") depth = Math.max(0, depth - 1);
      if (depth !== 0) continue;
      if (["SELECT","FROM","WHERE","ON","JOIN","UPDATE","SET","INSERT","INTO","ORDER","GROUP","HAVING"].includes(u)) lastClause = u;
      if (["FROM","JOIN","UPDATE","INTO"].includes(u) && tokens[i+1]) {
        const table = unquoteIdentifier(tokens[i+1].value);
        if (table && !KEYWORDS.has(table.toUpperCase())) {
          lastTable = table;
          const possibleAlias = tokens[i+2] && tokens[i+2].value.toUpperCase() === "AS" ? tokens[i+3] : tokens[i+2];
          if (possibleAlias && possibleAlias.type === "word" && !KEYWORDS.has(possibleAlias.value.toUpperCase())) aliasMap[possibleAlias.value.toLowerCase()] = table;
        }
      }
    }
    const last = tokens[tokens.length - 1];
    const prefix = last && last.end === cursor && ["word","keyword","quotedIdentifier"].includes(last.type) ? unquoteIdentifier(last.value) : "";
    if (last && last.end === cursor && ["string","comment"].includes(last.type)) return { kind: "none", reason: last.type, prefix };
    if (!lastClause || lastClause === "FROM" || lastClause === "JOIN" || lastClause === "INTO") return { kind: "table", prefix, aliases: aliasMap };
    if (lastClause === "SELECT" || lastClause === "WHERE" || lastClause === "ON" || lastClause === "SET" || lastClause === "ORDER" || lastClause === "GROUP" || lastClause === "HAVING") {
      const dot = prefix.lastIndexOf(".");
      if (dot > 0) {
        const qualifier = prefix.slice(0, dot).toLowerCase();
        return { kind: "column", prefix: prefix.slice(dot + 1), qualifier, table: aliasMap[qualifier] || qualifier, aliases: aliasMap };
      }
      return { kind: "column", prefix, table: lastTable, aliases: aliasMap };
    }
    return { kind: "keyword", prefix, aliases: aliasMap };
  }

  function complete(context, metadata) {
    metadata = metadata || {};
    const match = value => String(value || "").toLowerCase().startsWith(String(context.prefix || "").toLowerCase());
    if (context.kind === "none") return [];
    if (context.kind === "table") return (metadata.tables || []).filter(t => match(typeof t === "string" ? t : t.logicalName)).map(t => ({ label: typeof t === "string" ? t : t.logicalName, kind: "table" }));
    if (context.kind === "column") {
      let cols = metadata.columns || [];
      if (context.table) cols = cols.filter(c => !c.table || c.table.toLowerCase() === context.table.toLowerCase());
      return cols.filter(c => match(c.logicalName || c.name)).map(c => ({ label: c.logicalName || c.name, kind: "column", table: c.table }));
    }
    return ["SELECT","FROM","WHERE","JOIN","INNER JOIN","LEFT JOIN","ON","GROUP BY","ORDER BY","AND","OR","IS NULL","LIKE"].filter(match).map(label => ({ label, kind: "keyword" }));
  }

  return { tokenize, significant, splitTopLevel, parseSelect, completionContext, complete, unquoteIdentifier };
});
