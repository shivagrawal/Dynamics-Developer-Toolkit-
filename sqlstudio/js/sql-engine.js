/**
 * DevLens SQL Studio — read-only SQL subset planner and FetchXML compiler.
 *
 * This is an original JS implementation. It deliberately supports a bounded,
 * explicit subset and rejects unsupported SQL instead of silently changing meaning.
 * SQL4CDS reference behavior: https://github.com/MarkMpn/Sql4Cds (MIT).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DevLensSqlEngine = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const KEYWORDS = new Set(("SELECT DISTINCT TOP FROM WHERE ORDER BY ASC DESC AS INNER LEFT JOIN ON AND OR IS NULL NOT LIKE IN").split(/\s+/));
  const OPS = { "=": "eq", "!=": "ne", "<>": "ne", ">": "gt", ">=": "ge", "<": "lt", "<=": "le" };

  function tokenize(sql) {
    const out = []; let i = 0;
    const add = (type, start, end) => out.push({type, value: sql.slice(start, end), start, end});
    while (i < sql.length) {
      const s = i, c = sql[i], n = sql[i+1];
      if (/\s/.test(c)) { i++; while (i < sql.length && /\s/.test(sql[i])) i++; continue; }
      if (c === "-" && n === "-") { i += 2; while (i < sql.length && sql[i] !== "\n") i++; continue; }
      if (c === "/" && n === "*") { i += 2; let d = 1; while (i < sql.length && d) { if (sql[i] === "/" && sql[i+1] === "*") { d++; i+=2; } else if (sql[i] === "*" && sql[i+1] === "/") { d--; i+=2; } else i++; } if (d) throw Error("Unterminated SQL block comment."); continue; }
      if (c === "'" || c === '"') { const q = c; i++; while (i < sql.length) { if (sql[i] === q && sql[i+1] === q) { i+=2; continue; } if (sql[i] === q) { i++; break; } i++; } if (sql[i-1] !== q) throw Error("Unterminated SQL quoted value."); add(q === "'" ? "string" : "identifier", s, i); continue; }
      if (c === "[") { i++; while (i < sql.length) { if (sql[i] === "]" && sql[i+1] === "]") { i+=2; continue; } if (sql[i++] === "]") break; } if (sql[i-1] !== "]") throw Error("Unterminated bracketed identifier."); add("identifier",s,i); continue; }
      if (/[A-Za-z_]/.test(c)) { i++; while (i < sql.length && /[A-Za-z0-9_$]/.test(sql[i])) i++; const v=sql.slice(s,i); add(KEYWORDS.has(v.toUpperCase())?"keyword":"identifier",s,i); continue; }
      if (/\d/.test(c) || (c === "-" && /\d/.test(n || ""))) { i++; while (i < sql.length && /[\d.]/.test(sql[i])) i++; add("number",s,i); continue; }
      const two=sql.slice(i,i+2); if (["<=",">=","<>","!="].includes(two)) { i+=2; add("operator",s,i); continue; }
      i++; add("operator",s,i);
    }
    return out;
  }
  function unquote(t) {
    if (!t) return "";
    const v = typeof t === "string" ? t : t.value;
    if (v[0] === "[") return v.slice(1,-1).replace(/]]/g,"]");
    if (v[0] === '"' && v.endsWith('"')) return v.slice(1,-1).replace(/""/g,'"');
    return v;
  }
  function fail(message) { const e = new Error(message); e.code = "SQL_UNSUPPORTED"; throw e; }

  function parse(sql) {
    if (typeof sql !== "string" || !sql.trim()) fail("Enter a SQL SELECT query.");
    if (sql.length > 100000) fail("Query exceeds the 100,000 character limit.");
    const tokens = tokenize(sql);
    if (!tokens.length || tokens[0].value.toUpperCase() !== "SELECT") fail("Read-only SQL mode accepts SELECT statements only.");
    if (tokens.some(t => t.value === ";") && tokens.filter(t => t.value === ";").some(t => tokens.indexOf(t) !== tokens.length - 1)) fail("Run one SQL statement at a time.");
    let p = 0;
    const peek = (v) => tokens[p] && tokens[p].value.toUpperCase() === v;
    const take = () => tokens[p++];
    const expect = v => { if (!peek(v)) fail("Expected " + v + (tokens[p] ? " near '" + tokens[p].value + "'." : " at end of query.")); return take(); };
    const identifier = () => { if (!tokens[p] || !["identifier","keyword"].includes(tokens[p].type) || ["SELECT","FROM","WHERE","ORDER","BY","JOIN","LEFT","INNER","ON","AND","OR","AS","TOP","DISTINCT","ASC","DESC","IS","NULL","NOT","LIKE","IN"].includes(tokens[p].value.toUpperCase())) fail("Expected an identifier."); return unquote(take()); };
    const qualified = () => { const first = identifier(); if (peek(".")) { take(); return {tableAlias:first, column:identifier()}; } return {tableAlias:null,column:first}; };
    expect("SELECT");
    const distinct = !!(peek("DISTINCT") && take());
    let top = null;
    if (peek("TOP")) { take(); if (!tokens[p] || tokens[p].type !== "number") fail("TOP requires an integer literal."); top = Number(take().value); if (!Number.isInteger(top) || top < 1 || top > 5000) fail("TOP must be an integer from 1 to 5000."); }
    const columns = [];
    do {
      if (peek("*")) { take(); columns.push({star:true,alias:null}); }
      else { const field=qualified(); let as=null; if (peek("AS")) { take(); as=identifier(); } columns.push({tableAlias:field.tableAlias,column:field.column,alias:as}); }
      if (!peek(",")) break; take();
    } while (p < tokens.length);
    expect("FROM");
    const table = identifier().toLowerCase();
    let baseAlias = table;
    if (peek("AS")) { take(); baseAlias=identifier(); }
    else if (tokens[p] && tokens[p].type === "identifier" && !["WHERE","ORDER","INNER","LEFT","JOIN","ON"].includes(tokens[p].value.toUpperCase())) baseAlias=identifier();
    const joins=[];
    while (peek("INNER") || peek("LEFT") || peek("JOIN")) {
      let kind="inner";
      if (peek("LEFT")) { take(); kind="outer"; if (peek("OUTER")) take(); expect("JOIN"); }
      else if (peek("INNER")) { take(); expect("JOIN"); }
      else take();
      const joinTable=identifier().toLowerCase();
      let alias=joinTable;
      if (peek("AS")) { take(); alias=identifier(); }
      else if (tokens[p] && tokens[p].type==="identifier" && !["ON","WHERE","ORDER"].includes(tokens[p].value.toUpperCase())) alias=identifier();
      expect("ON");
      const left=qualified(); const op=take(); if (!["="].includes(op.value)) fail("JOIN conditions currently support equality only.");
      const right=qualified();
      joins.push({kind,table:joinTable,alias,left,right});
    }
    let where=null;
    if (peek("WHERE")) { take(); where=parsePredicate(); }
    function parsePredicate() {
      const parseAtom=()=>{
        if (peek("(")) { take(); const node=parseOr(); expect(")"); return node; }
        const field=qualified();
        if (peek("IS")) { take(); const not=!!(peek("NOT")&&take()); expect("NULL"); return {type:"null",field,not}; }
        let not=false; if (peek("NOT")) { take(); not=true; }
        if (peek("IN")) { take(); expect("("); const values=[]; do { values.push(literal()); if(!peek(","))break; take(); } while(true); expect(")"); if(not) fail("NOT IN is not supported in this engine version."); if(values.some(value=>value.type==="null")) fail("NULL values in IN lists are not supported; handle NULL explicitly."); return {type:"in",field,values}; }
        if (peek("LIKE")) { take(); if(not) fail("NOT LIKE is not supported in this engine version."); const value=literal(); if(value.type!=="string") fail("LIKE requires a string literal."); return {type:"like",field,value:value.value}; }
        const op=take(); if (!OPS[op.value]) fail("Unsupported WHERE operator '" + op.value + "'.");
        const value=literal(); if(value.type==="null") fail("Use IS NULL or IS NOT NULL instead of comparing with NULL."); return {type:"compare",field,operator:OPS[op.value],value};
      };
      const parseAnd=()=>{let n=parseAtom();while(peek("AND")){take();n={type:"and",left:n,right:parseAtom()};}return n;};
      const parseOr=()=>{let n=parseAnd();while(peek("OR")){take();n={type:"or",left:n,right:parseAnd()};}return n;};
      return parseOr();
    }
    function literal() {
      const t=take(); if(!t) fail("Expected a literal value.");
      if(t.type==="string") return {type:"string",value:t.value.slice(1,-1).replace(/''/g,"'")};
      if(t.type==="number") { const n=Number(t.value); if(!Number.isFinite(n))fail("Invalid numeric literal."); return {type:"number",value:n}; }
      if(t.value.toUpperCase()==="NULL") return {type:"null",value:null};
      if(t.value.toUpperCase()==="TRUE"||t.value.toUpperCase()==="FALSE") return {type:"boolean",value:t.value.toUpperCase()==="TRUE"};
      fail("Only string, numeric, boolean and NULL literals are supported in WHERE.");
    }
    // WHERE is parsed with closures above; declaration is hoisted and parser consumes until ORDER/semicolon.
    if (peek("ORDER")) { take(); expect("BY"); }
    const orderBy=[];
    if (tokens.slice(0,p).some(t=>t.value.toUpperCase()==="BY")) {
      do { const field=qualified(); let direction="asc"; if(peek("ASC"))take();else if(peek("DESC")){take();direction="desc";} orderBy.push({ ...field,direction }); if(!peek(","))break;take(); } while(true);
    }
    if (peek(";")) take();
    if (p !== tokens.length) fail("Unsupported SQL syntax near '" + tokens[p].value + "'.");
    if (columns.some(c=>c.star) && columns.length>1) fail("SELECT * cannot be combined with individual columns in this engine version.");
    const aliases = [baseAlias.toLowerCase(), ...joins.map(join => join.alias.toLowerCase())];
    if (new Set(aliases).size !== aliases.length) fail("Table aliases must be unique within a query.");
    return {type:"select",table,alias:baseAlias,columns,distinct,top,where,orderBy,joins};
  }

  function escapeXml(value) { return String(value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;"); }
  function attributeName(field, plan) {
    if (field.tableAlias && field.tableAlias.toLowerCase() !== plan.alias.toLowerCase()) {
      const join=plan.joins.find(j=>j.alias.toLowerCase()===field.tableAlias.toLowerCase());
      if (!join) fail("Unknown table alias '" + field.tableAlias + "'.");
      return {name:field.column,entityAlias:field.tableAlias};
    }
    return {name:field.column};
  }
  function valueXml(value) { if(value.type==="null") return ""; if(value.type==="boolean") return value.value?"true":"false"; return String(value.value); }
  function conditionXml(node, plan) {
    if(node.type==="and"||node.type==="or") return '<filter type="'+node.type+'">'+conditionXml(node.left,plan)+conditionXml(node.right,plan)+'</filter>';
    const field=attributeName(node.field,plan);
    const entity=field.entityAlias?' entityname="'+escapeXml(field.entityAlias)+'"':'';
    if(node.type==="null") return '<condition attribute="'+escapeXml(field.name)+'" operator="'+(node.not?"not-null":"null")+'"'+entity+'/>';
    if(node.type==="in") return '<condition attribute="'+escapeXml(field.name)+'" operator="in"'+entity+'>'+node.values.map(v=>'<value>'+escapeXml(valueXml(v))+'</value>').join("")+'</condition>';
    if(node.type==="like") {
      const pattern=node.value;
      const value=pattern.replace(/\\%/g,"%").replace(/\\_/g,"_");
      return '<condition attribute="'+escapeXml(field.name)+'" operator="like"'+entity+'><value>'+escapeXml(value)+'</value></condition>';
    }
    if(node.value.type==="null") fail("Use IS NULL or IS NOT NULL instead of comparing with NULL.");
    return '<condition attribute="'+escapeXml(field.name)+'" operator="'+node.operator+'"'+entity+'><value>'+escapeXml(valueXml(node.value))+'</value></condition>';
  }
  function compile(plan, metadata) {
    metadata=metadata||{};
    const entities=metadata.entities||{};
    if (!entities[plan.table]) fail("Metadata is required for base table '" + plan.table + "'.");
    for(const j of plan.joins) if(!entities[j.table]) fail("Metadata is required for joined table '" + j.table + "'.");
    const base=entities[plan.table], attrs=[];
    const resolveEntity = owner => {
      const normalized = String(owner || plan.alias).toLowerCase();
      if (normalized === plan.alias.toLowerCase()) return base;
      const join = plan.joins.find(item => item.alias.toLowerCase() === normalized);
      if (!join) fail("Unknown table alias '" + normalized + "'.");
      return entities[join.table];
    };
    const validateField = field => {
      const entity = resolveEntity(field.tableAlias);
      if (!entity.columns?.some(column => column.logicalName.toLowerCase() === field.column.toLowerCase() && column.queryable !== false)) {
        fail("Column '" + field.column + "' is not queryable on table '" + entity.logicalName + "'.");
      }
    };
    const validatePredicate = node => {
      if (!node) return;
      if (node.type === "and" || node.type === "or") { validatePredicate(node.left); validatePredicate(node.right); return; }
      validateField(node.field);
    };
    validatePredicate(plan.where);
    const selected=plan.columns.some(c=>c.star)?(base.columns||[]).filter(c=>c.queryable!==false).map(c=>({column:c.logicalName})):plan.columns;
    if(plan.columns.some(c=>c.star)) {
      if (!selected.length) fail("No queryable columns were found for SELECT * on '" + plan.table + "'.");
      for(const col of selected) attrs.push('<attribute name="'+escapeXml(col.column)+'"/>');
    } else {
      for(const c of plan.columns) {
        const owner=(c.tableAlias||plan.alias).toLowerCase();
        if(owner!==plan.alias.toLowerCase()&&!plan.joins.some(j=>j.alias.toLowerCase()===owner))fail("Unknown table alias '"+owner+"'.");
        const entity=owner===plan.alias.toLowerCase()?base:entities[plan.joins.find(j=>j.alias.toLowerCase()===owner).table];
        if(!entity.columns?.some(x=>x.logicalName.toLowerCase()===c.column.toLowerCase()&&x.queryable!==false)) fail("Column '"+c.column+"' is not queryable on table '"+entity.logicalName+"'.");
        const outputAlias = c.alias || (owner!==plan.alias.toLowerCase() ? owner+'_'+c.column : null);
        attrs.push('<attribute name="'+escapeXml(c.column)+'"'+(outputAlias?' alias="'+escapeXml(outputAlias)+'"':'')+'/>' );
      }
    }
    let orders=plan.orderBy.map(o=>{const owner=(o.tableAlias||plan.alias).toLowerCase();if(owner!==plan.alias.toLowerCase())fail("ORDER BY on joined columns is not supported yet.");if(!base.columns?.some(c=>c.logicalName.toLowerCase()===o.column.toLowerCase()&&c.queryable!==false))fail("ORDER BY column '"+o.column+"' is not queryable.");return '<order attribute="'+escapeXml(o.column)+'" descending="'+(o.direction==="desc"?'true':'false')+'"/>';}).join("");
    // Deterministic ordering makes FetchXML paging stable when SQL leaves row order unspecified.
    if (!plan.top && !plan.distinct && !orders && base.primaryIdAttribute) orders = '<order attribute="'+escapeXml(base.primaryIdAttribute)+'"/>';
    const filters=plan.where?conditionXml(plan.where,plan):"";
    const links=plan.joins.map(j=>{
      const left=j.left.tableAlias||plan.alias, right=j.right.tableAlias||plan.alias;
      let from,to;
      if(left.toLowerCase()===plan.alias.toLowerCase()&&right.toLowerCase()===j.alias.toLowerCase()){from=j.right.column;to=j.left.column;}
      else if(right.toLowerCase()===plan.alias.toLowerCase()&&left.toLowerCase()===j.alias.toLowerCase()){from=j.left.column;to=j.right.column;}
      else fail("JOIN must compare the base table with the joined table using an equality condition.");
      if(!base.columns?.some(c=>c.logicalName.toLowerCase()===to.toLowerCase())||!entities[j.table].columns?.some(c=>c.logicalName.toLowerCase()===from.toLowerCase()))fail("JOIN columns were not found in metadata.");
      return '<link-entity name="'+escapeXml(j.table)+'" alias="'+escapeXml(j.alias)+'" from="'+escapeXml(from)+'" to="'+escapeXml(to)+'" link-type="'+j.kind+'"/>';
    }).join("");
    const xml='<fetch'+(plan.top?' top="'+plan.top+'"':'')+(plan.distinct?' distinct="true"':'')+'><entity name="'+escapeXml(base.logicalName)+'">'+attrs.join("")+orders+filters+links+'</entity></fetch>';
    return {fetchXml:xml,plan,entitySetName:base.entitySetName,primaryIdAttribute:base.primaryIdAttribute,readOnly:true};
  }

  function plan(sql) { return parse(sql); }
  function compileSql(sql, metadata) { return compile(plan(sql),metadata); }
  return {tokenize,parse,plan,compile,compileSql,escapeXml};
});
