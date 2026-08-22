/**
 * Phase 5 — Operations Center + in-app Notifications domain.
 * Pure builders for system-generated Operations and Notifications.
 * No WhatsApp/Telegram/message drafts/automatic cooperation.
 */

export const OPERATION_TYPES = Object.freeze({
  MATCH_REVIEW: "MATCH_REVIEW",
  MISSING_DATA: "MISSING_DATA",
  COOPERATION_REQUEST: "COOPERATION_REQUEST",
  COOPERATION_RESPONSE: "COOPERATION_RESPONSE",
  EXTERNAL_RESPONSE: "EXTERNAL_RESPONSE",
  SYSTEM_ACTION: "SYSTEM_ACTION"
});

export const OPERATION_STATUS = Object.freeze({
  OPEN: "OPEN",
  IN_PROGRESS: "IN_PROGRESS",
  WAITING_EXTERNAL_RESPONSE: "WAITING_EXTERNAL_RESPONSE",
  COMPLETED: "COMPLETED",
  DISMISSED: "DISMISSED",
  EXPIRED: "EXPIRED"
});

export const OPERATION_PRIORITY = Object.freeze({
  URGENT: "URGENT",
  HIGH: "HIGH",
  NORMAL: "NORMAL",
  LOW: "LOW"
});

export const NOTIFICATION_TYPES = Object.freeze({
  NEW_MATCH: "NEW_MATCH",
  MISSING_DATA: "MISSING_DATA",
  COOPERATION_REQUEST: "COOPERATION_REQUEST",
  COOPERATION_RESPONSE: "COOPERATION_RESPONSE",
  SYSTEM_ACTION: "SYSTEM_ACTION"
});

export const NOTIFICATION_STATUS = Object.freeze({
  CREATED: "CREATED",
  QUEUED: "QUEUED",
  SENT: "SENT",
  DELIVERED: "DELIVERED",
  FAILED: "FAILED",
  READ: "READ",
  DISMISSED: "DISMISSED"
});

export const ACTIVE_OPERATION_STATUSES = Object.freeze([
  OPERATION_STATUS.OPEN,
  OPERATION_STATUS.IN_PROGRESS,
  OPERATION_STATUS.WAITING_EXTERNAL_RESPONSE
]);

const TYPE_COPY = Object.freeze({
  MATCH_REVIEW: {
    title: "مطابقة جديدة تحتاج مراجعتك",
    summary: "ظهرت مطابقة جاهزة للمراجعة داخل مكتبكم.",
    action: "مراجعة المطابقة",
    push: "وجدنا مطابقة جديدة",
    notificationType: NOTIFICATION_TYPES.NEW_MATCH
  },
  MISSING_DATA: {
    title: "بيانات ناقصة في فرصة",
    summary: "يلزم استكمال بيانات مطلوبة قبل متابعة الفرصة.",
    action: "استكمال البيانات",
    push: "توجد بيانات ناقصة في إحدى فرصك.",
    notificationType: NOTIFICATION_TYPES.MISSING_DATA
  },
  COOPERATION_REQUEST: {
    title: "طلب تعاون جديد",
    summary: "وصل طلب تعاون صريح يحتاج ردكم.",
    action: "مراجعة طلب التعاون",
    push: "وصل طلب تعاون جديد.",
    notificationType: NOTIFICATION_TYPES.COOPERATION_REQUEST
  },
  COOPERATION_RESPONSE: {
    title: "تحديث على طلب التعاون",
    summary: "تم تسجيل رد على طلب تعاون.",
    action: "عرض حالة التعاون",
    push: "يوجد تحديث على طلب تعاون.",
    notificationType: NOTIFICATION_TYPES.COOPERATION_RESPONSE
  },
  EXTERNAL_RESPONSE: {
    title: "رد يحتاج متابعتك",
    summary: "وصل رد مرتبط بفرصة تتطلب إجراءً.",
    action: "مراجعة الرد",
    push: "لديك رد يحتاج متابعتك.",
    notificationType: NOTIFICATION_TYPES.SYSTEM_ACTION
  },
  SYSTEM_ACTION: {
    title: "إجراء نظامي مطلوب",
    summary: "يوجد إجراء نظامي يحتاج انتباه المكتب.",
    action: "عرض التفاصيل",
    push: "يوجد إشعار نظامي يحتاج مراجعتك.",
    notificationType: NOTIFICATION_TYPES.SYSTEM_ACTION
  }
});

export function phase5BoundaryGuarantees() {
  return {
    // Phase 7: draft generation is real; Cloud API / Bot send remains off.
    createsWhatsAppMessage: true,
    sendsWhatsApp: false,
    createsTelegramMessage: true,
    sendsTelegram: false,
    createsSmartMessageDraft: true,
    createsAutomaticCooperation: false,
    createsBrokerRecommendation: false,
    createsDeal: false,
    createsCommission: false,
    addsDealsPage: false,
    addsBottomNavigation: false
  };
}

export function isActiveOperationStatus(status) {
  return ACTIVE_OPERATION_STATUSES.includes(String(status || "").toUpperCase());
}

export function priorityRank(priority) {
  switch (String(priority || "").toUpperCase()) {
    case OPERATION_PRIORITY.URGENT: return 0;
    case OPERATION_PRIORITY.HIGH: return 1;
    case OPERATION_PRIORITY.NORMAL: return 2;
    case OPERATION_PRIORITY.LOW: return 3;
    default: return 2;
  }
}

export function matchReviewPriority({ opportunityScore = 0, score = 0, isBestOpportunity = false } = {}) {
  const value = Number(opportunityScore || score || 0);
  if (isBestOpportunity || value >= 88) return OPERATION_PRIORITY.HIGH;
  if (value >= 72) return OPERATION_PRIORITY.HIGH;
  if (value >= 55) return OPERATION_PRIORITY.NORMAL;
  return OPERATION_PRIORITY.LOW;
}

export function missingDataPriority({ missingFields = [] } = {}) {
  const count = Array.isArray(missingFields) ? missingFields.length : 0;
  return count >= 4 ? OPERATION_PRIORITY.HIGH : OPERATION_PRIORITY.NORMAL;
}

export async function sha256Hex(value) {
  const data = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function operationDocumentId(deduplicationKey) {
  const hex = await sha256Hex(String(deduplicationKey || ""));
  return `op_${hex.slice(0, 40)}`;
}

export async function notificationDocumentId(deduplicationKey) {
  const hex = await sha256Hex(`notif|${String(deduplicationKey || "")}`);
  return `nt_${hex.slice(0, 40)}`;
}

export function buildMatchReviewDedupKey({ officeId, matchId, dataVersion = "" }) {
  return [
    OPERATION_TYPES.MATCH_REVIEW,
    String(officeId || ""),
    String(matchId || ""),
    String(dataVersion || "v0")
  ].join("|");
}

export function buildMissingDataDedupKey({ officeId, opportunityId, dataVersion = "", missingFields = [] }) {
  const fields = [...new Set((missingFields || []).map((f) => String(f || "").trim()).filter(Boolean))].sort();
  return [
    OPERATION_TYPES.MISSING_DATA,
    String(officeId || ""),
    String(opportunityId || ""),
    String(dataVersion || "v0"),
    fields.join(",")
  ].join("|");
}

export function buildCooperationDedupKey({
  type = OPERATION_TYPES.COOPERATION_REQUEST,
  officeId,
  cooperationId,
  status = ""
}) {
  return [
    String(type || OPERATION_TYPES.COOPERATION_REQUEST),
    String(officeId || ""),
    String(cooperationId || ""),
    String(status || "")
  ].join("|");
}

function copyFor(type) {
  return TYPE_COPY[type] || TYPE_COPY.SYSTEM_ACTION;
}

export async function buildMatchReviewOperation({
  officeId,
  assignedBrokerId = "",
  matchId,
  opportunityId = "",
  counterpartOpportunityId = "",
  dataVersion = "",
  score = 0,
  opportunityScore = 0,
  isBestOpportunity = false,
  reasons = [],
  now = new Date()
}) {
  const type = OPERATION_TYPES.MATCH_REVIEW;
  const copy = copyFor(type);
  const deduplicationKey = buildMatchReviewDedupKey({ officeId, matchId, dataVersion });
  const id = await operationDocumentId(deduplicationKey);
  const priority = matchReviewPriority({ opportunityScore, score, isBestOpportunity });
  const reasonText = Array.isArray(reasons) && reasons.length
    ? reasons.slice(0, 2).join("، ")
    : "مطابقة ضمن الحد المعتمد";
  return {
    id,
    officeId: String(officeId || ""),
    assignedBrokerId: String(assignedBrokerId || ""),
    type,
    sourceEntityType: "match",
    sourceEntityId: String(matchId || ""),
    opportunityId: String(opportunityId || ""),
    matchId: String(matchId || ""),
    cooperationId: "",
    titleCode: "MATCH_REVIEW_TITLE",
    summaryCode: "MATCH_REVIEW_SUMMARY",
    titleText: copy.title,
    summaryText: `${copy.summary} ${reasonText}`.trim(),
    recommendedActionCode: "REVIEW_MATCH",
    recommendedActionText: copy.action,
    priority,
    status: OPERATION_STATUS.OPEN,
    deduplicationKey,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    openedAt: null,
    completedAt: null,
    dismissedAt: null,
    dueAt: null,
    createdBySystem: true,
    operationVersion: 1,
    schemaVersion: 1,
    metadata: {
      score: Number(score || 0),
      opportunityScore: Number(opportunityScore || 0),
      isBestOpportunity: Boolean(isBestOpportunity),
      counterpartOpportunityId: String(counterpartOpportunityId || ""),
      dataVersion: String(dataVersion || ""),
      reasonPreview: reasonText
    }
  };
}

export async function buildMissingDataOperation({
  officeId,
  assignedBrokerId = "",
  opportunityId,
  missingFields = [],
  dataVersion = "",
  now = new Date()
}) {
  const type = OPERATION_TYPES.MISSING_DATA;
  const copy = copyFor(type);
  const fields = [...new Set((missingFields || []).map((f) => String(f || "").trim()).filter(Boolean))];
  const deduplicationKey = buildMissingDataDedupKey({
    officeId, opportunityId, dataVersion, missingFields: fields
  });
  const id = await operationDocumentId(deduplicationKey);
  return {
    id,
    officeId: String(officeId || ""),
    assignedBrokerId: String(assignedBrokerId || ""),
    type,
    sourceEntityType: "opportunity",
    sourceEntityId: String(opportunityId || ""),
    opportunityId: String(opportunityId || ""),
    matchId: "",
    cooperationId: "",
    titleCode: "MISSING_DATA_TITLE",
    summaryCode: "MISSING_DATA_SUMMARY",
    titleText: copy.title,
    summaryText: fields.length
      ? `${copy.summary} الحقول الناقصة: ${fields.join("، ")}.`
      : copy.summary,
    recommendedActionCode: "COMPLETE_DATA",
    recommendedActionText: copy.action,
    priority: missingDataPriority({ missingFields: fields }),
    status: OPERATION_STATUS.OPEN,
    deduplicationKey,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    openedAt: null,
    completedAt: null,
    dismissedAt: null,
    dueAt: null,
    createdBySystem: true,
    operationVersion: 1,
    schemaVersion: 1,
    metadata: {
      missingFields: fields,
      dataVersion: String(dataVersion || "")
    }
  };
}

export async function buildCooperationOperation({
  officeId,
  assignedBrokerId = "",
  cooperationId,
  opportunityId = "",
  responseStatus = "PENDING",
  isResponse = false,
  now = new Date()
}) {
  const type = isResponse ? OPERATION_TYPES.COOPERATION_RESPONSE : OPERATION_TYPES.COOPERATION_REQUEST;
  const copy = copyFor(type);
  const deduplicationKey = buildCooperationDedupKey({
    type, officeId, cooperationId, status: responseStatus
  });
  const id = await operationDocumentId(deduplicationKey);
  const statusLabel = String(responseStatus || "PENDING").toUpperCase();
  return {
    id,
    officeId: String(officeId || ""),
    assignedBrokerId: String(assignedBrokerId || ""),
    type,
    sourceEntityType: "cooperationRequest",
    sourceEntityId: String(cooperationId || ""),
    opportunityId: String(opportunityId || ""),
    matchId: "",
    cooperationId: String(cooperationId || ""),
    titleCode: isResponse ? "COOPERATION_RESPONSE_TITLE" : "COOPERATION_REQUEST_TITLE",
    summaryCode: isResponse ? "COOPERATION_RESPONSE_SUMMARY" : "COOPERATION_REQUEST_SUMMARY",
    titleText: copy.title,
    summaryText: isResponse
      ? `${copy.summary} الحالة: ${statusLabel}.`
      : copy.summary,
    recommendedActionCode: isResponse ? "VIEW_COOPERATION" : "REVIEW_COOPERATION",
    recommendedActionText: copy.action,
    priority: OPERATION_PRIORITY.NORMAL,
    status: OPERATION_STATUS.OPEN,
    deduplicationKey,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    openedAt: null,
    completedAt: null,
    dismissedAt: null,
    dueAt: null,
    createdBySystem: true,
    operationVersion: 1,
    schemaVersion: 1,
    metadata: {
      cooperationStatus: statusLabel
    }
  };
}

export async function buildInAppNotification({
  officeId,
  brokerId = "",
  operation,
  now = new Date()
}) {
  const copy = copyFor(operation.type);
  const deduplicationKey = `NOTIF|${operation.deduplicationKey}`;
  const id = await notificationDocumentId(deduplicationKey);
  return {
    id,
    officeId: String(officeId || operation.officeId || ""),
    brokerId: String(brokerId || operation.assignedBrokerId || ""),
    operationId: String(operation.id || ""),
    type: copy.notificationType,
    title: copy.push,
    body: copy.push,
    status: NOTIFICATION_STATUS.CREATED,
    readAt: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    deduplicationKey,
    deliveryChannels: ["in_app", "push"],
    providerState: {
      push: "QUEUED",
      pushSentAt: null,
      pushDeliveredAt: null,
      pushFailedAt: null,
      pushError: ""
    },
    sensitivePreview: false,
    schemaVersion: 1,
    createdBySystem: true
  };
}

export function applyOperationLifecycle(existing, action, { now = new Date(), reason = "" } = {}) {
  const current = String(existing?.status || OPERATION_STATUS.OPEN).toUpperCase();
  const next = String(action || "").toUpperCase();
  if (!existing) return { ok: false, error: "missing_operation" };

  if (next === "OPEN" || next === "VIEW") {
    if (current === OPERATION_STATUS.COMPLETED || current === OPERATION_STATUS.DISMISSED || current === OPERATION_STATUS.EXPIRED) {
      return { ok: false, error: "terminal_status" };
    }
    return {
      ok: true,
      patch: {
        openedAt: existing.openedAt || now.toISOString(),
        updatedAt: now.toISOString(),
        status: current === OPERATION_STATUS.OPEN ? OPERATION_STATUS.OPEN : current
      }
    };
  }

  if (next === "START" || next === "IN_PROGRESS") {
    if (![OPERATION_STATUS.OPEN, OPERATION_STATUS.IN_PROGRESS].includes(current)) {
      return { ok: false, error: "invalid_transition" };
    }
    return {
      ok: true,
      patch: {
        status: OPERATION_STATUS.IN_PROGRESS,
        openedAt: existing.openedAt || now.toISOString(),
        updatedAt: now.toISOString()
      }
    };
  }

  if (next === "COMPLETE" || next === "COMPLETED") {
    if ([OPERATION_STATUS.COMPLETED, OPERATION_STATUS.DISMISSED, OPERATION_STATUS.EXPIRED].includes(current)) {
      return { ok: true, patch: null, idempotent: true };
    }
    return {
      ok: true,
      patch: {
        status: OPERATION_STATUS.COMPLETED,
        completedAt: now.toISOString(),
        updatedAt: now.toISOString()
      }
    };
  }

  if (next === "DISMISS" || next === "DISMISSED") {
    if (current === OPERATION_STATUS.DISMISSED) {
      return { ok: true, patch: null, idempotent: true };
    }
    if (current === OPERATION_STATUS.COMPLETED || current === OPERATION_STATUS.EXPIRED) {
      return { ok: false, error: "invalid_transition" };
    }
    return {
      ok: true,
      patch: {
        status: OPERATION_STATUS.DISMISSED,
        dismissedAt: now.toISOString(),
        dismissalReason: String(reason || "").slice(0, 200),
        updatedAt: now.toISOString()
      }
    };
  }

  if (next === "EXPIRE" || next === "EXPIRED") {
    if ([OPERATION_STATUS.COMPLETED, OPERATION_STATUS.DISMISSED, OPERATION_STATUS.EXPIRED].includes(current)) {
      return { ok: true, patch: null, idempotent: true };
    }
    return {
      ok: true,
      patch: {
        status: OPERATION_STATUS.EXPIRED,
        updatedAt: now.toISOString()
      }
    };
  }

  return { ok: false, error: "unknown_action" };
}

export function shouldCreateMatchReview({ score = 0, threshold = 55, isCurrent = true, status = "active" } = {}) {
  if (isCurrent === false) return false;
  if (String(status || "").toLowerCase() === "superseded") return false;
  return Number(score || 0) >= Number(threshold || 55);
}
