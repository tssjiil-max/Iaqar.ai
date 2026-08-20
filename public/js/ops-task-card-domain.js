/**
 * Operations task card — bank listing layout for summary; unified details on open.
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
  if (type === "opportunity" || type === "intake") return true;
  if (type === "operation" && String(item.opportunityId || "").trim()) {
    if (String(item.operationType || "").toUpperCase() === "MISSING_DATA") return true;
    if (String(item.matchingReadiness || "").toUpperCase() === "NEEDS_COMPLETION") return true;
    const missing = item.matchingReadinessMissing || item.missingFields || [];
    return Array.isArray(missing) && missing.length > 0;
  }
  return false;
}

function escAttr(text = "") {
  return String(text == null ? "" : text).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
}

export function buildOpsTaskListingActionsHtml(item = {}, options = {}) {
  const taskId = escAttr(item.id || "");
  const followLabel = escAttr(options.followLabel || "تابع");
  const primaryLabel = escAttr(options.primaryLabel || "حفظ الفرصة");
  return `
    <div class="listing-card-actions">
      <button type="button" class="listing-card-action listing-card-action--secondary"
        data-ops-quick="followup" data-ops-task-id="${taskId}">${followLabel}</button>
      <button type="button" class="listing-card-action listing-card-action--primary"
        data-ops-primary="${taskId}">${primaryLabel}</button>
    </div>`;
}

export function buildOpsTaskListingContentHtml(item = {}) {
  if (!isOpsOpportunityTaskItem(item)) return "";
  return buildOpportunityListingCardInnerHtml(item, {
    layout: "ops",
    showFieldMarks: false
  });
}

export function buildOpsTaskListingBodyHtml(item = {}, options = {}) {
  if (!isOpsOpportunityTaskItem(item)) return "";
  const contentHtml = buildOpsTaskListingContentHtml(item);
  if (options.includeActions === false) return contentHtml;
  const actionsHtml = buildOpsTaskListingActionsHtml(item, options);
  return `${contentHtml}${actionsHtml}`;
}
