/**
 * Active-opportunity duplicate detection — office-scoped, not phone-only.
 */

import {
  getOpportunityLifecycleStatus,
  isActiveLifecycle,
  LIFECYCLE_STATUS,
  normalizeSaudiPhoneForWhatsApp
} from "./opportunity-lifecycle.mjs";

function normalizeArabicLite(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeDuplicatePurpose(record = {}) {
  const raw = String(record.purpose || record.transactionType || "").trim().toUpperCase();
  if (["RENT", "LEASE", "إيجار", "تأجير", "RENTAL"].includes(raw)) return "rent_offer";
  if (["LEASE_REQUEST", "استئجار", "طلب إيجار"].includes(raw)) return "rent_request";
  if (["SALE", "بيع"].includes(raw)) return "sale_offer";
  if (["PURCHASE", "BUY", "شراء"].includes(raw)) return "sale_request";
  return raw.toLowerCase();
}

function duplicateAmount(record = {}) {
  return Number(record.priceOrBudget ?? record.salePrice ?? record.budget ?? record.annualRent ?? record.price ?? 0);
}

export function normalizeDuplicatePhone(phone) {
  const digits = normalizeSaudiPhoneForWhatsApp(phone);
  return digits || "";
}

export function resolveOpportunityKind(record = {}) {
  const kind = String(record.opportunityKind || record.kind || record.recordType || "").toUpperCase();
  if (kind === "OFFER" || kind === "OWNER" || kind === "OWNER_OFFER" || record.contactType === "owner") {
    return "offer";
  }
  if (kind === "REQUEST" || kind === "CLIENT" || kind === "CLIENT_REQUEST" || record.contactType === "buyer") {
    return "request";
  }
  return "";
}

export function isActiveOpportunityForDuplicate(record = {}) {
  const status = getOpportunityLifecycleStatus(record);
  if (!isActiveLifecycle(record)) return false;
  if ([LIFECYCLE_STATUS.CLOSED_WON, LIFECYCLE_STATUS.CLOSED_LOST, LIFECYCLE_STATUS.ARCHIVED].includes(status)) {
    return false;
  }
  if (String(record.lifecycleStatus || "").toUpperCase() === "DELETED" || record.deletedAt) return false;
  return true;
}

/**
 * @param {object} existing — Firestore opportunity document
 * @param {object} criteria — incoming intake criteria
 */
export function matchesDuplicateCriteria(existing = {}, criteria = {}) {
  if (!isActiveOpportunityForDuplicate(existing)) return false;

  const officeId = String(criteria.officeId || "").trim();
  if (officeId && String(existing.officeId || "").trim() !== officeId) return false;

  const phone = normalizeDuplicatePhone(criteria.phone || criteria.contactPhone);
  const existingPhone = normalizeDuplicatePhone(
    existing.contactPhone || existing.advertiserPhoneNormalized || existing.phone
  );
  if (!phone || !existingPhone || phone !== existingPhone) return false;

  const contactType = String(criteria.contactType || "").trim().toLowerCase();
  const existingContact = String(existing.contactType || "").trim().toLowerCase();
  if (contactType && existingContact && contactType !== existingContact) return false;

  const kind = String(criteria.opportunityKind || criteria.kind || "").trim().toLowerCase();
  const existingKind = resolveOpportunityKind(existing);
  if (kind === "owner" || kind === "offer") {
    if (existingKind && existingKind !== "offer") return false;
  } else if (kind === "client" || kind === "request") {
    if (existingKind && existingKind !== "request") return false;
  }

  const purpose = normalizeDuplicatePurpose(criteria);
  const existingPurpose = normalizeDuplicatePurpose(existing);
  if (purpose && existingPurpose && purpose !== existingPurpose) return false;

  const propertyType = normalizeArabicLite(criteria.propertyType);
  const existingProperty = normalizeArabicLite(existing.propertyType);
  if (!propertyType || !existingProperty || propertyType !== existingProperty) return false;

  const city = normalizeArabicLite(criteria.city);
  const existingCity = normalizeArabicLite(existing.city);
  if (!city || !existingCity || city !== existingCity) return false;

  const district = normalizeArabicLite(criteria.district);
  const existingDistrict = normalizeArabicLite(existing.district);
  if (!district || !existingDistrict || district !== existingDistrict) return false;

  const amount = duplicateAmount(criteria);
  const existingAmount = duplicateAmount(existing);
  if (amount > 0 && existingAmount > 0 && amount !== existingAmount) return false;

  const area = Number(criteria.area || 0);
  const existingArea = Number(existing.area || 0);
  if (area > 0 && existingArea > 0 && area !== existingArea) return false;

  return true;
}

export function findDuplicateOpportunity(docs = [], criteria = {}) {
  for (const doc of docs) {
    const data = doc.data || doc;
    const opportunityId = doc.id || data.id || data.opportunityId || "";
    if (matchesDuplicateCriteria(data, criteria)) {
      return { opportunityId, data };
    }
  }
  return null;
}
