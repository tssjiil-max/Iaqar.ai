/**
 * Trusted opportunity partial updates via Worker (Admin SDK).
 * Mirrors public/js/opportunity-bank-domain editable fields + advertiser fields.
 */

import { evaluateMatchingReadiness } from "../../public/js/opportunity-readiness-domain.js";
import { normalizeOpportunityFinancials, safeText } from "../../public/js/opportunity-intake-domain.js";

export const PATCHABLE_OPPORTUNITY_FIELDS = Object.freeze([
  "opportunityKind",
  "purpose",
  "propertyType",
  "city",
  "district",
  "nearbyDistricts",
  "priceOrBudget",
  "area",
  "rooms",
  "bathrooms",
  "contactName",
  "advertiserDisplayName",
  "advertiserRole",
  "advertiserPhoneNormalized",
  "advertiserPhoneRaw",
  "advertiserPhoneSource",
  "cooperationListing",
  "cooperationListingAt",
  "cooperationEnabled",
  "cooperationEnabledBy",
  "cooperationEnabledAt",
  "matchingReadiness",
  "matchingReadinessMissing",
  "price",
  "budget",
  "salePrice",
  "annualRent",
  "lastContactAt",
  "lastWhatsAppOpenedAt",
  "advertiserContactStatus",
  "marketingConsentStatus",
  "lifecycleStatus",
  "archivedAt",
  "archivedBy",
  "restoredAt",
  "restoredBy",
  "preArchiveLifecycleStatus",
  "deletedAt",
  "deletedBy",
  "deletionReason",
  "nextFollowUpAt",
  "nextActionAt",
  "nextActionType",
  "updatedBy",
  "version",
  "brokerConfirmed"
]);

const NUMERIC_FIELDS = new Set([
  "priceOrBudget", "area", "rooms", "bathrooms", "price", "budget", "salePrice", "annualRent", "version"
]);

const PROTECTED_FIELDS = new Set([
  "id", "officeId", "brokerId", "originatingOfficeId", "originatingBrokerId",
  "currentOwningOfficeId", "createdAt", "deduplicationFingerprint", "sourceReference", "sourceType"
]);

export function sanitizeOpportunityPatch(patch = {}) {
  const out = {};
  for (const [key, value] of Object.entries(patch || {})) {
    if (PROTECTED_FIELDS.has(key)) continue;
    if (!PATCHABLE_OPPORTUNITY_FIELDS.includes(key)) continue;
    if (value === undefined) continue;
    if (NUMERIC_FIELDS.has(key)) {
      if (value === null || value === "") {
        out[key] = null;
        continue;
      }
      const num = Number(value);
      out[key] = Number.isFinite(num) ? num : null;
      continue;
    }
    if (value === null && [
      "archivedAt", "archivedBy", "restoredAt", "restoredBy", "deletedAt", "deletedBy", "deletionReason"
    ].includes(key)) {
      out[key] = null;
      continue;
    }
    if (key === "nearbyDistricts") {
      out[key] = Array.isArray(value)
        ? value.map((entry) => safeText(entry, 80)).filter(Boolean).slice(0, 12)
        : [];
      continue;
    }
    if (key === "matchingReadinessMissing") {
      out[key] = Array.isArray(value) ? value.map((entry) => safeText(entry, 40)).filter(Boolean) : [];
      continue;
    }
    out[key] = typeof value === "boolean" ? value : safeText(value, 500);
  }
  return out;
}

export function mergeOpportunityFinancialPatch(existing = {}, patch = {}) {
  const merged = { ...existing, ...patch };
  const normalized = normalizeOpportunityFinancials(merged);
  const financialKeys = [
    "purpose", "transactionType", "salePrice", "annualRent", "monthlyRent",
    "optionalMonthlyRentAfterSixMonths", "paymentInstallments", "budget", "priceOrBudget", "price"
  ];
  const out = { ...patch };
  for (const key of financialKeys) {
    if (normalized[key] !== undefined) out[key] = normalized[key];
  }
  if (out.priceOrBudget !== undefined) out.price = out.priceOrBudget;
  return out;
}

export function readinessFieldsForRecord(record = {}) {
  const readiness = evaluateMatchingReadiness(record);
  return {
    matchingReadiness: readiness.matchingReadiness,
    matchingReadinessMissing: readiness.matchingReadinessMissing || []
  };
}

export function validateCooperationListingEnable(record = {}) {
  const readiness = evaluateMatchingReadiness(record);
  if (readiness.isReadyForMatching) return { ok: true };
  return {
    ok: false,
    error: "cooperation_incomplete",
    missing: readiness.matchingReadinessMissing || []
  };
}

export function mapPatchErrorMessage(code = "") {
  switch (String(code || "").trim()) {
    case "opportunity_not_found":
      return "لم يتم العثور على الفرصة.";
    case "office_mismatch":
      return "لا تملك صلاحية تعديل هذه الفرصة.";
    case "patch_empty":
      return "لا توجد حقول قابلة للحفظ.";
    case "cooperation_incomplete":
      return "أكمل بيانات الفرصة قبل إتاحة التعاون.";
    case "firestore_write_failed":
      return "تعذر الوصول إلى خدمة الحفظ.";
    case "invalid_budget":
      return "قيمة الميزانية غير صالحة.";
    default:
      return "تعذر الحفظ؛ حاول مرة أخرى.";
  }
}
