/**
 * Phase 6 — client cooperation contracts (mirrors Worker domain).
 * Explicit approval only. No automatic recommendations / messaging / Deals.
 */

export const COOPERATION_LIFECYCLE_PATH = "/cooperation/lifecycle";
export const COOPERATION_SCOPE_REVOKE_PATH = "/cooperation/scope-revoke";

export const FIVE_ARABIC_COOPERATION_STATUSES = Object.freeze([
  "لم تُشارك",
  "بانتظار الموافقة",
  "تعاون نشط",
  "رُفض الطلب",
  "انتهى التعاون"
]);

export function phase6BoundaryGuarantees() {
  return {
    createsAutomaticCooperation: false,
    createsBrokerRecommendation: false,
    inventsPerformanceScores: false,
    exposesContactAutomatically: false,
    createsFinancialCommitment: false,
    createsCommission: false,
    sendsWhatsApp: false,
    sendsTelegram: false,
    createsSmartMessageDraft: false,
    addsDealsPage: false,
    addsBottomNavigation: false,
    smartAutomaticImplemented: false
  };
}

export function normalizeCooperationMode(value) {
  const mode = String(value || "").trim().toUpperCase();
  if (["DISABLED", "APPROVAL_REQUIRED", "SMART_AUTOMATIC"].includes(mode)) return mode;
  return "APPROVAL_REQUIRED";
}

export function cooperationModeAllowsExplicitRequest(mode) {
  return normalizeCooperationMode(mode) !== "DISABLED";
}

export function cooperationModeAllowsAccept(mode) {
  return normalizeCooperationMode(mode) !== "DISABLED";
}

export function assertOwnershipPreserved(before = {}, after = {}) {
  const keys = [
    "id", "officeId", "brokerId", "originatingOfficeId", "originatingBrokerId",
    "createdAt", "deduplicationFingerprint", "currentOwningOfficeId"
  ];
  const violations = [];
  for (const key of keys) {
    if (before[key] == null || before[key] === "") continue;
    if (String(after[key] ?? "") !== String(before[key])) violations.push(key);
  }
  return { ok: violations.length === 0, violations };
}

export function withCurrentOwningOffice(record = {}) {
  const officeId = String(record.officeId || record.originatingOfficeId || "");
  return {
    ...record,
    currentOwningOfficeId: String(record.currentOwningOfficeId || officeId)
  };
}

async function postWorkerJson({
  workerBase,
  path,
  idToken,
  body,
  fetchImpl = globalThis.fetch
}) {
  if (!workerBase) return { ok: false, error: "worker_base_required" };
  if (!idToken) return { ok: false, error: "auth_required" };
  const response = await fetchImpl(new URL(path, workerBase).toString(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`
    },
    body: JSON.stringify(body || {})
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      error: payload.error || "cooperation_request_failed",
      message: payload.message || "",
      status: response.status,
      payload
    };
  }
  return { ok: true, ...payload, payload };
}

export function requestCooperationLifecycle({
  workerBase,
  idToken,
  officeId,
  cooperationId,
  action,
  reason = "",
  fetchImpl = globalThis.fetch
} = {}) {
  return postWorkerJson({
    workerBase,
    path: COOPERATION_LIFECYCLE_PATH,
    idToken,
    body: {
      officeId: String(officeId || "").trim(),
      cooperationId: String(cooperationId || "").trim(),
      action: String(action || "").trim().toUpperCase(),
      reason: String(reason || "").slice(0, 200)
    },
    fetchImpl
  });
}

export function requestScopeRevoke({
  workerBase,
  idToken,
  officeId,
  sharingScopeId,
  reason = "",
  fetchImpl = globalThis.fetch
} = {}) {
  return postWorkerJson({
    workerBase,
    path: COOPERATION_SCOPE_REVOKE_PATH,
    idToken,
    body: {
      officeId: String(officeId || "").trim(),
      sharingScopeId: String(sharingScopeId || "").trim(),
      reason: String(reason || "").slice(0, 200)
    },
    fetchImpl
  });
}
