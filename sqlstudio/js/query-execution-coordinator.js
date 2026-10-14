/**
 * Query Studio execution coordinator.
 *
 * Owns deterministic route selection and the provider fallback contract.
 * Provider functions are injected so the coordinator can be tested without
 * a Dynamics runtime. UI code must not infer fallback eligibility.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module && module.exports) module.exports = api;
  if (root) root.DevLensQueryExecutionCoordinator = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ROUTES = Object.freeze(["native-sql", "fetchxml", "security-audit"]);
  const FALLBACK_CODES = new Set(["PROVIDER_CAPABILITY_REJECTION"]);
  const NO_FALLBACK_CODES = new Set([
    "AUTHENTICATION", "AUTHORIZATION", "METADATA", "QUERY_TIMEOUT",
    "TIMEOUT", "TRANSPORT", "THROTTLED", "DATAVERSE", "INTERNAL",
    "CANCELLED", "QUERY_CANCELLED"
  ]);

  function errorOutcome(code, message, provider) {
    return {
      ok: false,
      code: String(code || "INTERNAL"),
      category: String(code || "INTERNAL"),
      error: String(message || "Query execution failed."),
      provider: provider || null,
      fallbackEligible: false
    };
  }

  function chooseRoute(sql, decision, options) {
    if (!decision || decision.ok !== true || !decision.plan && options.specializedSecurity !== true) {
      return { ok: false, route: null, code: decision?.code || "POLICY_UNAVAILABLE", error: decision?.error || "The read-only SQL policy is unavailable; execution was stopped." };
    }
    if (options.specializedSecurity === true) {
      return { ok: true, route: "security-audit", plan: null, reason: "approved-security-audit-shape" };
    }
    const plan = decision.plan;
    if (plan?.hasOffset === true || (Number.isInteger(plan?.offset) && plan.offset > 0) || plan?.fetch != null) {
      return { ok: true, route: "fetchxml", plan, reason: "bounded-offset-fetch-semantics" };
    }
    // The Dataverse native SQL endpoint can resolve a joined-entity WHERE
    // attribute against the base entity (e.g. a.name against Contact). Route only
    // these queries through the validated FetchXML planner; projection-only joins
    // retain their existing native SQL behavior for compatibility.
    const joinedAliases = new Set((plan?.joins || []).map(join => String(join.alias).toLowerCase()));
    const whereUsesJoinedAlias = node => {
      if (!node || typeof node !== "object") return false;
      if (node.type === "and" || node.type === "or") {
        return whereUsesJoinedAlias(node.left) || whereUsesJoinedAlias(node.right);
      }
      return !!node.field?.tableAlias && joinedAliases.has(String(node.field.tableAlias).toLowerCase());
    };
    if (joinedAliases.size > 0 && whereUsesJoinedAlias(plan?.where)) {
      return { ok: true, route: "fetchxml", plan, reason: "joined-query-alias-semantics" };
    }
    return { ok: true, route: "native-sql", plan, reason: "native-provider-default" };
  }

  function decide(sql, engine, policy, options = {}) {
    if (typeof sql !== "string" || !sql.trim()) {
      return { ok: false, code: "SQL_SYNTAX", error: "Enter a SELECT query.", route: null, plan: null };
    }
    if (!policy || typeof policy.evaluate !== "function") {
      return { ok: false, code: "POLICY_UNAVAILABLE", error: "The read-only SQL policy is unavailable; execution was stopped.", route: null, plan: null };
    }
    const specializedSecurity = options.specializedSecurity === true;
    const decision = policy.evaluate(sql, engine, { specializedSecurity });
    if (!decision?.ok) return { ...decision, route: null, plan: null };
    return { ...decision, ...chooseRoute(sql, decision, { specializedSecurity }) };
  }

  function fallbackEligible(outcome, routeDecision, alternateRoute) {
    return !!outcome && outcome.ok === false &&
      FALLBACK_CODES.has(String(outcome.code || outcome.category || "")) &&
      !NO_FALLBACK_CODES.has(String(outcome.code || outcome.category || "").toUpperCase()) &&
      !!routeDecision?.ok && ROUTES.includes(routeDecision.route) &&
      ROUTES.includes(alternateRoute) && alternateRoute !== routeDecision.route &&
      routeDecision.equivalentAlternateRoutes?.includes(alternateRoute) === true;
  }

  async function execute(request, dependencies) {
    const startedAt = Date.now();
    const { sql, decision } = request || {};
    const providers = dependencies?.providers;
    const normalize = dependencies?.normalize;
    if (!decision?.ok || !ROUTES.includes(decision.route)) {
      return normalize
        ? normalize(errorOutcome(decision?.code || "POLICY_UNAVAILABLE", decision?.error, decision?.route))
        : errorOutcome(decision?.code || "POLICY_UNAVAILABLE", decision?.error, decision?.route);
    }
    const provider = providers?.[decision.route];
    if (typeof provider !== "function") {
      const failed = errorOutcome("PROVIDER_UNAVAILABLE", "The selected query provider is unavailable; execution was stopped.", decision.route);
      return normalize ? normalize(failed, { durationMs: Date.now() - startedAt }) : failed;
    }
    let outcome;
    let executedRoute = decision.route;
    try {
      outcome = await provider({ sql, plan: decision.plan || null, route: decision.route, requestId: request.requestId || null, deadlineAt: request.deadlineAt || null });
    } catch (error) {
      outcome = errorOutcome(error?.code || "INTERNAL", error?.message, decision.route);
    }
    if (!outcome || typeof outcome !== "object") outcome = errorOutcome("INTERNAL", "The selected provider returned an invalid outcome.", decision.route);
    if (outcome.ok !== true && outcome.fallbackEligible === true) {
      // Provider-provided flags are never sufficient: require a typed capability
      // code and an explicitly planner-approved equivalent route.
      const alternate = decision.alternateRoute;
      if (fallbackEligible(outcome, decision, alternate) && typeof providers[alternate] === "function") {
        try {
          executedRoute = alternate;
          outcome = await providers[alternate]({ sql, plan: decision.plan || null, route: alternate, requestId: request.requestId || null, deadlineAt: request.deadlineAt || null, fallbackFrom: decision.route });
        } catch (error) {
          outcome = errorOutcome(error?.code || "INTERNAL", error?.message, alternate);
        }
      } else {
        outcome = { ...outcome, fallbackEligible: false };
      }
    }
    if (outcome.ok === true) {
      outcome = { ...outcome, provider: executedRoute, fallbackEligible: false };
    } else {
      outcome = { ...outcome, provider: outcome.provider || executedRoute, fallbackEligible: false };
    }
    return normalize ? normalize(outcome, { durationMs: Date.now() - startedAt, provider: outcome.provider }) : outcome;
  }

  return Object.freeze({ ROUTES, decide, chooseRoute, fallbackEligible, execute });
});
