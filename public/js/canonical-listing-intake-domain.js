/**
 * Canonical listing intake — merge worker structured fields with deterministic text parser.
 */

import { safeText } from "./opportunity-intake-domain.js";

export const CLASSIFICATION_STATUS = Object.freeze({
  CONFIRMED: "confirmed",
  NEEDS_REVIEW: "needs_review",
  FALLBACK_REQUIRED: "fallback_required"
});

export const FALLBACK_URL_MESSAGE = "تعذر قراءة تفاصيل الرابط. أرفق صورة الإعلان أو الصق نصه لإكمال الاستيراد.";

const ANALYZER_PROVIDER_LABELS = Object.freeze({
  gemini_vision: "Gemini Vision",
  workers_ai_vision: "Workers AI Vision",
  site_adapter_aqar: "رابط عقار",
  site_adapter_haraj: "رابط حراج",
  site_adapter_deal: "رابط ديل",
  site_adapter_structured: "رابط الموقع",
  deterministic_text_parser: "نص الإعلان"
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

export function isUrlFallbackRequired(resolved = {}) {
  return Boolean(
    resolved.fallbackRequired
    || resolved.extractionStatus === CLASSIFICATION_STATUS.FALLBACK_REQUIRED
    || resolved.classificationStatus === CLASSIFICATION_STATUS.FALLBACK_REQUIRED
    || resolved.error === "fallback_required"
  );
}

export function buildCanonicalIntakeRecord(urlCanonical = {}, imageAnalysis = {}, mergedFields = {}) {
  return {
    originalUrl: safeText(urlCanonical.originalUrl, 2000),
    resolvedUrl: safeText(urlCanonical.resolvedUrl || urlCanonical.url, 2000),
    sourceSiteId: safeText(urlCanonical.sourceSiteId || urlCanonical.adapterId, 40),
    externalListingId: safeText(urlCanonical.externalListingId, 120),
    mediaPath: safeText(imageAnalysis.mediaPath || urlCanonical.mediaPath, 500),
    extractionStatus: safeText(
      imageAnalysis.extractionStatus || urlCanonical.extractionStatus,
      40
    ),
    classificationStatus: safeText(
      imageAnalysis.classificationStatus || urlCanonical.classificationStatus,
      40
    ),
    analyzerProvider: safeText(imageAnalysis.analyzerProvider, 40),
    extractionMode: safeText(imageAnalysis.extractionMode || urlCanonical.extractionMode, 80),
    contentHash: safeText(urlCanonical.contentHash, 128),
    fieldSources: {
      ...(urlCanonical.fieldSources || {}),
      ...(imageAnalysis.fieldSources || {})
    },
    brokerFields: mergedFields
  };
}

export function mergeImageAnalysisWithCanonical(textFields = {}, urlCanonical = {}, imageAnalysis = {}) {
  const imageBrokerFields = imageAnalysis.brokerFields && typeof imageAnalysis.brokerFields === "object"
    ? imageAnalysis.brokerFields
    : {};
  const merged = mergeCanonicalListingFields({ ...textFields, ...imageBrokerFields }, urlCanonical || {});
  const fields = { ...merged.fields };
  for (const [key, value] of Object.entries(imageBrokerFields)) {
    if (value === null || value === undefined || String(value).trim() === "") continue;
    fields[key] = value;
  }
  const fieldSources = {
    ...(urlCanonical?.fieldSources || {}),
    ...(imageAnalysis.fieldSources || merged.fieldSources || {})
  };
  for (const [key, value] of Object.entries(imageBrokerFields)) {
    if (value === null || value === undefined || String(value).trim() === "") continue;
    fieldSources[key] = imageAnalysis.analyzerProvider || imageAnalysis.extractionMode || "image_vision";
  }
  const extractionStatus = imageAnalysis.extractionStatus
    || (hasCoreListingFields(merged.fields) ? "extracted" : urlCanonical?.extractionStatus);
  return {
    ...merged,
    fields,
    fieldSources,
    extractionStatus,
    analyzerProvider: imageAnalysis.analyzerProvider || "",
    extractionMode: imageAnalysis.extractionMode || merged.extractionMode,
    mediaPath: imageAnalysis.mediaPath || urlCanonical?.mediaPath || "",
    confidence: Number(imageAnalysis.confidence || 0),
    intake: buildCanonicalIntakeRecord(urlCanonical, imageAnalysis, fields)
  };
}

function hasCoreListingFields(fields = {}) {
  return Boolean(
    fields.opportunityKind
    && fields.purpose
    && fields.propertyType
    && fields.city
  );
}

export function buildImportProvenanceSummary({ canonical = {}, extraction = {}, sourceSite = "" } = {}) {
  const parts = [];
  if (canonical?.originalUrl || canonical?.resolvedUrl) parts.push("رابط");
  if (canonical?.mediaPath || extraction?.mediaPath) parts.push("صورة");
  if (extraction?.analyzerProvider) {
    parts.push(ANALYZER_PROVIDER_LABELS[extraction.analyzerProvider] || extraction.analyzerProvider);
  } else if (extraction?.extractionMode?.includes("gemini")) {
    parts.push("Gemini Vision");
  } else if (extraction?.extractionMode?.includes("workers_ai")) {
    parts.push("Workers AI Vision");
  }
  if (sourceSite && !parts.includes(sourceSite)) parts.push(sourceSite);
  if (!parts.length) return "";
  return `المصدر: ${parts.join(" + ")}`;
}

export function importStatusMessageForExtraction({ extractionStatus, classificationStatus, error } = {}) {
  if (error === "source_blocked" || extractionStatus === "fallback_required") {
    return FALLBACK_URL_MESSAGE;
  }
  if (classificationStatus === "needs_review" || extractionStatus === "needs_review") {
    return "نحتاج معلومات إضافية";
  }
  if (extractionStatus === "extracted") {
    return "تمت قراءة البيانات";
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
