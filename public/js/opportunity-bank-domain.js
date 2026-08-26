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
import { evaluateMatchingReadiness } from "./opportunity-readiness-domain.js";
import { normalizePurpose } from "./opportunity-intake-domain.js";

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

export const SHARE_REQUEST_STATUS_LABELS = Object.freeze({
  PENDING: "بانتظار رد المكتب",
  ACCEPTED: "قَبِل المكتب",
  DETAILS_REQUESTED: "طلب تفاصيل",
  REJECTED: "اعتذر المكتب",
  REVOKED: "منتهية",
  ENDED: "منتهية",
  CLOSED: "منتهية"
});

export function shareRequestStatusLabel(status) {
  const key = String(status || "").trim().toUpperCase();
  return SHARE_REQUEST_STATUS_LABELS[key] || cooperationStatusLabel(status);
}

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
export function bankOpportunityKindDisplayLabel(record = {}) {
  const kind = String(record.opportunityKind || record.recordType || record.kind || "").toUpperCase();
  const purpose = String(record.purpose || "").toUpperCase();
  const isOffer = kind === "OFFER" || kind === "OWNER" || kind === "OWNER_OFFER";
  const isRequest = kind === "REQUEST" || kind === "CLIENT" || kind === "CLIENT_REQUEST";
  if (isOffer && purpose === "SALE") return "عرض بيع";
  if (isOffer && purpose === "RENT") return "عرض إيجار";
  if (isRequest && purpose === "PURCHASE") return "طلب شراء";
  if (isRequest && purpose === "LEASE_REQUEST") return "طلب استئجار";
  return "";
}

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

  const displayKindLabel = bankOpportunityKindDisplayLabel(record);

  return {
    ...base,
    kindLabel: displayKindLabel || base.kindLabel,
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
      const raw = input[key];
      if (raw === "" || raw === null) continue;
      const num = Number(raw);
      if (!Number.isFinite(num)) {
        return { ok: false, error: key === "priceOrBudget" ? "قيمة الميزانية غير صالحة." : "قيمة رقمية غير صالحة." };
      }
      patch[key] = num;
    } else if (key === "nearbyDistricts") {
      patch[key] = Array.isArray(input[key])
        ? input[key].map((value) => safeText(value, 80)).filter(Boolean).slice(0, 12)
        : [];
    } else if (key === "purpose") {
      patch[key] = normalizePurpose(input[key]);
    } else {
      patch[key] = safeText(input[key], 120);
    }
  }

  const nextPropertyType = patch.propertyType !== undefined
    ? patch.propertyType
    : existing.propertyType;
  if (/أرض|ارض/i.test(String(nextPropertyType || ""))) {
    patch.rooms = null;
    patch.bathrooms = null;
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
  if (patch.priceOrBudget !== undefined) {
    patch.price = patch.priceOrBudget;
    const purpose = String(patch.purpose || existing.purpose || "").toUpperCase();
    if (purpose === "PURCHASE" || purpose === "LEASE_REQUEST") {
      patch.budget = patch.priceOrBudget;
    } else if (purpose === "SALE") {
      patch.salePrice = patch.priceOrBudget;
    } else if (purpose === "RENT") {
      patch.annualRent = patch.priceOrBudget;
    }
  }
  if (patch.opportunityKind === "OFFER") patch.recordType = "owner";
  if (patch.opportunityKind === "REQUEST") patch.recordType = "client";

  return { ok: true, patch };
}

/**
 * Map a persisted bank record into review/extraction field shape (no DOM).
 */
export function recordToReviewFields(record = {}) {
  const purpose = safeText(record.purpose, 30).toUpperCase();
  const legacy = record.priceOrBudget ?? record.price ?? record.budget ?? record.annualRent ?? null;
  return {
    opportunityKind: safeText(record.opportunityKind, 20),
    purpose: purpose || safeText(record.purpose, 30),
    propertyType: safeText(record.propertyType, 80),
    city: safeText(record.city, 80),
    district: safeText(record.district, 80),
    area: record.area ?? "",
    rooms: record.rooms ?? "",
    bathrooms: record.bathrooms ?? "",
    floorNumber: record.floorNumber ?? "",
    priceOrBudget: legacy,
    salePrice: record.salePrice ?? "",
    annualRent: record.annualRent ?? "",
    budget: record.budget ?? legacy ?? "",
    advertiserRole: safeText(record.advertiserRole, 20),
    advertiserPhoneNormalized: safeText(record.advertiserPhoneNormalized || record.contactPhone, 20),
    extended: {
      purpose: purpose || safeText(record.purpose, 30),
      opportunityKind: safeText(record.opportunityKind, 20),
      propertyType: safeText(record.propertyType, 80),
      city: safeText(record.city, 80),
      district: safeText(record.district, 80),
      salePrice: record.salePrice ?? null,
      annualRent: record.annualRent ?? null,
      budget: record.budget ?? null,
      area: record.area ?? null,
      rooms: record.rooms ?? null,
      bathrooms: record.bathrooms ?? null,
      floorNumber: record.floorNumber ?? null
    }
  };
}

/**
 * Build a broker-review completion patch for an existing opportunity (same opportunityId).
 */
export function buildReviewCompletionPatch(
  existing,
  brokerExtras = {},
  { now = new Date(), actorUid = "" } = {}
) {
  const input = {
    opportunityKind: brokerExtras.opportunityKind,
    purpose: brokerExtras.purpose,
    propertyType: brokerExtras.propertyType,
    city: brokerExtras.city,
    district: brokerExtras.district,
    priceOrBudget: brokerExtras.priceOrBudget,
    area: brokerExtras.area,
    rooms: brokerExtras.rooms,
    bathrooms: brokerExtras.bathrooms
  };
  const result = buildEditPatch(existing, input, { now, actorUid });
  if (!result.ok) return result;

  const patch = { ...result.patch };
  if (brokerExtras.salePrice != null) patch.salePrice = brokerExtras.salePrice;
  if (brokerExtras.budget != null) patch.budget = brokerExtras.budget;
  if (brokerExtras.annualRent != null) patch.annualRent = brokerExtras.annualRent;
  if (brokerExtras.monthlyRent != null) patch.monthlyRent = brokerExtras.monthlyRent;
  if (brokerExtras.paymentInstallments != null) {
    patch.paymentInstallments = brokerExtras.paymentInstallments;
  }
  if (brokerExtras.optionalMonthlyRentAfterSixMonths != null) {
    patch.optionalMonthlyRentAfterSixMonths = brokerExtras.optionalMonthlyRentAfterSixMonths;
  }
  if (brokerExtras.floorNumber != null) patch.floorNumber = brokerExtras.floorNumber;

  return { ok: true, patch };
}

export function readinessMissingToNeedsReview(missing = [], record = {}) {
  const needs = {};
  const purpose = safeText(record.purpose, 30).toUpperCase();
  for (const key of missing) {
    if (key === "priceOrBudget") {
      if (purpose === "SALE") needs.salePrice = true;
      else if (purpose === "RENT") needs.annualRent = true;
      else needs.budget = true;
    } else if (key === "contactPhone") {
      needs.advertiserPhone = true;
    } else if (key === "advertiserRole") {
      needs.advertiserRole = true;
    } else {
      needs[key] = true;
    }
  }
  return needs;
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
      preArchiveLifecycleStatus: safeText(existing.lifecycleStatus, 40) || LIFECYCLE.ACTIVE,
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
  const readiness = evaluateMatchingReadiness({
    ...existing,
    archivedAt: null,
    archivedBy: null,
    lifecycleStatus: existing.preArchiveLifecycleStatus || LIFECYCLE.ACTIVE
  });
  const nextLifecycle = readiness.isReadyForMatching
    ? (safeText(existing.preArchiveLifecycleStatus, 40) || "NEW")
    : "NEW";
  return {
    ok: true,
    idempotent: false,
    patch: {
      lifecycleStatus: nextLifecycle === LIFECYCLE.ARCHIVED || nextLifecycle === LIFECYCLE.DELETED
        ? "NEW"
        : nextLifecycle,
      matchingReadiness: readiness.matchingReadiness,
      matchingReadinessMissing: readiness.matchingReadinessMissing,
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

export function validatePermanentDelete(record, { officeId = "" } = {}) {
  if (!record) return { allowed: false, reason: "الفرصة غير موجودة" };
  const currentOffice = safeText(officeId, 80);
  const ownerOffice = safeText(record.officeId, 80);
  const originOffice = safeText(record.originatingOfficeId, 80);
  if (!currentOffice || ownerOffice !== currentOffice) {
    return { allowed: false, reason: "لا يمكن حذف فرصة لا تملكها مكتبك" };
  }
  if (originOffice && originOffice !== currentOffice) {
    return { allowed: false, reason: "هذه فرصة مشاركة من مكتب آخر" };
  }
  if (record.activeCooperationId) {
    return { allowed: false, reason: "لا يمكن الحذف لوجود طلب تعاون نشط" };
  }
  const archived = isArchivedOpportunity(record);
  if (!archived) {
    return { allowed: false, reason: "انقل الفرصة إلى المؤرشفة قبل الحذف النهائي" };
  }
  return { allowed: true };
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
  scopeType = "single",
  idNonce = ""
}) {
  const hex = await sha256Hex(
    `${safeText(originatingOfficeId)}|${safeText(targetOfficeId)}|${safeText(scopeType)}|${safeText(opportunityId)}|${safeText(idNonce)}|PENDING`
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
  idNonce = "",
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
    scopeType,
    idNonce
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
