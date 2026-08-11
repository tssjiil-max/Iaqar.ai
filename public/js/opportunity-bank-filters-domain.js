/**
 * Opportunity Bank — client-side search/filter (additive, no data mutation).
 */

import { safeText } from "./opportunity-intake-domain.js";
import { evaluateMatchingReadiness, MATCHING_READINESS } from "./opportunity-readiness-domain.js";

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
  const search = safeText(filters.search, 120).toLowerCase();
  if (search) {
    const haystack = [
      record.propertyType,
      record.city,
      record.district,
      record.contactName,
      record.opportunityKind,
      record.purpose,
      record.advertiserDisplayName
    ].map((part) => safeText(part, 200).toLowerCase()).join(" ");
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
