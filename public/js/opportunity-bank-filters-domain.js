/**
 * Opportunity Bank — client-side search/filter (additive, no data mutation).
 */

import { safeText } from "./opportunity-intake-domain.js";
import { evaluateMatchingReadiness, MATCHING_READINESS } from "./opportunity-readiness-domain.js";
import {
  bankFilterCityOptions,
  bankFilterNeighborhoodOptions,
  bankFilterPropertyTypeOptions,
  matchOperationType,
  mapOperationToBrokerFields,
  matchPropertyType,
  matchDistrict,
  neighborhoodsEquivalent,
  normalizeNeighborhood,
  normalizePropertyTypeLabel,
  propertyTypesEquivalent,
  parseVoiceSearchCriteria
} from "./reference-catalog.js";

function normalizeSearchNeedle(value) {
  return String(value == null ? "" : value)
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 1776))
    .replace(/[٬,]/g, "")
    .toLowerCase()
    .trim();
}

function parseOptionalNumber(value) {
  const raw = normalizeSearchNeedle(safeText(value, 40));
  if (!raw) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function recordPriceValue(record = {}) {
  const candidates = [
    record.salePrice,
    record.priceOrBudget,
    record.price,
    record.budget,
    record.annualRent,
    record.monthlyRent
  ];
  for (const candidate of candidates) {
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return null;
}

function recordAreaValue(record = {}) {
  const parsed = Number(record.area);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

const PURPOSE_ALIASES = Object.freeze({
  بيع: "SALE",
  شراء: "PURCHASE",
  إيجار: "RENT",
  استئجار: "LEASE_REQUEST",
  "طلب إيجار": "LEASE_REQUEST",
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
    const canonicalDistrict = normalizeNeighborhood(record.district);
    const haystack = normalizeSearchNeedle([
      record.propertyType,
      normalizePropertyTypeLabel(record.propertyType),
      record.city,
      record.district,
      canonicalDistrict,
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
  if (district && !neighborhoodsEquivalent(record.district, district)) return false;

  const purpose = normalizePurposeFilter(filters.purpose);
  if (purpose && safeText(record.purpose, 30).toUpperCase() !== purpose) return false;

  const propertyType = safeText(filters.propertyType, 80);
  if (propertyType && !propertyTypesEquivalent(record.propertyType, propertyType)) return false;

  const status = safeText(filters.matchingReadiness, 40);
  if (status) {
    const readiness = resolveRecordMatchingReadiness(record);
    if (readiness !== status) return false;
  }

  const priceMin = parseOptionalNumber(filters.priceMin);
  const priceMax = parseOptionalNumber(filters.priceMax);
  const recordPrice = recordPriceValue(record);
  if (priceMin != null && recordPrice != null && recordPrice < priceMin) return false;
  if (priceMax != null && recordPrice != null && recordPrice > priceMax) return false;

  const areaMin = parseOptionalNumber(filters.areaMin);
  const areaMax = parseOptionalNumber(filters.areaMax);
  const recordArea = recordAreaValue(record);
  if (areaMin != null && recordArea != null && recordArea < areaMin) return false;
  if (areaMax != null && recordArea != null && recordArea > areaMax) return false;

  return true;
}

export function collectBankFilterOptions(records = []) {
  const cities = new Set(bankFilterCityOptions());
  const districts = new Set(bankFilterNeighborhoodOptions());
  const propertyTypes = new Set(bankFilterPropertyTypeOptions());
  for (const record of records) {
    const city = safeText(record.city, 80);
    const district = normalizeNeighborhood(record.district);
    const propertyType = normalizePropertyTypeLabel(record.propertyType);
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
    matchingReadiness: "",
    priceMin: "",
    priceMax: "",
    areaMin: "",
    areaMax: ""
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
    || safeText(normalized.priceMin, 40)
    || safeText(normalized.priceMax, 40)
    || safeText(normalized.areaMin, 40)
    || safeText(normalized.areaMax, 40)
  );
}

export function mergeVoiceCriteriaIntoFilters(current = {}, transcript = "") {
  const parsed = parseVoiceSearchCriteria(transcript);
  const next = { ...emptyBankFilters(), ...current };
  if (parsed.search) next.search = parsed.search;
  if (parsed.city) next.city = parsed.city;
  if (parsed.district) next.district = parsed.district;
  if (parsed.purpose) next.purpose = parsed.purpose;
  if (parsed.propertyType) next.propertyType = parsed.propertyType;
  return next;
}

export { parseVoiceSearchCriteria };

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
