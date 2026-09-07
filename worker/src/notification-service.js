/**
 * Notification persistence/delivery service.
 * Notifications are side effects and navigation alerts only; they never own
 * business state and never create or advance Operations.
 */

import { NOTIFICATION_STATUS } from "./operations-domain.js";

export function notificationBoundaryGuarantees() {
  return Object.freeze({
    ownsBusinessState: false,
    createsOperations: false,
    advancesWorkflow: false,
    inAppIsAuthoritativeAlert: true,
    pushIsOptionalSideEffect: true,
    deterministicDeduplication: true
  });
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
    dealId: firestoreString(notification.dealId || ""),
    opportunityId: firestoreString(notification.opportunityId || ""),
    cooperationId: firestoreString(notification.cooperationId || ""),
    taskId: firestoreString(notification.taskId || notification.workflowId || ""),
    workflowId: firestoreString(notification.workflowId || notification.taskId || ""),
    referenceCode: firestoreString(notification.referenceCode || ""),
    entityType: firestoreString(notification.entityType || ""),
    entityId: firestoreString(notification.entityId || ""),
    targetPath: firestoreString(notification.targetPath || ""),
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

export async function upsertNotificationDocument({
  projectId,
  officeId,
  notification,
  accessToken,
  setFirestoreDocument,
  getFirestoreDocument,
  firestoreHelpers
}) {
  if (!officeId || !notification?.id) throw new Error("notification_identity_required");
  if (notification.officeId && String(notification.officeId) !== String(officeId)) {
    throw new Error("notification_office_mismatch");
  }
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
  if (!officeId || !notificationId) throw new Error("notification_identity_required");
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
