/**
 * «التنبيهات» — the office's in-app notifications as a list. Each one keeps the destination it
 * already has as a push notification (the task's screen, the negotiation room, the record).
 * Notifications are written by the Worker only; this list just reads them.
 */

import { toDate } from "./format-domain.js";

const JOURNEY_ID = /^jr_[A-Za-z0-9]+$/;

function text(value, max = 200) {
  return String(value ?? "").trim().slice(0, max);
}

/**
 * Where a notification opens — the same rule the push link follows:
 * its own route → its task (by the task's kind) → its deal → its match → its record → المهام اليومية.
 */
export function notificationTarget(notification = {}, tasks = []) {
  const route = text(notification.route, 160);
  if (/^[a-z]+\/[A-Za-z0-9_\-/?=&]+$/.test(route)) return route;
  const taskId = text(notification.operationId || notification.taskId);
  const task = taskId ? tasks.find((item) => String(item.id) === taskId) : null;
  if (task) {
    const type = String(task.type || "").toUpperCase();
    if (type === "MATCH_REVIEW" && task.matchId) return `review/${task.matchId}`;
    if (type.startsWith("SESSION_") && task.journeyId) return `session/${task.journeyId}`;
    if (task.journeyId) return `journey/${task.journeyId}`;
    if (task.opportunityId) return `record/${task.opportunityId}`;
  }
  // «workflowId» is a deal only for deal notifications; older task notifications keep a match group or a task id there.
  const workflow = text(notification.workflowId);
  const journeyId = notification.entityType === "journey" ? text(notification.entityId) || workflow : JOURNEY_ID.test(workflow) ? workflow : "";
  if (journeyId) return `journey/${journeyId}`;
  if (notification.matchId) return `review/${text(notification.matchId)}`;
  if (notification.opportunityId) return `record/${text(notification.opportunityId)}`;
  return "tasks";
}

/** Notifications a member may see in the list: a manager all; a broker his own and the unassigned. */
export function visibleNotifications(list = [], { uid = "", isManager = false } = {}) {
  return list.filter((item) => {
    if (isManager) return true;
    const owner = text(item.brokerId || item.assignedBrokerId || item.userUid);
    return !owner || owner === uid;
  });
}

export function notificationViews(list = [], { tasks = [], seenAt = 0 } = {}) {
  return list
    .map((item) => {
      const at = toDate(item.createdAt);
      return {
        id: text(item.id, 120),
        title: text(item.title, 120) || "تنبيه",
        body: text(item.body || item.message, 240),
        at,
        isNew: Boolean(at && at.getTime() > seenAt),
        route: notificationTarget(item, tasks)
      };
    })
    .sort((a, b) => (b.at?.getTime() || 0) - (a.at?.getTime() || 0));
}

export function newestTime(list = []) {
  return list.reduce((max, item) => Math.max(max, toDate(item.createdAt)?.getTime() || 0), 0);
}
