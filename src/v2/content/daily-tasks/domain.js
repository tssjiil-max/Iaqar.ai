/**
 * Daily-task execution view-model.
 * Derives compact cards from existing records. Does not copy listing data
 * onto the card chrome.
 */

import {
  SORT_GROUP_RANK,
  buildCooperationDailyTaskView,
  isArchivedCooperation
} from "../../../../public/js/cooperation-workflow-domain.js";
import {
  LIVING_TASK_STAGE,
  TASK_SORT_GROUP_RANK,
  formatBestResultLine,
  formatCandidateCountLine,
  groupMatchItems,
  isRequestSource,
  livingCopy,
  livingTaskId,
  matchGroupKey,
  parseLivingTimeline,
  sortGroupForLivingStage
} from "../../../../public/js/match-group-domain.js";
import { formatOpportunityReference } from "../../../../public/js/reference-code-domain.js";
import {
  evaluateMatchContactGate,
  matchDedupeKey,
  MATCH_CONTACT_INCOMPLETE_LABEL,
  resolveDetailsOpportunityId,
  isValidContactPhone
} from "../../../../public/js/opportunity-data-flow-domain.js";
import {
  ROUTER_REASON_LABELS,
  livingTaskIdForOpportunity,
  platformOpportunityHeadline,
  platformOpportunityMoneyLine
} from "../../../../public/js/opportunity-router-domain.js";

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
  overdue: "متأخر"
});

export const TASK_DATA_INTEGRITY = Object.freeze({
  OK: "ok",
  INVALID_TASK_DATA: "INVALID_TASK_DATA"
});

const RIYADH_TZ = "Asia/Riyadh";
const MONTHS_AR = Object.freeze([
  "يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"
]);

const dailyTaskDiagnostics = [];

export const EXEC_ACTION = Object.freeze({
  SEND_TO_CLIENT: "send_to_client",
  SEND_TO_OWNER: "send_to_owner",
  RESEND_TO_CLIENT: "resend_to_client",
  OPEN_OFFER: "open_offer",
  COMPLETE_INFO: "complete_info",
  REVIEW_NEXT: "review_next_candidate",
  SHARE_DETAILS: "share_details",
  CONFIRM_DEAL: "confirm_deal",
  ACCEPT_PLATFORM_OPPORTUNITY: "accept_platform_opportunity",
  DECLINE_PLATFORM_OPPORTUNITY: "decline_platform_opportunity"
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
  NEEDS_BROKER_ACTION: 1,
  action_now: 1,
  overdue: 1,
  NEW_EXTERNAL_RESPONSE: 2,
  new_reply: 2,
  TODAY_APPOINTMENT: 3,
  appointment_today: 3,
  NEW_COOPERATION_RESPONSE: 4,
  WAITING_EXTERNAL_PARTY: 5,
  awaiting_reply: 5,
  PASSIVE_STATUS: 6,
  closed: 6
});

function upper(value) {
  return String(value ?? "").trim().toUpperCase();
}

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function coerceDailyTaskDate(value) {
  if (!value && value !== 0) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value?.toDate === "function") {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
  }
  if (typeof value === "object") {
    const seconds = Number(value.seconds ?? value._seconds);
    if (Number.isFinite(seconds)) {
      const nanos = Number(value.nanoseconds ?? value._nanoseconds ?? 0);
      const date = new Date(seconds * 1000 + nanos / 1e6);
      return Number.isNaN(date.getTime()) ? null : date;
    }
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function riyadhDayKey(date) {
  return date.toLocaleDateString("en-CA", { timeZone: RIYADH_TZ });
}

function riyadhDateParts(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: RIYADH_TZ,
    year: "numeric",
    month: "numeric",
    day: "numeric"
  }).formatToParts(date);
  const read = (type) => Number(parts.find((part) => part.type === type)?.value || 0);
  return { year: read("year"), month: read("month"), day: read("day") };
}

function formatClockTime(date) {
  return date.toLocaleString("en-US", {
    timeZone: RIYADH_TZ,
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  })
    .replace(/\u202f/g, " ")
    .replace(/\s*AM/i, " ص")
    .replace(/\s*PM/i, " م")
    .replace(/\s+/g, " ")
    .trim();
}

export function formatDailyTaskClock(value, now = new Date()) {
  const at = coerceDailyTaskDate(value);
  const current = coerceDailyTaskDate(now) || new Date();
  if (!at) return "";
  const time = formatClockTime(at);
  const thatDay = riyadhDayKey(at);
  const today = riyadhDayKey(current);
  if (thatDay === today) return time;
  const yesterday = new Date(current.getTime() - 24 * 60 * 60 * 1000);
  if (thatDay === riyadhDayKey(yesterday)) return `أمس · ${time}`;
  const parts = riyadhDateParts(at);
  const nowYear = riyadhDateParts(current).year;
  const monthName = MONTHS_AR[parts.month - 1] || "";
  if (parts.year === nowYear) return `${parts.day} ${monthName} · ${time}`;
  return `${parts.day} ${monthName} ${parts.year} · ${time}`;
}

export function isDedicatedQaOffice(officeId = "") {
  const id = String(officeId || "").trim().toLowerCase();
  return id.startsWith("qa-") || id.startsWith("qa_e2e") || id.includes("qa-e2e");
}

export function isTestFixtureRecord(item = {}) {
  if (item?.isTestFixture === true || item?.qaLiveE2e === true) return true;
  if (upper(item?.createdBy) === "E2E") return true;
  if (text(item?.testRunId) || text(item?.qaLiveRunId)) return true;
  const blob = [
    item?.id, item?.matchId, item?.recordId, item?.opportunityId,
    item?.clientRequestId, item?.ownerOfferId, item?.offerId, item?.requestId,
    item?.sourceType
  ].map((value) => text(value)).join(" ");
  return /livee2e_|\bqa_/i.test(blob) || /\blive_e2e\b/i.test(blob);
}

export function consumeDailyTaskDiagnostics() {
  return dailyTaskDiagnostics.splice(0, dailyTaskDiagnostics.length);
}

function pushDailyTaskDiagnostic(entry) {
  dailyTaskDiagnostics.push(entry);
  if (typeof console !== "undefined" && typeof console.warn === "function") {
    console.warn("[iaqar] INVALID_TASK_DATA", entry);
  }
}

export function opportunityIdFromItem(item = {}) {
  const raw = text(item.recordId || item.opportunityId || item.id);
  return raw.replace(/^opp-/, "");
}

export function indexOpportunityItems(items = []) {
  const map = new Map();
  for (const item of items) {
    if (String(item?.recordType || "").toLowerCase() !== "opportunity") continue;
    const id = opportunityIdFromItem(item);
    if (id) map.set(id, item);
  }
  return map;
}

function listingHasIdentity(listing = {}) {
  return Boolean(text(listing.propertyType) && (text(listing.district) || text(listing.city)));
}

function isTemporaryDailyTaskId(id = "") {
  const value = text(id);
  if (!value) return false;
  if (/^opp_/i.test(value)) return false;
  return /^(?:cli|own)_intake_|^(?:cli|own)_wa_|^intake_cycle_/i.test(value)
    || /^(?:cli|own)_/i.test(value);
}

function matchIdsFrom(item = {}) {
  const recordType = String(item.recordType || "").toLowerCase();
  return {
    matchId: text(item.matchId || (recordType === "match" ? item.recordId || item.id : "")),
    requestId: text(item.clientRequestId || item.requestId),
    offerId: text(item.ownerOfferId || item.offerId)
  };
}

export function diagnoseMatchLinkage(item = {}, opportunities = new Map()) {
  const ids = matchIdsFrom(item);
  const reasons = [];
  if (upper(item.integrityStatus) === "INVALID") {
    reasons.push(...text(item.integrityReason || "integrity_invalid").split(",").filter(Boolean));
  }
  if (!ids.matchId) reasons.push("missing_matchId");
  if (!ids.requestId) reasons.push("missing_requestId");
  if (!ids.offerId) reasons.push("missing_offerId");
  if (isTemporaryDailyTaskId(ids.requestId)) reasons.push("temporary_request_id");
  if (isTemporaryDailyTaskId(ids.offerId)) reasons.push("temporary_offer_id");
  const request = item._canonicalRequest || opportunities.get(ids.requestId) || null;
  const offer = item._canonicalOffer || opportunities.get(ids.offerId) || null;
  if (opportunities.size) {
    if (ids.requestId && !request) reasons.push("unresolved_request");
    if (ids.offerId && !offer) reasons.push("unresolved_offer");
  }
  const sourceOk = listingHasIdentity({
    propertyType: item.propertyType || request?.propertyType,
    district: item.district || request?.district,
    city: item.city || request?.city
  });
  const offerOk = listingHasIdentity({
    propertyType: item.candidatePropertyType || item.propertyType || offer?.propertyType,
    district: item.candidateDistrict || item.district || offer?.district,
    city: item.candidateCity || item.city || offer?.city
  });
  if (!sourceOk) reasons.push("incomplete_request_listing");
  if (!offerOk) reasons.push("incomplete_offer_listing");
  const unique = [...new Set(reasons)];
  return {
    ok: unique.length === 0,
    code: unique.length ? TASK_DATA_INTEGRITY.INVALID_TASK_DATA : TASK_DATA_INTEGRITY.OK,
    reasons: unique,
    matchId: ids.matchId,
    requestId: ids.requestId,
    offerId: ids.offerId,
    request,
    offer
  };
}

function overlayListing(item, opportunity, role) {
  if (!opportunity) return item;
  const next = { ...item };
  if (role === "request") {
    next.propertyType = text(next.propertyType) || opportunity.propertyType;
    next.purpose = text(next.purpose) || opportunity.purpose || opportunity.transactionType;
    next.district = text(next.district) || opportunity.district;
    next.city = text(next.city) || opportunity.city;
    next.budget = next.budget || opportunity.budget || opportunity.priceOrBudget;
    next.area = next.area || opportunity.area;
    next.clientPhone = text(next.clientPhone) || opportunity.contactPhone;
    next.clientName = text(next.clientName) || opportunity.contactName;
    next._canonicalRequest = opportunity;
  } else {
    next.candidatePropertyType = text(next.candidatePropertyType) || opportunity.propertyType;
    next.candidatePurpose = text(next.candidatePurpose) || opportunity.purpose || opportunity.transactionType;
    next.candidateDistrict = text(next.candidateDistrict) || opportunity.district;
    next.candidateCity = text(next.candidateCity) || opportunity.city;
    next.candidateSalePrice = next.candidateSalePrice || opportunity.salePrice || opportunity.annualRent || opportunity.priceOrBudget;
    next.candidateArea = next.candidateArea || opportunity.area;
    next.salePrice = next.salePrice || opportunity.salePrice;
    next.annualRent = next.annualRent || opportunity.annualRent;
    next.ownerPhone = text(next.ownerPhone) || opportunity.contactPhone;
    next.ownerName = text(next.ownerName) || opportunity.contactName;
    next._canonicalOffer = opportunity;
  }
  return next;
}

export function hydrateMatchItemFromOpportunities(item = {}, opportunities = new Map()) {
  const ids = matchIdsFrom(item);
  let next = {
    ...item,
    matchId: ids.matchId || item.matchId,
    requestId: ids.requestId,
    offerId: ids.offerId,
    clientRequestId: ids.requestId,
    ownerOfferId: ids.offerId
  };
  next = overlayListing(next, opportunities.get(ids.requestId), "request");
  next = overlayListing(next, opportunities.get(ids.offerId), "offer");
  return next;
}

function uniqueMatchItems(items = []) {
  const ranked = [...items].sort((a, b) => {
    const score = (item) => {
      let value = String(item.recordType || "").toLowerCase() === "match" ? 2 : 0;
      if (item._canonicalRequest || item._canonicalOffer) value += 1;
      return value;
    };
    return score(b) - score(a);
  });
  const seen = new Set();
  const out = [];
  for (const item of ranked) {
    const id = matchIdsFrom(item).matchId || text(item.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(item);
  }
  return out;
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

export function dailyTaskTypePurposeLine(record = {}) {
  const propertyType = text(record.propertyType);
  const purpose = purposeWord(record);
  return [propertyType, purpose].filter(Boolean).join(" ");
}

export function dailyTaskPlaceLine(record = {}) {
  const district = text(record.district).replace(/^حي\s+/, "");
  const city = text(record.city);
  return [district, city].filter(Boolean).join(" · ");
}

export function dailyTaskIdentityLine(record = {}) {
  const head = dailyTaskTypePurposeLine(record);
  const district = districtBit(record);
  return [head, district].filter(Boolean).join(" · ");
}

export function dailyTaskPropertyLine(record = {}) {
  const head = dailyTaskTypePurposeLine(record);
  const place = dailyTaskPlaceLine(record);
  if (head && place) return `${head}\n${place}`;
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

function detailsLabel() {
  return "عرض التفاصيل الكاملة";
}

function shareDetailsAction() {
  return {
    id: EXEC_ACTION.SHARE_DETAILS,
    label: "مشاركة التفاصيل",
    variant: "text"
  };
}

function confirmDealAction() {
  return {
    id: EXEC_ACTION.CONFIRM_DEAL,
    label: "تأكيد إتمام الصفقة"
  };
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

function canOpenOffer(record = {}) {
  if (record.canOpenOffer === false) return false;
  if (record.dataIntegrity === TASK_DATA_INTEGRITY.INVALID_TASK_DATA) return false;
  return Boolean(text(record.offerId || record.ownerOfferId));
}

function shouldOfferSendAction(record = {}, party = "client") {
  if (record.dataIntegrity === TASK_DATA_INTEGRITY.INVALID_TASK_DATA) return false;
  if (!text(record.matchId)) return false;
  if (!text(record.offerId || record.ownerOfferId)) return false;
  if (!text(record.requestId || record.clientRequestId || record.opportunityId)) return false;
  return party === "owner" ? true : true;
}

function canSendParty(record = {}, party = "client") {
  if (!shouldOfferSendAction(record, party)) return false;
  if (party === "owner") {
    if (record.canSendToOwner === false) return false;
    if (record.canSendToOwner === true) return true;
    return isValidContactPhone(record.ownerPhone || record.ownerContactPhone || record.advertiserPhone);
  }
  if (record.canSendToClient === false) return false;
  if (record.canSendToClient === true) return true;
  return isValidContactPhone(record.clientPhone || record.clientContactPhone || record.buyerPhone);
}

function actionsForState(stateKey, record = {}) {
  const secondary = [];
  let primary = null;
  if (record.dataIntegrity === TASK_DATA_INTEGRITY.INVALID_TASK_DATA) {
    return { primaryAction: null, secondaryActions: [] };
  }
  const ownerNeeded = Boolean(record.ownerContactNeeded);
  const living = upper(record.livingStage);
  const offerAction = canOpenOffer(record) ? openOfferAction(record) : null;
  if (living === LIVING_TASK_STAGE.FOLLOW_UP) {
    primary = confirmDealAction();
    if (offerAction) secondary.push(offerAction);
    return { primaryAction: primary, secondaryActions: secondary.slice(0, 2) };
  }
  if (ownerNeeded) {
    primary = shouldOfferSendAction(record, "owner") ? sendToOwnerAction(record) : null;
    if (offerAction) secondary.push(offerAction);
    return { primaryAction: primary, secondaryActions: secondary.slice(0, 2) };
  }
  if (living === LIVING_TASK_STAGE.WAITING_PROPERTY_CONFIRMATION
    || living === LIVING_TASK_STAGE.APPOINTMENT_CONFIRMED
    || living === LIVING_TASK_STAGE.PROPERTY_AVAILABLE
    || living === LIVING_TASK_STAGE.APPOINTMENT_COORDINATION) {
    if (offerAction) secondary.push(offerAction);
    return { primaryAction: null, secondaryActions: secondary.slice(0, 2) };
  }
  if (stateKey === DAILY_TASK_STATE.NEW_MATCH || stateKey === DAILY_TASK_STATE.AWAITING_SEND) {
    if (record.hasRejectedCandidate && record.hasNextCandidate) {
      primary = {
        id: EXEC_ACTION.REVIEW_NEXT,
        label: "مراجعة العرض التالي"
      };
    } else if (Number(record.candidateCount || 0) > 1) {
      primary = {
        id: EXEC_ACTION.REVIEW_NEXT,
        label: "مراجعة المطابقات"
      };
    } else if (shouldOfferSendAction(record, "client")) {
      primary = sendToClientAction(record);
    }
  }
  if ((stateKey === DAILY_TASK_STATE.CLIENT_NEEDS_DETAILS && record.missingInfoKey)
    || living === LIVING_TASK_STAGE.CLIENT_NEEDS_MISSING_INFO) {
    primary = {
      id: EXEC_ACTION.COMPLETE_INFO,
      label: "استكمال"
    };
  }
  if (stateKey === DAILY_TASK_STATE.AWAITING_CLIENT && shouldOfferSendAction(record, "client")) {
    secondary.push(sendToClientAction(record, EXEC_ACTION.RESEND_TO_CLIENT, "إعادة الإرسال"));
  }
  if (offerAction) secondary.push(offerAction);
  return {
    primaryAction: primary,
    secondaryActions: secondary.slice(0, 2)
  };
}

export function dailyTaskPriorityGroup(stateKey, badgeKey, sortGroup = "") {
  if (sortGroup && TASK_SORT_GROUP_RANK[sortGroup]) return sortGroup;
  if (badgeKey === "overdue") return "NEEDS_BROKER_ACTION";
  if (stateKey === DAILY_TASK_STATE.NEW_MATCH || stateKey === DAILY_TASK_STATE.AWAITING_SEND) {
    return "NEEDS_BROKER_ACTION";
  }
  if (stateKey === DAILY_TASK_STATE.APPOINTMENT_TODAY) return "TODAY_APPOINTMENT";
  if (
    stateKey === DAILY_TASK_STATE.CLIENT_INTERESTED
    || stateKey === DAILY_TASK_STATE.CLIENT_NEEDS_DETAILS
  ) {
    return "NEW_EXTERNAL_RESPONSE";
  }
  if (stateKey === DAILY_TASK_STATE.AWAITING_CLIENT) return "WAITING_EXTERNAL_PARTY";
  return "PASSIVE_STATUS";
}

export function buildDailyTaskView(record = {}) {
  const stateKey = record.stateKey || DAILY_TASK_STATE.NEW_MATCH;
  const badgeKey = record.badgeKey || (stateKey === DAILY_TASK_STATE.APPOINTMENT_TODAY ? "today" : "now");
  const now = coerceDailyTaskDate(record.now) || new Date();
  const occurredAt = record.createdAt || record.updatedAt || record.livingUpdatedAt;
  const clockLabel = text(record.clockLabel) || formatDailyTaskClock(occurredAt, now);
  const nextByState = {
    [DAILY_TASK_STATE.NEW_MATCH]: "",
    [DAILY_TASK_STATE.AWAITING_SEND]: "",
    [DAILY_TASK_STATE.AWAITING_CLIENT]: "",
    [DAILY_TASK_STATE.CLIENT_INTERESTED]: "",
    [DAILY_TASK_STATE.CLIENT_NEEDS_DETAILS]: "",
    [DAILY_TASK_STATE.MATCH_UNSUITABLE]: "",
    [DAILY_TASK_STATE.APPOINTMENT_TODAY]: ""
  };
  const { primaryAction, secondaryActions } = actionsForState(stateKey, record);
  const sessionKind = primaryAction?.sessionKind
    || secondaryActions.find((action) => action.sessionKind)?.sessionKind
    || SECURE_SESSION_KIND.CLIENT_MATCH_REVIEW;
  const referenceCode = text(record.referenceCode) || formatOpportunityReference(
    record.opportunityId || record.offerId || record.requestId || record.id
  );
  const identityLine = text(record.identityLine) || dailyTaskIdentityLine(record);
  const typePurposeLine = text(record.typePurposeLine) || identityLine || dailyTaskTypePurposeLine(record);
  const placeLine = text(record.placeLine) || dailyTaskPlaceLine(record);
  return {
    id: text(record.id),
    stateKey,
    kindLabel: text(record.kindLabel) || DAILY_TASK_STATE_LABELS[stateKey] || DAILY_TASK_STATE_LABELS.new_match,
    badgeKey,
    badgeLabel: badgeKey === "overdue" && !clockLabel ? DAILY_TASK_BADGE.overdue : clockLabel,
    clockLabel,
    createdAt: occurredAt || "",
    dataIntegrity: record.dataIntegrity || TASK_DATA_INTEGRITY.OK,
    integrityReasons: Array.isArray(record.integrityReasons) ? record.integrityReasons : [],
    canSendToClient: record.canSendToClient,
    canSendToOwner: record.canSendToOwner,
    canOpenOffer: record.canOpenOffer,
    isTestFixture: Boolean(record.isTestFixture),
    testRunId: text(record.testRunId),
    referenceCode,
    workflowId: text(record.workflowId || record.groupKey || record.id),
    propertyType: text(record.propertyType),
    purpose: text(record.purpose),
    city: text(record.city),
    district: text(record.district),
    priceOrBudget: text(record.moneyLine) || dailyTaskMoneyLine(record),
    typePurposeLine,
    placeLine,
    propertyLine: text(record.propertyLine) || [typePurposeLine, placeLine].filter(Boolean).join("\n"),
    moneyLine: text(record.moneyLine) || dailyTaskMoneyLine(record),
    statusLabel: record.statusLabel != null
      ? text(record.statusLabel)
      : (DAILY_TASK_STATUS_LABELS[stateKey] || DAILY_TASK_STATUS_LABELS.new_match),
    currentStatus: record.statusLabel != null
      ? text(record.statusLabel)
      : (DAILY_TASK_STATUS_LABELS[stateKey] || DAILY_TASK_STATUS_LABELS.new_match),
    requiresAction: record.requiresAction != null
      ? Boolean(record.requiresAction)
      : Boolean(primaryAction),
    requiresActionBy: text(record.requiresActionBy || record.nextActor || ""),
    nextActionLine: record.nextActionLine != null
      ? text(record.nextActionLine)
      : (nextByState[stateKey] || ""),
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
    priorityGroup: dailyTaskPriorityGroup(stateKey, badgeKey, record.sortGroup),
    endsThisMatchOnly: stateKey === DAILY_TASK_STATE.MATCH_UNSUITABLE,
    exposeCounterpartyContact: false,
    taskKind: record.taskKind || "match_group",
    candidateCount: Number(record.candidateCount || 0),
    candidateCountLine: text(record.candidateCountLine),
    candidates: Array.isArray(record.candidates) ? record.candidates : [],
    sourceListing: record.sourceListing || null,
    proposedListing: record.proposedListing || null,
    matchReasons: Array.isArray(record.matchReasons) ? record.matchReasons : [],
    livingStage: text(record.livingStage),
    missingInfoKey: text(record.missingInfoKey),
    ownerContactNeeded: Boolean(record.ownerContactNeeded),
    hasNextCandidate: Boolean(record.hasNextCandidate),
    hasRejectedCandidate: Boolean(record.hasRejectedCandidate),
    happenedLine: text(record.happenedLine),
    turnLine: text(record.turnLine),
    yourTurnLine: text(record.yourTurnLine),
    waiting: Boolean(record.waiting),
    timeline: parseLivingTimeline(record.timeline || record.livingTimeline),
    revealClosedLabel: text(record.revealClosedLabel) || "عرض البيانات",
    revealOpenLabel: text(record.revealOpenLabel) || "إخفاء البيانات",
    groupKey: text(record.groupKey),
    livingUpdatedAt: text(record.livingUpdatedAt || record.updatedAt),
    hasNewResponse: Boolean(record.hasNewResponse),
    partnerOfficeName: text(record.partnerOfficeName),
    partnerOfficeId: text(record.partnerOfficeId),
    identityLine
  };
}

export function sortDailyTaskViews(tasks = []) {
  return [...tasks].sort((a, b) => {
    const rankOf = (task) => {
      if (task.taskKind === "cooperation" && task.sortGroup) {
        return SORT_GROUP_RANK[task.sortGroup] ?? 9;
      }
      return PRIORITY_RANK[task.priorityGroup] ?? TASK_SORT_GROUP_RANK[task.priorityGroup] ?? 9;
    };
    const rank = rankOf(a) - rankOf(b);
    if (rank !== 0) return rank;
    const newA = Number(Boolean(a.hasNewResponse));
    const newB = Number(Boolean(b.hasNewResponse));
    if (newA !== newB) return newB - newA;
    const time = String(b.livingUpdatedAt || "").localeCompare(String(a.livingUpdatedAt || ""));
    if (time !== 0) return time;
    return String(a.id || "").localeCompare(String(b.id || ""));
  });
}

export function isDailyTaskExecutionSource(item = {}) {
  const opType = upper(item.operationType);
  const recordType = String(item.recordType || "").toLowerCase();
  if (opType === "MISSING_DATA") return false;
  if (upper(item.matchingReadiness) === "NEEDS_COMPLETION") return false;
  if (opType === "PLATFORM_OPPORTUNITY_OFFER") return true;
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
  return stateKeyFromLivingStage(item.livingStage || item.metadata?.livingStage || "");
}

function stateKeyFromLivingStage(stage = "") {
  const key = upper(stage);
  if (key === LIVING_TASK_STAGE.WAITING_CLIENT || key === LIVING_TASK_STAGE.CLIENT_SENT) {
    return DAILY_TASK_STATE.AWAITING_CLIENT;
  }
  if (key === LIVING_TASK_STAGE.CLIENT_INTERESTED || key === LIVING_TASK_STAGE.PROPERTY_AVAILABLE) {
    return DAILY_TASK_STATE.CLIENT_INTERESTED;
  }
  if (key === LIVING_TASK_STAGE.CLIENT_NEEDS_DETAILS || key === LIVING_TASK_STAGE.CLIENT_NEEDS_MISSING_INFO) {
    return DAILY_TASK_STATE.CLIENT_NEEDS_DETAILS;
  }
  if (key === LIVING_TASK_STAGE.CLIENT_REJECTED || key === LIVING_TASK_STAGE.MATCH_EXHAUSTED) {
    return DAILY_TASK_STATE.MATCH_UNSUITABLE;
  }
  if (key === LIVING_TASK_STAGE.APPOINTMENT_CONFIRMED) return DAILY_TASK_STATE.APPOINTMENT_TODAY;
  if (key === LIVING_TASK_STAGE.WAITING_PROPERTY_CONFIRMATION) return DAILY_TASK_STATE.CLIENT_INTERESTED;
  return DAILY_TASK_STATE.NEW_MATCH;
}

function formatAppointmentLine(value) {
  const at = new Date(value);
  if (!Number.isFinite(at.getTime())) return "";
  const weekday = at.toLocaleString("ar-SA", { timeZone: "Asia/Riyadh", weekday: "long" });
  const time = at.toLocaleString("ar-SA", {
    timeZone: "Asia/Riyadh",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  }).replace(/\s+/g, " ").trim();
  return [weekday, time].filter(Boolean).join(" ");
}

function listingLine(record = {}) {
  const typePurpose = dailyTaskTypePurposeLine({
    propertyType: record.propertyType || record.candidatePropertyType,
    purpose: record.purpose || record.candidatePurpose
  });
  const place = dailyTaskPlaceLine({
    district: record.district || record.candidateDistrict,
    city: record.city || record.candidateCity
  });
  return [typePurpose, place].filter(Boolean).join(" · ");
}

function areaLine(record = {}) {
  const area = Number(record.area || record.candidateArea || 0);
  return area > 0 ? `${area.toLocaleString("en-US")} م²` : "";
}

function moneyFromCandidate(record = {}) {
  return dailyTaskMoneyLine({
    salePrice: record.candidateSalePrice ?? record.salePrice ?? record.price,
    budget: record.budget,
    annualRent: record.annualRent,
    purpose: record.candidatePurpose || record.purpose
  });
}

function derivedMatchReasons(source = {}, proposed = {}, existing = []) {
  const lines = existing.map((row) => text(row)).filter(Boolean);
  const add = (line) => {
    if (line && !lines.includes(line) && !lines.some((row) => row.includes(line))) lines.push(line);
  };
  const srcDistrict = text(source.district).replace(/^حي\s+/, "");
  const prDistrict = text(proposed.district).replace(/^حي\s+/, "");
  if (srcDistrict && prDistrict && srcDistrict === prDistrict) add("نفس الحي");
  const srcMoney = Number(String(source.money || "").replace(/[^\d.]/g, ""));
  const prMoney = Number(String(proposed.money || "").replace(/[^\d.]/g, ""));
  if (srcMoney > 0 && prMoney > 0 && prMoney <= srcMoney) add("ضمن الميزانية");
  else if (srcMoney > 0 && prMoney > 0 && Math.abs(prMoney - srcMoney) / srcMoney <= 0.12) add("السعر مناسب");
  const srcArea = Number(String(source.area || "").replace(/[^\d.]/g, ""));
  const prArea = Number(String(proposed.area || "").replace(/[^\d.]/g, ""));
  if (srcArea > 0 && prArea > 0 && Math.abs(prArea - srcArea) / srcArea <= 0.15) add("المساحة متقاربة");
  return lines.slice(0, 4);
}

function reasonsFrom(item = {}) {
  if (Array.isArray(item.matchReasons) && item.matchReasons.length) {
    return item.matchReasons.map((row) => text(row)).filter(Boolean);
  }
  const preview = text(item.reasonPreview || item.metadata?.reasonPreview);
  return preview ? preview.split("،").map((row) => text(row)).filter(Boolean) : [];
}

function matchRecordFromItem(item = {}, now = new Date()) {
  const matchId = item.matchId || (String(item.recordType || "").toLowerCase() === "match" ? item.recordId || item.id : "");
  return {
    id: item.id || matchId,
    stateKey: liveStateKey(item, now),
    badgeKey: liveBadgeKey(item, now),
    propertyType: item.propertyType || item.candidatePropertyType,
    purpose: item.purpose || item.candidatePurpose,
    district: item.district || item.candidateDistrict,
    city: item.city || item.candidateCity,
    salePrice: item.candidateSalePrice ?? item.salePrice ?? item.price,
    budget: item.budget,
    annualRent: item.annualRent,
    area: item.candidateArea ?? item.area,
    matchId,
    offerId: item.ownerOfferId || item.offerId,
    requestId: item.clientRequestId || item.requestId,
    opportunityId: item.opportunityId || item.ownerOfferId || item.clientRequestId,
    opportunityKind: item.opportunityKind,
    sourceCollection: item.sourceCollection,
    matchGroupId: item.matchGroupId,
    livingStage: item.livingStage || item.metadata?.livingStage,
    rejectedMatchIds: item.rejectedMatchIds || item.metadata?.rejectedMatchIds,
    missingInfoKey: item.missingInfoKey || item.metadata?.missingInfoKey,
    ownerContactNeeded: item.ownerContactNeeded || item.metadata?.ownerContactNeeded,
    clientPhone: item.clientPhone || item.clientContactPhone || item.buyerPhone,
    ownerPhone: item.ownerPhone || item.ownerContactPhone || item.advertiserPhone,
    clientName: item.clientName,
    ownerName: item.ownerName,
    score: item.score || item.metadata?.score,
    opportunityScore: item.opportunityScore || item.metadata?.opportunityScore,
    isBestOpportunity: item.isBestOpportunity || item.metadata?.isBestOpportunity,
    matchReasons: reasonsFrom(item),
    viewingAt: item.viewingAt,
    appointmentAt: item.appointmentAt,
    livingTimeline: item.livingTimeline || item.livingTimelineJson || item.metadata?.livingTimeline,
    hasNewResponse: item.hasNewResponse || item.metadata?.hasNewResponse,
    nextActor: item.nextActor || item.metadata?.nextActor,
    livingUpdatedAt: item.livingUpdatedAt || item.metadata?.livingUpdatedAt || item.updatedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    now,
    isTestFixture: item.isTestFixture === true || item.qaLiveE2e === true,
    testRunId: item.testRunId || item.qaLiveRunId || "",
    createdBy: item.createdBy || "",
    candidatePropertyType: item.candidatePropertyType,
    candidatePurpose: item.candidatePurpose,
    candidateDistrict: item.candidateDistrict,
    candidateCity: item.candidateCity,
    candidateSalePrice: item.candidateSalePrice,
    candidateArea: item.candidateArea
  };
}

export function buildMatchGroupDailyTask(group, now = new Date()) {
  if (!group?.living) return null;
  if (group.living.stage === LIVING_TASK_STAGE.MATCH_EXHAUSTED
    || group.living.stage === LIVING_TASK_STAGE.COMPLETED) {
    return null;
  }
  const remaining = group.living.remaining.length ? group.living.remaining : group.members;
  if (!remaining.length) return null;
  const active = remaining[0];
  const sourceIsRequest = isRequestSource(active) || Boolean(text(active.clientRequestId || active.requestId));
  const source = {
    propertyType: active.propertyType,
    purpose: active.purpose,
    district: active.district,
    city: active.city,
    budget: active.budget,
    area: active.area,
    money: dailyTaskMoneyLine({
      budget: active.budget,
      salePrice: sourceIsRequest ? 0 : (active.salePrice || active.price),
      annualRent: active.annualRent,
      purpose: active.purpose
    })
  };
  const proposed = {
    propertyType: active.candidatePropertyType || active.propertyType,
    purpose: active.candidatePurpose || active.purpose,
    district: active.candidateDistrict || active.district,
    city: active.candidateCity || active.city,
    salePrice: active.candidateSalePrice ?? active.salePrice,
    area: active.candidateArea ?? active.area,
    money: moneyFromCandidate(active)
  };
  const appointmentToday = liveStateKey(active, now) === DAILY_TASK_STATE.APPOINTMENT_TODAY
    || group.living.stage === LIVING_TASK_STAGE.APPOINTMENT_CONFIRMED;
  const copy = livingCopy(group.living.stage, {
    missingInfoKey: group.living.missingInfoKey,
    hasNextCandidate: group.living.rejectedMatchIds.length > 0 && remaining.length > 0,
    appointmentLine: formatAppointmentLine(active.viewingAt || active.appointmentAt),
    ownerContactNeeded: group.living.ownerContactNeeded
  });
  const candidates = remaining.map((item, index) => ({
    matchId: text(item.matchId || item.recordId || item.id),
    offerId: text(item.ownerOfferId || item.offerId),
    requestId: text(item.clientRequestId || item.requestId),
    score: Number(item.opportunityScore || item.score || 0),
    rank: index + 1,
    propertyLine: listingLine(item),
    moneyLine: moneyFromCandidate(item),
    areaLine: areaLine(item),
    reasons: reasonsFrom(item)
  }));
  const best = candidates[0] || {};
  const candidateCount = candidates.length;
  const stateKey = appointmentToday
    ? DAILY_TASK_STATE.APPOINTMENT_TODAY
    : stateKeyFromLivingStage(group.living.stage);
  const badgeKey = remaining.some((item) => liveBadgeKey(item, now) === "overdue")
    ? "overdue"
    : (appointmentToday ? "today" : "now");
  const sortGroup = sortGroupForLivingStage(group.living.stage, {
    overdue: badgeKey === "overdue",
    appointmentToday,
    ownerContactNeeded: group.living.ownerContactNeeded,
    hasNewResponse: group.living.hasNewResponse
  });
  const missingInfo = group.living.stage === LIVING_TASK_STAGE.CLIENT_NEEDS_MISSING_INFO;
  const opportunityId = sourceIsRequest
    ? (active.clientRequestId || active.requestId || active.opportunityId)
    : (active.ownerOfferId || active.offerId || active.opportunityId);
  const referenceCode = formatOpportunityReference(opportunityId);
  const sourceListing = {
    propertyType: source.propertyType,
    district: source.district,
    city: source.city,
    money: source.money,
    area: areaLine(source),
    purpose: source.purpose,
    kindLabel: sourceIsRequest ? "طلب العميل" : "عرض المالك"
  };
  const proposedListing = {
    propertyType: proposed.propertyType,
    district: proposed.district,
    city: proposed.city,
    money: proposed.money,
    area: areaLine(proposed),
    purpose: proposed.purpose,
    kindLabel: sourceIsRequest ? "العرض المطابق" : "الطلب المطابق"
  };
  const contactGate = evaluateMatchContactGate({
    item: active,
    request: active._canonicalRequest,
    offer: active._canonicalOffer,
    ownerContactNeeded: group.living.ownerContactNeeded
  });
  const isEarlyContactGate = !contactGate.contactComplete
    && stateKey === DAILY_TASK_STATE.NEW_MATCH
    && upper(group.living.stage) === LIVING_TASK_STAGE.MATCH_FOUND
    && group.living.rejectedMatchIds.length === 0;
  const statusLabel = isEarlyContactGate
    ? MATCH_CONTACT_INCOMPLETE_LABEL
    : (copy.statusLabel != null
      ? text(copy.statusLabel)
      : (contactGate.canShowAsMatched
        ? (DAILY_TASK_STATUS_LABELS[stateKey] || "")
        : MATCH_CONTACT_INCOMPLETE_LABEL));
  return buildDailyTaskView({
    ...matchRecordFromItem(active, now),
    id: group.taskId || livingTaskId(group.groupKey),
    taskKind: "match_group",
    groupKey: group.groupKey,
    workflowId: group.taskId || livingTaskId(group.groupKey),
    referenceCode,
    stateKey,
    badgeKey,
    sortGroup,
    livingStage: group.living.stage,
    propertyType: source.propertyType || proposed.propertyType,
    purpose: source.purpose || proposed.purpose,
    district: source.district || proposed.district,
    city: source.city || proposed.city,
    typePurposeLine: dailyTaskIdentityLine(source.propertyType ? source : proposed),
    identityLine: dailyTaskIdentityLine(source.propertyType ? source : proposed),
    placeLine: text((source.district || source.city ? source : proposed).city),
    propertyLine: dailyTaskIdentityLine(source.propertyType ? source : proposed),
    now,
    salePrice: proposed.salePrice,
    budget: source.budget,
    candidateCount,
    candidateCountLine: formatCandidateCountLine(candidateCount, sourceIsRequest),
    moneyLine: candidateCount > 1
      ? formatBestResultLine({ money: best.moneyLine, area: best.areaLine })
      : (best.moneyLine || dailyTaskMoneyLine(active)),
    nextActionLine: copy.nextActionLine,
    happenedLine: copy.happenedLine,
    turnLine: copy.turnLine,
    yourTurnLine: copy.yourTurnLine,
    waiting: Boolean(copy.waiting),
    requiresAction: !copy.waiting,
    requiresActionBy: group.living.nextActor || "",
    revealClosedLabel: candidateCount > 1 ? "مراجعة المطابقات" : copy.revealClosedLabel,
    revealOpenLabel: copy.revealOpenLabel,
    kindLabel: copy.kindLabel,
    statusLabel,
    currentStatus: statusLabel,
    candidates,
    sourceListing,
    proposedListing,
    matchReasons: derivedMatchReasons(sourceListing, proposedListing, best.reasons || reasonsFrom(active)),
    timeline: group.living.timeline || [],
    missingInfoKey: missingInfo ? group.living.missingInfoKey : "",
    ownerContactNeeded: group.living.ownerContactNeeded,
    hasNextCandidate: remaining.length > 1 || (group.living.rejectedMatchIds.length > 0 && remaining.length > 0),
    hasRejectedCandidate: group.living.rejectedMatchIds.length > 0,
    hasNewResponse: group.living.hasNewResponse,
    livingUpdatedAt: group.living.livingUpdatedAt,
    matchId: group.living.activeMatchId || active.matchId,
    offerId: active.ownerOfferId || active.offerId,
    requestId: active.clientRequestId || active.requestId,
    opportunityId,
    createdAt: active.createdAt || group.living.livingUpdatedAt,
    updatedAt: active.updatedAt || group.living.livingUpdatedAt,
    dataIntegrity: active.dataIntegrity || TASK_DATA_INTEGRITY.OK,
    integrityReasons: active.integrityReasons || [],
    canSendToClient: contactGate.canSendToClient,
    canSendToOwner: contactGate.canSendToOwner,
    canOpenOffer: active.canOpenOffer !== false && Boolean(text(active.ownerOfferId || active.offerId)),
    isTestFixture: Boolean(active.isTestFixture),
    testRunId: text(active.testRunId)
  });
}

export function mapOperationsItemToDailyTask(item = {}, now = new Date(), { officeId = "" } = {}) {
  if (!isDailyTaskExecutionSource(item)) return null;
  if (isPlatformOpportunitySource(item)) return buildPlatformOpportunityDailyTask(item, now);
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
  return buildDailyTaskView(matchRecordFromItem(item, now));
}

export function mapOperationsItemsToDailyTasks(items = [], now = new Date(), {
  officeId = "",
  showTestFixtures = false
} = {}) {
  const views = [];
  const seen = new Set();
  const seenMatchIds = new Set();
  const allowFixtures = showTestFixtures || isDedicatedQaOffice(officeId);
  const opportunities = indexOpportunityItems(items);
  const matchItems = [];
  for (const item of items) {
    if (!isDailyTaskExecutionSource(item)) continue;
    if (!allowFixtures && isTestFixtureRecord(item)) continue;
    if (isPlatformOpportunitySource(item)) {
      const status = String(item.status || "OPEN").toUpperCase();
      if (status === "COMPLETED" || status === "DISMISSED" || status === "EXPIRED") continue;
      const view = buildPlatformOpportunityDailyTask(item, now);
      const key = view?.id;
      if (!view || !key || seen.has(key)) continue;
      seen.add(key);
      views.push(view);
      continue;
    }
    if (isCooperationSource(item)) {
      const view = mapOperationsItemToDailyTask(item, now, { officeId });
      const key = view?.cooperationTaskId || view?.id;
      if (!view || !key || seen.has(key)) continue;
      seen.add(key);
      views.push(view);
      continue;
    }
    matchItems.push(hydrateMatchItemFromOpportunities(item, opportunities));
  }
  const unique = uniqueMatchItems(matchItems);
  const valid = [];
  for (const item of unique) {
    const diagnosis = diagnoseMatchLinkage(item, opportunities);
    if (!diagnosis.ok) {
      pushDailyTaskDiagnostic({
        code: TASK_DATA_INTEGRITY.INVALID_TASK_DATA,
        taskId: text(item.id || diagnosis.matchId),
        matchId: diagnosis.matchId,
        requestId: diagnosis.requestId,
        offerId: diagnosis.offerId,
        reasons: diagnosis.reasons,
        canonicalRequest: Boolean(diagnosis.request),
        canonicalOffer: Boolean(diagnosis.offer),
        isTestFixture: isTestFixtureRecord(item)
      });
      continue;
    }
    const clientPhone = text(item.clientPhone || diagnosis.request?.contactPhone);
    const ownerPhone = text(item.ownerPhone || diagnosis.offer?.contactPhone);
    const contactGate = evaluateMatchContactGate({
      item: { ...item, clientPhone, ownerPhone },
      request: diagnosis.request,
      offer: diagnosis.offer,
      ownerContactNeeded: item.ownerContactNeeded
    });
    valid.push({
      ...item,
      dataIntegrity: TASK_DATA_INTEGRITY.OK,
      canSendToClient: contactGate.canSendToClient,
      canSendToOwner: contactGate.canSendToOwner,
      canOpenOffer: Boolean(diagnosis.offerId && (diagnosis.offer || opportunities.size === 0)),
      clientPhone: contactGate.clientPhone || clientPhone || item.clientPhone,
      ownerPhone: contactGate.ownerPhone || ownerPhone || item.ownerPhone,
      matchContactStatusLabel: contactGate.statusLabel,
      ownerContactNeeded: Boolean(item.ownerContactNeeded || item.metadata?.ownerContactNeeded)
    });
  }
  for (const group of groupMatchItems(valid, { officeId })) {
    const view = buildMatchGroupDailyTask(group, now);
    const dedupeSource = group?.living?.remaining?.[0] || group?.members?.[0] || {};
    const key = view?.id || view?.groupKey || matchDedupeKey(dedupeSource, officeId);
    const matchKey = text(view?.matchId);
    if (!view || !key || seen.has(key)) continue;
    if (matchKey && seenMatchIds.has(matchKey) && Number(view.candidateCount || 0) <= 1) continue;
    seen.add(key);
    if (matchKey) seenMatchIds.add(matchKey);
    for (const candidate of view.candidates || []) {
      if (candidate.matchId) seenMatchIds.add(candidate.matchId);
    }
    views.push(view);
  }
  return sortDailyTaskViews(views);
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
  if (opType === "PLATFORM_OPPORTUNITY_OFFER") return false;
  if (opType === "COOPERATION_MATCH" || opType === "COOPERATION_REQUEST" || opType === "COOPERATION_RESPONSE") return true;
  return Boolean(item.currentStage && (item.cooperationId || item.cooperationTaskId));
}

function isPlatformOpportunitySource(item = {}) {
  return upper(item.operationType) === "PLATFORM_OPPORTUNITY_OFFER";
}

function buildPlatformOpportunityDailyTask(item = {}, now = new Date()) {
  const metadata = item.metadata && typeof item.metadata === "object" ? item.metadata : {};
  const opportunityId = text(item.opportunityId || metadata.opportunityId);
  const livingTaskId = text(metadata.livingTaskId) || livingTaskIdForOpportunity(opportunityId) || text(item.id);
  const reasonCodes = Array.isArray(metadata.reasonCodes)
    ? metadata.reasonCodes
    : (Array.isArray(item.reasonCodes) ? item.reasonCodes : []);
  const reasonLabels = Array.isArray(metadata.reasonLabels) && metadata.reasonLabels.length
    ? metadata.reasonLabels.map((row) => text(row)).filter(Boolean)
    : reasonCodes.map((code) => ROUTER_REASON_LABELS[code]).filter(Boolean);
  const opportunity = {
    opportunityKind: item.opportunityKind || metadata.opportunityKind,
    purpose: item.purpose || metadata.purpose,
    propertyType: item.propertyType || metadata.propertyType,
    city: item.city || metadata.city,
    district: item.district || metadata.district,
    budget: item.budget || metadata.budget,
    salePrice: item.salePrice || metadata.salePrice,
    priceOrBudget: item.priceOrBudget || metadata.moneyLine,
    annualRent: item.annualRent
  };
  const moneyLine = text(metadata.moneyLine) || platformOpportunityMoneyLine(opportunity);
  const headline = platformOpportunityHeadline(opportunity);
  const status = upper(item.status || "OPEN");
  const active = status !== "COMPLETED" && status !== "DISMISSED" && status !== "EXPIRED";
  return {
    id: livingTaskId,
    operationId: text(item.id),
    opportunityId,
    attemptId: text(metadata.attemptId),
    livingTaskId,
    taskKind: "platform_opportunity",
    kindLabel: "فرصة جديدة من المنصة",
    identityLine: headline,
    typePurposeLine: headline,
    placeLine: [opportunity.district, opportunity.city].filter(Boolean).join(" · "),
    moneyLine,
    priceOrBudget: moneyLine,
    propertyType: text(opportunity.propertyType),
    purpose: text(opportunity.purpose),
    city: text(opportunity.city),
    district: text(opportunity.district),
    reasonTitle: "سبب ترشيح مكتبك",
    reasonCodes,
    reasonLabels,
    hideContactUntilAccept: true,
    statusLabel: active ? "بانتظار الاستلام" : status,
    currentStatus: status,
    requiresAction: active,
    primaryAction: active
      ? { id: EXEC_ACTION.ACCEPT_PLATFORM_OPPORTUNITY, label: "استلام الفرصة" }
      : null,
    secondaryActions: active
      ? [{ id: EXEC_ACTION.DECLINE_PLATFORM_OPPORTUNITY, label: "اعتذار" }]
      : [],
    createdAt: item.createdAt || now.toISOString(),
    updatedAt: item.updatedAt || item.createdAt || now.toISOString(),
    isTestFixture: Boolean(item.isTestFixture || metadata.isTestFixture),
    testRunId: text(item.testRunId || metadata.testRunId)
  };
}

export function buildTaskHeaderViewModel(task = {}) {
  return {
    referenceCode: String(task.referenceCode || "").trim(),
    taskType: String(task.kindLabel || "").trim(),
    propertyType: String(task.propertyType || "").trim(),
    purpose: String(task.purpose || "").trim(),
    city: String(task.city || "").trim(),
    district: String(task.district || "").trim(),
    priceOrBudget: String(task.priceOrBudget || task.moneyLine || "").trim(),
    currentStatus: String(task.currentStatus || task.statusLabel || "").trim(),
    requiresAction: Boolean(task.requiresAction)
  };
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
      createdAt: "2026-08-25T21:21:00.000+03:00",
      now: new Date("2026-08-25T21:30:00.000+03:00"),
      opportunityKind: "OFFER",
      propertyType: "أرض",
      purpose: "SALE",
      district: "عروة",
      city: "المدينة المنورة",
      salePrice: 500000,
      matchId: "match_new_1",
      offerId: "offer_urwah_1842",
      requestId: "request_urwah_1842",
      opportunityId: "offer_urwah_1842",
      clientPhone: "0511111111",
      ownerPhone: "0522222222",
      clientName: "عميل عروة",
      ownerName: "مالك عروة"
    }),
    buildDailyTaskView({
      id: "task_awaiting_client",
      stateKey: DAILY_TASK_STATE.AWAITING_CLIENT,
      createdAt: "2026-08-25T11:05:00.000+03:00",
      now: new Date("2026-08-25T21:30:00.000+03:00"),
      opportunityKind: "OFFER",
      propertyType: "شقة",
      purpose: "SALE",
      district: "الوعيرة",
      salePrice: 850000,
      matchId: "match_wait_1",
      offerId: "offer_wait_1",
      requestId: "request_wait_1",
      opportunityId: "offer_wait_1",
      clientPhone: "0533333333",
      ownerPhone: "0544444444"
    }),
    buildDailyTaskView({
      id: "task_interested",
      stateKey: DAILY_TASK_STATE.CLIENT_INTERESTED,
      createdAt: "2026-08-25T10:00:00.000+03:00",
      now: new Date("2026-08-25T21:30:00.000+03:00"),
      opportunityKind: "OFFER",
      propertyType: "فيلا",
      purpose: "SALE",
      district: "الجرف",
      salePrice: 1200000,
      matchId: "match_hot_1",
      offerId: "offer_hot_1",
      requestId: "request_hot_1",
      opportunityId: "offer_hot_1"
    }),
    buildDailyTaskView({
      id: "task_needs_details",
      stateKey: DAILY_TASK_STATE.CLIENT_NEEDS_DETAILS,
      createdAt: "2026-08-25T09:00:00.000+03:00",
      now: new Date("2026-08-25T21:30:00.000+03:00"),
      opportunityKind: "REQUEST",
      propertyType: "شقة",
      purpose: "RENT",
      district: "الرانوناء",
      annualRent: 45000,
      matchId: "match_info_1",
      requestId: "request_info_1",
      offerId: "offer_info_1",
      opportunityId: "request_info_1"
    }),
    buildDailyTaskView({
      id: "task_unsuitable",
      stateKey: DAILY_TASK_STATE.MATCH_UNSUITABLE,
      createdAt: "2026-08-24T20:43:00.000+03:00",
      now: new Date("2026-08-25T21:30:00.000+03:00"),
      opportunityKind: "OFFER",
      propertyType: "دور",
      purpose: "SALE",
      district: "قباء",
      salePrice: 720000,
      matchId: "match_no_1",
      offerId: "offer_no_1",
      requestId: "request_no_1",
      opportunityId: "offer_no_1"
    }),
    buildDailyTaskView({
      id: "task_overdue",
      stateKey: DAILY_TASK_STATE.NEW_MATCH,
      badgeKey: "overdue",
      createdAt: "2026-08-24T20:43:00.000+03:00",
      now: new Date("2026-08-25T21:30:00.000+03:00"),
      opportunityKind: "OFFER",
      propertyType: "أرض",
      purpose: "SALE",
      district: "شوران",
      salePrice: 640000,
      matchId: "match_late_1",
      offerId: "offer_late_1",
      requestId: "request_late_1",
      opportunityId: "offer_late_1"
    }),
    buildDailyTaskView({
      id: "task_appointment_today",
      stateKey: DAILY_TASK_STATE.APPOINTMENT_TODAY,
      createdAt: "2026-08-25T08:00:00.000+03:00",
      now: new Date("2026-08-25T21:30:00.000+03:00"),
      opportunityKind: "OFFER",
      propertyType: "أرض",
      purpose: "SALE",
      district: "عروة",
      city: "المدينة المنورة",
      salePrice: 500000,
      matchId: "match_visit_1",
      offerId: "offer_visit_1",
      requestId: "request_visit_1",
      opportunityId: "offer_visit_1"
    })
  ]);
}
