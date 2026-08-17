/**
 * Canonical listing intake — merge worker structured fields with deterministic text parser.
 */

import { safeText } from "./opportunity-intake-domain.js";

export const CLASSIFICATION_STATUS = Object.freeze({
  CONFIRMED: "confirmed",
  NEEDS_REVIEW: "needs_review",
  FALLBACK_REQUIRED: "fallback_required"
});

const REQUEST_PHRASE_RE = /(?:^|\s)(?:مطلوب|أبحث\s+عن|ابحث\s+عن|أرغب\s+في\s+(?:شراء|استئجار|الشراء|الاستئجار))(?:\s|$)/i;

function structuredBrokerFields(brokerFields = {}) {
  if (!brokerFields || typeof brokerFields !== "object") return null;
  const purpose = safeText(brokerFields.purpose, 30);
  const opportunityKind = safeText(brokerFields.opportunityKind, 20);
  if (!purpose && !opportunityKind && !brokerFields.propertyType) return null;
  return {
    opportunityKind: opportunityKind || "",
    purpose: purpose || "",
    propertyType: safeText(brokerFields.propertyType, 40),
    city: safeText(brokerFields.city, 80),
    district: safeText(brokerFields.district, 80),
    area: brokerFields.area ?? null,
    rooms: brokerFields.rooms ?? null,
    bathrooms: brokerFields.bathrooms ?? null,
    priceOrBudget: brokerFields.priceOrBudget ?? brokerFields.salePrice ?? brokerFields.annualRent ?? null,
    salePrice: brokerFields.salePrice ?? null,
    annualRent: brokerFields.annualRent ?? null,
    livingRoom: brokerFields.livingRoom ?? null
  };
}

export function mergeCanonicalListingFields(textFields = {}, canonical = {}) {
  const structured = structuredBrokerFields(canonical.brokerFields);
  if (!structured) {
    return {
      fields: { ...textFields },
      classificationStatus: canonical.classificationStatus || CLASSIFICATION_STATUS.FALLBACK_REQUIRED,
      extractionStatus: canonical.extractionStatus || "fallback_required",
      fieldSources: canonical.fieldSources || {},
      extractionMode: canonical.adapterId ? `site_adapter_${canonical.adapterId}` : "deterministic_text_parser"
    };
  }
  const merged = { ...textFields };
  const sources = { ...(canonical.fieldSources || {}) };
  for (const [key, value] of Object.entries(structured)) {
    if (value === null || value === undefined || String(value).trim() === "") continue;
    merged[key] = value;
    sources[key] = sources[key] || `site_adapter_${canonical.adapterId || canonical.sourceSiteId || "structured"}`;
  }
  if (structured.opportunityKind === "OFFER" && REQUEST_PHRASE_RE.test(safeText(canonical.listingTitle || ""))) {
    merged.opportunityKind = "REQUEST";
    merged.purpose = structured.purpose === "SALE" ? "PURCHASE" : structured.purpose === "RENT" ? "LEASE_REQUEST" : merged.purpose;
  }
  const classificationStatus = canonical.classificationStatus
    || (canonical.extractionStatus === "needs_review"
      ? CLASSIFICATION_STATUS.NEEDS_REVIEW
      : CLASSIFICATION_STATUS.CONFIRMED);
  return {
    fields: merged,
    classificationStatus,
    extractionStatus: canonical.extractionStatus || "extracted",
    fieldSources: sources,
    extractionMode: `site_adapter_${canonical.adapterId || canonical.sourceSiteId || "structured"}`,
    externalListingId: canonical.externalListingId || "",
    contentHash: canonical.contentHash || ""
  };
}

export function importStatusMessageForExtraction({ extractionStatus, classificationStatus, error } = {}) {
  if (error === "source_blocked" || extractionStatus === "fallback_required") {
    return "تعذر قراءة الرابط، أرفق صورة أو انسخ نص الإعلان";
  }
  if (classificationStatus === "needs_review" || extractionStatus === "needs_review") {
    return "توجد بيانات متعارضة وتحتاج مراجعة";
  }
  if (extractionStatus === "extracted") {
    return "تم استخراج بيانات الإعلان";
  }
  return "جارٍ قراءة الإعلان";
}

export function buildCanonicalSourceMetadata(canonical = {}, listingText = "") {
  return {
    originalUrl: safeText(canonical.originalUrl, 2000),
    resolvedUrl: safeText(canonical.resolvedUrl || canonical.url, 2000),
    sourceSiteId: safeText(canonical.sourceSiteId, 40),
    externalListingId: safeText(canonical.externalListingId, 120),
    extractionStatus: safeText(canonical.extractionStatus, 40),
    classificationStatus: safeText(canonical.classificationStatus, 40),
    contentHash: safeText(canonical.contentHash, 128),
    fieldSources: canonical.fieldSources || null,
    rawText: safeText(listingText),
    receivedAt: new Date().toISOString()
  };
}
