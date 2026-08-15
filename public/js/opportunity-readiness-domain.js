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

export const MISSING_FIELD_LABELS = Object.freeze({
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

export function missingFieldLabelsArabic(keys = []) {
  return (keys || [])
    .map((key) => MISSING_FIELD_LABELS[key] || "")
    .filter(Boolean);
}

const VALID_OWNER_ROLES = new Set(["OWNER", "DELEGATE", "BROKER", "CLIENT"]);

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
    return Number(fields.budget ?? legacy) > 0;
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

function resolveOwnerRole(record = {}) {
  const role = safeText(record.advertiserRole || record.ownerRole || "", 20).toUpperCase();
  if (role === "UNKNOWN" || !role) return "";
  return VALID_OWNER_ROLES.has(role) ? role : "";
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
  if (!safeText(fields.propertyType || record.propertyType, 40)) missing.push("propertyType");
  if (!safeText(fields.city || record.city, 80)) missing.push("city");
  if (!safeText(fields.district || record.district, 80)) missing.push("district");
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

export function matchingReadinessLabel(status) {
  return MATCHING_READINESS_LABELS[status] || MATCHING_READINESS_LABELS.NEEDS_COMPLETION;
}

export function isEligibleForMatchingRun(record = {}) {
  return evaluateMatchingReadiness(record).isReadyForMatching;
}
