/**
 * Phase 5 — Operations + Notifications persistence orchestration (Worker trust boundary).
 */

import {
  ACTIVE_OPERATION_STATUSES,
  NOTIFICATION_STATUS,
  OPERATION_STATUS,
  OPERATION_TYPES,
  applyOperationLifecycle,
  buildInAppNotification,
  buildLivingCooperationOperation,
  buildMatchReviewOperation,
  buildMissingDataOperation,
  phase5BoundaryGuarantees,
  shouldCreateMatchReview
} from "./operations-domain.js";
import { formatOpportunityReference } from "../../public/js/reference-code-domain.js";

const REQUIRED_OPPORTUNITY_FIELDS = Object.freeze([
  "opportunityKind", "purpose", "propertyType", "city",
  "district", "priceOrBudget", "area", "rooms"
]);

const FIELD_LABELS_AR = Object.freeze({
  opportunityKind: "نوع الفرصة",
  purpose: "الغرض",
  propertyType: "نوع العقار",
  city: "المدينة",
  district: "الحي",
  priceOrBudget: "السعر أو الميزانية",
  area: "المساحة",
  rooms: "عدد الغرف"
});

function isBlank(value) {
  if (value == null) return true;
  if (typeof value === "number") return !Number.isFinite(value);
  return String(value).trim() === "";
}

function isLandPropertyType(value) {
  return /أرض|ارض/i.test(String(value || "").trim());
}

export function listMissingOpportunityFields(opportunity = {}) {
  const required = REQUIRED_OPPORTUNITY_FIELDS.filter((key) => {
    if (key === "rooms" && isLandPropertyType(opportunity.propertyType)) return false;
    return true;
  });
  return required.filter((key) => isBlank(opportunity[key]));
}

export function missingFieldLabels(missingFields = []) {
  return missingFields.map((key) => FIELD_LABELS_AR[key] || key);
}

export function pushTypeForOperation(type) {
  switch (String(type || "").toUpperCase()) {
    case OPERATION_TYPES.MATCH_REVIEW: return "match";
    case OPERATION_TYPES.MISSING_DATA: return "missing_data";
    case OPERATION_TYPES.COOPERATION_REQUEST: return "cooperation_request";
    case OPERATION_TYPES.COOPERATION_RESPONSE: return "cooperation_response";
    case OPERATION_TYPES.COOPERATION_MATCH: return "cooperation_request";
    default: return "system";
  }
}

export function operationToFirestoreFields(operation, {
  firestoreString,
  firestoreBoolean,
  firestoreInteger,
  firestoreTimestamp
}) {
  const createdAt = operation.createdAt ? new Date(operation.createdAt) : new Date();
  const updatedAt = operation.updatedAt ? new Date(operation.updatedAt) : createdAt;
  return {
    schemaVersion: firestoreInteger(operation.schemaVersion || 1),
    id: firestoreString(operation.id),
    officeId: firestoreString(operation.officeId),
    assignedBrokerId: firestoreString(operation.assignedBrokerId || ""),
    type: firestoreString(operation.type),
    sourceEntityType: firestoreString(operation.sourceEntityType || ""),
    sourceEntityId: firestoreString(operation.sourceEntityId || ""),
    opportunityId: firestoreString(operation.opportunityId || ""),
    matchId: firestoreString(operation.matchId || ""),
    cooperationId: firestoreString(operation.cooperationId || ""),
    currentStage: firestoreString(operation.currentStage || ""),
    propertyType: firestoreString(operation.propertyType || ""),
    purpose: firestoreString(operation.purpose || ""),
    district: firestoreString(operation.district || ""),
    partnerOfficeName: firestoreString(operation.partnerOfficeName || ""),
    appointmentAt: firestoreString(operation.appointmentAt || ""),
    titleCode: firestoreString(operation.titleCode || ""),
    summaryCode: firestoreString(operation.summaryCode || ""),
    titleText: firestoreString(operation.titleText || ""),
    summaryText: firestoreString(operation.summaryText || ""),
    recommendedActionCode: firestoreString(operation.recommendedActionCode || ""),
    recommendedActionText: firestoreString(operation.recommendedActionText || ""),
    priority: firestoreString(operation.priority || "NORMAL"),
    status: firestoreString(operation.status || OPERATION_STATUS.OPEN),
    deduplicationKey: firestoreString(operation.deduplicationKey || ""),
    createdAt: firestoreTimestamp(createdAt),
    updatedAt: firestoreTimestamp(updatedAt),
    openedAt: operation.openedAt ? firestoreTimestamp(new Date(operation.openedAt)) : null,
    completedAt: operation.completedAt ? firestoreTimestamp(new Date(operation.completedAt)) : null,
    dismissedAt: operation.dismissedAt ? firestoreTimestamp(new Date(operation.dismissedAt)) : null,
    dueAt: operation.dueAt ? firestoreTimestamp(new Date(operation.dueAt)) : null,
    dismissalReason: firestoreString(operation.dismissalReason || ""),
    createdBySystem: firestoreBoolean(operation.createdBySystem !== false),
    operationVersion: firestoreInteger(operation.operationVersion || 1),
    metadataJson: firestoreString(JSON.stringify(operation.metadata || {})),
    missingFieldsJson: firestoreString(JSON.stringify(operation.metadata?.missingFields || []))
  };
}

export function notificationToFirestoreFields(notification, {
  firestoreString,
  firestoreBoolean,
  firestoreInteger,
  firestoreTimestamp
}) {
  const createdAt = notification.createdAt ? new Date(notification.createdAt) : new Date();
  return {
    schemaVersion: firestoreInteger(notification.schemaVersion || 1),
    id: firestoreString(notification.id),
    officeId: firestoreString(notification.officeId),
    brokerId: firestoreString(notification.brokerId || ""),
    operationId: firestoreString(notification.operationId || ""),
    matchId: firestoreString(notification.matchId || ""),
    opportunityId: firestoreString(notification.opportunityId || ""),
    taskId: firestoreString(notification.taskId || notification.workflowId || ""),
    workflowId: firestoreString(notification.workflowId || notification.taskId || ""),
    referenceCode: firestoreString(notification.referenceCode || ""),
    type: firestoreString(notification.type),
    title: firestoreString(notification.title || ""),
    body: firestoreString(notification.body || ""),
    status: firestoreString(notification.status || NOTIFICATION_STATUS.CREATED),
    readAt: notification.readAt ? firestoreTimestamp(new Date(notification.readAt)) : firestoreString(""),
    createdAt: firestoreTimestamp(createdAt),
    updatedAt: firestoreTimestamp(notification.updatedAt ? new Date(notification.updatedAt) : createdAt),
    deduplicationKey: firestoreString(notification.deduplicationKey || ""),
    deliveryChannelsJson: firestoreString(JSON.stringify(notification.deliveryChannels || ["in_app", "push"])),
    providerStateJson: firestoreString(JSON.stringify(notification.providerState || {})),
    sensitivePreview: firestoreBoolean(Boolean(notification.sensitivePreview)),
    createdBySystem: firestoreBoolean(notification.createdBySystem !== false)
  };
}

function isTerminalStatus(status) {
  return [
    OPERATION_STATUS.COMPLETED,
    OPERATION_STATUS.DISMISSED,
    OPERATION_STATUS.EXPIRED
  ].includes(String(status || "").toUpperCase());
}

/**
 * Idempotent upsert by deduplicationKey-derived document id.
 * Does not reopen terminal Operations for the same key.
 */
export async function upsertOperationDocument({
  projectId,
  officeId,
  operation,
  accessToken,
  setFirestoreDocument,
  getFirestoreDocument,
  firestoreHelpers
}) {
  const existingDoc = await getFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "operations", operation.id],
    accessToken,
    allowMissing: true
  });
  if (existingDoc) {
    const existing = firestoreHelpers.firestoreFieldsToJs(existingDoc.fields || {});
    if (isTerminalStatus(existing.status)) {
      return { operation: { ...existing, id: operation.id }, created: false, skippedTerminal: true };
    }
    const now = new Date().toISOString();
    const patch = {
      ...operation,
      createdAt: existing.createdAt || operation.createdAt,
      openedAt: existing.openedAt || null,
      status: existing.status || operation.status,
      updatedAt: now,
      operationVersion: Number(existing.operationVersion || 1)
    };
    await setFirestoreDocument({
      projectId,
      segments: ["offices", officeId, "operations", operation.id],
      accessToken,
      fields: operationToFirestoreFields(patch, firestoreHelpers)
    });
    return { operation: patch, created: false, skippedTerminal: false };
  }

  await setFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "operations", operation.id],
    accessToken,
    fields: operationToFirestoreFields(operation, firestoreHelpers)
  });
  return { operation, created: true, skippedTerminal: false };
}

export async function upsertNotificationDocument({
  projectId,
  officeId,
  notification,
  accessToken,
  setFirestoreDocument,
  getFirestoreDocument,
  firestoreHelpers
}) {
  const existingDoc = await getFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "notifications", notification.id],
    accessToken,
    allowMissing: true
  });
  if (existingDoc) {
    const existing = firestoreHelpers.firestoreFieldsToJs(existingDoc.fields || {});
    return { notification: { ...existing, id: notification.id }, created: false };
  }
  await setFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "notifications", notification.id],
    accessToken,
    fields: notificationToFirestoreFields(notification, firestoreHelpers)
  });
  return { notification, created: true };
}

export async function recordNotificationPushResult({
  projectId,
  officeId,
  notificationId,
  pushSummary,
  accessToken,
  setFirestoreDocument,
  firestoreHelpers
}) {
  const now = new Date();
  const failed = Number(pushSummary?.failed || 0) > 0 && Number(pushSummary?.sent || 0) === 0;
  const skipped = pushSummary?.skipped === true;
  const sent = Number(pushSummary?.sent || 0) > 0;
  let status = NOTIFICATION_STATUS.CREATED;
  let pushState = "QUEUED";
  if (skipped) {
    status = NOTIFICATION_STATUS.CREATED;
    pushState = "SKIPPED_PREFERENCE";
  } else if (sent) {
    status = NOTIFICATION_STATUS.SENT;
    pushState = "SENT";
  } else if (failed) {
    status = NOTIFICATION_STATUS.FAILED;
    pushState = "FAILED";
  }
  // Never claim DELIVERED without provider confirmation (FCM HTTP v1 send ack ≠ device delivery).
  await setFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "notifications", notificationId],
    accessToken,
    fields: {
      status: firestoreHelpers.firestoreString(status),
      updatedAt: firestoreHelpers.firestoreTimestamp(now),
      providerStateJson: firestoreHelpers.firestoreString(JSON.stringify({
        push: pushState,
        pushSentAt: sent ? now.toISOString() : null,
        pushDeliveredAt: null,
        pushFailedAt: failed ? now.toISOString() : null,
        pushError: failed ? String(pushSummary?.reason || "fcm_send_failed") : "",
        sent: Number(pushSummary?.sent || 0),
        failed: Number(pushSummary?.failed || 0),
        registered: Number(pushSummary?.registered || 0),
        skipped: Boolean(skipped),
        skipReason: skipped ? String(pushSummary?.reason || "") : ""
      }))
    }
  });
  return { status, pushState };
}

export async function createMatchReviewBundle({
  projectId,
  officeId,
  match,
  threshold = 55,
  assignedBrokerId = "",
  notifyPush = false,
  accessToken,
  deps
}) {
  if (!shouldCreateMatchReview({
    score: match.score,
    threshold,
    isCurrent: match.isCurrent !== false,
    status: match.status
  })) {
    return { created: false, reason: "not_actionable", boundaries: phase5BoundaryGuarantees() };
  }

  const operation = await buildMatchReviewOperation({
    officeId,
    assignedBrokerId: assignedBrokerId || match.assignedBrokerId || "",
    matchId: match.matchId,
    opportunityId: match.opportunityId || "",
    counterpartOpportunityId: match.counterpartOpportunityId || "",
    dataVersion: match.dataVersion || "",
    score: match.score,
    opportunityScore: match.opportunityScore,
    isBestOpportunity: match.isBestOpportunity,
    reasons: match.reasons || [],
    clientRequestId: match.clientRequestId || "",
    ownerOfferId: match.ownerOfferId || "",
    matchGroupId: match.matchGroupId || match.opportunityId || "",
    sourceCollection: match.sourceCollection || "",
    candidateSalePrice: match.candidateSalePrice || 0,
    candidateArea: match.candidateArea || 0,
    candidatePropertyType: match.candidatePropertyType || "",
    candidateDistrict: match.candidateDistrict || "",
    candidateCity: match.candidateCity || "",
    candidatePurpose: match.candidatePurpose || ""
  });

  const opResult = await upsertOperationDocument({
    projectId, officeId, operation, accessToken, ...deps
  });
  if (opResult.skippedTerminal) {
    return { created: false, reason: "terminal_exists", operation: opResult.operation, boundaries: phase5BoundaryGuarantees() };
  }

  const notification = await buildInAppNotification({
    officeId,
    brokerId: operation.assignedBrokerId,
    operation: opResult.operation,
    referenceCode: formatOpportunityReference(
      opResult.operation.opportunityId || opResult.operation.metadata?.clientRequestId || ""
    )
  });
  const notifResult = await upsertNotificationDocument({
    projectId, officeId, notification, accessToken, ...deps
  });

  let pushSummary = { registered: 0, sent: 0, failed: 0, skipped: true, reason: "push_not_requested" };
  if (notifyPush && notifResult.created) {
    pushSummary = await deps.sendOfficePush({
      projectId,
      officeId,
      title: notification.title,
      body: notification.body,
      type: pushTypeForOperation(operation.type),
      recordId: operation.id,
      assignedBrokerId: operation.assignedBrokerId,
      accessToken
    });
    await recordNotificationPushResult({
      projectId,
      officeId,
      notificationId: notification.id,
      pushSummary,
      accessToken,
      setFirestoreDocument: deps.setFirestoreDocument,
      firestoreHelpers: deps.firestoreHelpers
    });
  } else if (!notifResult.created) {
    pushSummary = { registered: 0, sent: 0, failed: 0, skipped: true, reason: "notification_exists" };
  }

  return {
    created: opResult.created,
    operation: opResult.operation,
    notification: notifResult.notification,
    notificationCreated: notifResult.created,
    pushSummary,
    boundaries: phase5BoundaryGuarantees()
  };
}

export async function expireOperationsForMatchIds({
  projectId,
  officeId,
  matchIds = [],
  accessToken,
  listCollectionDocuments,
  setFirestoreDocument,
  firestoreHelpers
}) {
  const ids = new Set((matchIds || []).map(String).filter(Boolean));
  if (!ids.size) return { expired: 0 };
  const docs = await listCollectionDocuments({
    projectId,
    segments: ["offices", officeId, "operations"],
    accessToken,
    pageSize: 100
  });
  const now = new Date();
  let expired = 0;
  for (const doc of docs) {
    const op = firestoreHelpers.firestoreFieldsToJs(doc.fields || {});
    const opId = decodeURIComponent(String(doc.name || "").split("/").pop() || "");
    if (op.type !== OPERATION_TYPES.MATCH_REVIEW) continue;
    if (!ids.has(String(op.matchId || ""))) continue;
    if (!ACTIVE_OPERATION_STATUSES.includes(String(op.status || "").toUpperCase())) continue;
    await setFirestoreDocument({
      projectId,
      segments: ["offices", officeId, "operations", opId],
      accessToken,
      fields: {
        status: firestoreHelpers.firestoreString(OPERATION_STATUS.EXPIRED),
        updatedAt: firestoreHelpers.firestoreTimestamp(now)
      }
    });
    expired += 1;
  }
  return { expired };
}

export async function upsertMissingDataForOpportunity({
  projectId,
  officeId,
  opportunity,
  opportunityId,
  accessToken,
  deps
}) {
  const missing = listMissingOpportunityFields(opportunity);
  const labels = missingFieldLabels(missing);
  const dataVersion = String(opportunity.version || opportunity.dataVersion || opportunity.updatedAt || "v0");
  const assignedBrokerId = String(opportunity.brokerId || opportunity.originatingBrokerId || "");

  if (!missing.length) {
    const closed = await completeActiveMissingDataOperations({
      projectId,
      officeId,
      opportunityId,
      accessToken,
      listCollectionDocuments: deps.listCollectionDocuments,
      setFirestoreDocument: deps.setFirestoreDocument,
      firestoreHelpers: deps.firestoreHelpers
    });
    return { created: false, closed: closed.completed, reason: "complete", boundaries: phase5BoundaryGuarantees() };
  }

  const operation = await buildMissingDataOperation({
    officeId,
    assignedBrokerId,
    opportunityId,
    missingFields: labels,
    dataVersion
  });
  const opResult = await upsertOperationDocument({
    projectId, officeId, operation, accessToken, ...deps
  });
  if (opResult.skippedTerminal || !opResult.created && !opResult.operation) {
    return { created: false, operation: opResult.operation, boundaries: phase5BoundaryGuarantees() };
  }

  let notification = null;
  let notificationCreated = false;
  if (opResult.created) {
    notification = await buildInAppNotification({
      officeId,
      brokerId: assignedBrokerId,
      operation: opResult.operation
    });
    const notifResult = await upsertNotificationDocument({
      projectId, officeId, notification, accessToken, ...deps
    });
    notificationCreated = notifResult.created;
    if (notificationCreated) {
      const pushSummary = await deps.sendOfficePush({
        projectId,
        officeId,
        title: notification.title,
        body: notification.body,
        type: pushTypeForOperation(operation.type),
        recordId: operation.id,
        assignedBrokerId,
        accessToken
      });
      await recordNotificationPushResult({
        projectId,
        officeId,
        notificationId: notification.id,
        pushSummary,
        accessToken,
        setFirestoreDocument: deps.setFirestoreDocument,
        firestoreHelpers: deps.firestoreHelpers
      });
    }
  }

  return {
    created: opResult.created,
    operation: opResult.operation,
    notification,
    notificationCreated,
    boundaries: phase5BoundaryGuarantees()
  };
}

export async function completeActiveMissingDataOperations({
  projectId,
  officeId,
  opportunityId,
  accessToken,
  listCollectionDocuments,
  setFirestoreDocument,
  firestoreHelpers
}) {
  const docs = await listCollectionDocuments({
    projectId,
    segments: ["offices", officeId, "operations"],
    accessToken,
    pageSize: 100
  });
  const now = new Date();
  let completed = 0;
  for (const doc of docs) {
    const op = firestoreHelpers.firestoreFieldsToJs(doc.fields || {});
    const opId = decodeURIComponent(String(doc.name || "").split("/").pop() || "");
    if (op.type !== OPERATION_TYPES.MISSING_DATA) continue;
    if (String(op.opportunityId || "") !== String(opportunityId || "")) continue;
    if (!ACTIVE_OPERATION_STATUSES.includes(String(op.status || "").toUpperCase())) continue;
    await setFirestoreDocument({
      projectId,
      segments: ["offices", officeId, "operations", opId],
      accessToken,
      fields: {
        status: firestoreHelpers.firestoreString(OPERATION_STATUS.COMPLETED),
        completedAt: firestoreHelpers.firestoreTimestamp(now),
        updatedAt: firestoreHelpers.firestoreTimestamp(now)
      }
    });
    completed += 1;
  }
  return { completed };
}

export async function upsertLivingCooperationOperation({
  projectId,
  officeId,
  cooperation,
  accessToken,
  deps
}) {
  const operation = await buildLivingCooperationOperation({ officeId, cooperation });
  const existingDoc = await deps.getFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "operations", operation.id],
    accessToken,
    allowMissing: true
  });
  const existing = existingDoc
    ? deps.firestoreHelpers.firestoreFieldsToJs(existingDoc.fields || {})
    : null;
  const now = new Date().toISOString();
  const patch = {
    ...operation,
    createdAt: existing?.createdAt || operation.createdAt,
    openedAt: existing?.openedAt || null,
    updatedAt: now,
    operationVersion: Number(existing?.operationVersion || 1)
  };
  await deps.setFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "operations", operation.id],
    accessToken,
    fields: operationToFirestoreFields(patch, deps.firestoreHelpers)
  });
  let notificationCreated = false;
  if (!existing) {
    const notification = await buildInAppNotification({
      officeId,
      brokerId: operation.assignedBrokerId,
      operation: patch
    });
    const notifResult = await upsertNotificationDocument({
      projectId, officeId, notification, accessToken, ...deps
    });
    notificationCreated = notifResult.created;
    if (notificationCreated && typeof deps.sendOfficePush === "function") {
      const pushSummary = await deps.sendOfficePush({
        projectId,
        officeId,
        title: notification.title,
        body: notification.body,
        type: pushTypeForOperation(operation.type),
        recordId: operation.id,
        accessToken
      });
      await recordNotificationPushResult({
        projectId,
        officeId,
        notificationId: notification.id,
        pushSummary,
        accessToken,
        setFirestoreDocument: deps.setFirestoreDocument,
        firestoreHelpers: deps.firestoreHelpers
      });
    }
  }
  return { operation: patch, created: !existing, notificationCreated };
}

export async function upsertCooperationOperations({
  projectId,
  cooperation,
  accessToken,
  deps
}) {
  const originatingOfficeId = String(cooperation.originatingOfficeId || "");
  const targetOfficeId = String(cooperation.targetOfficeId || "");
  const results = [];
  const offices = [...new Set([originatingOfficeId, targetOfficeId].filter(Boolean))];
  for (const officeId of offices) {
    const result = await upsertLivingCooperationOperation({
      projectId,
      officeId,
      cooperation,
      accessToken,
      deps
    });
    results.push({ officeId, operation: result.operation, created: result.created, notificationCreated: result.notificationCreated });
  }
  return { results, boundaries: phase5BoundaryGuarantees() };
}

async function completeActiveCooperationRequests({
  projectId,
  officeId,
  cooperationId,
  accessToken,
  listCollectionDocuments,
  setFirestoreDocument,
  firestoreHelpers
}) {
  const docs = await listCollectionDocuments({
    projectId,
    segments: ["offices", officeId, "operations"],
    accessToken,
    pageSize: 100
  });
  const now = new Date();
  for (const doc of docs) {
    const op = firestoreHelpers.firestoreFieldsToJs(doc.fields || {});
    const opId = decodeURIComponent(String(doc.name || "").split("/").pop() || "");
    if (op.type !== OPERATION_TYPES.COOPERATION_REQUEST) continue;
    if (String(op.cooperationId || "") !== String(cooperationId || "")) continue;
    if (!ACTIVE_OPERATION_STATUSES.includes(String(op.status || "").toUpperCase())) continue;
    await setFirestoreDocument({
      projectId,
      segments: ["offices", officeId, "operations", opId],
      accessToken,
      fields: {
        status: firestoreHelpers.firestoreString(OPERATION_STATUS.COMPLETED),
        completedAt: firestoreHelpers.firestoreTimestamp(now),
        updatedAt: firestoreHelpers.firestoreTimestamp(now)
      }
    });
  }
}

export async function applyTrustedOperationAction({
  projectId,
  officeId,
  operationId,
  action,
  reason = "",
  accessToken,
  getFirestoreDocument,
  setFirestoreDocument,
  firestoreHelpers
}) {
  const doc = await getFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "operations", operationId],
    accessToken,
    allowMissing: true
  });
  if (!doc) return { ok: false, error: "operation_not_found", status: 404 };
  const existing = firestoreHelpers.firestoreFieldsToJs(doc.fields || {});
  if (String(existing.officeId || officeId) !== String(officeId)) {
    return { ok: false, error: "office_mismatch", status: 403 };
  }
  const result = applyOperationLifecycle(
    { ...existing, id: operationId },
    action,
    { reason }
  );
  if (!result.ok) return { ok: false, error: result.error, status: 400 };
  if (result.patch) {
    const fields = {};
    for (const [key, value] of Object.entries(result.patch)) {
      if (value == null) continue;
      if (key.endsWith("At") || key === "updatedAt") {
        fields[key] = firestoreHelpers.firestoreTimestamp(new Date(value));
      } else if (typeof value === "boolean") {
        fields[key] = firestoreHelpers.firestoreBoolean(value);
      } else {
        fields[key] = firestoreHelpers.firestoreString(value);
      }
    }
    await setFirestoreDocument({
      projectId,
      segments: ["offices", officeId, "operations", operationId],
      accessToken,
      fields
    });
  }
  return {
    ok: true,
    operationId,
    status: result.patch?.status || existing.status,
    idempotent: Boolean(result.idempotent),
    boundaries: phase5BoundaryGuarantees()
  };
}

export { phase5BoundaryGuarantees, applyOperationLifecycle, OPERATION_TYPES, OPERATION_STATUS };
