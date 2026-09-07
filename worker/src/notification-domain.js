/**
 * Notification domain — deterministic alert identity and Operation-to-alert projection.
 * This module does not create Operations or advance business workflow state.
 */

import { livingTaskId } from "../../public/js/match-group-domain.js";

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

const COPY = Object.freeze({
  MATCH_REVIEW: { push: "لديك مطابقة جديدة تحتاج مراجعتك.", type: NOTIFICATION_TYPES.NEW_MATCH },
  MISSING_DATA: { push: "توجد بيانات ناقصة في إحدى فرصك.", type: NOTIFICATION_TYPES.MISSING_DATA },
  OPPORTUNITY_REVIEW: { push: "لديك عرض أو طلب جديد يحتاج مراجعتك.", type: NOTIFICATION_TYPES.SYSTEM_ACTION },
  OPPORTUNITY_FOLLOW_UP: { push: "لديك متابعة مالك أو عميل تحتاج إجراء.", type: NOTIFICATION_TYPES.SYSTEM_ACTION },
  DEAL_ACTION: { push: "لديك صفقة تحتاج متابعة.", type: NOTIFICATION_TYPES.SYSTEM_ACTION },
  COOPERATION_REQUEST: { push: "وصل طلب تعاون جديد.", type: NOTIFICATION_TYPES.COOPERATION_REQUEST },
  COOPERATION_RESPONSE: { push: "يوجد تحديث على طلب تعاون.", type: NOTIFICATION_TYPES.COOPERATION_RESPONSE },
  COOPERATION_MATCH: { push: "لديك مهمة تعاون تحتاج إجراء.", type: NOTIFICATION_TYPES.COOPERATION_REQUEST },
  EXTERNAL_RESPONSE: { push: "لديك رد يحتاج متابعتك.", type: NOTIFICATION_TYPES.SYSTEM_ACTION },
  SYSTEM_ACTION: { push: "يوجد إشعار نظامي يحتاج مراجعتك.", type: NOTIFICATION_TYPES.SYSTEM_ACTION },
  PLATFORM_OPPORTUNITY_OFFER: { push: "لديك فرصة جديدة من المنصة.", type: NOTIFICATION_TYPES.SYSTEM_ACTION }
});

function copyForOperation(type = "") {
  return COPY[String(type || "").toUpperCase()] || COPY.SYSTEM_ACTION;
}

async function sha256Hex(value) {
  const data = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function notificationDocumentId(deduplicationKey) {
  const hex = await sha256Hex(`notif|${String(deduplicationKey || "")}`);
  return `nt_${hex.slice(0, 40)}`;
}

export async function buildInAppNotification({ officeId, brokerId = "", operation, referenceCode = "", now = new Date() }) {
  const copy = copyForOperation(operation?.type);
  const deduplicationKey = `NOTIF|${operation?.deduplicationKey || ""}`;
  const id = await notificationDocumentId(deduplicationKey);
  const ref = String(referenceCode || "").trim();
  const operationType = String(operation?.type || "").toUpperCase();
  const title = operationType === "MATCH_REVIEW" && ref
    ? `مطابقة جديدة — ${ref.startsWith("#") ? ref : `#${ref}`}`
    : copy.push;
  const matchId = operationType === "MATCH_REVIEW"
    ? String(operation?.matchId || operation?.sourceEntityId || "")
    : String(operation?.matchId || "");
  const opportunityId = String(operation?.opportunityId || "");
  const matchGroupId = String(operation?.metadata?.matchGroupId || "");
  const workflowId = operationType === "MATCH_REVIEW"
    ? livingTaskId(matchGroupId || opportunityId || matchId)
    : String(matchGroupId || operation?.id || matchId || "");
  return {
    id,
    officeId: String(officeId || operation?.officeId || ""),
    brokerId: String(brokerId || operation?.assignedBrokerId || ""),
    operationId: String(operation?.id || ""),
    matchId,
    dealId: String(operation?.dealId || operation?.metadata?.dealId || ""),
    opportunityId,
    cooperationId: String(operation?.cooperationId || ""),
    taskId: workflowId,
    workflowId,
    referenceCode: ref,
    entityType: String(operation?.sourceEntityType || ""),
    entityId: String(operation?.sourceEntityId || ""),
    type: copy.type,
    title,
    body: title,
    status: NOTIFICATION_STATUS.CREATED,
    readAt: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    deduplicationKey,
    deliveryChannels: ["in_app", "push"],
    providerState: { push: "QUEUED", pushSentAt: null, pushDeliveredAt: null, pushFailedAt: null, pushError: "" },
    sensitivePreview: false,
    schemaVersion: 1,
    createdBySystem: true
  };
}
