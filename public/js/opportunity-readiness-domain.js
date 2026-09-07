/**
 * Minimum Matching Gate — seven required fields before READY_FOR_MATCHING.
 * Additive statuses; does not replace lifecycleStatus.
 */

import { normalizeOpportunityFinancials, safeText } from "./opportunity-intake-domain.js";
import { normalizeAdvertiserPhoneE164 } from "./advertiser-phone-domain.js";

export const MATCHING_READINESS = Object.freeze({
  READY_FOR_MATCHING: "READY_FOR_MATCHING",
  NEEDS_COMPLETION: "NEEDS_COMPLETION"
});

export const MATCHING_READINESS_LABELS = Object.freeze({
  READY_FOR_MATCHING: "جاهزة للمطابقة",
  NEEDS_COMPLETION: "ناقصة"
});

export const CORE_COMPLETION_STATUS = Object.freeze({
  COMPLETE: "COMPLETE",
  NEEDS_COMPLETION: "NEEDS_COMPLETION"
});

export const MISSING_FIELD_LABELS = Object.freeze({
  opportunityKind: "نوع الفرصة",
  purpose: "الغرض",
  propertyType: "نوع العقار",
  city: "المدينة",
  district: "الحي",
  priceOrBudget: "الميزانية",
  advertiserRole: "صفة المعلن",
  contactPhone: "رقم الجوال",
  area: "المساحة",
  rooms: "الغرف",
  salePrice: "سعر البيع",
  annualRent: "الإيجار السنوي",
  budget: "الميزانية"
});

export const MATCHING_PLACEHOLDER_VALUES = Object.freeze([
  "", "—", "-", "غير محدد", "غير متوفر", "العقار", "تحتاج مراجعة",
  "unknown", "null", "undefined", "n/a", "na", "property"
]);

export function missingFieldLabelsArabic(keys = []) {
  return (keys || [])
    .map((key) => MISSING_FIELD_LABELS[key] || "")
    .filter(Boolean);
}

const VALID_OWNER_ROLES = new Set(["OWNER", "DELEGATE", "BROKER", "CLIENT"]);
const VALID_OPPORTUNITY_KINDS = new Set(["OFFER", "REQUEST"]);

function hasAppropriatePrice(fields = {}) {
  const purpose = safeText(fields.purpose, 30).toUpperCase();
  const legacy = fields.priceOrBudget ?? fields.price;
  if (purpose === "SALE") {
    return Number(fields.salePrice ?? legacy) > 0;
  }
  if (purpose === "RENT") {
    return Number(fields.annualRent ?? legacy) > 0;
  }
  if (purpose === "PURCHASE" || purpose === "LEASE_REQUEST") {
    return Number(fields.budget ?? fields.annualRent ?? legacy) > 0;
  }
  if (purpose === "INVESTMENT") {
    return Number(legacy) > 0;
  }
  return Number(legacy) > 0;
}

function resolveContactPhone(record = {}) {
  return normalizeAdvertiserPhoneE164(
    record.advertiserPhoneNormalized
      || record.contactPhone
      || record.phone
      || record.advertiserPhoneRaw
  );
}

export function normalizeMatchingText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function isMatchingPlaceholder(value) {
  const text = normalizeMatchingText(value);
  return MATCHING_PLACEHOLDER_VALUES.includes(text)
    || MATCHING_PLACEHOLDER_VALUES.includes(text.toLowerCase());
}

function isFilledText(value) {
  return !isMatchingPlaceholder(value);
}

function resolveOwnerRole(record = {}) {
  const role = safeText(record.advertiserRole || record.ownerRole || "", 20).toUpperCase();
  if (role === "UNKNOWN" || !role) return "";
  return VALID_OWNER_ROLES.has(role) ? role : "";
}

function resolveOpportunityKind(record = {}) {
  const kind = safeText(record.opportunityKind || record.kind || "", 20).toUpperCase();
  return VALID_OPPORTUNITY_KINDS.has(kind) ? kind : "";
}

/**
 * @returns {{ matchingReadiness: string, matchingReadinessMissing: string[], isReadyForMatching: boolean }}
 */
export function evaluateMatchingReadiness(record = {}) {
  const fields = normalizeOpportunityFinancials(record);
  const missing = [];

  const purpose = safeText(fields.purpose || record.purpose, 30).toUpperCase();
  if (!purpose || !["SALE", "PURCHASE", "RENT", "LEASE_REQUEST"].includes(purpose)) {
    missing.push("purpose");
  }
  if (!isFilledText(fields.propertyType || record.propertyType)) missing.push("propertyType");
  if (!isFilledText(fields.city || record.city)) missing.push("city");
  if (!isFilledText(fields.district || record.district)) missing.push("district");
  if (!hasAppropriatePrice(fields)) missing.push("priceOrBudget");
  if (!resolveOwnerRole(record)) missing.push("advertiserRole");
  if (!resolveContactPhone(record)) missing.push("contactPhone");

  const isReady = missing.length === 0;
  return {
    matchingReadiness: isReady
      ? MATCHING_READINESS.READY_FOR_MATCHING
      : MATCHING_READINESS.NEEDS_COMPLETION,
    matchingReadinessMissing: missing,
    isReadyForMatching: isReady
  };
}

/**
 * Canonical Core gate for an Opportunity before it may leave Data Completion.
 * It deliberately keeps opportunityKind as a structural requirement separate from
 * the matching algorithm's seven-field gate, so existing matching semantics are
 * not silently changed while every upstream writer migrates to this contract.
 */
export function evaluateOpportunityCoreReadiness(record = {}) {
  const matching = evaluateMatchingReadiness(record);
  const missing = [];
  if (!resolveOpportunityKind(record)) missing.push("opportunityKind");
  for (const key of matching.matchingReadinessMissing || []) {
    if (!missing.includes(key)) missing.push(key);
  }
  const totalRequired = 8;
  const filledRequired = Math.max(0, totalRequired - missing.length);
  const isComplete = missing.length === 0;
  return {
    completionStatus: isComplete
      ? CORE_COMPLETION_STATUS.COMPLETE
      : CORE_COMPLETION_STATUS.NEEDS_COMPLETION,
    completionMissingFields: missing,
    dataCompleteness: Math.round((filledRequired / totalRequired) * 100),
    isComplete,
    matchingReadiness: matching.matchingReadiness,
    matchingReadinessMissing: matching.matchingReadinessMissing || [],
    isReadyForMatching: isComplete && matching.isReadyForMatching
  };
}

export function matchingReadinessLabel(status) {
  return MATCHING_READINESS_LABELS[status] || MATCHING_READINESS_LABELS.NEEDS_COMPLETION;
}

export function isEligibleForMatchingRun(record = {}) {
  return evaluateMatchingReadiness(record).isReadyForMatching;
}
