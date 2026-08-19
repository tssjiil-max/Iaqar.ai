/**
 * Operations task card — delegates to shared listing card layout.
 */

import {
  buildListingFieldChecks,
  buildOpportunityListingCardInnerHtml,
  LISTING_FIELD_ORDER,
  normalizeListingRecord
} from "./opportunity-listing-card-ui.js";
import { buildBankListCardView } from "./bank-list-card-domain.js";

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
  return type === "opportunity" || type === "intake";
}

export function buildOpsTaskListingBodyHtml(item = {}) {
  if (!isOpsOpportunityTaskItem(item)) return "";
  return buildOpportunityListingCardInnerHtml(item);
}
