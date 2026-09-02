/**
 * Opportunity card projection — readable at a glance without opening details.
 */

import { safeText } from "./opportunity-intake-domain.js";
import {
  formatLocalPhoneDisplay,
  maskPhoneForDisplay,
  readAdvertiserDisplayName
} from "./advertiser-phone-domain.js";
import { projectOpportunityStatuses } from "./opportunity-status-domain.js";
import {
  evaluateMatchingReadiness,
  missingFieldLabelsArabic
} from "./opportunity-readiness-domain.js";
import {
  formatLocationLine,
  normalizePropertyTypeDisplay,
  sanitizeDisplayField
} from "./display-sanitize-domain.js";

const LC = typeof window !== "undefined" && window.IAQAR_LIFECYCLE
  ? window.IAQAR_LIFECYCLE
  : null;

const SOURCE_LABELS = Object.freeze({
  office_link: "رابط المكتب",
  manual: "إدخال يدوي",
  whatsapp: "واتساب",
  public_site: "فرصة منصة",
  voice: "تسجيل صوتي",
  other: "مصدر آخر"
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

function htmlEsc(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function contactLineParts(record = {}) {
  const name = sanitizeDisplayField(readAdvertiserDisplayName(record));
  const firstName = name.display.split(/\s+/)[0] || "";
  const masked = maskPhoneForDisplay(
    record.advertiserPhoneNormalized || record.contactPhone || record.phone
  );
  return { firstName: name.needsReview ? "" : firstName, masked };
}

export function contactLineMarkup(record = {}) {
  const { firstName, masked } = contactLineParts(record);
  if (firstName && masked) {
    return `${htmlEsc(firstName)} • <span class="phone-ltr" dir="ltr">${htmlEsc(masked)}</span>`;
  }
  if (masked) return `<span class="phone-ltr" dir="ltr">${htmlEsc(masked)}</span>`;
  if (firstName) return htmlEsc(firstName);
  return "غير محدد";
}

function propertyDescription(record = {}) {
  const propertyType = sanitizeDisplayField(
    normalizePropertyTypeDisplay(record.propertyType)
  ).display;
  const purpose = String(record.purpose || record.transactionType || "").toUpperCase();
  const owner = isOwnerRecord(record);
  const purposeWord = purpose === "RENT" || purpose === "LEASE_REQUEST" ? (owner ? "للإيجار" : "للاستئجار")
    : purpose === "SALE" || purpose === "PURCHASE" ? (owner ? "للبيع" : "للشراء")
    : "";
  if (propertyType && propertyType !== "تحتاج مراجعة" && purposeWord) {
    return `${propertyType} ${purposeWord}`;
  }
  if (propertyType) return propertyType;
  if (LC?.buildOpportunitySummary) {
    const summary = LC.buildOpportunitySummary(record);
    return sanitizeDisplayField(summary).display || "غير محدد";
  }
  return "غير محدد";
}

function locationLine(record = {}) {
  const line = formatLocationLine(record.city, record.district);
  return line || "غير محدد";
}

function moneyLine(record = {}) {
  const isOwner = isOwnerRecord(record);
  const price = Number(record.price ?? record.salePrice ?? record.amount ?? 0);
  const budget = Number(record.budget ?? record.priceMax ?? record.priceOrBudget ?? 0);
  const annualRent = Number(record.annualRent ?? 0);
  if (isOwner && price > 0) return `${price.toLocaleString("ar-SA")} ريال`;
  if (!isOwner && budget > 0) return `ميزانية ${budget.toLocaleString("ar-SA")} ريال`;
  if (annualRent > 0) return `${annualRent.toLocaleString("ar-SA")} ريال سنويًا`;
  if (price > 0) return `${price.toLocaleString("ar-SA")} ريال`;
  return "غير محدد";
}

function areaLine(record = {}) {
  const area = Number(record.area || 0);
  const min = Number(record.areaMin || 0);
  const max = Number(record.areaMax || 0);
  if (area > 0) return `${area.toLocaleString("ar-SA")} م²`;
  if (min > 0 && max > 0) return `${min.toLocaleString("ar-SA")}–${max.toLocaleString("ar-SA")} م²`;
  if (min > 0) return `من ${min.toLocaleString("ar-SA")} م²`;
  return "غير محدد";
}

function contactLine(record = {}) {
  const markup = contactLineMarkup(record);
  if (markup === "غير محدد") return markup;
  return markup.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&quot;/g, "\"");
}

function sourceLabel(record = {}) {
  const raw = safeText(record.normalizedSource || record.source || record.sourceType, 40);
  if (LC?.normalizeOpportunitySource) {
    return SOURCE_LABELS[LC.normalizeOpportunitySource(raw)] || SOURCE_LABELS.other;
  }
  return SOURCE_LABELS[raw] || raw || "غير محدد";
}

function formatNextAction(value) {
  if (!value) return "غير محدد";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "غير محدد";
  const now = new Date();
  const overdue = date.getTime() < now.getTime();
  const tz = "Asia/Riyadh";
  const today = new Date(now.toLocaleString("en-US", { timeZone: tz }));
  const target = new Date(date.toLocaleString("en-US", { timeZone: tz }));
  const dayDiff = Math.round(
    (Date.UTC(target.getFullYear(), target.getMonth(), target.getDate())
      - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000
  );
  const weekday = date.toLocaleString("ar-SA", { timeZone: tz, weekday: "long" });
  const monthDay = date.toLocaleString("ar-SA", { timeZone: tz, month: "long", day: "numeric" });
  const time = date.toLocaleString("ar-SA", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
  let prefix = "";
  if (dayDiff === 0) prefix = "اليوم";
  else if (dayDiff === 1) prefix = "غدًا";
  else if (dayDiff === 2) prefix = "بعد غد";
  const label = prefix
    ? `${prefix} — ${weekday} ${monthDay}، ${time}`
    : `${weekday} ${monthDay}، ${time}`;
  if (overdue) return `متابعة متأخرة — ${label}`;
  return label;
}

/**
 * @param {object} record
 * @param {object} [context] — { matchCount, bestMatchScore, bestMatchComputed }
 */
export function buildOpportunityCardView(record = {}, context = {}) {
  const statuses = projectOpportunityStatuses(record, context);
  const readiness = evaluateMatchingReadiness(record);
  const missingNames = missingFieldLabelsArabic(readiness.matchingReadinessMissing || []);
  const bestScore = Number(context.bestMatchScore ?? record.bestMatchScore ?? 0);
  const scoreComputed = Boolean(context.bestMatchComputed ?? record.bestMatchComputed);
  const nextAt = record.nextActionAt || record.nextFollowUpAt;

  return {
    opportunityId: safeText(record.id || record.opportunityId, 180),
    kindBadge: kindBadge(record),
    description: propertyDescription(record),
    location: locationLine(record),
    priceOrBudget: moneyLine(record),
    area: areaLine(record),
    contactLine: contactLine(record),
    contactLineMarkup: contactLineMarkup(record),
    sourceLabel: sourceLabel(record),
    dataCompletenessLabel: statuses.dataCompletenessLabel,
    contactStatusLabel: statuses.contactStatusLabel,
    matchStatusLabel: statuses.matchStatusLabel,
    outcomeStatusLabel: statuses.outcomeStatusLabel,
    nextActionLabel: formatNextAction(nextAt),
    nextActionOverdue: Boolean(nextAt && new Date(nextAt).getTime() < Date.now()),
    bestMatchScore: scoreComputed && bestScore > 0 ? bestScore : null,
    bestMatchScoreText: scoreComputed && bestScore > 0 ? `${bestScore}%` : "",
    missingFieldNames: missingNames,
    missingFieldsBanner: missingNames.length
      ? `البيانات الناقصة: ${missingNames.join("، ")}`
      : "البيانات مكتملة — جاهزة للمطابقة",
    isReadyForMatching: readiness.isReadyForMatching
  };
}

export function opportunityCardSubtitle(card = {}) {
  return [
    card.description,
    card.location,
    card.priceOrBudget !== "غير محدد" ? card.priceOrBudget : ""
  ].filter(Boolean).join(" — ");
}
