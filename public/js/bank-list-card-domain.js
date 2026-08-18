/**
 * Opportunity bank list card projection — display layer only for list rows.
 */

import {
  formatLocationLine,
  normalizePropertyTypeDisplay,
  sanitizeDisplayField
} from "./display-sanitize-domain.js";
import { normalizeLegacyArabicLabel } from "./reference-catalog.js";
import {
  evaluateMatchingReadiness,
  missingFieldLabelsArabic
} from "./opportunity-readiness-domain.js";
import { isLandProperty } from "./opportunity-intake-domain.js";
import { contactLineMarkup } from "./opportunity-card-domain.js";

const BANK_LABEL_ALIASES = Object.freeze({
  riyadh: "الرياض",
  "al-arid": "العريض",
  "al arid": "العريض",
  office: "مكتب",
  land: "أرض",
  madina: "المدينة المنورة"
});

const SOURCE_SHORT = Object.freeze({
  office_link: "رابط المكتب",
  manual: "إدخال يدوي",
  whatsapp: "واتساب",
  public_site: "منصة",
  voice: "صوتي"
});

function isOwnerRecord(record = {}) {
  const kind = String(record.opportunityKind || record.kind || record.recordType || "").toUpperCase();
  return record.contactType === "owner"
    || kind === "OWNER"
    || kind === "OWNER_OFFER"
    || kind === "OFFER";
}

function kindBadge(record = {}) {
  return isOwnerRecord(record) ? "عرض مالك" : "طلب عميل";
}

function normalizeBankText(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const lower = raw.toLowerCase().replace(/[_-]/g, " ").trim();
  if (BANK_LABEL_ALIASES[lower]) return BANK_LABEL_ALIASES[lower];
  const legacy = normalizeLegacyArabicLabel(raw);
  const cleaned = sanitizeDisplayField(normalizePropertyTypeDisplay(legacy));
  return cleaned.display || "";
}

function purposeWord(record = {}) {
  const purpose = String(record.purpose || record.transactionType || "").toUpperCase();
  if (purpose === "RENT" || purpose === "LEASE_REQUEST") return "للإيجار";
  if (purpose === "SALE" || purpose === "PURCHASE") return "للبيع";
  if (purpose === "INVESTMENT") return "للاستثمار";
  return "";
}

function titleLine(record = {}) {
  const propertyType = normalizeBankText(record.propertyType);
  const purpose = purposeWord(record);
  if (propertyType && propertyType !== "تحتاج مراجعة" && purpose) {
    return `${propertyType} ${purpose}`;
  }
  if (propertyType) return propertyType;
  return "";
}

function locationLine(record = {}) {
  const city = normalizeBankText(record.city);
  const district = normalizeBankText(record.district);
  const line = formatLocationLine(city, district);
  if (!line || line === "غير محدد" || line.includes("تحتاج مراجعة")) return "";
  return line;
}

function moneyValue(record = {}) {
  const isOwner = isOwnerRecord(record);
  const price = Number(record.price ?? record.salePrice ?? record.amount ?? 0);
  const budget = Number(record.budget ?? record.priceMax ?? record.priceOrBudget ?? 0);
  const annualRent = Number(record.annualRent ?? 0);
  if (isOwner && price > 0) return `${price.toLocaleString("ar-SA")} ريال`;
  if (!isOwner && budget > 0) return `${budget.toLocaleString("ar-SA")} ريال`;
  if (annualRent > 0) return `${annualRent.toLocaleString("ar-SA")} ريال سنويًا`;
  if (price > 0) return `${price.toLocaleString("ar-SA")} ريال`;
  return "";
}

function areaValue(record = {}) {
  const area = Number(record.area || 0);
  const min = Number(record.areaMin || 0);
  const max = Number(record.areaMax || 0);
  if (area > 0) return `${area.toLocaleString("ar-SA")} م²`;
  if (min > 0 && max > 0) return `${min.toLocaleString("ar-SA")}–${max.toLocaleString("ar-SA")} م²`;
  if (min > 0) return `من ${min.toLocaleString("ar-SA")} م²`;
  return "";
}

function roomsValue(record = {}) {
  if (isLandProperty(record.propertyType)) return "";
  const rooms = Number(record.rooms || 0);
  return rooms > 0 ? String(rooms) : "";
}

function sourceShort(record = {}) {
  const raw = String(record.normalizedSource || record.source || record.sourceType || "").trim();
  return SOURCE_SHORT[raw] || "";
}

function formatNextAction(value) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const tz = "Asia/Riyadh";
  const now = new Date();
  const today = new Date(now.toLocaleString("en-US", { timeZone: tz }));
  const target = new Date(date.toLocaleString("en-US", { timeZone: tz }));
  const dayDiff = Math.round(
    (Date.UTC(target.getFullYear(), target.getMonth(), target.getDate())
      - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000
  );
  const time = date.toLocaleString("ar-SA", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
  if (dayDiff === 0) return `اليوم، ${time}`;
  if (dayDiff === 1) return `غدًا، ${time}`;
  if (dayDiff === 2) return `بعد غد، ${time}`;
  const weekday = date.toLocaleString("ar-SA", { timeZone: tz, weekday: "long" });
  return `${weekday}، ${time}`;
}

/**
 * @param {object} record
 * @param {object} [context] — { bestMatchScore, bestMatchComputed }
 */
export function buildBankListCardView(record = {}, context = {}) {
  const readiness = evaluateMatchingReadiness(record);
  const missingNames = missingFieldLabelsArabic(readiness.matchingReadinessMissing || []);
  const bestScore = Number(context.bestMatchScore ?? record.bestMatchScore ?? 0);
  const scoreComputed = Boolean(context.bestMatchComputed ?? record.bestMatchComputed);
  const nextAt = record.nextActionAt || record.nextFollowUpAt;
  const nextAction = formatNextAction(nextAt);
  const overdue = Boolean(nextAt && new Date(nextAt).getTime() < Date.now());

  const title = titleLine(record) || "تحتاج مراجعة";
  const location = locationLine(record);
  const priceText = moneyValue(record);
  const areaText = areaValue(record);
  const roomsText = roomsValue(record);
  const headerStatus = readiness.isReadyForMatching ? "جاهزة للمطابقة" : "تحتاج استكمال";
  const readinessLine = readiness.isReadyForMatching
    ? "جاهزة للمطابقة"
    : (missingNames.length ? `ينقص: ${missingNames.join("، ")}` : "تحتاج استكمال");

  return {
    opportunityId: String(record.id || record.opportunityId || "").trim(),
    kindBadge: kindBadge(record),
    title,
    headerStatus,
    location,
    priceText,
    areaText,
    roomsText,
    readinessLine,
    isReadyForMatching: readiness.isReadyForMatching,
    contactLineMarkup: contactLineMarkup(record),
    nextActionLabel: nextAction ? `الإجراء القادم: ${nextAction}` : "",
    nextActionOverdue: overdue,
    bestMatchScoreText: scoreComputed && bestScore > 0 ? `${bestScore}%` : "",
    sourceShort: sourceShort(record),
    ariaLabel: [kindBadge(record), title, location].filter(Boolean).join(" — ")
  };
}
