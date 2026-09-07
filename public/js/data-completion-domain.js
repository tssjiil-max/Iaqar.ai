import {
  CORE_COMPLETION_STATUS,
  evaluateOpportunityCoreReadiness,
  missingFieldLabelsArabic
} from "./opportunity-readiness-domain.js";

export const COMPLETION_SESSION_STATUS = Object.freeze({
  OPEN: "OPEN",
  COMPLETED: "COMPLETED",
  EXPIRED: "EXPIRED",
  REVOKED: "REVOKED"
});

export const COMPLETION_EDITABLE_FIELDS = Object.freeze([
  "opportunityKind",
  "purpose",
  "propertyType",
  "city",
  "district",
  "priceOrBudget",
  "advertiserRole",
  "contactPhone"
]);

const EDITABLE = new Set(COMPLETION_EDITABLE_FIELDS);

function cleanText(value, max = 300) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanNumber(value) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const num = Number(String(value).replace(/,/g, ""));
  return Number.isFinite(num) && num > 0 ? num : null;
}

export function completionRequiredFields(opportunity = {}) {
  return evaluateOpportunityCoreReadiness(opportunity).completionMissingFields;
}

export function buildCompletionSessionProjection(opportunity = {}) {
  const readiness = evaluateOpportunityCoreReadiness(opportunity);
  return {
    opportunityKind: cleanText(opportunity.opportunityKind || opportunity.kind, 20),
    purpose: cleanText(opportunity.purpose, 30),
    propertyType: cleanText(opportunity.propertyType, 80),
    city: cleanText(opportunity.city, 100),
    district: cleanText(opportunity.district, 100),
    priceOrBudget: Number(opportunity.priceOrBudget || opportunity.price || opportunity.salePrice || opportunity.budget || opportunity.annualRent || 0) || null,
    completionStatus: readiness.completionStatus,
    dataCompleteness: readiness.dataCompleteness,
    missingFields: readiness.completionMissingFields,
    missingFieldLabels: missingFieldLabelsArabic(readiness.completionMissingFields)
  };
}

/**
 * External completion pages may patch only fields explicitly requested by the
 * server for this session. Identity, office ownership, lifecycle and match data
 * are never accepted from the party page.
 */
export function sanitizeCompletionPatch(patch = {}, allowedFields = []) {
  const allowed = new Set((allowedFields || []).filter((key) => EDITABLE.has(String(key))));
  const out = {};
  for (const [key, raw] of Object.entries(patch || {})) {
    if (!allowed.has(key) || !EDITABLE.has(key)) continue;
    if (key === "priceOrBudget") {
      const value = cleanNumber(raw);
      if (value !== null) out[key] = value;
      continue;
    }
    const value = cleanText(raw, key === "contactPhone" ? 40 : 120);
    if (value) out[key] = value;
  }
  return out;
}

export function evaluateCompletionSubmission(opportunity = {}, patch = {}, allowedFields = []) {
  const sanitizedPatch = sanitizeCompletionPatch(patch, allowedFields);
  const merged = { ...opportunity, ...sanitizedPatch };
  const readiness = evaluateOpportunityCoreReadiness(merged);
  return {
    patch: sanitizedPatch,
    opportunity: merged,
    completionStatus: readiness.completionStatus,
    missingFields: readiness.completionMissingFields,
    dataCompleteness: readiness.dataCompleteness,
    isComplete: readiness.completionStatus === CORE_COMPLETION_STATUS.COMPLETE,
    isReadyForMatching: readiness.isReadyForMatching
  };
}

export function isCompletionSessionTerminal(status) {
  return [
    COMPLETION_SESSION_STATUS.COMPLETED,
    COMPLETION_SESSION_STATUS.EXPIRED,
    COMPLETION_SESSION_STATUS.REVOKED
  ].includes(String(status || "").toUpperCase());
}
