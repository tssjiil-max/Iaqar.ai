/**
 * Worker helpers for living-event in-app notifications and mark-read.
 * Notifications alert; they do not create a second Daily Task.
 */

import {
  NOTIFICATION_STATUS,
  notificationDocumentId
} from "./operations-domain.js";
import { notificationToFirestoreFields } from "./operations-service.js";
import {
  livingEventDedupKey,
  livingEventNotificationTitle,
  notificationTypeFromPartyAction
} from "../../public/js/in-app-notification-domain.js";
import { formatOpportunityReference } from "../../public/js/reference-code-domain.js";

function text(value) {
  return String(value == null ? "" : value).trim();
}

export async function buildLivingEventNotification({
  officeId,
  brokerId = "",
  matchId = "",
  opportunityId = "",
  operationId = "",
  taskId = "",
  party,
  action,
  livingStage = "",
  now = new Date()
}) {
  const referenceCode = formatOpportunityReference(opportunityId || matchId);
  const type = notificationTypeFromPartyAction(party, action);
  const title = livingEventNotificationTitle({ party, action, referenceCode });
  const deduplicationKey = livingEventDedupKey({
    officeId,
    matchId,
    party,
    action,
    livingStage
  });
  const id = await notificationDocumentId(deduplicationKey);
  const workflowId = text(taskId) || (text(matchId) ? `mg_${matchId}` : text(opportunityId));
  return {
    id,
    officeId: text(officeId),
    brokerId: text(brokerId),
    operationId: text(operationId),
    matchId: text(matchId),
    opportunityId: text(opportunityId),
    taskId: workflowId,
    workflowId,
    referenceCode,
    type,
    title,
    body: title,
    status: NOTIFICATION_STATUS.CREATED,
    readAt: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    deduplicationKey,
    deliveryChannels: ["in_app"],
    providerState: { push: "SKIPPED_IN_APP_ONLY" },
    sensitivePreview: false,
    schemaVersion: 1,
    createdBySystem: true
  };
}

export async function markNotificationRead({
  projectId,
  officeId,
  notificationId,
  accessToken,
  getFirestoreDocument,
  setFirestoreDocument,
  firestoreHelpers,
  now = new Date()
}) {
  const existingDoc = await getFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "notifications", notificationId],
    accessToken,
    allowMissing: true
  });
  if (!existingDoc) {
    return { ok: false, error: "notification_not_found" };
  }
  const existing = firestoreHelpers.firestoreFieldsToJs(existingDoc.fields || {});
  if (text(existing.officeId) && text(existing.officeId) !== text(officeId)) {
    return { ok: false, error: "office_mismatch" };
  }
  if (existing.readAt) {
    return { ok: true, notification: { ...existing, id: notificationId }, alreadyRead: true };
  }
  await setFirestoreDocument({
    projectId,
    segments: ["offices", officeId, "notifications", notificationId],
    accessToken,
    fields: {
      status: firestoreHelpers.firestoreString(NOTIFICATION_STATUS.READ),
      readAt: firestoreHelpers.firestoreTimestamp(now),
      updatedAt: firestoreHelpers.firestoreTimestamp(now)
    }
  });
  return {
    ok: true,
    alreadyRead: false,
    notification: {
      ...existing,
      id: notificationId,
      status: NOTIFICATION_STATUS.READ,
      readAt: now.toISOString()
    }
  };
}

export { notificationToFirestoreFields };
