/**
 * Journey tasks — persisted in offices/{o}/operations (the collection Daily Tasks
 * reads), with deterministic ids so every write is an idempotent upsert.
 *
 *   dedup key: JOURNEY|{officeId}|{journeyId}|{TYPE}|{ref}
 *
 * A broker decision (COMPLETED/DISMISSED) is terminal and never reopened by replay.
 */

import { operationDocumentId } from "../operations-domain.js";
import { recordTitle } from "../../../public/os/domain/records-domain.js";

const TERMINAL = new Set(["COMPLETED", "DISMISSED", "EXPIRED"]);

const TYPE_TITLES = Object.freeze({
  SEND_PROPOSAL: "إرسال مقترح",
  AWAITING_REPLY: "بانتظار رد",
  PROPOSAL_REPLY: "رد يحتاج مراجعة",
  VIEWING_CONFIRM: "تأكيد موعد المعاينة",
  VIEWING_RESULT: "تسجيل نتيجة المعاينة",
  JOURNEY_FOLLOW_UP: "متابعة الفرصة",
  DEAL_ACTION: "متابعة إجراءات الاتفاق"
});

export function journeyTaskKey({ officeId, journeyId, type, ref = "" }) {
  return `JOURNEY|${officeId}|${journeyId}|${type}|${ref}`;
}

export async function journeyTaskId(params) {
  return operationDocumentId(journeyTaskKey(params));
}

export function journeyTitle(journey = {}) {
  const offer = journey.offerSummary || {};
  const request = journey.requestSummary || {};
  const left = request.purpose === "LEASE_REQUEST" ? "طلب استئجار" : "طلب شراء";
  const right = recordTitle({ ...offer, opportunityKind: "OFFER" }).replace(/ للبيع| للإيجار/, "");
  return `${left} ↔ ${right}`;
}

/**
 * Upsert one journey task. Returns { id, created, skippedTerminal }.
 * status: OPEN | WAITING_EXTERNAL_RESPONSE.
 */
export async function upsertJourneyTask(store, deps, {
  officeId, journey, type, ref = "", status = "OPEN", dueAt = null, priority = "NORMAL",
  reason = "", lastEvent = "", lastEventAt = null, actionLabel = "", proposalId = "", now = new Date()
}) {
  const key = journeyTaskKey({ officeId, journeyId: journey.journeyId, type, ref });
  const id = await operationDocumentId(key);
  const segments = ["offices", officeId, "operations", id];
  const existing = await store.get(segments);
  if (existing && TERMINAL.has(String(existing.status || "").toUpperCase())) {
    return { id, created: false, skippedTerminal: true };
  }
  const metadata = {
    journeyId: journey.journeyId,
    opportunityTitle: journeyTitle(journey),
    reason,
    lastEvent,
    lastEventAt: lastEventAt ? new Date(lastEventAt).toISOString() : null,
    actionLabel,
    proposalId,
    offerId: journey.offerId || "",
    requestId: journey.requestId || ""
  };
  await store.set(segments, {
    schemaVersion: 1,
    id,
    officeId,
    assignedBrokerId: journey.assignedBrokerId || "",
    type,
    sourceEntityType: "journey",
    sourceEntityId: journey.journeyId,
    journeyId: journey.journeyId,
    opportunityId: journey.requestId || "",
    offerId: journey.offerId || "",
    requestId: journey.requestId || "",
    matchId: journey.matchId || "",
    titleText: TYPE_TITLES[type] || type,
    summaryText: reason,
    recommendedActionText: actionLabel,
    priority,
    status: existing ? String(existing.status || status) === "IN_PROGRESS" ? "IN_PROGRESS" : status : status,
    deduplicationKey: key,
    createdAt: existing?.createdAt ? new Date(existing.createdAt) : now,
    updatedAt: now,
    dueAt: dueAt ? new Date(dueAt) : null,
    createdBySystem: true,
    operationVersion: Number(existing?.operationVersion || 0) + 1,
    metadataJson: JSON.stringify(metadata),
    missingFieldsJson: "[]"
  });
  return { id, created: !existing, skippedTerminal: false };
}

/** Complete (or dismiss) the given task ids; missing or terminal ones are skipped. */
export async function finishTasks(store, { officeId, taskIds = [], status = "COMPLETED", reason = "", now = new Date() }) {
  let finished = 0;
  for (const id of new Set(taskIds.filter(Boolean))) {
    const segments = ["offices", officeId, "operations", id];
    const existing = await store.get(segments);
    if (!existing || TERMINAL.has(String(existing.status || "").toUpperCase())) continue;
    await store.set(segments, {
      status,
      updatedAt: now,
      completedAt: status === "COMPLETED" ? now : null,
      dismissedAt: status === "DISMISSED" ? now : null,
      dismissalReason: reason || ""
    });
    finished += 1;
  }
  return finished;
}

/**
 * In-app notification (create-only, deduplicated by key) + optional FCM push to the
 * responsible broker. Push failure is recorded, never thrown: a notification is a side
 * effect and must not undo the saved action.
 */
export async function notifyBroker(store, deps, {
  officeId, journey, taskId, dedupKey, title, body, pushType = "message", now = new Date()
}) {
  const hex = await deps.sha256Hex(`notif|${dedupKey}`);
  const id = `nt_${hex.slice(0, 40)}`;
  const created = await store.create(["offices", officeId, "notifications", id], {
    schemaVersion: 1,
    id,
    officeId,
    brokerId: journey.assignedBrokerId || "",
    operationId: taskId || "",
    matchId: journey.matchId || "",
    opportunityId: journey.requestId || "",
    taskId: taskId || "",
    workflowId: journey.journeyId,
    entityType: "journey",
    entityId: journey.journeyId,
    type: "JOURNEY_UPDATE",
    title,
    body,
    status: "CREATED",
    readAt: "",
    createdAt: now,
    updatedAt: now,
    deduplicationKey: dedupKey,
    deliveryChannelsJson: JSON.stringify(["in_app", "push"]),
    providerStateJson: JSON.stringify({ push: "QUEUED" }),
    sensitivePreview: false,
    createdBySystem: true
  });
  if (!created || typeof deps.sendOfficePush !== "function") return { id, created, push: "skipped" };
  let push = "FAILED";
  let detail = "";
  try {
    const result = await deps.sendOfficePush({
      officeId, title, body, type: pushType, recordId: taskId, taskId: journey.journeyId,
      operationId: taskId, opportunityId: journey.requestId || "", matchId: journey.matchId || "",
      assignedBrokerId: journey.assignedBrokerId || ""
    });
    push = result?.skipped ? `SKIPPED_${String(result.reason || "").toUpperCase()}` : Number(result?.sent || 0) > 0 ? "SENT_TO_PROVIDER" : "NO_DEVICES";
  } catch (error) {
    detail = String(error?.message || error).slice(0, 160);
  }
  await store.set(["offices", officeId, "notifications", id], {
    providerStateJson: JSON.stringify({ push, detail, at: now.toISOString() }),
    updatedAt: now
  }).catch(() => {});
  return { id, created, push };
}
