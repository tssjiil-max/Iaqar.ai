/**
 * Canonical admission gate for Opportunity -> Matching.
 * Pure domain only: no Firestore writes, Operations, messaging, cooperation or scheduling.
 *
 * Matching may score only complete canonical Opportunities. Legacy records that do not
 * look like canonical Opportunities remain outside this gate until their migration.
 */

export const MATCHING_ADMISSION_STATUS = Object.freeze({
  ADMITTED: "ADMITTED",
  NEEDS_COMPLETION: "NEEDS_COMPLETION",
  LEGACY_UNGATED: "LEGACY_UNGATED"
});

export const CANONICAL_MATCHING_REQUIRED_FIELDS = Object.freeze([
  "opportunityKind",
  "purpose",
  "propertyType",
  "city",
  "district",
  "priceOrBudget",
  "advertiserRole",
  "contactPhone"
]);

export const CANONICAL_MATCHING_FIELD_LABELS_AR = Object.freeze({
  opportunityKind: "نوع الفرصة",
  purpose: "الغرض",
  propertyType: "نوع العقار",
  city: "المدينة",
  district: "الحي",
  priceOrBudget: "السعر أو الميزانية",
  advertiserRole: "صفة المعلن",
  contactPhone: "رقم الجوال"
});

const PLACEHOLDERS = new Set([
  "", "—", "-", "غير محدد", "غير متوفر", "العقار", "تحتاج مراجعة",
  "unknown", "null", "undefined", "n/a", "na", "property"
]);
const VALID_KINDS = new Set(["OFFER", "REQUEST"]);
const VALID_PURPOSES = new Set(["SALE", "PURCHASE", "RENT", "LEASE_REQUEST"]);
const VALID_ADVERTISER_ROLES = new Set(["OWNER", "DELEGATE", "BROKER", "CLIENT"]);

function text(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function filledText(value) {
  const valueText = text(value);
  return Boolean(valueText) && !PLACEHOLDERS.has(valueText) && !PLACEHOLDERS.has(valueText.toLowerCase());
}

function positiveNumber(value) {
  if (value == null || text(value) === "") return false;
  const number = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(number) && number > 0;
}

export function normalizeCanonicalContactPhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (/^009665\d{8}$/.test(digits)) return `+${digits.slice(2)}`;
  if (/^9665\d{8}$/.test(digits)) return `+${digits}`;
  if (/^05\d{8}$/.test(digits)) return `+966${digits.slice(1)}`;
  if (/^5\d{8}$/.test(digits)) return `+966${digits}`;
  return "";
}

function hasAppropriatePrice(record = {}) {
  const purpose = upper(record.purpose);
  const legacy = record.priceOrBudget ?? record.price;
  if (purpose === "SALE") return positiveNumber(record.salePrice ?? legacy);
  if (purpose === "RENT") return positiveNumber(record.annualRent ?? legacy);
  if (purpose === "PURCHASE" || purpose === "LEASE_REQUEST") {
    return positiveNumber(record.budget ?? record.annualRent ?? legacy);
  }
  return positiveNumber(legacy);
}

export function looksCanonicalOpportunity(record = {}) {
  return Boolean(
    record.opportunityKind
      || record.matchingReadiness
      || record.completionStatus
      || record.deduplicationFingerprint
      || record.originatingOfficeId
      || record.currentOwningOfficeId
  );
}

export function canonicalOpportunityMissingFields(record = {}) {
  const missing = [];
  if (!VALID_KINDS.has(upper(record.opportunityKind || record.kind))) missing.push("opportunityKind");
  if (!VALID_PURPOSES.has(upper(record.purpose))) missing.push("purpose");
  if (!filledText(record.propertyType)) missing.push("propertyType");
  if (!filledText(record.city)) missing.push("city");
  if (!filledText(record.district)) missing.push("district");
  if (!hasAppropriatePrice(record)) missing.push("priceOrBudget");
  if (!VALID_ADVERTISER_ROLES.has(upper(record.advertiserRole || record.ownerRole))) missing.push("advertiserRole");
  if (!normalizeCanonicalContactPhone(
    record.advertiserPhoneNormalized
      || record.contactPhone
      || record.phone
      || record.advertiserPhoneRaw
  )) missing.push("contactPhone");
  return missing;
}

export function matchingAdmissionFieldLabels(missingFields = []) {
  return (missingFields || []).map((key) => CANONICAL_MATCHING_FIELD_LABELS_AR[key] || key);
}

export function evaluateMatchingAdmission(record = {}) {
  if (!looksCanonicalOpportunity(record)) {
    return {
      status: MATCHING_ADMISSION_STATUS.LEGACY_UNGATED,
      isCanonical: false,
      isReadyForMatching: true,
      missingFields: []
    };
  }
  const missingFields = canonicalOpportunityMissingFields(record);
  return {
    status: missingFields.length
      ? MATCHING_ADMISSION_STATUS.NEEDS_COMPLETION
      : MATCHING_ADMISSION_STATUS.ADMITTED,
    isCanonical: true,
    isReadyForMatching: missingFields.length === 0,
    missingFields
  };
}

export function evaluateCounterpartAdmission(sourceRecord = {}, candidateRecord = {}) {
  const source = evaluateMatchingAdmission(sourceRecord);
  const candidate = evaluateMatchingAdmission(candidateRecord);
  return {
    admitted: source.isReadyForMatching && candidate.isReadyForMatching,
    source,
    candidate
  };
}
