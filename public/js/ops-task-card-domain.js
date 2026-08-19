/**
 * Operations task card — unified opportunity details on daily task surfaces.
 */

import {
  buildListingFieldChecks,
  LISTING_FIELD_ORDER,
  normalizeListingRecord
} from "./opportunity-listing-card-ui.js";
import { buildBankListCardView } from "./bank-list-card-domain.js";
import { buildOpportunityDetailsCoreHtml } from "./opportunity-details-ui.js";
import { evaluateMatchingReadiness } from "./opportunity-readiness-domain.js";

export const OPS_TASK_FIELD_ORDER = LISTING_FIELD_ORDER;

export function opsTaskItemAsRecord(item = {}) {
  return normalizeListingRecord(item);
}

export const buildOpsTaskFieldChecks = buildListingFieldChecks;

export function buildOpsTaskAdSummary(record = {}) {
  const card = buildBankListCardView(normalizeListingRecord(record));
  const specs = [card.priceText, card.areaText, card.roomsText ? `${card.roomsText} غرف` : ""]
    .filter(Boolean)
    .join(" · ");
  return {
    headline: card.title,
    location: card.location,
    specs,
    kindBadge: card.kindBadge,
    isReadyForMatching: card.isReadyForMatching
  };
}

export function isOpsOpportunityTaskItem(item = {}) {
  const type = String(item.recordType || "").toLowerCase();
  if (type === "opportunity" || type === "intake") return true;
  if (type === "operation" && String(item.opportunityId || "").trim()) {
    if (String(item.operationType || "").toUpperCase() === "MISSING_DATA") return true;
    if (String(item.matchingReadiness || "").toUpperCase() === "NEEDS_COMPLETION") return true;
    const missing = item.matchingReadinessMissing || item.missingFields || [];
    return Array.isArray(missing) && missing.length > 0;
  }
  return false;
}

function resolveOpsTaskOpportunityId(item = {}) {
  const opportunityId = String(item.opportunityId || "").trim();
  if (opportunityId) return opportunityId;
  const recordType = String(item.recordType || "").toLowerCase();
  if (recordType === "opportunity" || recordType === "intake") {
    const recordId = String(item.recordId || "").trim();
    if (recordId) return recordId;
  }
  const rawId = String(item.id || "").trim();
  if (rawId.startsWith("opp-")) return rawId.slice(4);
  return rawId;
}

export function buildOpsTaskListingBodyHtml(item = {}) {
  if (!isOpsOpportunityTaskItem(item)) return "";
  const id = resolveOpsTaskOpportunityId(item);
  const readiness = evaluateMatchingReadiness(item);
  return buildOpportunityDetailsCoreHtml(id, item, readiness).html;
}
