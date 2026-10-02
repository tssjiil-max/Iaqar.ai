/**
 * Daily Tasks domain — how a persisted operation (offices/{o}/operations) shows up
 * as work. One registry entry per task type: badge, button named after the action,
 * and whether the action runs from the card or opens the opportunity workspace.
 */

import { isSameRiyadhDay, toDate } from "./format-domain.js";
import { phaseInfo } from "./deal-flow-domain.js";

import { buildCooperationDailyTaskView } from "../../js/cooperation-workflow-domain.js";

export const ACTIVE_STATUSES = Object.freeze(["OPEN", "IN_PROGRESS", "WAITING_EXTERNAL_RESPONSE"]);

/**
 * opens: "review" (match review sheet) | "workspace" | "record" | "legacy"
 * inline: action code the card can complete directly (no page change)
 */
export const TASK_TYPES = Object.freeze({
  MATCH_REVIEW: { badge: "مطابقة تحتاج مراجعة", button: "مراجعة المطابقة", icon: "match", opens: "review", needsBroker: true },
  PROPOSAL_REPLY: { badge: "رد يحتاج مراجعة", button: "مراجعة الرد", icon: "mail", opens: "workspace", needsBroker: true },
  SEND_PROPOSAL: { badge: "تفاوض", button: "تجهيز المقترح", icon: "handshake", opens: "workspace", needsBroker: true },
  AWAITING_REPLY: { badge: "بانتظار رد", button: "إرسال تذكير", icon: "bell", opens: "workspace", needsBroker: false, waiting: true },
  VIEWING_CONFIRM: { badge: "معاينة", button: "تأكيد الموعد", icon: "calendar", opens: "workspace", needsBroker: true, inline: "CONFIRM_VIEWING" },
  VIEWING_RESULT: { badge: "معاينة", button: "نتيجة المعاينة", icon: "eye", opens: "workspace", needsBroker: true },
  JOURNEY_FOLLOW_UP: { badge: "متابعة", button: "متابعة الآن", icon: "chart-up", opens: "workspace", needsBroker: true },
  DEAL_ACTION: { badge: "إتمام الصفقة", button: "متابعة الاتفاق", icon: "contract", opens: "workspace", needsBroker: true },
  DEAL_JOURNEY: { badge: "رحلة صفقة", button: "فتح الصفقة", icon: "handshake", opens: "deal", needsBroker: true },
  SESSION_INTERVENTION: { badge: "تدخل مطلوب", button: "فتح جلسة التفاوض", icon: "alert", opens: "session", needsBroker: true },
  SESSION_AGREED: { badge: "تفاوض", button: "فتح جلسة التفاوض", icon: "handshake", opens: "session", needsBroker: true },
  SESSION_PRIVATE_PRICE: { badge: "تفاوض", button: "فتح جلسة التفاوض", icon: "coins", opens: "session", needsBroker: true },
  SESSION_VIEWING_COUNTER: { badge: "معاينة", button: "فتح جلسة التفاوض", icon: "calendar", opens: "session", needsBroker: true },
  MISSING_DATA: { badge: "استكمال بيانات", button: "استكمال البيانات", icon: "edit", opens: "record", needsBroker: true },
  OPPORTUNITY_REVIEW: { badge: "سجل جديد", button: "مراجعة السجل", icon: "inbox-in", opens: "record", needsBroker: true },
  OPPORTUNITY_FOLLOW_UP: { badge: "متابعة", button: "متابعة السجل", icon: "clock", opens: "record", needsBroker: true },
  COOPERATION_REQUEST: { badge: "تعاون", button: "مراجعة طلب التعاون", icon: "users", opens: "community", needsBroker: true },
  COOPERATION_RESPONSE: { badge: "تعاون", button: "عرض حالة التعاون", icon: "users", opens: "community", needsBroker: false },
  COOPERATION_MATCH: { badge: "تعاون", button: "فتح التعاون", icon: "users", opens: "community", needsBroker: true },
  PLATFORM_OPPORTUNITY_OFFER: { badge: "فرصة من المنصة", button: "استلام الفرصة", icon: "inbox-in", opens: "legacy", needsBroker: true },
  EXTERNAL_RESPONSE: { badge: "رد", button: "مراجعة الرد", icon: "mail", opens: "legacy", needsBroker: true },
  SYSTEM_ACTION: { badge: "إجراء", button: "عرض التفاصيل", icon: "info", opens: "legacy", needsBroker: false }
});

export function taskTypeOf(task = {}) {
  return TASK_TYPES[String(task.type || "").toUpperCase()] || TASK_TYPES.SYSTEM_ACTION;
}

export function isActiveTask(task = {}) {
  return ACTIVE_STATUSES.includes(String(task.status || "").toUpperCase());
}

export function isWaitingTask(task = {}) {
  return String(task.status || "").toUpperCase() === "WAITING_EXTERNAL_RESPONSE" || Boolean(taskTypeOf(task).waiting);
}

export function dueOf(task = {}) {
  return toDate(task.dueAt) || toDate(task.appointmentAt) || toDate(task.viewingAt);
}

export function isOverdue(task = {}, now = new Date()) {
  const due = dueOf(task);
  return Boolean(due && due.getTime() < now.getTime() && isActiveTask(task));
}

/** Postponed tasks are hidden until their date, then return (they never vanish). */
export function isSnoozed(task = {}, now = new Date()) {
  const until = toDate(task.snoozedUntil);
  return Boolean(until && until.getTime() > now.getTime());
}

export function isToday(task = {}, now = new Date()) {
  const due = dueOf(task);
  if (due) return isSameRiyadhDay(due, now) || due.getTime() < now.getTime();
  return isSameRiyadhDay(task.createdAt, now) || isSameRiyadhDay(task.updatedAt, now);
}

/** Managers see all; brokers see tasks assigned to them and unassigned ones. */
const COOPERATION_TASK_TYPES = new Set(["COOPERATION_MATCH", "COOPERATION_REQUEST", "COOPERATION_RESPONSE"]);

/**
 * Cooperation shows in «المهام اليومية» only when the broker has something to do (answer a request,
 * continue the follow-up). Waiting or informational states stay on the cooperation page, never here.
 * Tasks that lack the cooperation facts are left visible (never hide what we cannot judge).
 */
export function cooperationNeedsMyAction(task = {}, officeId = "") {
  if (!COOPERATION_TASK_TYPES.has(String(task.type || "").toUpperCase()) || !officeId) return true;
  const meta = parseMeta(task);
  if (!meta.originatingOfficeId || !meta.targetOfficeId) return true;
  const view = buildCooperationDailyTaskView({ ...meta, id: meta.cooperationTaskId || task.cooperationId || task.id }, { officeId });
  return Boolean(view.requiresAction);
}

export function visibleToActor(task = {}, { uid = "", isManager = false, officeId = "" } = {}) {
  if (!cooperationNeedsMyAction(task, officeId)) return false;
  if (isManager) return true;
  const assigned = String(task.assignedBrokerId || "");
  return !assigned || assigned === uid;
}

const PRIORITY_RANK = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };

function millis(value) {
  const date = toDate(value);
  return date ? date.getTime() : 0;
}

/**
 * Order: overdue → needs the broker now (by due time, then priority) → waiting on
 * others → snoozed. Stable for equal keys (newest first).
 */
export function sortTasks(tasks = [], now = new Date()) {
  const bucket = (task) => {
    if (isSnoozed(task, now)) return 4;
    if (isOverdue(task, now)) return 0;
    if (!isWaitingTask(task)) return dueOf(task) ? 1 : 2;
    return 3;
  };
  return [...tasks].sort((a, b) => {
    const diff = bucket(a) - bucket(b);
    if (diff) return diff;
    const dueA = millis(dueOf(a)) || Number.MAX_SAFE_INTEGER;
    const dueB = millis(dueOf(b)) || Number.MAX_SAFE_INTEGER;
    if (dueA !== dueB) return dueA - dueB;
    const pa = PRIORITY_RANK[String(a.priority || "NORMAL").toUpperCase()] ?? 2;
    const pb = PRIORITY_RANK[String(b.priority || "NORMAL").toUpperCase()] ?? 2;
    if (pa !== pb) return pa - pb;
    return millis(b.updatedAt || b.createdAt) - millis(a.updatedAt || a.createdAt);
  });
}

export const TASK_FILTERS = Object.freeze([
  { id: "all", label: "الكل" },
  { id: "today", label: "اليوم" },
  { id: "waiting", label: "بانتظار رد" }
]);

export function filterTasks(tasks = [], filterId = "all", now = new Date()) {
  const active = tasks.filter(isActiveTask);
  if (filterId === "waiting") return active.filter(isWaitingTask);
  if (filterId === "today") return active.filter((task) => !isWaitingTask(task) && !isSnoozed(task, now) && isToday(task, now));
  return active.filter((task) => !isSnoozed(task, now) || isOverdue(task, now));
}

export function parseMeta(task = {}) {
  if (task.metadata && typeof task.metadata === "object") return task.metadata;
  try {
    const parsed = JSON.parse(task.metadataJson || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Card copy: title (opportunity summary), reason, last event, action label. */
export function taskCardModel(task = {}, now = new Date()) {
  const type = taskTypeOf(task);
  const meta = parseMeta(task);
  const due = dueOf(task);
  return {
    id: String(task.id || ""),
    type: String(task.type || "").toUpperCase(),
    badge: isOverdue(task, now) ? `${type.badge} · متأخرة` : type.badge,
    overdue: isOverdue(task, now),
    waiting: isWaitingTask(task),
    title: String(meta.opportunityTitle || task.titleText || "").trim(),
    reason: String(meta.reason || task.summaryText || "").trim(),
    lastEvent: String(meta.lastEvent || "").trim(),
    lastEventAt: meta.lastEventAt || null,
    button: ["VIEWING_RESULT", "AWAITING_REPLY"].includes(String(task.type || "").toUpperCase()) ? type.button : String(meta.actionLabel || type.button),
    icon: type.icon,
    opens: type.opens,
    inline: type.inline || "",
    due,
    journeyId: String(task.journeyId || meta.journeyId || ""),
    matchId: String(task.matchId || ""),
    opportunityId: String(task.opportunityId || ""),
    proposalId: String(meta.proposalId || ""),
    phase: String(task.journeyPhase || meta.journeyPhase || "")
  };
}

/** A deal card opens the page of the deal's current phase (price → session; viewing/final → workspace). */
export function dealRoute(task = {}) {
  const info = phaseInfo(String(task.journeyPhase || ""));
  const id = String(task.journeyId || "");
  if (info.route === "review" && task.matchId) return `review/${task.matchId}`;
  if (info.route === "session" && id) return `session/${id}`;
  return id ? `journey/${id}` : "tasks";
}

/**
 * Record ids that already take part in a match or a deal — any active task that carries a
 * match/journey and points at the record. Everything else is «بلا مطابقة».
 */
export function engagedRecordIds(tasks = []) {
  const ids = new Set();
  for (const task of tasks) {
    if (!isActiveTask(task)) continue;
    if (!task.matchId && !task.journeyId) continue;
    const meta = parseMeta(task);
    for (const id of [task.offerId, task.requestId, task.opportunityId, meta.ownerOfferId, meta.clientRequestId]) {
      if (id) ids.add(String(id));
    }
  }
  return ids;
}
