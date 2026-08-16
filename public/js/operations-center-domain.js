/**
 * Daily tasks (المهام اليومية) — category projection for Operations Center UI.
 * Pure logic: maps iaqar:operations-data items into six broker-facing buckets.
 */

export const OPERATIONS_CATEGORIES = Object.freeze([
  {
    key: "incomplete",
    label: "غير مكتملة",
    description: "فرص تحتاج استكمال البيانات أو حقول ناقصة.",
    colorClass: "ops-cat-red",
    openLabel: "عرض غير المكتملة"
  },
  {
    key: "follow_up",
    label: "تحتاج متابعة",
    description: "معلنون أو عملاء بانتظار رد أو موعد متابعة.",
    colorClass: "ops-cat-orange",
    openLabel: "عرض المتابعة"
  },
  {
    key: "ready",
    label: "جاهزة للمطابقة",
    description: "فرص مكتملة وجاهزة لتشغيل المطابقة.",
    colorClass: "ops-cat-green",
    openLabel: "عرض الجاهزة"
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

  if (
    upper(item.matchingReadiness) === "READY_FOR_MATCHING"
    || containsText(text, "جاهزة للمطابقة")
  ) {
    return "ready";
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
  return groups;
}

export function categoryCounts(items) {
  const groups = groupItems(items);
  return Object.fromEntries(
    OPERATIONS_CATEGORIES.map((cat) => [cat.key, groups[cat.key].length])
  );
}
