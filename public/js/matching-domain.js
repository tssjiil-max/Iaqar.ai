/**
 * Phase 4 — client matching contracts.
 * Triggers Worker rematch; does not score in the browser and does not create Operations.
 */

export const MATCHING_RULE_VERSION = "4.0.0";
export const MATCHING_RUN_PATH = "/matching/run";

export function phase4BoundaryGuarantees() {
  return {
    createsOperation: false,
    sendsWhatsApp: false,
    sendsTelegram: false,
    runsAutomaticCooperation: false,
    runsMatchingEngine: true,
    matchingRuleVersion: MATCHING_RULE_VERSION
  };
}

export function rematchRequestBody({ officeId, opportunityId, notify = false } = {}) {
  return {
    officeId: String(officeId || "").trim(),
    opportunityId: String(opportunityId || "").trim(),
    notify: notify === true
  };
}

export function shouldRematchAfterOpportunityWrite({
  duplicate = false,
  lifecycleStatus = "ACTIVE",
  deletedAt = null,
  archivedAt = null
} = {}) {
  if (duplicate) return false;
  if (deletedAt) return true; // Worker supersedes related matches.
  const life = String(lifecycleStatus || "ACTIVE").toUpperCase();
  if (life === "DELETED" || life === "ARCHIVED" || archivedAt) return true;
  return life === "ACTIVE" || !lifecycleStatus;
}

export async function requestOpportunityRematch({
  workerBase,
  idToken,
  officeId,
  opportunityId,
  notify = false,
  fetchImpl = globalThis.fetch
} = {}) {
  const body = rematchRequestBody({ officeId, opportunityId, notify });
  if (!body.officeId || !body.opportunityId) {
    return { ok: false, error: "office_or_opportunity_required" };
  }
  if (!workerBase) return { ok: false, error: "worker_base_required" };
  if (!idToken) return { ok: false, error: "auth_required" };

  const response = await fetchImpl(new URL(MATCHING_RUN_PATH, workerBase).toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`
    },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      error: payload.error || "matching_run_failed",
      status: response.status,
      payload
    };
  }
  return {
    ok: true,
    matchCount: Number(payload.matchCount || 0),
    matches: Array.isArray(payload.matches) ? payload.matches : [],
    matchingRuleVersion: payload.matchingRuleVersion || MATCHING_RULE_VERSION,
    createsOperation: payload.createsOperation === true,
    boundaries: payload.boundaries || phase4BoundaryGuarantees(),
    payload
  };
}
