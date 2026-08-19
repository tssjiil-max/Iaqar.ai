/**
 * Broker-facing card readiness — four levels for client/owner cards.
 * UI-only scoring; does not change Worker matching or lifecycle.
 */

import { evaluateMatchingReadiness } from "./opportunity-readiness-domain.js";
import { resolveContactPhone } from "./daily-tasks-domain.js";

export const BROKER_READINESS_LEVELS = Object.freeze({
  very_high: { mark: "🟢", label: "عالية جدًا", cssClass: "is-very-high", min: 85 },
  high: { mark: "🟡", label: "عالية", cssClass: "is-high", min: 70 },
  medium: { mark: "🟠", label: "متوسطة", cssClass: "is-medium", min: 50 },
  low: { mark: "🔴", label: "منخفضة", cssClass: "is-low", min: 0 }
});

function hasText(value) {
  return Boolean(String(value || "").trim());
}

function hasPrice(record = {}) {
  return [
    record.salePrice,
    record.price,
    record.amount,
    record.budget,
    record.annualRent,
    record.priceOrBudget
  ].some((value) => Number(value) > 0);
}

function hasMedia(record = {}) {
  const paths = Array.isArray(record.mediaPaths) ? record.mediaPaths : [];
  return paths.length > 0 || Number(record.imageCount || 0) > 0 || record.hasVideo === true;
}

function lifecycleBonus(record = {}) {
  const status = String(record.lifecycleStatus || record.status || "").toUpperCase();
  if (status === "NEW" || status === "new") return -4;
  if (["CONTACTED", "FOLLOW_UP", "MATCHED"].includes(status)) return 6;
  return 0;
}

export function scoreBrokerCardReadiness(record = {}) {
  const readiness = evaluateMatchingReadiness(record);
  const missing = readiness.matchingReadinessMissing?.length || 0;
  let score = readiness.isReadyForMatching ? 42 : Math.max(8, 42 - missing * 5);

  if (resolveContactPhone(record)) score += 12;
  if (hasText(record.propertyType)) score += 8;
  if (hasText(record.district)) score += 8;
  if (hasText(record.city)) score += 6;
  if (hasPrice(record)) score += 10;
  if (hasText(record.details || record.contactName)) score += 4;
  if (hasMedia(record)) score += 6;
  score += lifecycleBonus(record);

  score = Math.max(0, Math.min(100, Math.round(score)));
  const level = score >= 85 ? "very_high"
    : score >= 70 ? "high"
    : score >= 50 ? "medium"
    : "low";
  const meta = BROKER_READINESS_LEVELS[level];
  return {
    score,
    level,
    mark: meta.mark,
    label: meta.label,
    cssClass: meta.cssClass,
    isReadyForMatching: readiness.isReadyForMatching,
    matchingReadinessMissing: readiness.matchingReadinessMissing || []
  };
}

export function buildBrokerCardReadinessBadge(record = {}) {
  const scored = scoreBrokerCardReadiness(record);
  const missingNames = scored.matchingReadinessMissing.length;
  const detailLine = scored.isReadyForMatching
    ? `جاهزة للمطابقة — ${scored.score}%`
    : (missingNames ? `ينقص ${missingNames} حقول — ${scored.score}%` : `تحتاج استكمال — ${scored.score}%`);
  return {
    kind: "broker_readiness",
    label: scored.label,
    mark: scored.mark,
    cssClass: scored.cssClass,
    detailLine,
    score: scored.score
  };
}
