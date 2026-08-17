/**
 * استيراد إعلان — منطق نقي: التحقق من الرابط، المصدر، التكرار، وجاهزية المراجعة.
 */

import {
  isHttpUrl,
  normalizeUrl,
  normalizeOpportunityFinancials,
  safeText,
  computeDataCompleteness
} from "./opportunity-intake-domain.js";
import {
  evaluateMatchingReadiness,
  missingFieldLabelsArabic
} from "./opportunity-readiness-domain.js";
import {
  matchesDuplicateCriteria,
  normalizeDuplicatePhone,
  resolveOpportunityKind,
  isActiveOpportunityForDuplicate
} from "../../worker/src/opportunity-duplicate.mjs";

export const IMPORT_SUMMARY_FIELDS = Object.freeze([
  "opportunityKind",
  "purpose",
  "propertyType",
  "city",
  "district",
  "priceOrBudget",
  "area",
  "rooms",
  "advertiserRole",
  "contactPhone"
]);

export const IMPORT_FIELD_STATUS = Object.freeze({
  EXTRACTED: "extracted",
  NEEDS_REVIEW: "needs_review",
  MISSING: "missing"
});

export const IMPORT_FIELD_STATUS_LABELS = Object.freeze({
  extracted: "تم استخراجه",
  needs_review: "يحتاج مراجعة",
  missing: "بيانات ناقصة"
});

const SITE_LABELS = Object.freeze({
  "haraj.com.sa": "حراج",
  "sa.aqar.fm": "عقار",
  "aqar.fm": "عقار",
  "a.aqar.fm": "عقار",
  "dealapp.sa": "ديل",
  "bayut.sa": "بيوت",
  "propertyfinder.sa": "بروبرتي فايندر"
});

/** Client-side SSRF guard — mirrors worker isPrivateOrLocalHost. */
export function isBlockedImportHost(hostname) {
  const host = String(hostname || "").trim().toLowerCase();
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "0.0.0.0") return true;
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!ipv4) return false;
  const parts = ipv4.slice(1).map((n) => Number(n));
  if (parts.some((n) => n > 255)) return true;
  if (parts[0] === 10) return true;
  if (parts[0] === 127) return true;
  if (parts[0] === 169 && parts[1] === 254) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  return false;
}

export function validateImportUrl(value) {
  const text = safeText(value, 2000);
  if (!isHttpUrl(text)) return { ok: false, error: "invalid_url", message: "الرابط غير صالح" };
  try {
    const withProtocol = /^https?:\/\//i.test(text) ? text : `https://${text}`;
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { ok: false, error: "invalid_url", message: "الرابط غير صالح" };
    }
    if (isBlockedImportHost(parsed.hostname)) {
      return { ok: false, error: "blocked_host", message: "الرابط غير صالح" };
    }
    return { ok: true, normalizedUrl: normalizeUrl(withProtocol) };
  } catch {
    return { ok: false, error: "invalid_url", message: "الرابط غير صالح" };
  }
}

export function resolveSourceSiteLabel(urlOrHost = "") {
  const raw = safeText(urlOrHost, 500);
  let host = raw.toLowerCase().replace(/^www\./, "");
  if (raw.includes("//")) {
    try {
      host = new URL(raw).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      host = raw.toLowerCase();
    }
  }
  if (SITE_LABELS[host]) return SITE_LABELS[host];
  if (host.includes("haraj")) return "حراج";
  if (host.includes("aqar")) return "عقار";
  if (host.includes("dealapp")) return "ديل";
  if (host.includes("bayut")) return "بيوت";
  if (host.includes("propertyfinder")) return "بروبرتي فايندر";
  return "الموقع";
}

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

export function descriptionSimilarity(left = "", right = "") {
  const wordsA = normalizeArabicLite(left).split(/\s+/).filter((w) => w.length > 3);
  const setB = new Set(normalizeArabicLite(right).split(/\s+/).filter((w) => w.length > 3));
  if (!wordsA.length || !setB.size) return 0;
  const overlap = wordsA.filter((w) => setB.has(w)).length;
  return overlap / wordsA.length;
}

function fieldFilled(key, record = {}) {
  const fields = normalizeOpportunityFinancials(record);
  if (key === "contactPhone") {
    const phone = record.advertiserPhoneNormalized || record.contactPhone || record.phone;
    return Boolean(normalizeDuplicatePhone(phone));
  }
  if (key === "advertiserRole") {
    const role = safeText(record.advertiserRole, 20).toUpperCase();
    return role && role !== "UNKNOWN";
  }
  if (key === "priceOrBudget") {
    const purpose = safeText(fields.purpose, 30).toUpperCase();
    if (purpose === "SALE") return Number(fields.salePrice ?? fields.priceOrBudget) > 0;
    if (purpose === "RENT") return Number(fields.annualRent ?? fields.priceOrBudget) > 0;
    if (purpose === "PURCHASE" || purpose === "LEASE_REQUEST") {
      return Number(fields.budget ?? fields.priceOrBudget) > 0;
    }
    return Number(fields.priceOrBudget) > 0;
  }
  const value = fields[key] ?? record[key];
  if (value === null || value === undefined || String(value).trim() === "") return false;
  if (key === "rooms" && /أرض|ارض/.test(String(fields.propertyType || ""))) return true;
  return true;
}

export function countImportSummaryFields(record = {}) {
  let filled = 0;
  for (const key of IMPORT_SUMMARY_FIELDS) {
    if (fieldFilled(key, record)) filled += 1;
  }
  return filled;
}

export function buildImportReadinessSummary(record = {}) {
  const filled = countImportSummaryFields(record);
  const total = IMPORT_SUMMARY_FIELDS.length;
  return `تم استخراج ${filled} من ${total} بيانات مطلوبة للمطابقة`;
}

export function buildImportFieldStatuses(fields = {}, needsReview = {}, missingFields = []) {
  const statuses = {};
  const missingSet = new Set(missingFields || []);
  const reviewSet = needsReview && typeof needsReview === "object" ? needsReview : {};
  for (const key of IMPORT_SUMMARY_FIELDS) {
    if (missingSet.has(key) || !fieldFilled(key, fields)) {
      statuses[key] = IMPORT_FIELD_STATUS.MISSING;
    } else if (reviewSet[key]) {
      statuses[key] = IMPORT_FIELD_STATUS.NEEDS_REVIEW;
    } else {
      statuses[key] = IMPORT_FIELD_STATUS.EXTRACTED;
    }
  }
  return statuses;
}

export function buildImportOpportunityExtras({
  sourceUrl = "",
  sourceSite = "",
  extractionConfidence = 0,
  importedAt = new Date(),
  canonical = null
} = {}) {
  const normalized = normalizeUrl(sourceUrl);
  const site = safeText(sourceSite, 80) || (normalized ? resolveSourceSiteLabel(normalized) : "");
  const timestamp = importedAt instanceof Date ? importedAt.toISOString() : String(importedAt || "");
  const extras = {
    sourceType: normalized ? "url" : "text",
    sourceSite: site,
    sourceUrl: normalized || safeText(sourceUrl, 2000),
    importedAt: timestamp,
    extractionConfidence: Number(extractionConfidence) || 0,
    importActivityText: site ? `تم استيراد الإعلان من ${site}` : "تم استيراد الإعلان"
  };
  if (canonical && typeof canonical === "object") {
    if (canonical.originalUrl) extras.originalUrl = safeText(canonical.originalUrl, 2000);
    if (canonical.resolvedUrl) extras.resolvedUrl = safeText(canonical.resolvedUrl, 2000);
    if (canonical.sourceSiteId) extras.sourceSiteId = safeText(canonical.sourceSiteId, 40);
    if (canonical.externalListingId) extras.externalListingId = safeText(canonical.externalListingId, 120);
    if (canonical.extractionStatus) extras.extractionStatus = safeText(canonical.extractionStatus, 40);
    if (canonical.classificationStatus) extras.classificationStatus = safeText(canonical.classificationStatus, 40);
    if (canonical.contentHash) extras.contentHash = safeText(canonical.contentHash, 128);
    if (canonical.fieldSources) extras.fieldSources = canonical.fieldSources;
  }
  return extras;
}

function sameOfficeOnly(record = {}, officeId = "") {
  const office = safeText(officeId, 80);
  if (!office) return false;
  return safeText(record.officeId, 80) === office;
}

function strongPropertyMatch(existing = {}, criteria = {}) {
  const propertyType = normalizeArabicLite(criteria.propertyType);
  const existingProperty = normalizeArabicLite(existing.propertyType);
  if (!propertyType || !existingProperty || propertyType !== existingProperty) return false;
  const city = normalizeArabicLite(criteria.city);
  const existingCity = normalizeArabicLite(existing.city);
  if (!city || !existingCity || city !== existingCity) return false;
  const district = normalizeArabicLite(criteria.district);
  const existingDistrict = normalizeArabicLite(existing.district);
  if (!district || !existingDistrict || district !== existingDistrict) return false;
  const price = Number(criteria.priceOrBudget ?? criteria.salePrice ?? criteria.budget ?? criteria.annualRent);
  const existingPrice = Number(existing.priceOrBudget ?? existing.salePrice ?? existing.budget ?? existing.annualRent);
  if (price > 0 && existingPrice > 0 && price !== existingPrice) return false;
  const area = Number(criteria.area);
  const existingArea = Number(existing.area);
  if (area > 0 && existingArea > 0 && area !== existingArea) return false;
  return true;
}

/**
 * Office-scoped duplicate scan for import flow.
 * Never returns opportunities from another office.
 */
export function findImportDuplicateOpportunities(docs = [], criteria = {}, officeId = "") {
  const normalizedUrl = normalizeUrl(criteria.sourceUrl || criteria.url || "");
  const hits = [];
  for (const doc of docs) {
    const data = doc.data || doc;
    const opportunityId = doc.id || data.id || data.opportunityId || "";
    if (!sameOfficeOnly(data, officeId)) continue;
    if (!isActiveOpportunityForDuplicate(data)) continue;

    const existingUrl = normalizeUrl(data.sourceUrl || data.url || "");
    if (normalizedUrl && existingUrl && normalizedUrl === existingUrl) {
      hits.push({ opportunityId, data, strength: "strong", reason: "source_url" });
      continue;
    }

    if (matchesDuplicateCriteria(data, {
      officeId,
      phone: criteria.phone || criteria.contactPhone || criteria.advertiserPhoneNormalized,
      contactType: criteria.contactType,
      opportunityKind: criteria.opportunityKind,
      kind: criteria.opportunityKind,
      propertyType: criteria.propertyType,
      city: criteria.city,
      district: criteria.district
    })) {
      hits.push({ opportunityId, data, strength: "strong", reason: "phone_property" });
      continue;
    }

    if (strongPropertyMatch(data, criteria)) {
      hits.push({ opportunityId, data, strength: "medium", reason: "property_location_price" });
      continue;
    }

    const description = safeText(criteria.description || criteria.sourceText, 4000);
    const existingDescription = safeText(data.description || data.sourceText || data.notes, 4000);
    if (description && existingDescription && descriptionSimilarity(description, existingDescription) >= 0.55) {
      if (strongPropertyMatch(data, criteria) || matchesDuplicateCriteria(data, {
        officeId,
        propertyType: criteria.propertyType,
        city: criteria.city,
        district: criteria.district
      })) {
        hits.push({ opportunityId, data, strength: "medium", reason: "description_similarity" });
      }
    }
  }
  return hits;
}

export function pickStrongestImportDuplicate(hits = []) {
  if (!hits.length) return null;
  const order = { strong: 0, medium: 1, weak: 2 };
  return hits.sort((a, b) => (order[a.strength] ?? 9) - (order[b.strength] ?? 9))[0];
}

export function importSaveButtonLabel(record = {}) {
  const readiness = evaluateMatchingReadiness(record);
  if (readiness.isReadyForMatching) return "حفظ وإدخالها في المطابقة";
  return "حفظ الإعلان في بنك الفرص";
}

export function importReadinessPresentation(record = {}) {
  const readiness = evaluateMatchingReadiness(record);
  const completeness = computeDataCompleteness(record);
  return {
    matchingReadiness: readiness.matchingReadiness,
    matchingReadinessMissing: readiness.matchingReadinessMissing,
    matchingReadinessLabel: readiness.isReadyForMatching ? "جاهزة للمطابقة" : "تحتاج استكمال",
    missingFieldLabels: missingFieldLabelsArabic(readiness.matchingReadinessMissing),
    dataCompleteness: completeness.dataCompleteness,
    isReadyForMatching: readiness.isReadyForMatching
  };
}

export const __test = {
  resolveOpportunityKind
};
