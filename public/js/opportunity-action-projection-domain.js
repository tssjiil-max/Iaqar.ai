/**
 * Projects active Operations onto their canonical Opportunity card.
 * Opportunities remain the only list rows; Operations only decorate/sort them.
 */

export const OPPORTUNITY_ACTION_FILTER = Object.freeze({
  ALL: "all",
  NEEDS_ACTION: "needs_action",
  MATCHES: "matches",
  APPOINTMENTS: "appointments",
  FOLLOW_UP: "follow_up"
});

const ACTIVE_STATUSES = new Set(["OPEN", "IN_PROGRESS", "WAITING_EXTERNAL_RESPONSE", "READY"]);
const TERMINAL_OUTCOMES = new Set(["NOT_SERIOUS", "NOT_INTERESTED", "CANCELLED", "COMPLETED"]);
const MATCH_NEW_STAGES = new Set(["", "MATCH_FOUND", "MATCH_REVIEW"]);
const DAY_MS = 24 * 60 * 60 * 1000;

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function instant(value) {
  const ms = new Date(value || 0).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function startOfLocalDayMs(date) {
  const value = date instanceof Date ? date : new Date(date);
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

export function isActiveOpportunityOperation(operation = {}) {
  return ACTIVE_STATUSES.has(upper(operation.status));
}

export function operationOpportunityId(operation = {}) {
  return text(
    operation.opportunityId
      || operation.originOpportunityId
      || operation.metadata?.originOpportunityId
      || operation.clientRequestId
      || operation.requestId
      || operation.ownerOfferId
      || operation.offerId
  );
}

function appointmentCopy(appointmentAt, now) {
  const at = new Date(appointmentAt);
  const formatter = new Intl.DateTimeFormat("ar-SA", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Riyadh"
  });
  const today = startOfLocalDayMs(now);
  const appointmentDay = startOfLocalDayMs(at);
  const dayLabel = appointmentDay === today ? "اليوم" : appointmentDay === today + DAY_MS ? "غدًا" : new Intl.DateTimeFormat("ar-SA", {
    month: "short",
    day: "numeric",
    timeZone: "Asia/Riyadh"
  }).format(at);
  return `${dayLabel} — ${formatter.format(at)}`;
}

export function projectOpportunityAction(operation = {}, now = new Date()) {
  if (!isActiveOpportunityOperation(operation)) return null;
  const type = upper(operation.operationType || operation.type);
  const status = upper(operation.status);
  const livingStage = upper(operation.livingStage || operation.metadata?.livingStage);
  const appointmentAt = text(operation.appointmentAt || operation.viewingAt || operation.metadata?.appointmentAt);
  const appointmentMs = instant(appointmentAt);
  const nowMs = (now instanceof Date ? now : new Date(now)).getTime();
  const viewingCompletedAt = text(operation.viewingCompletedAt || operation.metadata?.viewingCompletedAt);
  const viewingOutcome = upper(operation.viewingOutcome || operation.metadata?.viewingOutcome);
  const dayDelta = appointmentMs ? Math.floor((startOfLocalDayMs(new Date(appointmentMs)) - startOfLocalDayMs(new Date(nowMs))) / DAY_MS) : 0;

  if (appointmentMs && appointmentMs <= nowMs && !viewingCompletedAt && !TERMINAL_OUTCOMES.has(viewingOutcome)) {
    return {
      category: OPPORTUNITY_ACTION_FILTER.NEEDS_ACTION,
      rank: 1,
      tone: "overdue",
      badge: "يحتاج إجراء",
      reason: "انتهى موعد المعاينة",
      detail: appointmentCopy(appointmentAt, now),
      primaryAction: "سجّل نتيجة المعاينة",
      actionCode: "record_viewing_result",
      dueAt: appointmentAt
    };
  }

  if (appointmentMs > nowMs && !viewingCompletedAt) {
    const hours = (appointmentMs - nowMs) / 3600000;
    const rank = hours <= 6 ? 2 : (dayDelta === 0 ? 3 : (dayDelta === 1 ? 4 : 4));
    const reason = hours <= 6
      ? `موعد بعد ${Math.max(1, Math.ceil(hours))} ${Math.ceil(hours) === 1 ? "ساعة" : "ساعات"}`
      : (dayDelta === 0 ? "موعد اليوم" : (dayDelta === 1 ? "موعد الغد" : "موعد معاينة"));
    return {
      category: OPPORTUNITY_ACTION_FILTER.APPOINTMENTS,
      rank,
      tone: "appointment",
      badge: "موعد معاينة",
      reason,
      detail: appointmentCopy(appointmentAt, now),
      primaryAction: "عرض الموعد",
      actionCode: "view_appointment",
      dueAt: appointmentAt
    };
  }

  if (viewingCompletedAt && !viewingOutcome) {
    return {
      category: OPPORTUNITY_ACTION_FILTER.NEEDS_ACTION,
      rank: 1,
      tone: "overdue",
      badge: "يحتاج إجراء",
      reason: "تمت المعاينة ولم تُسجل النتيجة",
      detail: "اختر نتيجة المعاينة",
      primaryAction: "سجّل نتيجة المعاينة",
      actionCode: "record_viewing_result",
      dueAt: viewingCompletedAt
    };
  }

  if (type === "MATCH_REVIEW" && MATCH_NEW_STAGES.has(livingStage)) {
    return {
      category: OPPORTUNITY_ACTION_FILTER.MATCHES,
      rank: 5,
      tone: "match",
      badge: "تطابق جديد",
      reason: "يوجد تطابق مناسب لهذا الطلب",
      detail: "",
      primaryAction: "مراجعة التطابق",
      actionCode: "review_match",
      dueAt: operation.createdAt || operation.updatedAt || ""
    };
  }

  const followUp = type === "OPPORTUNITY_FOLLOW_UP"
    || viewingOutcome === "FOLLOW_UP"
    || /FOLLOW_UP|FOLLOWUP/.test(livingStage);
  if (followUp) {
    return {
      category: OPPORTUNITY_ACTION_FILTER.FOLLOW_UP,
      rank: 6,
      tone: "followup",
      badge: "متابعة مطلوبة",
      reason: text(operation.coordinationBrokerLine || operation.summaryText) || "متابعة بعد المعاينة",
      detail: "",
      primaryAction: "فتح المتابعة",
      actionCode: "open_follow_up",
      dueAt: operation.followUpAt || operation.dueAt || operation.updatedAt || ""
    };
  }

  if (status === "WAITING_EXTERNAL_RESPONSE" || /^WAITING_|AWAITING_/.test(livingStage)) {
    const since = instant(operation.livingUpdatedAt || operation.updatedAt || operation.createdAt);
    const hours = since ? Math.max(1, Math.floor((nowMs - since) / 3600000)) : 0;
    return {
      category: OPPORTUNITY_ACTION_FILTER.NEEDS_ACTION,
      rank: 7,
      tone: "waiting",
      badge: "بانتظار رد",
      reason: hours ? `بانتظار رد منذ ${hours} ساعة` : "بانتظار رد",
      detail: "",
      primaryAction: "عرض الحالة",
      actionCode: "view_waiting",
      dueAt: operation.livingUpdatedAt || operation.updatedAt || ""
    };
  }

  if (type === "MATCH_REVIEW" && /NEGOTIATION|COORDINATION|CLIENT_INTERESTED|OWNER_REPLIED/.test(livingStage)) {
    return {
      category: OPPORTUNITY_ACTION_FILTER.ALL,
      rank: 8,
      tone: "waiting",
      badge: "تفاوض جارٍ",
      reason: "تم إرسال المطابقة للطرفين",
      detail: "",
      primaryAction: "متابعة التفاوض",
      actionCode: "open_negotiation",
      dueAt: operation.updatedAt || operation.createdAt || ""
    };
  }

  return null;
}

export function buildOpportunityActionIndex(operations = [], { officeId = "", now = new Date() } = {}) {
  const expectedOfficeId = text(officeId);
  const deduped = new Map();
  for (const operation of operations || []) {
    if (!isActiveOpportunityOperation(operation)) continue;
    if (expectedOfficeId && text(operation.officeId) !== expectedOfficeId) continue;
    const opportunityId = operationOpportunityId(operation);
    if (!opportunityId) continue;
    const matchId = text(operation.matchId);
    const type = upper(operation.operationType || operation.type);
    const dedupKey = `${expectedOfficeId}|${opportunityId}|${type}|${matchId}`;
    const existing = deduped.get(dedupKey);
    if (!existing || instant(operation.updatedAt || operation.createdAt) > instant(existing.updatedAt || existing.createdAt)) {
      deduped.set(dedupKey, operation);
    }
  }

  const byOpportunity = new Map();
  const newMatchCounts = new Map();
  for (const operation of deduped.values()) {
    const opportunityId = operationOpportunityId(operation);
    const action = projectOpportunityAction(operation, now);
    if (!action) continue;
    if (action.category === OPPORTUNITY_ACTION_FILTER.MATCHES) {
      newMatchCounts.set(opportunityId, (newMatchCounts.get(opportunityId) || 0) + 1);
    }
    const candidate = { ...action, operation, operationId: text(operation.id || operation.recordId), matchId: text(operation.matchId) };
    const current = byOpportunity.get(opportunityId);
    if (!current || candidate.rank < current.rank || (candidate.rank === current.rank && instant(candidate.dueAt) < instant(current.dueAt))) {
      byOpportunity.set(opportunityId, candidate);
    }
  }
  for (const [opportunityId, count] of newMatchCounts) {
    const action = byOpportunity.get(opportunityId);
    if (action?.category === OPPORTUNITY_ACTION_FILTER.MATCHES) {
      byOpportunity.set(opportunityId, { ...action, matchCount: count });
    }
  }
  return byOpportunity;
}

export function opportunityMatchesActionFilter(action, filter = OPPORTUNITY_ACTION_FILTER.ALL) {
  if (filter === OPPORTUNITY_ACTION_FILTER.ALL) return true;
  if (!action) return false;
  if (filter === OPPORTUNITY_ACTION_FILTER.NEEDS_ACTION) return action.rank === 1 || action.category === OPPORTUNITY_ACTION_FILTER.NEEDS_ACTION;
  return action.category === filter;
}

export function compareOpportunityPriority(left = {}, right = {}, actionFor = () => null) {
  const leftAction = actionFor(left);
  const rightAction = actionFor(right);
  const rankDelta = Number(leftAction?.rank || 8) - Number(rightAction?.rank || 8);
  if (rankDelta) return rankDelta;
  if (!leftAction && !rightAction) return 0;
  const leftDue = instant(leftAction?.dueAt);
  const rightDue = instant(rightAction?.dueAt);
  if (!leftDue || !rightDue) return 0;
  return leftDue - rightDue;
}
