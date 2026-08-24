/**
 * العروض والطلبات inbox card — display projection only.
 * Reads matching readiness and stored match counts; does not run Matching Engine.
 */

import { evaluateMatchingReadiness, missingFieldLabelsArabic } from "./opportunity-readiness-domain.js";
import { bankOpportunityKindDisplayLabel } from "./opportunity-bank-domain.js";
import { normalizeMatchStatus, MATCH_STATUS } from "./opportunity-status-domain.js";
import {
  formatLocationLine,
  normalizePropertyTypeDisplay,
  sanitizeDisplayField
} from "./display-sanitize-domain.js";
import { normalizeLegacyArabicLabel } from "./reference-catalog.js";

export const BANK_INBOX_STATUS = Object.freeze({
  NEEDS_COMPLETION: "needs_completion",
  MATCHING: "matching",
  MATCH_FOUND: "match_found"
});

export const BANK_INBOX_STATUS_LABELS = Object.freeze({
  needs_completion: "يحتاج استكمال",
  matching: "قيد المطابقة",
  match_found: "تم العثور على مطابقة"
});

const SOURCE_LABELS = Object.freeze({
  office_link: "من رابط المكتب",
  officelink: "من رابط المكتب",
  office: "من رابط المكتب",
  public_link: "من رابط المكتب",
  manual: "إضافة مباشرة",
  text: "إضافة مباشرة",
  voice: "إضافة مباشرة",
  audio: "إضافة مباشرة",
  direct: "إضافة مباشرة",
  import: "استيراد إعلان",
  advert: "استيراد إعلان",
  public_site: "استيراد إعلان",
  url: "استيراد إعلان",
  whatsapp: "من واتساب",
  image: "من صورة",
  screenshot: "من صورة",
  photo: "من صورة"
});

function isOfferRecord(record = {}) {
  const kind = String(record.opportunityKind || record.kind || record.recordType || "").toUpperCase();
  return record.contactType === "owner"
    || kind === "OWNER"
    || kind === "OWNER_OFFER"
    || kind === "OFFER";
}

function normalizeBankText(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const legacy = normalizeLegacyArabicLabel(raw);
  const cleaned = sanitizeDisplayField(normalizePropertyTypeDisplay(legacy));
  return cleaned.display || "";
}

function matchContext(record = {}, context = {}) {
  return {
    matchCount: Number(context.matchCount ?? record.activeMatchCount ?? record.matchCount ?? 0),
    bestMatchScore: Number(context.bestMatchScore ?? record.bestMatchScore ?? 0),
    bestMatchComputed: Boolean(context.bestMatchComputed ?? record.bestMatchComputed),
    needsReview: Boolean(context.needsReview ?? record.matchNeedsReview)
  };
}

export function bankInboxStatusKey(record = {}, context = {}) {
  const readiness = evaluateMatchingReadiness(record);
  if (!readiness.isReadyForMatching) return BANK_INBOX_STATUS.NEEDS_COMPLETION;
  const match = normalizeMatchStatus(record, matchContext(record, context));
  if (match === MATCH_STATUS.MATCH_EXISTS || match === MATCH_STATUS.NEEDS_REVIEW) {
    return BANK_INBOX_STATUS.MATCH_FOUND;
  }
  return BANK_INBOX_STATUS.MATCHING;
}

export function bankInboxStatusLabel(key) {
  return BANK_INBOX_STATUS_LABELS[key] || BANK_INBOX_STATUS_LABELS.needs_completion;
}

export function bankInboxSourceLabel(record = {}) {
  const raw = String(
    record.normalizedSource || record.sourceType || record.source || record.intakeSource || ""
  ).trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (SOURCE_LABELS[raw]) return SOURCE_LABELS[raw];
  if (raw.includes("whatsapp")) return SOURCE_LABELS.whatsapp;
  if (raw.includes("image") || raw.includes("photo") || raw.includes("screenshot")) return SOURCE_LABELS.image;
  if (raw.includes("office")) return SOURCE_LABELS.office_link;
  if (raw.includes("url") || raw.includes("import") || raw.includes("advert")) return SOURCE_LABELS.import;
  return "";
}

export function bankInboxMissingLine(record = {}) {
  const readiness = evaluateMatchingReadiness(record);
  if (readiness.isReadyForMatching) return "";
  const offer = isOfferRecord(record);
  const labels = (readiness.matchingReadinessMissing || []).map((key) => {
    if (key === "priceOrBudget" || key === "salePrice" || key === "budget" || key === "annualRent") {
      return offer ? "السعر" : "الميزانية";
    }
    if (key === "contactPhone") return "رقم التواصل";
    return missingFieldLabelsArabic([key])[0] || "";
  }).filter(Boolean);
  const unique = [...new Set(labels)];
  if (!unique.length) return "";
  if (unique.length === 1) return `ينقص ${unique[0]}`;
  if (unique.length === 2) return `ينقص ${unique[0]} و${unique[1]}`;
  return `ينقص ${unique.slice(0, -1).join(" و")} و${unique[unique.length - 1]}`;
}

function moneyLine(record = {}) {
  const offer = isOfferRecord(record);
  const price = Number(record.price ?? record.salePrice ?? record.amount ?? 0);
  const budget = Number(record.budget ?? record.priceMax ?? record.priceOrBudget ?? 0);
  const annualRent = Number(record.annualRent ?? 0);
  const format = (value) => `${value.toLocaleString("ar-SA")} ريال`;
  if (offer && price > 0) return `السعر: ${format(price)}`;
  if (!offer && budget > 0) return `الميزانية: ${format(budget)}`;
  if (annualRent > 0) return `الإيجار: ${format(annualRent)} سنويًا`;
  if (price > 0) return `السعر: ${format(price)}`;
  if (budget > 0) return `الميزانية: ${format(budget)}`;
  return "";
}

function propertyLocationLine(record = {}) {
  const propertyType = normalizeBankText(record.propertyType);
  const district = normalizeBankText(record.district);
  const city = normalizeBankText(record.city);
  if (propertyType && district) return `${propertyType} — حي ${district.replace(/^حي\s+/, "")}`;
  if (propertyType && city) return `${propertyType} — ${city}`;
  const location = formatLocationLine(city, district);
  if (propertyType && location && location !== "غير محدد") return `${propertyType} — ${location}`;
  return propertyType || location || "";
}

function timestampMs(record = {}) {
  const value = Date.parse(record.updatedAt || record.createdAt || record.receivedAt || 0);
  return Number.isFinite(value) ? value : 0;
}

export function compareBankInboxRecords(a = {}, b = {}, contextA = {}, contextB = {}) {
  const keyA = bankInboxStatusKey(a, contextA);
  const keyB = bankInboxStatusKey(b, contextB);
  const rank = (key) => (key === BANK_INBOX_STATUS.NEEDS_COMPLETION ? 0 : 1);
  const delta = rank(keyA) - rank(keyB);
  if (delta !== 0) return delta;
  return timestampMs(b) - timestampMs(a);
}

export function sortBankInboxRecords(records = [], contextFor = () => ({})) {
  return [...records].sort((a, b) => compareBankInboxRecords(a, b, contextFor(a), contextFor(b)));
}

export function buildBankInboxCardView(record = {}, context = {}) {
  const statusKey = bankInboxStatusKey(record, context);
  const kindTitle = bankOpportunityKindDisplayLabel(record)
    || (isOfferRecord(record) ? "عرض" : "طلب");
  return {
    opportunityId: String(record.id || record.opportunityId || "").trim(),
    kindTitle,
    propertyLocation: propertyLocationLine(record),
    moneyLine: moneyLine(record),
    sourceLabel: bankInboxSourceLabel(record),
    statusKey,
    statusLabel: bankInboxStatusLabel(statusKey),
    missingLine: statusKey === BANK_INBOX_STATUS.NEEDS_COMPLETION ? bankInboxMissingLine(record) : "",
    isNeedsCompletion: statusKey === BANK_INBOX_STATUS.NEEDS_COMPLETION,
    isMatching: statusKey === BANK_INBOX_STATUS.MATCHING,
    isMatchFound: statusKey === BANK_INBOX_STATUS.MATCH_FOUND,
    ariaLabel: [kindTitle, propertyLocationLine(record), bankInboxStatusLabel(statusKey)]
      .filter(Boolean)
      .join(" — ")
  };
}
