/**
 * Phase 5 — client Operations Center + Notifications contracts.
 * Projects persisted Operations into the shell list; lifecycle mutations go through Worker.
 * Phase 7: MATCH_REVIEW / EXTERNAL_RESPONSE may offer smart message *draft* actions
 * (never auto-send; never claim delivery).
 */

export const OPERATION_TYPES = Object.freeze({
  MATCH_REVIEW: "MATCH_REVIEW",
  MISSING_DATA: "MISSING_DATA",
  COOPERATION_REQUEST: "COOPERATION_REQUEST",
  COOPERATION_RESPONSE: "COOPERATION_RESPONSE",
  COOPERATION_MATCH: "COOPERATION_MATCH",
  EXTERNAL_RESPONSE: "EXTERNAL_RESPONSE",
  SYSTEM_ACTION: "SYSTEM_ACTION",
  PLATFORM_OPPORTUNITY_OFFER: "PLATFORM_OPPORTUNITY_OFFER"
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

export const ACTIVE_OPERATION_STATUSES = Object.freeze([
  OPERATION_STATUS.OPEN,
  OPERATION_STATUS.IN_PROGRESS,
  OPERATION_STATUS.WAITING_EXTERNAL_RESPONSE
]);

export const OPERATIONS_ACTION_PATH = "/operations/action";
export const OPERATIONS_COOPERATION_PATH = "/operations/from-cooperation";
export const OPERATIONS_MISSING_DATA_PATH = "/operations/missing-data";

const TYPE_ICONS = Object.freeze({
  MATCH_REVIEW: "i-match",
  MISSING_DATA: "i-clipboard-list",
  COOPERATION_REQUEST: "i-user-clock",
  COOPERATION_RESPONSE: "i-user-clock",
  COOPERATION_MATCH: "i-user-clock",
  EXTERNAL_RESPONSE: "i-clipboard-list",
  PLATFORM_OPPORTUNITY_OFFER: "i-clipboard-list"
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

export function priorityLabel(priority) {
  switch (String(priority || "").toUpperCase()) {
    case OPERATION_PRIORITY.URGENT: return "عاجل";
    case OPERATION_PRIORITY.HIGH: return "مرتفع";
    case OPERATION_PRIORITY.NORMAL: return "عادي";
    case OPERATION_PRIORITY.LOW: return "منخفض";
    default: return "عادي";
  }
}

function parseMetadata(raw) {
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      return {};
    }
  }
  return {};
}

function isoFrom(value) {
  if (!value && value !== 0) return "";
  if (typeof value === "string") return value;
  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.toISOString() : "";
  }
  if (typeof value === "object" && (value.seconds != null || value._seconds != null)) {
    const date = new Date(Number(value.seconds ?? value._seconds) * 1000);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function missingFieldsFrom(op, metadata) {
  if (Array.isArray(op.missingFields)) return op.missingFields.map(String);
  if (typeof op.missingFieldsJson === "string") {
    try {
      const parsed = JSON.parse(op.missingFieldsJson);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch (_) {
      return [];
    }
  }
  if (Array.isArray(metadata.missingFields)) return metadata.missingFields.map(String);
  return [];
}

/** Match living writes ownerContactNeeded on matches; operations may only carry nextActor. */
export function resolveOwnerContactNeeded(op = {}, metadata = {}) {
  if (metadata.ownerContactNeeded === true || metadata.ownerContactNeeded === "true") return true;
  if (op.ownerContactNeeded === true || String(op.ownerContactNeeded || "").toLowerCase() === "true") {
    return true;
  }
  const stage = String(op.livingStage || metadata.livingStage || "").toUpperCase();
  const actor = String(op.nextActor || metadata.nextActor || "").toUpperCase();
  return stage === "WAITING_PROPERTY_CONFIRMATION" && actor === "BROKER";
}

/** Project a persisted Operation document into the Operations Center card contract. */
export function projectOperationToUiItem(op, { relativeTime = () => "الآن" } = {}) {
  const type = String(op.type || OPERATION_TYPES.SYSTEM_ACTION).toUpperCase();
  const metadata = parseMetadata(op.metadata || op.metadataJson);
  const missingFields = missingFieldsFrom(op, metadata);
  const status = String(op.status || OPERATION_STATUS.OPEN).toUpperCase();
  const priority = String(op.priority || OPERATION_PRIORITY.NORMAL).toUpperCase();
  let title = String(op.titleText || "إجراء مطلوب");
  let summary = String(op.summaryText || "");
  let action = String(op.recommendedActionText || "عرض التفاصيل");
  const detailsLines = summary ? [summary] : [];

  if (type === OPERATION_TYPES.MISSING_DATA) {
    title = "استكمال بيانات الفرصة";
    summary = "يرجى استكمال البيانات لتفعيل المطابقة.";
    action = "استكمال البيانات";
    detailsLines.length = 0;
    detailsLines.push(summary);
  }

  if (type === OPERATION_TYPES.MATCH_REVIEW) {
    const score = Number(metadata.opportunityScore || metadata.score || op.score || 0);
    if (score > 0) detailsLines.push(`نسبة المطابقة: ${score}%`);
    if (metadata.reasonPreview) detailsLines.push(`أسباب المطابقة: ${metadata.reasonPreview}`);
    detailsLines.push("الإجراء المطلوب: مراجعة المطابقة داخل المكتب.");
  } else if (type === OPERATION_TYPES.MISSING_DATA) {
    if (missingFields.length) {
      detailsLines.push(`الحقول الناقصة: ${missingFields.join("، ")}`);
    }
    detailsLines.push("الإجراء المطلوب: استكمال البيانات ثم إعادة المطابقة.");
  } else if (type === OPERATION_TYPES.COOPERATION_REQUEST || type === OPERATION_TYPES.COOPERATION_RESPONSE) {
    if (metadata.cooperationStatus) {
      detailsLines.push(`حالة التعاون: ${metadata.cooperationStatus}`);
    }
    detailsLines.push("الإجراء المطلوب: مراجعة طلب التعاون الصريح فقط.");
  }

  detailsLines.push(`الأولوية: ${priorityLabel(priority)}`);
  detailsLines.push(`الحالة: ${status}`);

  // Phase 7: Match / external-response ops can generate drafts; never claim send.
  const canDraftMessage = type === OPERATION_TYPES.MATCH_REVIEW
    || type === OPERATION_TYPES.EXTERNAL_RESPONSE;

  const matchingReadinessMissing = type === OPERATION_TYPES.MISSING_DATA && missingFields.length
    ? missingFields
    : [];
  const matchingReadiness = matchingReadinessMissing.length
    ? "NEEDS_COMPLETION"
    : (type === OPERATION_TYPES.MISSING_DATA ? "NEEDS_COMPLETION" : "");

  return {
    id: String(op.id || ""),
    recordId: String(op.id || ""),
    recordType: "operation",
    operationType: type,
    main: "opportunities",
    priority: priorityRank(priority),
    priorityKey: priority,
    priorityLabel: priorityLabel(priority),
    isAlert: priority === OPERATION_PRIORITY.URGENT || priority === OPERATION_PRIORITY.HIGH,
    icon: TYPE_ICONS[type] || "i-clipboard-list",
    title,
    subtitle: summary,
    time: relativeTime(op.updatedAt || op.createdAt),
    detailsLines,
    status,
    statusLabel: status,
    actionLabel: action,
    secondaryActionLabel: "إتمام",
    canDismiss: isActiveOperationStatus(status),
    dismissLabel: "صرف النظر",
    matchId: String(op.matchId || ""),
    opportunityId: String(op.opportunityId || ""),
    clientRequestId: String(metadata.clientRequestId || op.clientRequestId || ""),
    ownerOfferId: String(metadata.ownerOfferId || op.ownerOfferId || ""),
    requestId: String(metadata.clientRequestId || op.clientRequestId || metadata.requestId || ""),
    offerId: String(metadata.ownerOfferId || op.ownerOfferId || metadata.offerId || ""),
    integrityStatus: String(op.integrityStatus || metadata.integrityStatus || ""),
    integrityReason: String(op.integrityReason || metadata.integrityReason || ""),
    matchGroupId: String(metadata.matchGroupId || op.opportunityId || ""),
    sourceCollection: String(metadata.sourceCollection || ""),
    score: Number(metadata.score || op.score || 0),
    opportunityScore: Number(metadata.opportunityScore || 0),
    isBestOpportunity: Boolean(metadata.isBestOpportunity),
    coordinationOutcome: String(op.coordinationOutcome || metadata.coordinationOutcome || ""),
    coordinationBrokerLine: String(op.coordinationBrokerLine || metadata.coordinationBrokerLine || ""),
    livingStage: String(op.livingStage || metadata.livingStage || ""),
    livingTimeline: (() => {
      const raw = op.livingTimeline || op.livingTimelineJson || metadata.livingTimeline || metadata.livingTimelineJson;
      if (Array.isArray(raw)) return raw;
      if (typeof raw === "string" && raw) {
        try {
          const parsed = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      }
      return [];
    })(),
    livingUpdatedAt: String(op.livingUpdatedAt || metadata.livingUpdatedAt || op.updatedAt || ""),
    nextActor: String(op.nextActor || metadata.nextActor || ""),
    rejectedMatchIds: metadata.rejectedMatchIds || [],
    missingInfoKey: String(metadata.missingInfoKey || ""),
    ownerContactNeeded: resolveOwnerContactNeeded(op, metadata),
    candidateSalePrice: Number(metadata.candidateSalePrice || 0),
    candidateArea: Number(metadata.candidateArea || 0),
    candidatePropertyType: String(metadata.candidatePropertyType || ""),
    candidateDistrict: String(metadata.candidateDistrict || ""),
    candidateCity: String(metadata.candidateCity || ""),
    candidatePurpose: String(metadata.candidatePurpose || ""),
    salePrice: Number(metadata.candidateSalePrice || op.salePrice || 0),
    cooperationId: String(op.cooperationId || metadata.cooperationTaskId || ""),
    cooperationTaskId: String(metadata.cooperationTaskId || op.cooperationId || op.id || ""),
    currentStage: String(op.currentStage || metadata.currentStage || ""),
    originatingOfficeId: String(metadata.originatingOfficeId || ""),
    targetOfficeId: String(metadata.targetOfficeId || ""),
    originatingOfficeName: String(metadata.originatingOfficeName || ""),
    targetOfficeName: String(metadata.targetOfficeName || ""),
    clientOfficeId: String(metadata.clientOfficeId || ""),
    propertyOfficeId: String(metadata.propertyOfficeId || ""),
    originOpportunityId: String(metadata.originOpportunityId || op.opportunityId || ""),
    counterpartOpportunityId: String(metadata.counterpartOpportunityId || ""),
    propertyType: String(op.propertyType || metadata.propertyType || ""),
    purpose: String(op.purpose || metadata.purpose || ""),
    district: String(op.district || metadata.district || ""),
    city: String(metadata.city || ""),
    moneyLine: String(metadata.moneyLine || ""),
    reasonCodes: Array.isArray(metadata.reasonCodes) ? metadata.reasonCodes : [],
    reasonLabels: Array.isArray(metadata.reasonLabels) ? metadata.reasonLabels : [],
    livingTaskId: String(metadata.livingTaskId || ""),
    attemptId: String(metadata.attemptId || ""),
    hideContactUntilAccept: metadata.hideContactUntilAccept !== false && type === OPERATION_TYPES.PLATFORM_OPPORTUNITY_OFFER,
    metadata,
    proximityLabel: String(metadata.proximityLabel || ""),
    compatibilityLabel: String(metadata.compatibilityLabel || ""),
    matchReasons: Array.isArray(metadata.matchReasons) ? metadata.matchReasons : [],
    ownListing: metadata.ownListing || metadata.originListing || {},
    partnerListing: metadata.partnerListing || metadata.counterpartListing || {},
    originListing: metadata.originListing || {},
    counterpartListing: metadata.counterpartListing || {},
    appointmentAt: op.appointmentAt || metadata.appointmentAt || "",
    viewingAt: metadata.viewingAt || "",
    completionConfirmations: metadata.completionConfirmations || {},
    hasNewResponse: Boolean(metadata.hasNewResponse) || String(op.hasNewResponse || "").toLowerCase() === "true",
    partnerOfficeName: String(op.partnerOfficeName || ""),
    assignedBrokerId: String(op.assignedBrokerId || ""),
    matchingReadiness,
    matchingReadinessMissing,
    missingFields: matchingReadinessMissing,
    createdAt: isoFrom(op.createdAt),
    updatedAt: isoFrom(op.updatedAt || op.createdAt),
    isTestFixture: op.isTestFixture === true || metadata.isTestFixture === true || op.qaLiveE2e === true || metadata.qaLiveE2e === true,
    testRunId: String(op.testRunId || metadata.testRunId || op.qaLiveRunId || metadata.qaLiveRunId || ""),
    createdBy: String(op.createdBy || metadata.createdBy || ""),
    qaLiveE2e: op.qaLiveE2e === true || metadata.qaLiveE2e === true,
    sourceType: String(op.sourceType || metadata.sourceType || ""),
    ...phase5BoundaryGuarantees(),
    whatsappOwner: canDraftMessage,
    whatsappClient: canDraftMessage,
    telegramOwner: canDraftMessage,
    telegramClient: canDraftMessage,
    whatsappOwnerLabel: "إرسال واتساب للمالك",
    whatsappClientLabel: "إرسال واتساب للعميل",
    telegramOwnerLabel: "إرسال تليجرام للمالك",
    telegramClientLabel: "إرسال تليجرام للعميل",
    createsWhatsAppMessage: canDraftMessage,
    createsTelegramMessage: canDraftMessage,
    createsSmartMessageDraft: canDraftMessage,
    sendsWhatsApp: false,
    sendsTelegram: false
  };
}

export function sortActiveOperations(items) {
  return [...(items || [])].sort((a, b) => {
    const pr = (a.priority ?? 2) - (b.priority ?? 2);
    if (pr !== 0) return pr;
    return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
  });
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
      error: payload.error || "operations_request_failed",
      status: response.status,
      payload
    };
  }
  return { ok: true, ...payload, payload };
}

export function requestOperationAction({
  workerBase,
  idToken,
  officeId,
  operationId,
  action,
  reason = "",
  fetchImpl = globalThis.fetch
} = {}) {
  return postWorkerJson({
    workerBase,
    path: OPERATIONS_ACTION_PATH,
    idToken,
    body: {
      officeId: String(officeId || "").trim(),
      operationId: String(operationId || "").trim(),
      action: String(action || "").trim(),
      reason: String(reason || "").slice(0, 200)
    },
    fetchImpl
  });
}

export function requestCooperationOperationSync({
  workerBase,
  idToken,
  officeId,
  cooperationId,
  fetchImpl = globalThis.fetch
} = {}) {
  return postWorkerJson({
    workerBase,
    path: OPERATIONS_COOPERATION_PATH,
    idToken,
    body: {
      officeId: String(officeId || "").trim(),
      cooperationId: String(cooperationId || "").trim()
    },
    fetchImpl
  });
}

export function requestMissingDataOperationSync({
  workerBase,
  idToken,
  officeId,
  opportunityId,
  fetchImpl = globalThis.fetch
} = {}) {
  return postWorkerJson({
    workerBase,
    path: OPERATIONS_MISSING_DATA_PATH,
    idToken,
    body: {
      officeId: String(officeId || "").trim(),
      opportunityId: String(opportunityId || "").trim()
    },
    fetchImpl
  });
}
