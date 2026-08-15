/**
 * Four separate status domains for opportunities — no single combined status list.
 * Backward compatible with legacy lifecycleStatus and advertiserContactStatus fields.
 */

import { evaluateMatchingReadiness } from "./opportunity-readiness-domain.js";

export const DATA_COMPLETENESS = Object.freeze({
  INCOMPLETE: "INCOMPLETE",
  COMPLETE: "COMPLETE",
  READY_FOR_MATCHING: "READY_FOR_MATCHING"
});

export const CONTACT_STATUS = Object.freeze({
  NOT_STARTED: "NOT_STARTED",
  CONTACTED: "CONTACTED",
  NO_RESPONSE: "NO_RESPONSE",
  FOLLOW_UP_SCHEDULED: "FOLLOW_UP_SCHEDULED"
});

export const MATCH_STATUS = Object.freeze({
  NOT_MATCHED: "NOT_MATCHED",
  MATCH_EXISTS: "MATCH_EXISTS",
  NEEDS_REVIEW: "NEEDS_REVIEW"
});

export const OUTCOME_STATUS = Object.freeze({
  ACTIVE: "ACTIVE",
  NEGOTIATION: "NEGOTIATION",
  SUCCESS: "SUCCESS",
  FAILED: "FAILED",
  ARCHIVED: "ARCHIVED"
});

export const DATA_COMPLETENESS_LABELS = Object.freeze({
  INCOMPLETE: "ناقصة",
  COMPLETE: "مكتملة",
  READY_FOR_MATCHING: "جاهزة للمطابقة"
});

export const CONTACT_STATUS_LABELS = Object.freeze({
  NOT_STARTED: "لم يبدأ",
  CONTACTED: "تم التواصل",
  NO_RESPONSE: "لم يرد",
  FOLLOW_UP_SCHEDULED: "متابعة مجدولة"
});

export const MATCH_STATUS_LABELS = Object.freeze({
  NOT_MATCHED: "لم تُطابق",
  MATCH_EXISTS: "مطابقة موجودة",
  NEEDS_REVIEW: "تحتاج مراجعة"
});

export const OUTCOME_STATUS_LABELS = Object.freeze({
  ACTIVE: "نشطة",
  NEGOTIATION: "تفاوض",
  SUCCESS: "ناجحة",
  FAILED: "غير ناجحة",
  ARCHIVED: "مؤرشفة"
});

const LIFECYCLE = typeof window !== "undefined" && window.IAQAR_LIFECYCLE
  ? window.IAQAR_LIFECYCLE
  : null;

function lifecycleStatus(record = {}) {
  if (LIFECYCLE?.getOpportunityLifecycleStatus) {
    return LIFECYCLE.getOpportunityLifecycleStatus(record);
  }
  return String(record.lifecycleStatus || record.status || "NEW").trim().toUpperCase();
}

export function normalizeDataCompleteness(record = {}) {
  const readiness = evaluateMatchingReadiness(record);
  if (readiness.isReadyForMatching) return DATA_COMPLETENESS.READY_FOR_MATCHING;
  return DATA_COMPLETENESS.INCOMPLETE;
}

export function normalizeContactStatus(record = {}) {
  const advertiser = String(record.advertiserContactStatus || "").trim().toUpperCase();
  const lc = lifecycleStatus(record);

  if (advertiser === "NO_RESPONSE") return CONTACT_STATUS.NO_RESPONSE;
  if (
    advertiser === "RESPONDED"
    || advertiser === "OPENED_WHATSAPP"
    || lc === "CONTACTED"
  ) return CONTACT_STATUS.CONTACTED;
  if (
    advertiser === "CALL_LATER"
    || lc === "FOLLOW_UP"
    || record.nextFollowUpAt
    || record.nextActionAt
  ) return CONTACT_STATUS.FOLLOW_UP_SCHEDULED;

  return CONTACT_STATUS.NOT_STARTED;
}

export function normalizeMatchStatus(record = {}, context = {}) {
  const matchCount = Number(context.matchCount ?? record.activeMatchCount ?? 0);
  const bestScore = Number(context.bestMatchScore ?? record.bestMatchScore ?? 0);
  const needsReview = Boolean(context.needsReview ?? record.matchNeedsReview);

  if (needsReview) return MATCH_STATUS.NEEDS_REVIEW;
  if (matchCount > 0 || bestScore > 0) return MATCH_STATUS.MATCH_EXISTS;
  return MATCH_STATUS.NOT_MATCHED;
}

export function normalizeOutcomeStatus(record = {}) {
  const lc = lifecycleStatus(record);
  if (lc === "ARCHIVED" || record.archivedAt) return OUTCOME_STATUS.ARCHIVED;
  if (lc === "CLOSED_WON") return OUTCOME_STATUS.SUCCESS;
  if (lc === "CLOSED_LOST") return OUTCOME_STATUS.FAILED;
  if (lc === "NEGOTIATION") return OUTCOME_STATUS.NEGOTIATION;
  return OUTCOME_STATUS.ACTIVE;
}

export function dataCompletenessLabel(status) {
  return DATA_COMPLETENESS_LABELS[status] || DATA_COMPLETENESS_LABELS.INCOMPLETE;
}

export function contactStatusLabel(status) {
  return CONTACT_STATUS_LABELS[status] || CONTACT_STATUS_LABELS.NOT_STARTED;
}

export function matchStatusLabel(status) {
  return MATCH_STATUS_LABELS[status] || MATCH_STATUS_LABELS.NOT_MATCHED;
}

export function outcomeStatusLabel(status) {
  return OUTCOME_STATUS_LABELS[status] || OUTCOME_STATUS_LABELS.ACTIVE;
}

export function projectOpportunityStatuses(record = {}, context = {}) {
  const dataCompleteness = normalizeDataCompleteness(record);
  const contactStatus = normalizeContactStatus(record);
  const matchStatus = normalizeMatchStatus(record, context);
  const outcomeStatus = normalizeOutcomeStatus(record);
  return {
    dataCompleteness,
    dataCompletenessLabel: dataCompletenessLabel(dataCompleteness),
    contactStatus,
    contactStatusLabel: contactStatusLabel(contactStatus),
    matchStatus,
    matchStatusLabel: matchStatusLabel(matchStatus),
    outcomeStatus,
    outcomeStatusLabel: outcomeStatusLabel(outcomeStatus)
  };
}
