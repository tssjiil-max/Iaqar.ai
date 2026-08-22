/**
 * Prioritized daily task list — maps operations items into broker-facing buckets
 * with direct quick actions (call / follow up / schedule viewing).
 */

import { filterBrokerVisibleItems, isSavedOpportunityFeedback } from "./operations-center-domain.js";

export const MAX_TODAY_TASKS = 5;

export const TODAY_TASK_SECTIONS = Object.freeze([
  {
    key: "new_review",
    label: "طلبات جديدة",
    description: "طلبات وعروض بانتظار مراجعة الوسيط.",
    colorClass: "ops-today-purple"
  },
  {
    key: "overdue",
    label: "متأخر",
    description: "متابعات تجاوزت موعدها.",
    colorClass: "ops-today-red"
  },
  {
    key: "viewing_soon",
    label: "معاينة قريبة",
    description: "مواعيد معاينة اليوم أو خلال 3 ساعات.",
    colorClass: "ops-today-orange"
  },
  {
    key: "ready_to_close",
    label: "جاهز للإغلاق",
    description: "صفقات أو مطابقات قريبة من الإتمام.",
    colorClass: "ops-today-green"
  },
  {
    key: "awaiting_response",
    label: "بانتظار رد",
    description: "بانتظار رد العميل أو المالك أو مكتب آخر.",
    colorClass: "ops-today-blue"
  }
]);

const ARCHIVED_STATUSES = new Set([
  "COMPLETED",
  "ARCHIVED",
  "CLOSED_WON",
  "CLOSED_LOST",
  "DISMISSED",
  "EXPIRED",
  "CLOSED",
  "LOST",
  "completed",
  "closed",
  "lost"
]);

const TASK_TIMEZONE = "Asia/Riyadh";

function upper(value) {
  return String(value ?? "").trim().toUpperCase();
}

export function parseTaskInstant(value) {
  if (!value) return null;
  if (typeof value?.toDate === "function") return value.toDate();
  const date = value instanceof Date ? value : new Date(value);
  const ms = date.getTime();
  return Number.isFinite(ms) ? date : null;
}

export function isSameLocalDay(instant, reference = new Date(), timeZone = TASK_TIMEZONE) {
  const at = parseTaskInstant(instant);
  if (!at) return false;
  const ref = reference instanceof Date ? reference : new Date(reference);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  return fmt.format(at) === fmt.format(ref);
}

export function isTaskOverdue(item, now = new Date()) {
  if (!item || isTaskArchived(item)) return false;
  const at = parseTaskInstant(item.nextFollowUpAt || item.nextActionAt);
  return Boolean(at && at.getTime() < now.getTime());
}

export function isTaskArchived(item) {
  const status = upper(item?.status || item?.statusLabel);
  const lifecycle = upper(item?.lifecycleStatus);
  if (ARCHIVED_STATUSES.has(status) || ARCHIVED_STATUSES.has(lifecycle)) return true;
  if (isSavedOpportunityFeedback(item)) return true;
  return false;
}

export function isViewingSoon(item, now = new Date()) {
  if (!item || isTaskArchived(item)) return false;
  const at = parseTaskInstant(item.viewingAt || item.appointmentAt || item.nextFollowUpAt);
  if (!at) return false;
  if (at.getTime() < now.getTime()) return false;
  const diffMs = at.getTime() - now.getTime();
  const tomorrow = new Date(now.getTime() + 86400000);
  return isSameLocalDay(at, now, TASK_TIMEZONE)
    || isSameLocalDay(at, tomorrow, TASK_TIMEZONE)
    || diffMs <= 3 * 3600000;
}

/** @deprecated use isViewingSoon */
export function isViewingToday(item, now = new Date()) {
  return isViewingSoon(item, now);
}

export function isNewReview(item) {
  if (!item || isTaskArchived(item)) return false;
  const recordType = String(item.recordType || "").toLowerCase();
  if (!["opportunity", "intake"].includes(recordType)) return false;
  const lifecycle = upper(item.lifecycleStatus);
  const status = upper(item.status);
  return lifecycle === "NEW" || status === "NEW";
}

export function isReadyToClose(item) {
  if (!item || isTaskArchived(item)) return false;
  const score = Number(item.closingReadinessScore || 0);
  if (score >= 85) return true;
  if (String(item.closingReadinessKey || "").toLowerCase() === "very_high") return true;
  const stage = String(item.workflowStage || item.status || "").toLowerCase();
  if (["negotiation", "agreement", "closing"].includes(stage)) return true;
  if (String(item.status || "").toLowerCase() === "negotiation") return true;
  return false;
}

export function isAwaitingResponse(item) {
  if (!item || isTaskArchived(item)) return false;
  const status = upper(item.status || item.statusLabel);
  if (status === "WAITING_EXTERNAL_RESPONSE" || status === "WAITING_RESPONSE") return true;
  if (String(item.status || "").toLowerCase() === "waiting_response") return true;
  const opType = upper(item.operationType);
  if (opType === "EXTERNAL_RESPONSE" || opType === "COOPERATION_RESPONSE") return true;
  return false;
}

/**
 * Assign one prioritized bucket per item (first match wins).
 */
export function todayTaskBucket(item) {
  if (!item || isTaskArchived(item)) return null;
  if (isTaskOverdue(item)) return "overdue";
  if (isNewReview(item)) return "new_review";
  if (isViewingSoon(item)) return "viewing_soon";
  if (isReadyToClose(item)) return "ready_to_close";
  if (isAwaitingResponse(item)) return "awaiting_response";
  return null;
}

function itemSortTimestamp(item) {
  return String(item?.nextFollowUpAt || item?.viewingAt || item?.appointmentAt
    || item?.updatedAt || item?.createdAt || "");
}

export function sortTodayTasks(items = []) {
  return [...items].sort((a, b) => {
    const priorityDiff = (a.priority ?? 2) - (b.priority ?? 2);
    if (priorityDiff !== 0) return priorityDiff;
    const timeDiff = itemSortTimestamp(a).localeCompare(itemSortTimestamp(b));
    if (timeDiff !== 0) return timeDiff;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
}

export function groupTodayTasks(items = []) {
  const groups = Object.fromEntries(TODAY_TASK_SECTIONS.map((section) => [section.key, []]));
  for (const item of filterBrokerVisibleItems(items)) {
    const bucket = todayTaskBucket(item);
    if (bucket && groups[bucket]) groups[bucket].push(item);
  }
  for (const section of TODAY_TASK_SECTIONS) {
    groups[section.key] = sortTodayTasks(groups[section.key]);
  }
  return groups;
}

export function flattenTodayTasks(items = [], maxTasks = MAX_TODAY_TASKS) {
  const groups = groupTodayTasks(items);
  const flat = [];
  let taskCount = 0;
  for (const section of TODAY_TASK_SECTIONS) {
    const rows = groups[section.key] || [];
    if (!rows.length) continue;
    const sectionRows = [];
    for (const item of rows) {
      if (taskCount >= maxTasks) break;
      sectionRows.push(item);
      taskCount += 1;
    }
    if (!sectionRows.length) continue;
    flat.push({
      type: "section",
      key: section.key,
      label: section.label,
      count: sectionRows.length,
      totalInBucket: rows.length
    });
    for (const item of sectionRows) {
      flat.push({ type: "task", key: section.key, item });
    }
    if (taskCount >= maxTasks) break;
  }
  return flat;
}

export function todayTaskCount(items = []) {
  return flattenTodayTasks(items).filter((row) => row.type === "task").length;
}

export function getTodayTaskSection(key) {
  return TODAY_TASK_SECTIONS.find((section) => section.key === key) || null;
}

export function resolveContactPhone(item = {}) {
  const raw = String(
    item.contactPhone
    || item.advertiserPhoneNormalized
    || item.phone
    || ""
  ).trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 9) return raw;
  return "";
}

/**
 * Quick actions shown on each task row — broker must tap explicitly.
 */
export function resolveQuickActions(item, bucket = todayTaskBucket(item)) {
  if (!item) return [];
  const actions = [];
  const phone = resolveContactPhone(item);
  const recordType = String(item.recordType || "").toLowerCase();
  const hasViewing = Boolean(item.viewingAt || item.appointmentAt);

  if (phone && ["opportunity", "intake"].includes(recordType)) {
    actions.push({ id: "call", label: "اتصل", actionMode: "call" });
  } else if (["match", "deal"].includes(recordType)) {
    actions.push({ id: "call", label: "اتصل", actionMode: "call" });
  }

  if (bucket === "overdue" || bucket === "awaiting_response" || bucket === "viewing_soon" || bucket === "new_review") {
    actions.push({ id: "followup", label: "تابع", actionMode: "followup" });
  } else if (["opportunity", "intake"].includes(recordType)) {
    actions.push({ id: "followup", label: "تابع", actionMode: "followup" });
  }

  if (["match", "deal"].includes(recordType) && !hasViewing && bucket !== "viewing_soon") {
    actions.push({ id: "schedule_viewing", label: "حدد معاينة", actionMode: "schedule_viewing" });
  }

  const seen = new Set();
  return actions.filter((action) => {
    if (seen.has(action.actionMode)) return false;
    seen.add(action.actionMode);
    return true;
  }).slice(0, 3);
}

export function todayTaskMetaLine(item, bucket = todayTaskBucket(item)) {
  if (!item) return "";
  if (bucket === "overdue" && item.nextFollowUpAt) {
    return `كان المطلوب: ${formatTaskWhen(item.nextFollowUpAt)}`;
  }
  if (bucket === "new_review") {
    return item.lifecycleStatusLabel || "طلب جديد بانتظار المراجعة";
  }
  if (bucket === "viewing_soon") {
    const at = item.viewingAt || item.appointmentAt;
    return at ? `موعد المعاينة: ${formatTaskWhen(at)}` : "";
  }
  if (bucket === "ready_to_close" && item.closingReadinessScore) {
    return `جاهزية الإغلاق: ${Number(item.closingReadinessScore)}%`;
  }
  if (bucket === "awaiting_response") {
    return item.opsStatusLine || item.nextAction || "بانتظار رد";
  }
  return item.opsStatusLine || "";
}

function formatTaskWhen(value) {
  const at = parseTaskInstant(value);
  if (!at) return "غير محدد";
  return at.toLocaleString("ar-SA", {
    timeZone: TASK_TIMEZONE,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}
