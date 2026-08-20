/**
 * Shared listing-record normalization and field completeness checks.
 */

import {
  evaluateMatchingReadiness,
  MISSING_FIELD_LABELS
} from "./opportunity-readiness-domain.js";

export const LISTING_FIELD_ORDER = Object.freeze([
  "purpose",
  "propertyType",
  "city",
  "district",
  "priceOrBudget",
  "advertiserRole",
  "contactPhone"
]);

export function normalizeListingRecord(record = {}) {
  return {
    ...record,
    id: record.id || record.recordId || record.opportunityId || "",
    propertyType: record.propertyType || "",
    city: record.city || "",
    district: record.district || "",
    purpose: record.purpose || record.transactionType || "",
    contactPhone: record.contactPhone || record.phone || record.advertiserPhoneNormalized || "",
    advertiserRole: record.advertiserRole || record.ownerRole || "",
    salePrice: record.salePrice ?? record.price ?? record.amount,
    annualRent: record.annualRent,
    budget: record.budget ?? record.priceMax,
    priceOrBudget: record.priceOrBudget ?? record.amount ?? record.price
  };
}

export function buildListingFieldChecks(record = {}) {
  const readiness = evaluateMatchingReadiness(normalizeListingRecord(record));
  const missing = new Set(readiness.matchingReadinessMissing || []);
  return LISTING_FIELD_ORDER.map((key) => ({
    key,
    label: MISSING_FIELD_LABELS[key] || key,
    complete: !missing.has(key)
  }));
}
