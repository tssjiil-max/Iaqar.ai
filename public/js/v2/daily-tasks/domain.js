/**
 * Daily-task execution view-model.
 * Derives compact cards from existing records. Does not copy listing data
 * onto the card chrome.
 */

import {
  SORT_GROUP_RANK,
  buildCooperationDailyTaskView,
  isArchivedCooperation
} from "../../cooperation-workflow-domain.js";

export const DAILY_TASK_STATE = Object.freeze({
  NEW_MATCH: "new_match",
  AWAITING_SEND: "awaiting_send",
  AWAITING_CLIENT: "awaiting_client",
  CLIENT_INTERESTED: "client_interested",
  CLIENT_NEEDS_DETAILS: "client_needs_details",
  MATCH_UNSUITABLE: "match_unsuitable",
  APPOINTMENT_TODAY: "appointment_today"
});

export const DAILY_TASK_STATE_LABELS = Object.freeze({
  new_match: "مطابقة جديدة",
  awaiting_send: "بانتظار الإرسال للعميل",
  awaiting_client: "بانتظار رد العميل",
  client_interested: "العميل مهتم",
  client_needs_details: "العميل يحتاج تفاصيل",
  match_unsuitable: "المطابقة غير مناسبة",
  appointment_today: "موعد اليوم"
});

export const DAILY_TASK_STATUS_LABELS = Object.freeze({
  new_match: "تم العثور على مطابقة",
  awaiting_send: "بانتظار الإرسال للعميل",
  awaiting_client: "بانتظار رد العميل",
  client_interested: "✓ العميل مهتم",
  client_needs_details: "العميل يحتاج تفاصيل أكثر",
  match_unsuitable: "المطابقة غير مناسبة",
  appointment_today: "معاينة اليوم"
});

export const DAILY_TASK_BADGE = Object.freeze({
  now: "الآن",
  today: "اليوم",
  overdue: "متأخر"
});

export const EXEC_ACTION = Object.freeze({
  SEND_TO_CLIENT: "send_to_client",
  SEND_TO_OWNER: "send_to_owner",
  RESEND_TO_CLIENT: "resend_to_client",
  OPEN_OFFER: "open_offer"
});

export const SECURE_PARTY = Object.freeze({
  CLIENT: "client",
  OWNER: "owner"
});

export const SECURE_SESSION_KIND = Object.freeze({
  CLIENT_MATCH_REVIEW: "CLIENT_MATCH_REVIEW",
  OWNER_MATCH_REVIEW: "OWNER_MATCH_REVIEW"
});

/** Future client-link replies. Never rendered as broker buttons. */
export const FUTURE_CLIENT_REPLY = Object.freeze({
  INTERESTED: "interested",
  NEEDS_DETAILS: "needs_details",
  NOT_SUITABLE: "not_suitable"
});

export const FUTURE_CLIENT_REPLY_LABELS = Object.freeze({
  interested: "مهتم",
  needs_details: "أحتاج تفاصيل أكثر",
  not_suitable: "غير مناسب"
});

/** Future owner-link replies. Negotiation UI is not implemented in this round. */
export const FUTURE_OWNER_REPLY = Object.freeze({
  PROPERTY_AVAILABLE: "property_available",
  CONFIRM_APPOINTMENT: "confirm_appointment",
  SUGGEST_OTHER_TIME: "suggest_other_time",
  ACCEPT_OFFER: "accept_offer",
  COUNTER_OFFER: "counter_offer",
  REJECT: "reject"
});

export const FUTURE_OWNER_REPLY_LABELS = Object.freeze({
  property_available: "العقار متاح",
  confirm_appointment: "تأكيد الموعد",
  suggest_other_time: "اقتراح وقت آخر",
  accept_offer: "قبول العرض",
  counter_offer: "عرض مقابل",
  reject: "رفض"
});

/** Future deal states. Closing workflow is not implemented in this round. */
export const FUTURE_DEAL_STATE = Object.freeze({
  AGREEMENT: "agreement",
  CLOSING: "closing",
  DEAL_COMPLETED: "deal_completed",
  ARCHIVED: "archived"
});

export const FUTURE_DEAL_STATE_LABELS = Object.freeze({
  agreement: "اتفاق",
  closing: "إتمام الصفقة",
  deal_completed: "الصفقة مكتملة",
  archived: "مؤرشف"
});

export const MATCH_UNSUITABLE_POLICY = Object.freeze({
  endsThisMatchOnly: true,
  keepOffer: true,
  keepRequest: true,
  archiveOffer: false,
  archiveRequest: false,
  showStartMatchingButton: false,
  matchingEngine: "automatic"
});

export const ARCHIVE_POLICY = Object.freeze({
  archivedAtField: "archivedAt",
  retentionDaysField: "archiveRetentionDays",
  defaultRetentionDays: 30,
  hardDeleteEnabled: false,
  deleteTransactionRecords: false
});

/**
 * Later secure-link payload. Links parties through matchId only.
 * Does not expose the other party's contact.
 */
export function buildSecureLinkIntent({
  actionId,
  matchId,
  party,
  contactRef = null,
  stage = "match_found",
  ttlHours = 72
} = {}) {
  const id = text(matchId);
  const side = party === SECURE_PARTY.OWNER ? SECURE_PARTY.OWNER : SECURE_PARTY.CLIENT;
  if (!id) return null;
  return {
    matchId: id,
    party: side,
    contactRef: contactRef || null,
    stage: text(stage) || "match_found",
    ttlHours: Number.isFinite(Number(ttlHours)) ? Number(ttlHours) : 72,
    sessionKind: side === SECURE_PARTY.OWNER
      ? SECURE_SESSION_KIND.OWNER_MATCH_REVIEW
      : SECURE_SESSION_KIND.CLIENT_MATCH_REVIEW,
    actionId: actionId || (side === SECURE_PARTY.OWNER ? EXEC_ACTION.SEND_TO_OWNER : EXEC_ACTION.SEND_TO_CLIENT),
    exposeCounterpartyContact: false
  };
}

const PRIORITY_RANK = Object.freeze({
  action_now: 0,
  overdue: 1,
  appointment_today: 2,
  new_reply: 3,
  awaiting_reply: 4,
  closed: 5
});

function upper(value) {
  return String(value ?? "").trim().toUpperCase();
}

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function purposeWord(record = {}) {
  const purpose = upper(record.purpose || record.transactionType);
  if (purpose === "RENT" || purpose === "LEASE_REQUEST") return "للإيجار";
  if (purpose === "SALE" || purpose === "PURCHASE") return "للبيع";
  if (purpose === "INVESTMENT") return "للاستثمار";
  return "";
}

function districtBit(record = {}) {
  const district = text(record.district).replace(/^حي\s+/, "");
  return district ? `حي ${district}` : "";
}

export function dailyTaskPropertyLine(record = {}) {
  const propertyType = text(record.propertyType);
  const purpose = purposeWord(record);
  const place = districtBit(record);
  const head = [propertyType, purpose].filter(Boolean).join(" ");
  if (head && place) return `${head} — ${place}`;
  return head || place || text(record.summaryLine) || "";
}

export function dailyTaskMoneyLine(record = {}) {
  const sale = Number(record.salePrice ?? record.price ?? 0);
  const budget = Number(record.budget ?? record.priceMax ?? 0);
  const rent = Number(record.annualRent ?? 0);
  const format = (value) => `${value.toLocaleString("en-US")} ر.س`;
  if (rent > 0 && (upper(record.purpose) === "RENT" || upper(record.purpose) === "LEASE_REQUEST")) {
    return `${format(rent)} سنويًا`;
  }
  if (sale > 0) return format(sale);
  if (budget > 0) return format(budget);
  if (rent > 0) return `${format(rent)} سنويًا`;
  return text(record.moneyLine);
}

function detailsLabel(record = {}) {
  const kind = upper(record.opportunityKind || record.kind || "");
  if (kind === "REQUEST" || kind === "CLIENT" || record.contactType === "client") {
    return "عرض تفاصيل الطلب";
  }
  return "عرض تفاصيل العرض";
}

function openOfferAction(record = {}) {
  return {
    id: EXEC_ACTION.OPEN_OFFER,
    label: detailsLabel(record),
    variant: "text"
  };
}

function sendToClientAction(record = {}, actionId = EXEC_ACTION.SEND_TO_CLIENT, label = "إرسال للعميل") {
  return {
    id: actionId,
    label,
    party: SECURE_PARTY.CLIENT,
    sessionKind: SECURE_SESSION_KIND.CLIENT_MATCH_REVIEW,
    secureIntent: buildSecureLinkIntent({
      actionId,
      matchId: record.matchId,
      party: SECURE_PARTY.CLIENT,
      contactRef: record.clientContactRef || null,
      stage: "match_found"
    })
  };
}

function sendToOwnerAction(record = {}) {
  return {
    id: EXEC_ACTION.SEND_TO_OWNER,
    label: "إرسال للمالك",
    party: SECURE_PARTY.OWNER,
    sessionKind: SECURE_SESSION_KIND.OWNER_MATCH_REVIEW,
    secureIntent: buildSecureLinkIntent({
      actionId: EXEC_ACTION.SEND_TO_OWNER,
      matchId: record.matchId,
      party: SECURE_PARTY.OWNER,
      contactRef: record.ownerContactRef || null,
      stage: "match_found"
    })
  };
}

function actionsForState(stateKey, record = {}) {
  const secondary = [];
  let primary = null;
  if (stateKey === DAILY_TASK_STATE.NEW_MATCH || stateKey === DAILY_TASK_STATE.AWAITING_SEND) {
    primary = sendToClientAction(record);
    secondary.push(sendToOwnerAction(record));
  }
  if (stateKey === DAILY_TASK_STATE.AWAITING_CLIENT) {
    secondary.push(sendToClientAction(record, EXEC_ACTION.RESEND_TO_CLIENT, "إعادة الإرسال"));
  }
  secondary.push(openOfferAction(record));
  return {
    primaryAction: primary,
    secondaryActions: secondary.slice(0, 2)
  };
}

export function dailyTaskPriorityGroup(stateKey, badgeKey) {
  if (badgeKey === "overdue") return "overdue";
  if (stateKey === DAILY_TASK_STATE.NEW_MATCH || stateKey === DAILY_TASK_STATE.AWAITING_SEND) {
    return "action_now";
  }
  if (stateKey === DAILY_TASK_STATE.APPOINTMENT_TODAY) return "appointment_today";
  if (
    stateKey === DAILY_TASK_STATE.CLIENT_INTERESTED
    || stateKey === DAILY_TASK_STATE.CLIENT_NEEDS_DETAILS
  ) {
    return "new_reply";
  }
  if (stateKey === DAILY_TASK_STATE.AWAITING_CLIENT) return "awaiting_reply";
  return "closed";
}

export function buildDailyTaskView(record = {}) {
  const stateKey = record.stateKey || DAILY_TASK_STATE.NEW_MATCH;
  const badgeKey = record.badgeKey || (stateKey === DAILY_TASK_STATE.APPOINTMENT_TODAY ? "today" : "now");
  const nextByState = {
    [DAILY_TASK_STATE.NEW_MATCH]: "مراجعة المطابقة",
    [DAILY_TASK_STATE.AWAITING_SEND]: "مراجعة المطابقة",
    [DAILY_TASK_STATE.AWAITING_CLIENT]: "",
    [DAILY_TASK_STATE.CLIENT_INTERESTED]: "الخطوة التالية ستظهر هنا",
    [DAILY_TASK_STATE.CLIENT_NEEDS_DETAILS]: "السعر · الموقع · الصور · المواصفات · سؤال آخر",
    [DAILY_TASK_STATE.MATCH_UNSUITABLE]: "",
    [DAILY_TASK_STATE.APPOINTMENT_TODAY]: "الخطوة التالية ستظهر هنا"
  };
  const { primaryAction, secondaryActions } = actionsForState(stateKey, record);
  const sessionKind = primaryAction?.sessionKind
    || secondaryActions.find((action) => action.sessionKind)?.sessionKind
    || SECURE_SESSION_KIND.CLIENT_MATCH_REVIEW;
  return {
    id: text(record.id),
    stateKey,
    kindLabel: DAILY_TASK_STATE_LABELS[stateKey] || DAILY_TASK_STATE_LABELS.new_match,
    badgeKey,
    badgeLabel: DAILY_TASK_BADGE[badgeKey] || "",
    propertyLine: dailyTaskPropertyLine(record),
    moneyLine: dailyTaskMoneyLine(record),
    statusLabel: DAILY_TASK_STATUS_LABELS[stateKey] || DAILY_TASK_STATUS_LABELS.new_match,
    nextActionLine: record.nextActionLine || nextByState[stateKey] || "",
    primaryAction,
    secondaryActions,
    matchId: text(record.matchId),
    offerId: text(record.offerId || record.ownerOfferId),
    requestId: text(record.requestId || record.clientRequestId),
    opportunityId: text(record.opportunityId || record.offerId || record.requestId || record.ownerOfferId || record.clientRequestId),
    clientPhone: text(record.clientPhone || record.clientContactPhone || record.buyerPhone),
    ownerPhone: text(record.ownerPhone || record.ownerContactPhone || record.advertiserPhone),
    clientName: text(record.clientName),
    ownerName: text(record.ownerName),
    sessionKind,
    priorityGroup: dailyTaskPriorityGroup(stateKey, badgeKey),
    endsThisMatchOnly: stateKey === DAILY_TASK_STATE.MATCH_UNSUITABLE,
    exposeCounterpartyContact: false
  };
}

export function sortDailyTaskViews(tasks = []) {
  return [...tasks].sort((a, b) => {
    const rankOf = (task) => {
      if (task.taskKind === "cooperation" && task.sortGroup) {
        return SORT_GROUP_RANK[task.sortGroup] ?? 9;
      }
      return PRIORITY_RANK[task.priorityGroup] ?? 9;
    };
    const rank = rankOf(a) - rankOf(b);
    if (rank !== 0) return rank;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
}

export function isDailyTaskExecutionSource(item = {}) {
  const opType = upper(item.operationType);
  const recordType = String(item.recordType || "").toLowerCase();
  if (opType === "MISSING_DATA") return false;
  if (upper(item.matchingReadiness) === "NEEDS_COMPLETION") return false;
  if (opType === "COOPERATION_MATCH" || opType === "COOPERATION_REQUEST" || opType === "COOPERATION_RESPONSE") {
    return Boolean(item.cooperationId || item.cooperationTaskId || item.id);
  }
  if (item.currentStage && (item.cooperationId || item.cooperationTaskId)) return true;
  if (opType === "MATCH_REVIEW") return true;
  if (recordType === "match") return true;
  return Boolean(item.matchId && (item.ownerOfferId || item.clientRequestId || item.opportunityId));
}

function liveStateKey(item = {}, now = new Date()) {
  const viewing = item.viewingAt || item.appointmentAt;
  if (viewing) {
    const at = new Date(viewing);
    if (Number.isFinite(at.getTime())) {
      const sameDay = at.toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" })
        === now.toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
      if (sameDay) return DAILY_TASK_STATE.APPOINTMENT_TODAY;
    }
  }
  return DAILY_TASK_STATE.NEW_MATCH;
}

function liveBadgeKey(item = {}, now = new Date()) {
  const due = item.nextFollowUpAt || item.nextActionAt;
  if (due) {
    const at = new Date(due);
    if (Number.isFinite(at.getTime()) && at.getTime() < now.getTime()) return "overdue";
  }
  if (liveStateKey(item, now) === DAILY_TASK_STATE.APPOINTMENT_TODAY) return "today";
  return "now";
}

function isCooperationSource(item = {}) {
  const opType = upper(item.operationType);
  if (opType === "COOPERATION_MATCH" || opType === "COOPERATION_REQUEST" || opType === "COOPERATION_RESPONSE") return true;
  return Boolean(item.currentStage && (item.cooperationId || item.cooperationTaskId));
}

export function mapOperationsItemToDailyTask(item = {}, now = new Date(), { officeId = "" } = {}) {
  if (!isDailyTaskExecutionSource(item)) return null;
  if (isCooperationSource(item)) {
    const record = {
      ...item,
      id: item.cooperationTaskId || item.cooperationId || item.id,
      cooperationTaskId: item.cooperationTaskId || item.cooperationId || item.id,
      cooperationId: item.cooperationId || item.cooperationTaskId || item.id,
      ownListing: item.ownListing || item.originListing || {
        propertyType: item.propertyType,
        purpose: item.purpose,
        district: item.district,
        city: item.city
      },
      partnerListing: item.partnerListing || item.counterpartListing || {}
    };
    if (isArchivedCooperation(record)) return null;
    const viewerOfficeId = officeId || item.viewerOfficeId || item.officeId || "";
    return buildCooperationDailyTaskView(record, { officeId: viewerOfficeId, now });
  }
  return buildDailyTaskView({
    id: item.id || item.matchId || item.recordId,
    stateKey: liveStateKey(item, now),
    badgeKey: liveBadgeKey(item, now),
    propertyType: item.propertyType,
    purpose: item.purpose,
    district: item.district,
    salePrice: item.salePrice ?? item.price,
    budget: item.budget,
    annualRent: item.annualRent,
    matchId: item.matchId || (String(item.recordType || "").toLowerCase() === "match" ? item.recordId || item.id : ""),
    offerId: item.ownerOfferId || item.offerId,
    requestId: item.clientRequestId || item.requestId,
    opportunityId: item.opportunityId || item.ownerOfferId || item.clientRequestId,
    opportunityKind: item.opportunityKind,
    clientPhone: item.clientPhone || item.clientContactPhone || item.buyerPhone,
    ownerPhone: item.ownerPhone || item.ownerContactPhone || item.advertiserPhone,
    clientName: item.clientName,
    ownerName: item.ownerName
  });
}

export function mapOperationsItemsToDailyTasks(items = [], now = new Date(), { officeId = "" } = {}) {
  const views = [];
  const seen = new Set();
  for (const item of items) {
    const view = mapOperationsItemToDailyTask(item, now, { officeId });
    if (!view) continue;
    const key = view.cooperationTaskId || view.matchId || view.id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    views.push(view);
  }
  return sortDailyTaskViews(views);
}

export function dailyTaskDetailsHash(task) {
  const id = String(task?.opportunityId || task?.offerId || task?.requestId || "").trim();
  if (!id || id.includes("/") || id.includes("\\") || id.includes("..") || id.length > 128) return "";
  return `#/opportunities/${encodeURIComponent(id)}`;
}

export function dailyTasksDemoFixtures() {
  return sortDailyTaskViews([
    buildDailyTaskView({
      id: "task_new_match",
      stateKey: DAILY_TASK_STATE.NEW_MATCH,
      badgeKey: "now",
      opportunityKind: "OFFER",
      propertyType: "أرض",
      purpose: "SALE",
      district: "عروة",
      salePrice: 500000,
      matchId: "match_new_1",
      offerId: "offer_urwah_1",
      requestId: "request_urwah_1",
      opportunityId: "offer_urwah_1",
      clientPhone: "0511111111",
      ownerPhone: "0522222222",
      clientName: "عميل عروة",
      ownerName: "مالك عروة"
    }),
    buildDailyTaskView({
      id: "task_awaiting_client",
      stateKey: DAILY_TASK_STATE.AWAITING_CLIENT,
      badgeKey: "today",
      opportunityKind: "OFFER",
      propertyType: "شقة",
      purpose: "SALE",
      district: "الوعيرة",
      salePrice: 850000,
      matchId: "match_wait_1",
      offerId: "offer_wait_1",
      opportunityId: "offer_wait_1"
    }),
    buildDailyTaskView({
      id: "task_interested",
      stateKey: DAILY_TASK_STATE.CLIENT_INTERESTED,
      badgeKey: "today",
      opportunityKind: "OFFER",
      propertyType: "فيلا",
      purpose: "SALE",
      district: "الجرف",
      salePrice: 1200000,
      matchId: "match_hot_1",
      offerId: "offer_hot_1",
      opportunityId: "offer_hot_1"
    }),
    buildDailyTaskView({
      id: "task_needs_details",
      stateKey: DAILY_TASK_STATE.CLIENT_NEEDS_DETAILS,
      badgeKey: "today",
      opportunityKind: "REQUEST",
      propertyType: "شقة",
      purpose: "RENT",
      district: "الرانوناء",
      annualRent: 45000,
      matchId: "match_info_1",
      requestId: "request_info_1",
      opportunityId: "request_info_1"
    }),
    buildDailyTaskView({
      id: "task_unsuitable",
      stateKey: DAILY_TASK_STATE.MATCH_UNSUITABLE,
      badgeKey: "today",
      opportunityKind: "OFFER",
      propertyType: "دور",
      purpose: "SALE",
      district: "قباء",
      salePrice: 720000,
      matchId: "match_no_1",
      offerId: "offer_no_1",
      opportunityId: "offer_no_1"
    }),
    buildDailyTaskView({
      id: "task_overdue",
      stateKey: DAILY_TASK_STATE.NEW_MATCH,
      badgeKey: "overdue",
      opportunityKind: "OFFER",
      propertyType: "أرض",
      purpose: "SALE",
      district: "شوران",
      salePrice: 640000,
      matchId: "match_late_1",
      offerId: "offer_late_1",
      opportunityId: "offer_late_1"
    }),
    buildDailyTaskView({
      id: "task_appointment_today",
      stateKey: DAILY_TASK_STATE.APPOINTMENT_TODAY,
      badgeKey: "today",
      opportunityKind: "OFFER",
      propertyType: "أرض",
      purpose: "SALE",
      district: "عروة",
      salePrice: 500000,
      matchId: "match_visit_1",
      offerId: "offer_visit_1",
      opportunityId: "offer_visit_1"
    })
  ]);
}
