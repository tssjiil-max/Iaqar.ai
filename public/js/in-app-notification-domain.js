/**
 * In-app notification center domain.
 * Notifications alert; they do not create a second Daily Task.
 */

import { formatDailyTaskClock } from "./v2/daily-tasks/domain.js";
import { partyReplyTimelineLabel } from "./match-group-domain.js";

export const IN_APP_NOTIFICATION_TYPE = Object.freeze({
  NEW_MATCH: "NEW_MATCH",
  CLIENT_REPLY: "CLIENT_REPLY",
  CLIENT_INTERESTED: "CLIENT_INTERESTED",
  CLIENT_NEEDS_DETAILS: "CLIENT_NEEDS_DETAILS",
  CLIENT_WANTS_VIEWING: "CLIENT_WANTS_VIEWING",
  OWNER_REPLY: "OWNER_REPLY",
  OWNER_AVAILABLE: "OWNER_AVAILABLE",
  OWNER_UNAVAILABLE: "OWNER_UNAVAILABLE",
  APPOINTMENT_ACTION: "APPOINTMENT_ACTION",
  APPOINTMENT_CONFIRMED: "APPOINTMENT_CONFIRMED",
  COOPERATION_REQUEST: "COOPERATION_REQUEST",
  COOPERATION_RESPONSE: "COOPERATION_RESPONSE",
  BROKER_INTERVENTION: "BROKER_INTERVENTION",
  MISSING_DATA: "MISSING_DATA",
  SYSTEM_ACTION: "SYSTEM_ACTION"
});

function text(value) {
  return String(value == null ? "" : value).trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

export function isNotificationUnread(row = {}) {
  if (row.readAt) return false;
  const status = upper(row.status);
  return status !== "READ" && status !== "DISMISSED";
}

export function unreadNotificationCount(rows = []) {
  return (rows || []).filter(isNotificationUnread).length;
}

export function notificationTypeFromPartyAction(party, action) {
  const side = text(party).toLowerCase();
  const id = text(action);
  if (side === "owner") {
    if (id === "property_available") return IN_APP_NOTIFICATION_TYPE.OWNER_AVAILABLE;
    if (id === "not_available") return IN_APP_NOTIFICATION_TYPE.OWNER_UNAVAILABLE;
    if (id === "confirm_appointment") return IN_APP_NOTIFICATION_TYPE.APPOINTMENT_CONFIRMED;
    return IN_APP_NOTIFICATION_TYPE.OWNER_REPLY;
  }
  if (id === "interested") return IN_APP_NOTIFICATION_TYPE.CLIENT_INTERESTED;
  if (id === "needs_details" || id.startsWith("detail_")) return IN_APP_NOTIFICATION_TYPE.CLIENT_NEEDS_DETAILS;
  if (id === "want_viewing") return IN_APP_NOTIFICATION_TYPE.CLIENT_WANTS_VIEWING;
  if (id === "confirm_appointment") return IN_APP_NOTIFICATION_TYPE.APPOINTMENT_CONFIRMED;
  return IN_APP_NOTIFICATION_TYPE.CLIENT_REPLY;
}

export function livingEventNotificationTitle({ party, action, referenceCode = "" } = {}) {
  const base = partyReplyTimelineLabel(party, action);
  const ref = text(referenceCode);
  return ref ? `${base} — ${ref.startsWith("#") ? ref : `#${ref}`}` : base;
}

export function notificationTapTarget(row = {}) {
  return {
    taskId: text(row.taskId || row.workflowId || row.matchGroupId),
    matchId: text(row.matchId),
    operationId: text(row.operationId),
    opportunityId: text(row.opportunityId),
    cooperationId: text(row.cooperationId)
  };
}

export function mapNotificationView(row = {}, now = new Date()) {
  const createdAt = row.createdAt || row.updatedAt || "";
  return {
    id: text(row.id),
    officeId: text(row.officeId),
    type: text(row.type) || IN_APP_NOTIFICATION_TYPE.SYSTEM_ACTION,
    title: text(row.title || row.titleText || row.body),
    createdAt,
    readAt: row.readAt || null,
    unread: isNotificationUnread(row),
    clockLabel: formatDailyTaskClock(createdAt, now),
    taskId: text(row.taskId || row.workflowId || row.matchGroupId),
    matchId: text(row.matchId),
    operationId: text(row.operationId),
    referenceCode: text(row.referenceCode),
    workflowId: text(row.workflowId || row.taskId || row.matchGroupId)
  };
}

export function sortNotifications(rows = []) {
  return [...(rows || [])].sort((a, b) => {
    const aTime = Date.parse(a.createdAt || "") || 0;
    const bTime = Date.parse(b.createdAt || "") || 0;
    return bTime - aTime;
  });
}

export function livingEventDedupKey({ officeId, matchId, party, action, livingStage = "" } = {}) {
  return [
    "LIVING_EVENT",
    text(officeId),
    text(matchId),
    text(party),
    text(action),
    text(livingStage)
  ].join("|");
}
