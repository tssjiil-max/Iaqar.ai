/**
 * Daily tasks (المهام اليومية) — category projection for Operations Center UI.
 * Pure logic: maps iaqar:operations-data items into six broker-facing buckets.
 */

import { missingFieldLabelsArabic } from "./opportunity-readiness-domain.js";

export const OPERATIONS_CATEGORIES = Object.freeze([
  {
    key: "incomplete",
    label: "تحتاج استكمال",
    description: "فرص تحتاج استكمال البيانات أو حقول ناقصة.",
    colorClass: "ops-cat-red",
    openLabel: "عرض تحتاج استكمال"
  },
  {
    key: "ready",
    label: "جاهزة للمطابقة",
    description: "فرص مكتملة وجاهزة لتشغيل المطابقة.",
    colorClass: "ops-cat-green",
    openLabel: "عرض الجاهزة"
  },
  {
    key: "follow_up",
    label: "تحتاج متابعة",
    description: "معلنون أو عملاء بانتظار رد أو موعد متابعة.",
    colorClass: "ops-cat-orange",
    openLabel: "عرض المتابعة"
  },
  {
    key: "matched",
    label: "تمت المطابقة",
    description: "مطابقات ونتائج تحتاج مراجعة داخل المكتب.",
    colorClass: "ops-cat-green-dark",
    openLabel: "عرض المطابقة"
  },
  {
    key: "responded",
    label: "تم الرد عليها",
    description: "ردود تعاون أو ردود خارجية جديدة.",
    colorClass: "ops-cat-blue",
    openLabel: "عرض الردود"
  },
  {
    key: "archived",
    label: "منتهية ومؤرشفة",
    description: "فرص وعمليات أُغلقت أو أُرشفت أو انتهت صلاحيتها.",
    colorClass: "ops-cat-gray",
    openLabel: "عرض المؤرشف"
  }
]);

const ARCHIVED_STATUSES = new Set([
  "COMPLETED",
  "ARCHIVED",
  "CLOSED_WON",
  "CLOSED_LOST",
  "DISMISSED",
  "EXPIRED",
  "CLOSED",
  "LOST"
]);

function upper(value) {
  return String(value ?? "").trim().toUpperCase();
}

function containsText(value, needle) {
  return String(value || "").includes(needle);
}

function combinedText(item) {
  return [
    item?.title,
    item?.subtitle,
    item?.opsStatusLine,
    item?.details,
    ...(Array.isArray(item?.detailsLines) ? item.detailsLines : [])
  ].join(" ");
}

/**
 * Hide transient save-success rows from broker task counts.
 */
export function isSavedOpportunityFeedback(item) {
  const type = upper(item?.operationType);
  const title = String(item?.title || "").trim();
  return type === "OPPORTUNITY_SAVED" || title === "فرصة محفوظة مسبقًا";
}

export function filterBrokerVisibleItems(items) {
  return (items || []).filter((item) => !isSavedOpportunityFeedback(item));
}

export function getCategoryDefinition(key) {
  return OPERATIONS_CATEGORIES.find((cat) => cat.key === key) || null;
}

/**
 * Resolve opportunity id from an operations list item.
 */
export function extractOpportunityId(item) {
  if (!item) return "";
  const fromOpportunityId = String(item.opportunityId || "").trim().replace(/^(?:opp[-_])+/, "");
  if (fromOpportunityId) return fromOpportunityId;

  const recordType = String(item.recordType || "").toLowerCase();
  if (recordType === "opportunity" || recordType === "intake") {
    const recordId = String(item.recordId || "").trim().replace(/^(?:opp[-_])+/, "");
    if (recordId) return recordId;
  }

  const rawId = String(item.id || "").trim();
  if (/^opp[-_]/i.test(rawId)) {
    return rawId.replace(/^(?:opp[-_])+/, "");
  }
  return "";
}

/**
 * Count missing matching-readiness fields on an item.
 */
export function missingFieldCount(item) {
  if (!item) return 0;
  if (Array.isArray(item.matchingReadinessMissing) && item.matchingReadinessMissing.length) {
    return item.matchingReadinessMissing.length;
  }
  if (Array.isArray(item.missingFields) && item.missingFields.length) {
    return item.missingFields.length;
  }
  const opType = upper(item.operationType);
  if (opType === "MISSING_DATA") {
    const text = combinedText(item);
    const match = text.match(/الحقول الناقصة:\s*([^]+?)(?:\.|$)/);
    if (match) {
      const parts = match[1].split(/[،,]/).map((s) => s.trim()).filter(Boolean);
      if (parts.length) return parts.length;
    }
    return 1;
  }
  return 0;
}

function itemSortTimestamp(item) {
  return String(item?.createdAt || item?.updatedAt || item?.receivedAt || "");
}

/**
 * Incomplete bucket: one missing field first, then two, then three+, oldest first.
 */
export function sortIncompleteItems(items) {
  return [...(items || [])].sort((a, b) => {
    const countDiff = missingFieldCount(a) - missingFieldCount(b);
    if (countDiff !== 0) return countDiff;
    const timeDiff = itemSortTimestamp(a).localeCompare(itemSortTimestamp(b));
    if (timeDiff !== 0) return timeDiff;
    return (a.priority ?? 2) - (b.priority ?? 2);
  });
}

export function sortCategoryItems(categoryKey, items) {
  if (categoryKey === "incomplete") return sortIncompleteItems(items);
  return [...(items || [])].sort((a, b) => {
    const timeDiff = itemSortTimestamp(a).localeCompare(itemSortTimestamp(b));
    if (timeDiff !== 0) return timeDiff;
    return (a.priority ?? 2) - (b.priority ?? 2);
  });
}

/**
 * One broker-facing suggestion — does not auto-run.
 */
export function bestActionHint(item) {
  if (!item) return "";
  const cat = categoryKey(item);
  if (cat === "incomplete") {
    const labels = missingFieldLabelsArabic(item.matchingReadinessMissing || item.missingFields || []);
    if (labels.length) return `أكمل ${labels[0]}`;
    const count = missingFieldCount(item);
    if (count === 1) return "أكمل الحقل الناقص";
    if (count > 1) return `أكمل ${count} حقول ناقصة`;
    return "استكمال الفرصة";
  }
  if (cat === "ready") {
    const scoreText = String(item.bestMatchScoreText || "");
    const matchCount = Number(item.matchCount || 0);
    if (matchCount > 0 || scoreText) {
      const n = matchCount > 0 ? matchCount : (scoreText.match(/\d+/)?.[0] || "");
      if (n) return `راجع ${n} مطابقات`;
      return "راجع المطابقات";
    }
    const text = combinedText(item);
    if (containsText(text, "لا توجد مطابقات") || containsText(text, "لا مطابقات")) {
      return "اطلب تعاونًا من مكتب متخصص";
    }
    return "عرض المطابقات";
  }
  if (cat === "follow_up") {
    return "حدد موعد متابعة";
  }
  if (cat === "matched") {
    return "تابع التواصل مع الطرفين";
  }
  if (cat === "responded") {
    return "عالج الرد والخطوة التالية";
  }
  if (cat === "archived") {
    return "مراجعة السجل";
  }
  return String(item.nextAction || item.actionLabel || "").trim();
}

export function primaryActionLabel(item) {
  if (!item) return "بدء الإجراء";
  const cat = categoryKey(item);
  if (cat === "incomplete") return "استكمال الفرصة";
  if (cat === "ready") return "فتح مساحة العمل";
  if (cat === "follow_up") return "متابعة الفرصة";
  if (cat === "matched") return "مراجعة المطابقة";
  if (cat === "responded") return "معالجة الرد";
  if (cat === "archived") return "عرض السجل";
  return String(item.actionLabel || "بدء الإجراء").trim();
}

/**
 * Assign one category key per operations item (first-match priority).
 */
export function categoryKey(item) {
  if (!item) return "follow_up";

  const opType = upper(item.operationType);
  const status = upper(item.status || item.statusLabel);
  const lifecycle = upper(item.lifecycleStatus);
  const recordType = String(item.recordType || "").toLowerCase();
  const text = combinedText(item);

  if (
    ARCHIVED_STATUSES.has(status)
    || ARCHIVED_STATUSES.has(lifecycle)
    || opType === "OPPORTUNITY_SAVED"
  ) {
    return "archived";
  }

  if (
    opType === "MISSING_DATA"
    || containsText(text, "تحتاج استكمال")
    || containsText(text, "استكمال البيانات")
    || containsText(text, "بيانات ناقصة")
    || containsText(text, "غير مكتمل")
    || upper(item.matchingReadiness) === "NEEDS_COMPLETION"
  ) {
    return "incomplete";
  }

  if (
    upper(item.matchingReadiness) === "READY_FOR_MATCHING"
    || containsText(text, "جاهزة للمطابقة")
  ) {
    return "ready";
  }

  if (
    opType === "ADVERTISER_FOLLOWUP"
    || opType === "FOLLOW_UP"
    || status === "FOLLOW_UP"
    || status === "CONTACT_PENDING"
    || status === "WAITING_EXTERNAL_RESPONSE"
    || containsText(text, "بانتظار الرد")
    || containsText(text, "متابعة")
  ) {
    return "follow_up";
  }

  if (
    opType === "EXTERNAL_RESPONSE"
    || opType === "COOPERATION_RESPONSE"
    || containsText(text, "رد جديد")
  ) {
    return "responded";
  }

  if (
    opType === "MATCH_REVIEW"
    || status === "MATCHED"
    || recordType === "match"
    || Boolean(item.matchId)
    || (recordType === "deal" && !ARCHIVED_STATUSES.has(status))
  ) {
    return "matched";
  }

  if (recordType === "intake") return "follow_up";

  return "follow_up";
}

/**
 * Group broker-visible items into the six category buckets.
 */
export function groupItems(items) {
  const groups = Object.fromEntries(OPERATIONS_CATEGORIES.map((cat) => [cat.key, []]));
  for (const item of filterBrokerVisibleItems(items)) {
    const key = categoryKey(item);
    if (groups[key]) groups[key].push(item);
  }
  for (const cat of OPERATIONS_CATEGORIES) {
    groups[cat.key] = sortCategoryItems(cat.key, groups[cat.key]);
  }
  return groups;
}

export function categoryCounts(items) {
  const groups = groupItems(items);
  return Object.fromEntries(
    OPERATIONS_CATEGORIES.map((cat) => [cat.key, groups[cat.key].length])
  );
}
