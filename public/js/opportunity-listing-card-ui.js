/**
 * Shared opportunity listing card — same بيانات الفرصة table as every offer/request.
 */

import {
  buildListingFieldChecks,
  LISTING_FIELD_ORDER,
  normalizeListingRecord
} from "./opportunity-listing-normalize.js";
import {
  buildOpportunityDataTableHtml,
  buildOpportunityDetailsViewModel
} from "./opportunity-details-ui.js";
import {
  hasRecentBrokerAction,
  recentBrokerActionMarkHtml
} from "./broker-action-progress-domain.js";

export {
  buildListingFieldChecks,
  LISTING_FIELD_ORDER,
  normalizeListingRecord
};

/**
 * Unified listing card body — identical data table for bank list and daily tasks.
 * @param {object} record
 * @param {object} [options]
 * @param {string} [options.footerHtml]
 * @param {string} [options.actionsHtml]
 * @param {boolean} [options.includeRevealButton=false]
 */
export function buildOpportunityListingCardInnerHtml(record = {}, options = {}) {
  const normalized = normalizeListingRecord(record);
  const vm = buildOpportunityDetailsViewModel(normalized.id, normalized);
  const tableHtml = buildOpportunityDataTableHtml(vm, {
    includeRevealButton: options.includeRevealButton === true
  });
  const extra = [options.footerHtml, options.actionsHtml].filter(Boolean).join("");
  const recent = hasRecentBrokerAction(record, options.nowMs);
  const markHtml = recentBrokerActionMarkHtml(record, options);
  return `
    <div class="listing-card-inner listing-card-inner--unified${recent ? " has-recent-action" : ""}"${recent ? ' data-recent-action="1"' : ""}>
      ${markHtml}
      ${tableHtml}
      ${extra ? `<div class="listing-card-extra">${extra}</div>` : ""}
    </div>`;
}
