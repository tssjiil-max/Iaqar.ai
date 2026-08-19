/**
 * Readiness badges for client/owner cards in Operations Center lists.
 * Mirrors bank list readiness without duplicating bank-only layout fields.
 */

import { buildBrokerCardReadinessBadge } from "./broker-card-readiness-domain.js";

export const CLOSING_READINESS_BADGES = Object.freeze({
  very_high: { label: "عالية جدًا", mark: "🟢", cssClass: "is-very-high" },
  high: { label: "عالية", mark: "🟡", cssClass: "is-high" },
  medium: { label: "متوسطة", mark: "🟠", cssClass: "is-medium" },
  low: { label: "منخفضة", mark: "🔴", cssClass: "is-low" }
});

const CLIENT_OWNER_TYPES = new Set(["opportunity", "intake"]);

export function isClientOwnerCard(item = {}) {
  return CLIENT_OWNER_TYPES.has(String(item.recordType || "").toLowerCase());
}

/**
 * Matching readiness badge for client/owner opportunity cards.
 */
export function buildMatchingReadinessBadge(item = {}) {
  return buildBrokerCardReadinessBadge(item);
}

/**
 * Closing readiness badge for match cards in today's task list.
 */
export function buildClosingReadinessBadge(item = {}) {
  const score = Number(item.closingReadinessScore || 0);
  const fallbackKey = score >= 85 ? "very_high" : score >= 70 ? "high" : score >= 50 ? "medium" : "low";
  const key = CLOSING_READINESS_BADGES[item.closingReadinessKey]
    ? item.closingReadinessKey
    : fallbackKey;
  const meta = CLOSING_READINESS_BADGES[key] || CLOSING_READINESS_BADGES.low;
  const label = String(item.closingReadinessLabel || meta.label).trim() || meta.label;
  return {
    kind: "closing",
    label,
    detailLine: score > 0 ? `جاهزية الإغلاق: ${score}%` : `جاهزية الإغلاق: ${label}`,
    cssClass: meta.cssClass,
    mark: meta.mark
  };
}

/**
 * Resolve zero or one primary badge for an operations list item.
 */
export function buildOpsCardBadge(item = {}) {
  if (!item) return null;
  const recordType = String(item.recordType || "").toLowerCase();
  if (recordType === "match") return buildClosingReadinessBadge(item);
  if (isClientOwnerCard(item)) return buildMatchingReadinessBadge(item);
  return null;
}
