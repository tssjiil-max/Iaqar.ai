/**
 * Opportunity Bank — client-side search/filter (additive, no data mutation).
 */

import { safeText } from "./opportunity-intake-domain.js";
import { evaluateMatchingReadiness, MATCHING_READINESS } from "./opportunity-readiness-domain.js";

function normalizeSearchNeedle(value) {
  return String(value == null ? "" : value)
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776))
    .replace(/[٬,]/g, "")
    .toLowerCase()
    .trim();
}

const PURPOSE_ALIASES = Object.freeze({
  بيع: "SALE",
  شراء: "PURCHASE",
  إيجار: "RENT",
  استئجار: "LEASE_REQUEST",
  sale: "SALE",
  purchase: "PURCHASE",
  rent: "RENT",
  lease_request: "LEASE_REQUEST"
});

export function normalizePurposeFilter(value) {
  const raw = safeText(value, 40);
  if (!raw) return "";
  const upper = raw.toUpperCase();
  if (["SALE", "PURCHASE", "RENT", "LEASE_REQUEST"].includes(upper)) return upper;
  return PURPOSE_ALIASES[raw.toLowerCase()] || PURPOSE_ALIASES[raw] || "";
}

export function resolveRecordMatchingReadiness(record = {}) {
  if (record.matchingReadiness === MATCHING_READINESS.READY_FOR_MATCHING
    || record.matchingReadiness === MATCHING_READINESS.NEEDS_COMPLETION) {
    return record.matchingReadiness;
  }
  return evaluateMatchingReadiness(record).matchingReadiness;
}

export function matchesBankQueryFilters(record = {}, filters = {}) {
  const search = normalizeSearchNeedle(safeText(filters.search, 120));
  if (search) {
    const haystack = normalizeSearchNeedle([
      record.propertyType,
      record.city,
      record.district,
      record.contactName,
      record.opportunityKind,
      record.purpose,
      record.advertiserDisplayName,
      record.salePrice,
      record.priceOrBudget,
      record.price,
      record.budget,
      record.annualRent,
      record.area
    ].map((part) => safeText(part, 200)).join(" "));
    if (!haystack.includes(search)) return false;
  }

  const city = safeText(filters.city, 80);
  if (city && safeText(record.city, 80) !== city) return false;

  const district = safeText(filters.district, 80);
  if (district && safeText(record.district, 80) !== district) return false;

  const purpose = normalizePurposeFilter(filters.purpose);
  if (purpose && safeText(record.purpose, 30).toUpperCase() !== purpose) return false;

  const propertyType = safeText(filters.propertyType, 80);
  if (propertyType && safeText(record.propertyType, 80) !== propertyType) return false;

  const status = safeText(filters.matchingReadiness, 40);
  if (status) {
    const readiness = resolveRecordMatchingReadiness(record);
    if (readiness !== status) return false;
  }

  return true;
}

export function collectBankFilterOptions(records = []) {
  const cities = new Set();
  const districts = new Set();
  const propertyTypes = new Set();
  for (const record of records) {
    const city = safeText(record.city, 80);
    const district = safeText(record.district, 80);
    const propertyType = safeText(record.propertyType, 80);
    if (city) cities.add(city);
    if (district) districts.add(district);
    if (propertyType) propertyTypes.add(propertyType);
  }
  return {
    cities: [...cities].sort((a, b) => a.localeCompare(b, "ar")),
    districts: [...districts].sort((a, b) => a.localeCompare(b, "ar")),
    propertyTypes: [...propertyTypes].sort((a, b) => a.localeCompare(b, "ar"))
  };
}

export function emptyBankFilters() {
  return {
    search: "",
    city: "",
    district: "",
    purpose: "",
    propertyType: "",
    matchingReadiness: ""
  };
}

/** True when the broker entered search text or any query filter (not lifecycle tab alone). */
export function hasActiveBankQuery(filters = {}) {
  const normalized = filters && typeof filters === "object" ? filters : {};
  return Boolean(
    safeText(normalized.search, 120)
    || safeText(normalized.city, 80)
    || safeText(normalized.district, 80)
    || safeText(normalized.purpose, 40)
    || safeText(normalized.propertyType, 80)
    || safeText(normalized.matchingReadiness, 40)
  );
}

/**
 * Summarize office bank counts from lightweight metadata rows.
 * Uses existing matchingReadiness / lifecycle fields — no parallel taxonomy.
 */
export function summarizeBankCounts(records = []) {
  const summary = {
    total: 0,
    readyForMatching: 0,
    needsCompletion: 0,
    archived: 0,
    active: 0
  };
  for (const record of records) {
    if (!record || record.deletedAt || record.lifecycleStatus === "DELETED") continue;
    const archived = record.lifecycleStatus === "ARCHIVED" || Boolean(record.archivedAt);
    if (archived) {
      summary.archived += 1;
      summary.total += 1;
      continue;
    }
    summary.active += 1;
    summary.total += 1;
    const readiness = resolveRecordMatchingReadiness(record);
    if (readiness === MATCHING_READINESS.READY_FOR_MATCHING) summary.readyForMatching += 1;
    else summary.needsCompletion += 1;
  }
  return summary;
}

export function emptyBankSummary() {
  return {
    total: 0,
    readyForMatching: 0,
    needsCompletion: 0,
    archived: 0,
    active: 0
  };
}
