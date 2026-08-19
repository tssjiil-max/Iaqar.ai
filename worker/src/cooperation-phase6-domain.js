/**
 * Phase 6 — Cooperation lifecycle, ownership proofs, audit entries.
 * Explicit approval only. No automatic broker recommendations (Q-4 unresolved).
 * No WhatsApp/Telegram/Deals.
 */

export const COOPERATION_AUDIT_ACTIONS = Object.freeze({
  REQUEST_CREATED: "COOPERATION_REQUEST_CREATED",
  REQUEST_ACCEPTED: "COOPERATION_REQUEST_ACCEPTED",
  REQUEST_REJECTED: "COOPERATION_REQUEST_REJECTED",
  REQUEST_REVOKED: "COOPERATION_REQUEST_REVOKED",
  SCOPE_CREATED: "BANK_SHARING_SCOPE_CREATED",
  SCOPE_REVOKED: "BANK_SHARING_SCOPE_REVOKED",
  SHARED_PROJECTION_WRITTEN: "SHARED_OPPORTUNITY_WRITTEN",
  SHARED_PROJECTION_REMOVED: "SHARED_OPPORTUNITY_REMOVED"
});

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
    // SMART_AUTOMATIC mode is stored but does not auto-accept or recommend brokers (Q-4).
    smartAutomaticImplemented: false
  };
}

export function normalizeCooperationMode(value) {
  const mode = String(value || "").trim().toUpperCase();
  if (["DISABLED", "APPROVAL_REQUIRED", "SMART_AUTOMATIC"].includes(mode)) return mode;
  return "APPROVAL_REQUIRED";
}

/** DISABLED blocks new outbound/inbound cooperation. SMART_AUTOMATIC falls back to approval. */
export function cooperationModeAllowsExplicitRequest(mode) {
  return normalizeCooperationMode(mode) !== "DISABLED";
}

export function cooperationModeAllowsAccept(mode) {
  return normalizeCooperationMode(mode) !== "DISABLED";
}

export function assertOwnershipPreserved(before = {}, after = {}) {
  const keys = [
    "id",
    "officeId",
    "brokerId",
    "originatingOfficeId",
    "originatingBrokerId",
    "createdAt",
    "deduplicationFingerprint",
    "currentOwningOfficeId"
  ];
  const violations = [];
  for (const key of keys) {
    if (before[key] == null || before[key] === "") continue;
    if (String(after[key] ?? "") !== String(before[key])) {
      violations.push(key);
    }
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

export function minimumSharedFields(record = {}) {
  return {
    opportunityKind: String(record.opportunityKind || ""),
    purpose: String(record.purpose || ""),
    propertyType: String(record.propertyType || ""),
    city: String(record.city || ""),
    district: String(record.district || ""),
    priceOrBudget: record.priceOrBudget ?? record.price ?? null,
    area: record.area ?? null,
    rooms: record.rooms ?? null,
    dateAdded: record.createdAt || null,
    contactName: "",
    contactPhone: "",
    phone: ""
  };
}

export function buildSharedProjection({
  opportunityId,
  source = {},
  request = {},
  now = new Date()
} = {}) {
  const min = minimumSharedFields(source);
  return {
    id: String(opportunityId || ""),
    sourceOpportunityId: String(opportunityId || ""),
    originatingOfficeId: String(source.originatingOfficeId || source.officeId || request.originatingOfficeId || ""),
    currentOwningOfficeId: String(source.currentOwningOfficeId || source.officeId || source.originatingOfficeId || ""),
    ...min,
    cooperationStatus: "ACTIVE",
    sharedViaRequestId: String(request.id || request.cooperationId || ""),
    permissions: {
      readOnly: true,
      minimumData: true,
      contactVisible: false,
      ownershipModifiable: false,
      canDelete: false,
      canArchive: false,
      unrestrictedAttachmentDownload: false,
      canReshare: false,
      ...(request.permissions || {}),
      // Hard floor: contact never auto-exposed.
      contactVisible: false,
      ownershipModifiable: false,
      canDelete: false
    },
    contactName: "",
    contactPhone: "",
    phone: "",
    readOnly: true,
    revokedAt: null,
    updatedAt: now.toISOString(),
    schemaVersion: 1
  };
}

export function buildRevocationCleanupPlan(request = {}) {
  const opportunityIds = Array.isArray(request.opportunityIds) && request.opportunityIds.length
    ? request.opportunityIds.map(String)
    : (request.opportunityId ? [String(request.opportunityId)] : []);
  return {
    cooperationId: String(request.id || request.cooperationId || ""),
    originatingOfficeId: String(request.originatingOfficeId || ""),
    targetOfficeId: String(request.targetOfficeId || ""),
    opportunityIds,
    removeSharedProjections: true,
    updateOriginStatuses: true,
    terminalStatus: "REVOKED"
  };
}

export async function sha256Hex(value) {
  const data = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function defaultCooperationRequestPermissions() {
  return {
    readOnly: true,
    minimumData: true,
    contactVisible: false,
    ownershipModifiable: false,
    canDelete: false,
    canArchive: false,
    unrestrictedAttachmentDownload: false,
    canReshare: false
  };
}

export async function buildCooperationRequestId({
  originatingOfficeId,
  targetOfficeId,
  opportunityId = "",
  scopeType = "single",
  idNonce = ""
}) {
  const hex = await sha256Hex(
    `${String(originatingOfficeId || "").trim()}|${String(targetOfficeId || "").trim()}|${String(scopeType || "single")}|${String(opportunityId || "")}|${String(idNonce || "")}|PENDING`
  );
  return `coop_${hex.slice(0, 40)}`;
}

export async function cooperationAuditId({
  action,
  cooperationId = "",
  officeId = "",
  at = ""
}) {
  const hex = await sha256Hex(`${action}|${officeId}|${cooperationId}|${at}`);
  return `aud_${hex.slice(0, 40)}`;
}

export async function buildCooperationAuditEntry({
  action,
  officeId,
  actorUid = "",
  cooperationId = "",
  targetOfficeId = "",
  originatingOfficeId = "",
  opportunityIds = [],
  details = {},
  now = new Date()
}) {
  const createdAt = now.toISOString();
  const id = await cooperationAuditId({
    action,
    cooperationId,
    officeId,
    at: createdAt
  });
  return {
    id,
    officeId: String(officeId || ""),
    action: String(action || ""),
    actorUid: String(actorUid || ""),
    cooperationId: String(cooperationId || ""),
    originatingOfficeId: String(originatingOfficeId || ""),
    targetOfficeId: String(targetOfficeId || ""),
    opportunityIds: (opportunityIds || []).map(String),
    details: {
      // Never store phones or full contact payloads in audit details.
      ...sanitizeAuditDetails(details)
    },
    createdAt,
    schemaVersion: 1,
    createdBySystem: true
  };
}

function sanitizeAuditDetails(details = {}) {
  const blocked = new Set([
    "contactPhone", "phone", "contactName", "whatsapp", "rawText", "fcmToken"
  ]);
  const out = {};
  for (const [key, value] of Object.entries(details || {})) {
    if (blocked.has(key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      out[key] = value;
    } else if (Array.isArray(value)) {
      out[key] = value.map(String).slice(0, 40);
    }
  }
  return out;
}

export function applyCooperationDecision(request, decision, { now = new Date(), actorUid = "" } = {}) {
  const status = String(decision || "").toUpperCase();
  if (!request) return { ok: false, error: "missing_request" };

  if (status === "ACCEPT" || status === "ACCEPTED") {
    if (request.status === "ACCEPTED") return { ok: true, patch: null, idempotent: true };
    if (request.status !== "PENDING") return { ok: false, error: "not_pending" };
    return {
      ok: true,
      patch: {
        status: "ACCEPTED",
        respondedAt: now.toISOString(),
        acceptedAt: now.toISOString(),
        updatedAt: now.toISOString(),
        respondedBy: String(actorUid || "")
      }
    };
  }

  if (status === "REJECT" || status === "REJECTED") {
    if (request.status === "REJECTED") return { ok: true, patch: null, idempotent: true };
    if (request.status !== "PENDING" && request.status !== "DETAILS_REQUESTED") {
      return { ok: false, error: "not_pending" };
    }
    return {
      ok: true,
      patch: {
        status: "REJECTED",
        respondedAt: now.toISOString(),
        updatedAt: now.toISOString(),
        respondedBy: String(actorUid || "")
      }
    };
  }

  if (status === "REQUEST_DETAILS" || status === "DETAILS_REQUESTED") {
    if (request.status === "DETAILS_REQUESTED") return { ok: true, patch: null, idempotent: true };
    if (request.status !== "PENDING") return { ok: false, error: "not_pending" };
    return {
      ok: true,
      patch: {
        status: "DETAILS_REQUESTED",
        detailsRequestedAt: now.toISOString(),
        updatedAt: now.toISOString(),
        respondedBy: String(actorUid || "")
      }
    };
  }

  if (status === "REVOKE" || status === "REVOKED" || status === "END" || status === "ENDED") {
    if (["REVOKED", "ENDED"].includes(String(request.status || "").toUpperCase())) {
      return { ok: true, patch: null, idempotent: true };
    }
    return {
      ok: true,
      patch: {
        status: "REVOKED",
        revokedAt: now.toISOString(),
        endedAt: now.toISOString(),
        updatedAt: now.toISOString(),
        revokedBy: String(actorUid || "")
      }
    };
  }

  return { ok: false, error: "unknown_decision" };
}

export function opportunityStatusFromShare(status) {
  switch (String(status || "").toUpperCase()) {
    case "PENDING": return "PENDING_APPROVAL";
    case "ACCEPTED": return "ACTIVE";
    case "REJECTED": return "REJECTED";
    case "REVOKED":
    case "ENDED": return "ENDED";
    default: return "NOT_SHARED";
  }
}
