/**
 * Phase 3 — Opportunity Bank domain.
 * List/edit/archive/soft-delete and explicit cooperation/sharing structures.
 * No matching, no Operations Center items, no outbound messaging.
 */

import {
  COOPERATION_STATUS_LABELS,
  cooperationStatusLabel,
  formatDateAdded,
  opportunityAmountText,
  opportunityBankRow,
  safeText
} from "./office-domain.js";

export { COOPERATION_STATUS_LABELS, cooperationStatusLabel, opportunityBankRow };

export const BANK_PAGE_SIZE = 20;

export const LIFECYCLE = Object.freeze({
  ACTIVE: "ACTIVE",
  ARCHIVED: "ARCHIVED",
  DELETED: "DELETED"
});

export const COOPERATION_STATE = Object.freeze({
  NOT_SHARED: "NOT_SHARED",
  PENDING_APPROVAL: "PENDING_APPROVAL",
  ACTIVE: "ACTIVE",
  REJECTED: "REJECTED",
  ENDED: "ENDED"
});

export const SHARE_REQUEST_STATUS = Object.freeze({
  PENDING: "PENDING",
  ACCEPTED: "ACCEPTED",
  REJECTED: "REJECTED",
  REVOKED: "REVOKED",
  ENDED: "ENDED"
});

/** Fields the originating office may edit in Phase 3. */
export const EDITABLE_OPPORTUNITY_FIELDS = Object.freeze([
  "opportunityKind",
  "purpose",
  "propertyType",
  "city",
  "district",
  "nearbyDistricts",
  "priceOrBudget",
  "area",
  "rooms",
  "bathrooms",
  "contactName"
]);

/** Ownership / identity fields that must never mutate after create. */
export const PROTECTED_OWNERSHIP_FIELDS = Object.freeze([
  "id",
  "officeId",
  "brokerId",
  "originatingOfficeId",
  "originatingBrokerId",
  "currentOwningOfficeId",
  "createdAt",
  "deduplicationFingerprint",
  "sourceReference",
  "sourceType"
]);

/** Technical fields never rendered in broker-facing bank UI. */
export const HIDDEN_TECHNICAL_FIELDS = Object.freeze([
  "deduplicationFingerprint",
  "extractionConfidence",
  "dataCompleteness",
  "missingFields",
  "extractionMode",
  "extractionProvider",
  "rawText",
  "rawHints",
  "matchRuns",
  "confidence",
  "completeness",
  "missingFieldsJson",
  "queueState",
  "internalEventIds"
]);

export function normalizeLifecycle(value) {
  const key = String(value || LIFECYCLE.ACTIVE).trim().toUpperCase();
  return Object.values(LIFECYCLE).includes(key) ? key : LIFECYCLE.ACTIVE;
}

export function normalizeCooperationState(value) {
  const key = String(value || COOPERATION_STATE.NOT_SHARED).trim().toUpperCase();
  // Accept legacy cooperationStatus aliases.
  const aliases = {
    NOT_SHARED: COOPERATION_STATE.NOT_SHARED,
    PENDING: COOPERATION_STATE.PENDING_APPROVAL,
    PENDING_APPROVAL: COOPERATION_STATE.PENDING_APPROVAL,
    ACTIVE: COOPERATION_STATE.ACTIVE,
    REJECTED: COOPERATION_STATE.REJECTED,
    ENDED: COOPERATION_STATE.ENDED,
    REVOKED: COOPERATION_STATE.ENDED
  };
  return aliases[key] || COOPERATION_STATE.NOT_SHARED;
}

export function cooperationStateFromShareStatus(status) {
  switch (String(status || "").toUpperCase()) {
    case SHARE_REQUEST_STATUS.PENDING:
      return COOPERATION_STATE.PENDING_APPROVAL;
    case SHARE_REQUEST_STATUS.ACCEPTED:
      return COOPERATION_STATE.ACTIVE;
    case SHARE_REQUEST_STATUS.REJECTED:
      return COOPERATION_STATE.REJECTED;
    case SHARE_REQUEST_STATUS.REVOKED:
    case SHARE_REQUEST_STATUS.ENDED:
      return COOPERATION_STATE.ENDED;
    default:
      return COOPERATION_STATE.NOT_SHARED;
  }
}

export function isDeletedOpportunity(record = {}) {
  if (!record) return false;
  if (record.deletedAt) return true;
  return normalizeLifecycle(record.lifecycleStatus) === LIFECYCLE.DELETED;
}

export function isArchivedOpportunity(record = {}) {
  if (!record || isDeletedOpportunity(record)) return false;
  if (normalizeLifecycle(record.lifecycleStatus) === LIFECYCLE.ARCHIVED) return true;
  // Legacy docs that only stamped archivedAt without lifecycleStatus.
  if (!record.lifecycleStatus && record.archivedAt) return true;
  return false;
}

export function isActiveOpportunity(record = {}) {
  if (!record) return false;
  if (isDeletedOpportunity(record)) return false;
  if (isArchivedOpportunity(record)) return false;
  return true;
}

/**
 * Project a Phase 2/3 opportunity into the bank list row.
 * Extends Phase 1 projection with purpose and Phase 2 field aliases.
 */
export function bankListItem(id, record = {}) {
  const base = opportunityBankRow(id, {
    ...record,
    recordType: record.recordType
      || (record.opportunityKind === "OFFER" ? "owner" : record.opportunityKind === "REQUEST" ? "client" : record.recordType),
    price: record.price ?? record.priceOrBudget ?? record.amount,
    cooperationStatus: record.cooperationStatus || record.cooperationState || COOPERATION_STATE.NOT_SHARED
  });

  const purposeLabels = {
    SALE: "بيع",
    PURCHASE: "شراء",
    RENT: "إيجار",
    LEASE_REQUEST: "طلب إيجار"
  };

  return {
    ...base,
    purpose: purposeLabels[String(record.purpose || "").toUpperCase()] || safeText(record.purpose) || "—",
    opportunityKind: safeText(record.opportunityKind) || "",
    lifecycleStatus: normalizeLifecycle(record.lifecycleStatus),
    cooperationState: normalizeCooperationState(record.cooperationStatus || record.cooperationState),
    cooperationStatus: cooperationStatusLabel(record.cooperationStatus || record.cooperationState),
    selected: false
  };
}

export function bankDetailView(id, record = {}, { includeSource = false, source = null } = {}) {
  const item = bankListItem(id, record);
  const detail = {
    id: item.id,
    opportunityKind: item.kindLabel,
    purpose: item.purpose,
    propertyType: item.propertyType,
    city: safeText(record.city) || "—",
    district: safeText(record.district) || "—",
    nearbyDistricts: Array.isArray(record.nearbyDistricts) ? record.nearbyDistricts.map(safeText).filter(Boolean) : [],
    priceOrBudget: item.amountText,
    area: Number(record.area || 0) > 0 ? Number(record.area) : null,
    rooms: Number(record.rooms || 0) > 0 ? Number(record.rooms) : null,
    bathrooms: Number(record.bathrooms || 0) > 0 ? Number(record.bathrooms) : null,
    attributes: item.attributes,
    contactName: item.contactName || "",
    dateAdded: item.dateAdded,
    cooperationStatus: item.cooperationStatus,
    lifecycleStatus: item.lifecycleStatus,
    sourceType: safeText(record.sourceType),
    hasSourceReference: Boolean(record.sourceReference)
  };

  if (includeSource && source) {
    detail.sourcePreview = {
      sourceType: safeText(source.sourceType),
      text: safeText(source.text, 500),
      url: safeText(source.url, 500),
      fileName: safeText(source.fileName, 240),
      mediaPath: safeText(source.mediaPath, 500)
    };
  }

  // Guarantee technical fields never leak into the detail object.
  for (const key of HIDDEN_TECHNICAL_FIELDS) {
    if (key in detail) delete detail[key];
  }
  return detail;
}

export function assertNoOwnershipMutation(existing, patch) {
  const violations = [];
  for (const key of PROTECTED_OWNERSHIP_FIELDS) {
    if (patch[key] === undefined) continue;
    const before = existing[key];
    const after = patch[key];
    if (String(before ?? "") !== String(after ?? "")) violations.push(key);
  }
  return violations;
}

export function buildEditPatch(existing, input = {}, { now = new Date(), actorUid = "" } = {}) {
  const violations = assertNoOwnershipMutation(existing, input);
  if (violations.length) {
    return { ok: false, error: "ownership_fields_protected", violations };
  }

  const patch = {};
  for (const key of EDITABLE_OPPORTUNITY_FIELDS) {
    if (input[key] === undefined) continue;
    if (["priceOrBudget", "area", "rooms", "bathrooms"].includes(key)) {
      const num = Number(input[key]);
      patch[key] = Number.isFinite(num) ? num : null;
    } else if (key === "nearbyDistricts") {
      patch[key] = Array.isArray(input[key])
        ? input[key].map((value) => safeText(value, 80)).filter(Boolean).slice(0, 12)
        : [];
    } else {
      patch[key] = safeText(input[key], 120);
    }
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, error: "no_editable_fields" };
  }

  // Broker-confirmed values win — never reintroduce simulated extraction here.
  patch.updatedAt = now.toISOString();
  patch.updatedBy = safeText(actorUid, 120);
  patch.version = Number(existing.version || 1) + 1;
  patch.brokerConfirmed = true;
  // Keep list helpers in sync.
  if (patch.priceOrBudget !== undefined) patch.price = patch.priceOrBudget;
  if (patch.opportunityKind === "OFFER") patch.recordType = "owner";
  if (patch.opportunityKind === "REQUEST") patch.recordType = "client";

  return { ok: true, patch };
}

export function buildArchivePatch(existing, { now = new Date(), actorUid = "" } = {}) {
  if (existing.deletedAt || normalizeLifecycle(existing.lifecycleStatus) === LIFECYCLE.DELETED) {
    return { ok: false, error: "deleted" };
  }
  if (isArchivedOpportunity(existing)) {
    return { ok: true, patch: null, idempotent: true };
  }
  return {
    ok: true,
    idempotent: false,
    patch: {
      lifecycleStatus: LIFECYCLE.ARCHIVED,
      archivedAt: now.toISOString(),
      archivedBy: safeText(actorUid, 120),
      restoredAt: null,
      updatedAt: now.toISOString(),
      version: Number(existing.version || 1) + 1
    }
  };
}

export function buildRestorePatch(existing, { now = new Date(), actorUid = "" } = {}) {
  if (existing.deletedAt || normalizeLifecycle(existing.lifecycleStatus) === LIFECYCLE.DELETED) {
    return { ok: false, error: "deleted" };
  }
  if (isActiveOpportunity(existing) && !existing.archivedAt) {
    return { ok: true, patch: null, idempotent: true };
  }
  return {
    ok: true,
    idempotent: false,
    patch: {
      lifecycleStatus: LIFECYCLE.ACTIVE,
      restoredAt: now.toISOString(),
      restoredBy: safeText(actorUid, 120),
      archivedAt: null,
      archivedBy: null,
      updatedAt: now.toISOString(),
      version: Number(existing.version || 1) + 1
    }
  };
}

export function buildSoftDeletePatch(existing, { now = new Date(), actorUid = "", reason = "" } = {}) {
  if (existing.deletedAt || normalizeLifecycle(existing.lifecycleStatus) === LIFECYCLE.DELETED) {
    return { ok: true, patch: null, idempotent: true };
  }
  return {
    ok: true,
    idempotent: false,
    patch: {
      lifecycleStatus: LIFECYCLE.DELETED,
      deletedAt: now.toISOString(),
      deletedBy: safeText(actorUid, 120),
      deletionReason: safeText(reason, 200),
      updatedAt: now.toISOString(),
      version: Number(existing.version || 1) + 1
    }
  };
}

export function defaultSharePermissions() {
  return Object.freeze({
    readOnly: true,
    minimumData: true,
    contactVisible: false,
    ownershipModifiable: false,
    canDelete: false,
    canArchive: false,
    unrestrictedAttachmentDownload: false,
    canReshare: false
  });
}

export async function sha256Hex(value) {
  const data = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function cooperationRequestId({
  originatingOfficeId,
  targetOfficeId,
  opportunityId = "",
  scopeType = "single"
}) {
  const hex = await sha256Hex(
    `${safeText(originatingOfficeId)}|${safeText(targetOfficeId)}|${safeText(scopeType)}|${safeText(opportunityId)}|PENDING`
  );
  return `coop_${hex.slice(0, 40)}`;
}

export async function buildCooperationRequest({
  originatingOfficeId,
  originatingBrokerId,
  targetOfficeId,
  targetBrokerId = "",
  opportunityId = "",
  opportunityIds = null,
  scopeType = "single",
  now = new Date(),
  createdBy = ""
}) {
  const origin = safeText(originatingOfficeId, 80);
  const target = safeText(targetOfficeId, 80);
  if (!origin || !target) return { ok: false, error: "office_ids_required" };
  if (origin === target) return { ok: false, error: "same_office" };

  const ids = Array.isArray(opportunityIds)
    ? [...new Set(opportunityIds.map((id) => safeText(id, 80)).filter(Boolean))]
    : (opportunityId ? [safeText(opportunityId, 80)] : []);

  if (scopeType === "single" && ids.length !== 1) return { ok: false, error: "single_opportunity_required" };
  if (scopeType === "selected" && ids.length < 1) return { ok: false, error: "selection_required" };

  const id = await cooperationRequestId({
    originatingOfficeId: origin,
    targetOfficeId: target,
    opportunityId: scopeType === "single" ? ids[0] : ids.slice().sort().join(","),
    scopeType
  });

  return {
    ok: true,
    request: {
      id,
      originatingOfficeId: origin,
      originatingBrokerId: safeText(originatingBrokerId, 120),
      targetOfficeId: target,
      targetBrokerId: safeText(targetBrokerId, 120),
      opportunityId: scopeType === "single" ? ids[0] : "",
      opportunityIds: ids,
      scopeType,
      requestedAt: now.toISOString(),
      status: SHARE_REQUEST_STATUS.PENDING,
      permissions: { ...defaultSharePermissions() },
      createdBy: safeText(createdBy || originatingBrokerId, 120),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      respondedAt: null,
      acceptedAt: null,
      revokedAt: null,
      endedAt: null,
      revocationReason: "",
      schemaVersion: 1
    }
  };
}

export function applyCooperationDecision(request, decision, { now = new Date(), actorUid = "" } = {}) {
  const status = String(decision || "").toUpperCase();
  if (!request) return { ok: false, error: "missing_request" };

  if (status === "ACCEPT" || status === SHARE_REQUEST_STATUS.ACCEPTED) {
    if (request.status === SHARE_REQUEST_STATUS.ACCEPTED) {
      return { ok: true, patch: null, idempotent: true };
    }
    if (request.status !== SHARE_REQUEST_STATUS.PENDING) {
      return { ok: false, error: "not_pending" };
    }
    return {
      ok: true,
      patch: {
        status: SHARE_REQUEST_STATUS.ACCEPTED,
        respondedAt: now.toISOString(),
        acceptedAt: now.toISOString(),
        updatedAt: now.toISOString(),
        respondedBy: safeText(actorUid, 120)
      }
    };
  }

  if (status === "REJECT" || status === SHARE_REQUEST_STATUS.REJECTED) {
    if (request.status === SHARE_REQUEST_STATUS.REJECTED) {
      return { ok: true, patch: null, idempotent: true };
    }
    if (request.status !== SHARE_REQUEST_STATUS.PENDING) {
      return { ok: false, error: "not_pending" };
    }
    return {
      ok: true,
      patch: {
        status: SHARE_REQUEST_STATUS.REJECTED,
        respondedAt: now.toISOString(),
        updatedAt: now.toISOString(),
        respondedBy: safeText(actorUid, 120)
      }
    };
  }

  if (status === "REVOKE" || status === SHARE_REQUEST_STATUS.REVOKED || status === "END") {
    if ([SHARE_REQUEST_STATUS.REVOKED, SHARE_REQUEST_STATUS.ENDED].includes(request.status)) {
      return { ok: true, patch: null, idempotent: true };
    }
    return {
      ok: true,
      patch: {
        status: SHARE_REQUEST_STATUS.REVOKED,
        revokedAt: now.toISOString(),
        endedAt: now.toISOString(),
        updatedAt: now.toISOString(),
        revokedBy: safeText(actorUid, 120)
      }
    };
  }

  return { ok: false, error: "unknown_decision" };
}

/** Minimum shared projection — never includes contact or ownership-modifiable fields. */
export function sharedOpportunityProjection(opportunityId, record = {}, request = {}) {
  return {
    id: safeText(opportunityId, 80),
    sourceOpportunityId: safeText(opportunityId, 80),
    originatingOfficeId: safeText(record.originatingOfficeId || record.officeId, 80),
    opportunityKind: safeText(record.opportunityKind),
    purpose: safeText(record.purpose),
    propertyType: safeText(record.propertyType),
    city: safeText(record.city),
    district: safeText(record.district),
    priceOrBudget: record.priceOrBudget ?? record.price ?? null,
    area: record.area ?? null,
    rooms: record.rooms ?? null,
    dateAdded: record.createdAt || null,
    cooperationStatus: COOPERATION_STATE.ACTIVE,
    sharedViaRequestId: safeText(request.id, 80),
    permissions: { ...defaultSharePermissions(), ...(request.permissions || {}) },
    contactName: "",
    contactPhone: "",
    phone: "",
    readOnly: true
  };
}

export async function bankSharingScopeId({ originatingOfficeId, targetOfficeId, filterKey }) {
  const hex = await sha256Hex(
    `${safeText(originatingOfficeId)}|${safeText(targetOfficeId)}|${safeText(filterKey)}|ACTIVE`
  );
  return `scope_${hex.slice(0, 40)}`;
}

export async function buildBankSharingScope({
  originatingOfficeId,
  originatingBrokerId,
  targetOfficeId,
  filters = {},
  opportunityIds = [],
  enabled = false,
  now = new Date(),
  createdBy = ""
}) {
  const origin = safeText(originatingOfficeId, 80);
  const target = safeText(targetOfficeId, 80);
  if (!origin || !target) return { ok: false, error: "office_ids_required" };
  if (origin === target) return { ok: false, error: "same_office" };

  const normalizedFilters = {
    opportunityKind: safeText(filters.opportunityKind, 20),
    purpose: safeText(filters.purpose, 20),
    propertyType: safeText(filters.propertyType, 40),
    city: safeText(filters.city, 80),
    district: safeText(filters.district, 80),
    activeOnly: filters.activeOnly !== false
  };
  const explicitIds = [...new Set((opportunityIds || []).map((id) => safeText(id, 80)).filter(Boolean))];
  const filterKey = explicitIds.length
    ? `ids:${explicitIds.slice().sort().join(",")}`
    : JSON.stringify(normalizedFilters);

  const id = await bankSharingScopeId({ originatingOfficeId: origin, targetOfficeId: target, filterKey });

  return {
    ok: true,
    scope: {
      sharingScopeId: id,
      id,
      originatingOfficeId: origin,
      originatingBrokerId: safeText(originatingBrokerId, 120),
      targetOfficeId: target,
      filters: normalizedFilters,
      opportunityIds: explicitIds,
      permissions: { ...defaultSharePermissions() },
      status: enabled ? "ACTIVE" : "DISABLED",
      enabled: Boolean(enabled),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      revokedAt: null,
      createdBy: safeText(createdBy || originatingBrokerId, 120),
      schemaVersion: 1
    }
  };
}

export function scopeAllowsOpportunity(scope, opportunity = {}) {
  if (!scope || scope.status === "DISABLED" || scope.status === "REVOKED" || scope.enabled === false) {
    return false;
  }
  if (scope.revokedAt) return false;
  if (Array.isArray(scope.opportunityIds) && scope.opportunityIds.length) {
    return scope.opportunityIds.includes(opportunity.id || opportunity.opportunityId);
  }
  const filters = scope.filters || {};
  if (filters.activeOnly !== false && !isActiveOpportunity(opportunity)) return false;
  for (const key of ["opportunityKind", "purpose", "propertyType", "city", "district"]) {
    if (filters[key] && safeText(opportunity[key]) !== safeText(filters[key])) return false;
  }
  return true;
}

export function validateOwnedOpportunityIds(officeId, recordsById, requestedIds) {
  const office = safeText(officeId, 80);
  const accepted = [];
  const rejected = [];
  for (const id of requestedIds || []) {
    const record = recordsById.get(id) || recordsById[id];
    if (!record || safeText(record.officeId) !== office) {
      rejected.push(id);
    } else {
      accepted.push(id);
    }
  }
  return { ok: rejected.length === 0, accepted, rejected };
}

export function phase3BoundaryGuarantees() {
  return {
    createsMatch: false,
    createsOperation: false,
    sendsNotification: false,
    sendsWhatsApp: false,
    sendsTelegram: false,
    runsMatchingEngine: false
  };
}

/** Phase 6: ensure current owning office is always the source office unless already set. */
export function withCurrentOwningOffice(record = {}, officeId = "") {
  const owner = safeText(record.currentOwningOfficeId || record.officeId || officeId, 80);
  return {
    ...record,
    currentOwningOfficeId: owner
  };
}

export function buildScopeRevokePatch({ now = new Date(), actorUid = "", reason = "" } = {}) {
  return {
    status: "REVOKED",
    enabled: false,
    revokedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    revokedBy: safeText(actorUid, 120),
    revocationReason: safeText(reason, 200)
  };
}
